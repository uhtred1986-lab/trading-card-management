/**
 * The Android phone on the USB cable, through `adb` (Android platform tools), for
 * `scripts/arena-phone-run.mts`. Only what that run needs: who the device is, the two port
 * mappings (the phone reaching the laptop's server, the laptop reaching the phone's Chrome),
 * airplane mode, a cold launch of the browser, a screenshot and the browser's memory.
 *
 * Every call is synchronous (`execFileSync`): the run is a sequence, and a hung `adb` is
 * stopped by the timeout rather than left behind. Nothing here needs root.
 */
import { execFileSync } from "node:child_process";

export interface DeviceInfo {
  serial: string;
  model: string;
  manufacturer: string;
  android: string;
  sdk: number;
  browserPackage: string;
  browserVersion: string | null;
  screen: string | null;
  density: string | null;
  batteryLevel: number | null;
  charging: boolean | null;
  powerSave: boolean | null;
  freeDataBytes: number | null;
}

export class Adb {
  private constructor(readonly serial: string, readonly browserPackage: string) {}

  /** The one device attached (or `serial`); throws with what to do when there is none or several. */
  static open(o: { serial?: string; browserPackage?: string } = {}): Adb {
    let out: string;
    try {
      out = execFileSync("adb", ["devices"], { encoding: "utf8", timeout: 20000 });
    } catch (e) {
      throw new Error(`adb is not on the PATH or did not answer (${(e as Error).message.split("\n")[0]}). Install the Android platform tools (Windows: \`winget install Google.PlatformTools\`).`);
    }
    const rows = out.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 2 && r[0]);
    const want = o.serial ?? process.env.ANDROID_SERIAL;
    const pick = want ? rows.find((r) => r[0] === want) : rows.length === 1 ? rows[0] : null;
    if (!pick) {
      if (!rows.length) throw new Error("No Android device attached. Plug the phone in with USB debugging on, and accept the prompt on the phone.");
      throw new Error(want ? `Device ${want} is not attached (attached: ${rows.map((r) => r[0]).join(", ")}).` : `Several devices attached (${rows.map((r) => r[0]).join(", ")}): pass --serial.`);
    }
    if (pick[1] === "unauthorized") throw new Error(`Device ${pick[0]} is unauthorized: unlock the phone and accept "Allow USB debugging".`);
    if (pick[1] !== "device") throw new Error(`Device ${pick[0]} is ${pick[1]}, not ready.`);
    return new Adb(pick[0], o.browserPackage ?? "com.android.chrome");
  }

  /** `adb -s <serial> ...args`, stdout as text. */
  run(args: string[], timeoutMs = 30000): string {
    return execFileSync("adb", ["-s", this.serial, ...args], { encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 << 20 });
  }

  shell(command: string, timeoutMs = 30000): string {
    return this.run(["shell", command], timeoutMs).replace(/\r/g, "");
  }

  /** The same, but an error is an answer (null) rather than a throw. */
  try(command: string): string | null {
    try {
      return this.shell(command);
    } catch {
      return null;
    }
  }

  info(): DeviceInfo {
    const prop = (k: string) => (this.try(`getprop ${k}`) ?? "").trim();
    const battery = this.try("dumpsys battery") ?? "";
    const level = battery.match(/\blevel: (\d+)/);
    const powered = /(AC|USB|Wireless) powered: true/.test(battery);
    const df = this.try("df -k /data") ?? "";
    const dfRow = df.trim().split("\n").pop()?.trim().split(/\s+/);
    const free = dfRow && dfRow.length >= 4 && /^\d+$/.test(dfRow[3]) ? Number(dfRow[3]) * 1024 : null;
    const pkg = this.try(`dumpsys package ${this.browserPackage}`) ?? "";
    return {
      serial: this.serial,
      model: prop("ro.product.model"),
      manufacturer: prop("ro.product.manufacturer"),
      android: prop("ro.build.version.release"),
      sdk: Number(prop("ro.build.version.sdk")) || 0,
      browserPackage: this.browserPackage,
      browserVersion: pkg.match(/versionName=(\S+)/)?.[1] ?? null,
      screen: (this.try("wm size") ?? "").match(/(\d+x\d+)\s*$/m)?.[1] ?? null,
      density: (this.try("wm density") ?? "").match(/(\d+)\s*$/m)?.[1] ?? null,
      batteryLevel: level ? Number(level[1]) : null,
      charging: battery ? powered : null,
      powerSave: ((v) => (v === "1" ? true : v === "0" ? false : null))((this.try("settings get global low_power") ?? "").trim()),
      freeDataBytes: free,
    };
  }

  /** The phone's `localhost:port` reaches the laptop's `localhost:port` (over the cable, no Wi-Fi needed). */
  reverse(port: number) {
    this.run(["reverse", `tcp:${port}`, `tcp:${port}`]);
  }

  /** Undo every `reverse`: from now on nothing on the laptop is reachable from the phone. */
  reverseRemoveAll() {
    try {
      this.run(["reverse", "--remove-all"]);
    } catch {
      /* none set */
    }
  }

  /** The laptop's `localhost:localPort` reaches the browser's DevTools socket on the phone. */
  forwardDevtools(localPort: number) {
    // Chrome stable, Beta, Dev and Canary all listen on the same abstract socket name.
    this.run(["forward", `tcp:${localPort}`, "localabstract:chrome_devtools_remote"]);
  }

  forwardRemove(localPort: number) {
    try {
      this.run(["forward", "--remove", `tcp:${localPort}`]);
    } catch {
      /* not set */
    }
  }

  airplaneOn(): boolean {
    return (this.try("settings get global airplane_mode_on") ?? "").trim() === "1";
  }

  /**
   * Airplane mode on or off. `cmd connectivity airplane-mode` (Android 11+) needs no root; older
   * devices refuse it, and the caller is told so (the run then says airplane mode was not
   * switched, and the network is cut only by stopping the server and the `reverse`).
   */
  setAirplane(on: boolean): { ok: boolean; how: string } {
    const r = this.try(`cmd connectivity airplane-mode ${on ? "enable" : "disable"}`);
    for (let i = 0; i < 20; i++) {
      if (this.airplaneOn() === on) return { ok: true, how: "cmd connectivity airplane-mode" };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
    return { ok: false, how: `cmd connectivity airplane-mode answered ${JSON.stringify((r ?? "an error").trim().slice(0, 120))}` };
  }

  /** Keep the screen on while the cable is in (a locked screen hides the browser). Returns the previous setting. */
  stayAwake(on: boolean) {
    this.try(`svc power stayon ${on ? "usb" : "false"}`);
    if (on) this.try("input keyevent KEYCODE_WAKEUP");
  }

  /** Swipe the browser away the hard way: its process is killed, as Android does under memory pressure. */
  forceStopBrowser() {
    this.shell(`am force-stop ${this.browserPackage}`);
  }

  /** Open `url` in the browser (a cold launch when the browser was stopped). */
  openUrl(url: string) {
    this.shell(`am start -a android.intent.action.VIEW -d '${url.replace(/'/g, "")}' -p ${this.browserPackage}`);
  }

  /** The device's own screenshot (status bar, keyboard and system dialogs included), PNG. */
  screencap(): Buffer {
    return execFileSync("adb", ["-s", this.serial, "exec-out", "screencap", "-p"], { timeout: 30000, maxBuffer: 128 << 20 });
  }

  /**
   * The browser's memory as Android counts it: the proportional set size of every one of its
   * processes (browser, GPU, renderers), in bytes. Not the JS heap: the heap is measured in the
   * page; this is what the phone pays.
   */
  browserPss(): { totalBytes: number; processes: Array<{ name: string; bytes: number }> } | null {
    const out = this.try("dumpsys meminfo");
    if (!out) return null;
    const processes: Array<{ name: string; bytes: number }> = [];
    const section = out.split(/Total PSS by process:/)[1]?.split(/\n\s*\n/)[0] ?? "";
    for (const m of section.matchAll(/([\d,]+)K: (\S+)/g)) {
      if (m[2].startsWith(this.browserPackage)) processes.push({ name: m[2], bytes: Number(m[1].replace(/,/g, "")) * 1024 });
    }
    return processes.length ? { totalBytes: processes.reduce((a, p) => a + p.bytes, 0), processes } : null;
  }
}
