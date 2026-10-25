/**
 * #902: the durable spend ledger of the local-policy versus Claude API campaign (#906).
 *
 * One append-only journal (`ledger.jsonl`) in a local directory, never the database: the campaign
 * runs offline against pinned inputs, and the owner's caps must survive a crash, a restart and
 * several workers at once. Every change is made under an exclusive lock file (`O_EXCL`), re-reads
 * the journal, checks the caps against **everything** recorded, appends one line and `fsync`s it
 * before the caller may act on it.
 *
 * The life of one paid call:
 *
 *   reserve   the most the call can cost (`maxChargeMicros`), refused when the pilot or total cap
 *             cannot cover it — in-flight reservations of other workers included
 *   dispatch  written **before** the request leaves; a reservation without one was provably never
 *             sent, so a restart may release it
 *   settle    the actual charge from the reported usage (it may exceed the reservation; that is
 *             recorded as it is and halts further reservations)
 *   ambiguous a dispatched call that failed without usage (timeout, connection loss, 5xx, refusal of
 *             unknown cost): it keeps the whole reservation as spent
 *   reconcile the owner's own figure for an ambiguous or orphaned call, read off the Console
 *
 * Nothing is released optimistically: a dispatched call is charged its reservation until usage or
 * the owner says otherwise. A crash between dispatch and settle leaves exactly that state.
 *
 * Games count too: a pilot game and a full-campaign game each take one slot of their cap when they
 * start (8 pilot, 40 in all, pilot included), whether they finish or not.
 */
import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeSync, fstatSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const LEDGER_FORMAT = 1;

export type CampaignPhase = "pilot" | "full";

export interface CampaignCaps {
  /** The pilot's own cap, in micro-dollars and games. */
  pilot: { micros: number; games: number };
  /** Everything, pilot included. */
  total: { micros: number; games: number };
}

/** Approved by the owner on 15 Oct 2026 (#906): $20 / 8 games pilot, $100 / 40 games inclusive total. */
export const APPROVED_CAPS: CampaignCaps = { pilot: { micros: 20_000_000, games: 8 }, total: { micros: 100_000_000, games: 40 } };

export interface CallUsageRecord { input: number; output: number; cacheRead: number; cacheWrite: number }

type Line =
  | { t: "open"; format: typeof LEDGER_FORMAT; campaign: string; caps: CampaignCaps; rateSheet: string; dryRun: boolean; at: string }
  | { t: "game"; game: string; phase: CampaignPhase; at: string }
  | { t: "gameEnd"; game: string; outcome: string; at: string }
  | { t: "reserve"; id: string; game: string; phase: CampaignPhase; model: string; maxMicros: number; at: string; pid: number }
  | { t: "dispatch"; id: string; at: string }
  | { t: "release"; id: string; why: string; at: string }
  | { t: "settle"; id: string; usage: CallUsageRecord; micros: number; billed: boolean; at: string }
  | { t: "ambiguous"; id: string; why: string; at: string }
  | { t: "reconcile"; id: string; micros: number; source: string; at: string };

export type ReservationState = "reserved" | "dispatched" | "released" | "settled" | "ambiguous" | "reconciled";

export interface Reservation {
  id: string;
  game: string;
  phase: CampaignPhase;
  model: string;
  maxMicros: number;
  state: ReservationState;
  /** What the reservation counts against the caps now. */
  chargedMicros: number;
  /** Settled usage, when there is some. */
  usage: CallUsageRecord | null;
  billed: boolean | null;
}

export interface LedgerSummary {
  campaign: string;
  caps: CampaignCaps;
  dryRun: boolean;
  /** Everything counted against the caps: settled and reconciled charges, plus the whole reservation of every open, dispatched or ambiguous call. */
  committedMicros: number;
  pilotCommittedMicros: number;
  /** Settled charges reported as billed (what the provider should invoice). */
  billedMicros: number;
  /** Reservations still open (not settled, released, ambiguous or reconciled). */
  inFlight: number;
  ambiguous: number;
  overruns: string[];
  games: { pilot: number; total: number; finished: number };
  remaining: { pilotMicros: number; totalMicros: number; pilotGames: number; totalGames: number };
  reservations: number;
}

export type LedgerRefusal = { ok: false; reason: string; code: "cap" | "games" | "halted" | "state" | "phase" };

interface Folded {
  open: Extract<Line, { t: "open" }> | null;
  games: Map<string, { phase: CampaignPhase; outcome: string | null }>;
  reservations: Map<string, Reservation>;
  dispatched: Set<string>;
}

const now = () => new Date().toISOString();

function sleepMs(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export class CampaignLedger {
  readonly dir: string;
  readonly journal: string;
  private readonly lockPath: string;
  private folded: Folded = { open: null, games: new Map(), reservations: new Map(), dispatched: new Set() };
  private readOffset = 0;
  private counter = 0;

  private constructor(dir: string) {
    this.dir = dir;
    this.journal = join(dir, "ledger.jsonl");
    this.lockPath = join(dir, "ledger.lock");
  }

  /**
   * Open (or create) the campaign ledger in `dir`. An existing journal must name the same campaign,
   * caps and dry-run flag: a restart can never change the caps. A different rate sheet is allowed
   * (rates are re-verified) and recorded per reservation by its model, not here.
   */
  static open(dir: string, header: { campaign: string; caps: CampaignCaps; rateSheet: string; dryRun: boolean }): CampaignLedger {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const ledger = new CampaignLedger(dir);
    ledger.locked(() => {
      if (!ledger.folded.open) {
        ledger.append({ t: "open", format: LEDGER_FORMAT, campaign: header.campaign, caps: header.caps, rateSheet: header.rateSheet, dryRun: header.dryRun, at: now() });
        return;
      }
      const o = ledger.folded.open;
      if (o.campaign !== header.campaign) throw new Error(`ledger ${dir} belongs to campaign ${o.campaign}, not ${header.campaign}`);
      if (JSON.stringify(o.caps) !== JSON.stringify(header.caps)) throw new Error(`ledger ${dir} was opened with caps ${JSON.stringify(o.caps)}; a restart cannot change them to ${JSON.stringify(header.caps)}`);
      if (o.dryRun !== header.dryRun) throw new Error(`ledger ${dir} is a ${o.dryRun ? "dry-run" : "paid"} ledger; it cannot be reused for a ${header.dryRun ? "dry run" : "paid run"}`);
    });
    return ledger;
  }

  /** Read-only view of an existing ledger (no lock, no header check). */
  static inspect(dir: string): CampaignLedger {
    const ledger = new CampaignLedger(dir);
    ledger.catchUp(false);
    if (!ledger.folded.open) throw new Error(`no campaign ledger in ${dir}`);
    return ledger;
  }

  // ------------------------------------------------------------------ locking and the journal

  private locked<T>(fn: () => T): T {
    const deadline = Date.now() + 30_000;
    let fd: number | null = null;
    while (fd === null) {
      try {
        fd = openSync(this.lockPath, "wx", 0o600);
        writeSync(fd, `${process.pid}\n${hostname()}\n${now()}\n`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        this.breakStaleLock();
        if (Date.now() > deadline) throw new Error(`the campaign ledger lock ${this.lockPath} is held; refusing to wait longer`);
        sleepMs(2 + Math.floor(Math.random() * 5));
      }
    }
    try {
      this.catchUp(true);
      return fn();
    } finally {
      closeSync(fd);
      unlinkSync(this.lockPath);
    }
  }

  /** A lock left by a process on this host that is no longer running is removed; anything else is waited for. */
  private breakStaleLock() {
    let text: string;
    try { text = readFileSync(this.lockPath, "utf8"); } catch { return; }
    const [pidText, host] = text.split("\n");
    const pid = Number(pidText);
    if (!pidText || !Number.isInteger(pid)) {
      // Written but not yet filled by its holder, or torn: only stale when old.
      try { if (Date.now() - statSync(this.lockPath).mtimeMs > 10_000) unlinkSync(this.lockPath); } catch { /* gone */ }
      return;
    }
    if (host === hostname() && !alive(pid)) {
      try { unlinkSync(this.lockPath); } catch { /* another waiter broke it first */ }
    }
  }

  /**
   * Fold every complete line written since the last read. A final line without its newline is a
   * write torn by a crash: under the lock it is cut off (it never returned to its caller, so nothing
   * acted on it); a malformed complete line anywhere fails closed.
   */
  private catchUp(underLock: boolean) {
    if (!existsSync(this.journal)) return;
    const fd = openSync(this.journal, underLock ? "r+" : "r");
    try {
      const size = fstatSync(fd).size;
      if (size < this.readOffset) throw new Error(`the campaign ledger ${this.journal} shrank; refusing to continue`);
      const buf = Buffer.alloc(size - this.readOffset);
      readSync(fd, buf, 0, buf.length, this.readOffset);
      const text = buf.toString("utf8");
      const lastNl = text.lastIndexOf("\n");
      const complete = lastNl < 0 ? "" : text.slice(0, lastNl + 1);
      if (underLock && complete.length < text.length) {
        ftruncateSync(fd, this.readOffset + Buffer.byteLength(complete, "utf8"));
        fsyncSync(fd);
      }
      let lineNo = 0;
      for (const raw of complete.split("\n")) {
        lineNo++;
        if (!raw) continue;
        let line: Line;
        try { line = JSON.parse(raw) as Line; } catch { throw new Error(`the campaign ledger ${this.journal} has a malformed line (${lineNo} after offset ${this.readOffset}); refusing to continue`); }
        this.apply(line);
      }
      this.readOffset += Buffer.byteLength(complete, "utf8");
    } finally {
      closeSync(fd);
    }
  }

  private append(line: Line) {
    const fd = openSync(this.journal, "a", 0o600);
    try {
      const bytes = Buffer.from(JSON.stringify(line) + "\n", "utf8");
      writeSync(fd, bytes);
      fsyncSync(fd);
      this.readOffset += bytes.length;
    } finally {
      closeSync(fd);
    }
    this.apply(line);
  }

  private apply(line: Line) {
    const f = this.folded;
    const r = "id" in line ? f.reservations.get(line.id) : undefined;
    switch (line.t) {
      case "open":
        if (f.open) throw new Error("the campaign ledger has two headers");
        if (line.format !== LEDGER_FORMAT) throw new Error(`ledger format ${line.format} is not ${LEDGER_FORMAT}`);
        f.open = line;
        return;
      case "game":
        f.games.set(line.game, { phase: line.phase, outcome: null });
        return;
      case "gameEnd": {
        const g = f.games.get(line.game);
        if (g) g.outcome = line.outcome;
        return;
      }
      case "reserve":
        f.reservations.set(line.id, { id: line.id, game: line.game, phase: line.phase, model: line.model, maxMicros: line.maxMicros, state: "reserved", chargedMicros: line.maxMicros, usage: null, billed: null });
        return;
      case "dispatch":
        if (r) { r.state = "dispatched"; f.dispatched.add(line.id); }
        return;
      case "release":
        if (r) { r.state = "released"; r.chargedMicros = 0; }
        return;
      case "settle":
        if (r) { r.state = "settled"; r.chargedMicros = line.micros; r.usage = line.usage; r.billed = line.billed; }
        return;
      case "ambiguous":
        if (r) { r.state = "ambiguous"; r.chargedMicros = r.maxMicros; }
        return;
      case "reconcile":
        if (r) { r.state = "reconciled"; r.chargedMicros = line.micros; r.billed = true; }
        return;
    }
  }

  // ------------------------------------------------------------------ the operations

  /** Take one game slot for `game` in `phase`. A game key is used once: a crashed game stays counted and is not resumed. */
  startGame(game: string, phase: CampaignPhase): { ok: true } | LedgerRefusal {
    return this.locked(() => {
      if (this.folded.games.has(game)) return { ok: false as const, code: "state" as const, reason: `game ${game} was already started; a crashed or finished game is not restarted under the same key` };
      const s = this.summaryNow();
      if (phase === "pilot" && s.remaining.pilotGames < 1) return { ok: false as const, code: "games" as const, reason: `the pilot's ${s.caps.pilot.games} games are used` };
      if (s.remaining.totalGames < 1) return { ok: false as const, code: "games" as const, reason: `the campaign's ${s.caps.total.games} games are used` };
      this.append({ t: "game", game, phase, at: now() });
      return { ok: true as const };
    });
  }

  finishGame(game: string, outcome: string): void {
    this.locked(() => {
      if (!this.folded.games.has(game)) throw new Error(`game ${game} was never started`);
      this.append({ t: "gameEnd", game, outcome, at: now() });
    });
  }

  /** Reserve `maxMicros` for one call of `game`, or refuse when a cap cannot cover it. */
  reserve(input: { game: string; model: string; maxMicros: number }): { ok: true; id: string } | LedgerRefusal {
    if (!Number.isSafeInteger(input.maxMicros) || input.maxMicros <= 0) throw new Error(`a reservation is a positive whole number of micro-dollars (got ${input.maxMicros})`);
    return this.locked(() => {
      const g = this.folded.games.get(input.game);
      if (!g) return { ok: false as const, code: "state" as const, reason: `game ${input.game} has not started` };
      if (g.outcome !== null) return { ok: false as const, code: "state" as const, reason: `game ${input.game} has finished` };
      const s = this.summaryNow();
      if (s.overruns.length) return { ok: false as const, code: "halted" as const, reason: `halted: a settled call cost more than its reservation (${s.overruns.join(", ")}); the owner reviews before anything more is spent` };
      if (g.phase === "pilot" && input.maxMicros > s.remaining.pilotMicros) return { ok: false as const, code: "cap" as const, reason: `the pilot cap cannot cover ${input.maxMicros} µ$ (${s.remaining.pilotMicros} µ$ left of ${s.caps.pilot.micros})` };
      if (input.maxMicros > s.remaining.totalMicros) return { ok: false as const, code: "cap" as const, reason: `the total cap cannot cover ${input.maxMicros} µ$ (${s.remaining.totalMicros} µ$ left of ${s.caps.total.micros})` };
      const id = `r-${process.pid}-${Date.now().toString(36)}-${(this.counter++).toString(36)}-${createHash("sha256").update(`${Math.random()}`).digest("hex").slice(0, 6)}`;
      this.append({ t: "reserve", id, game: input.game, phase: g.phase, model: input.model, maxMicros: input.maxMicros, at: now(), pid: process.pid });
      return { ok: true as const, id };
    });
  }

  private expect(id: string, states: ReservationState[]): Reservation {
    const r = this.folded.reservations.get(id);
    if (!r) throw new Error(`no reservation ${id}`);
    if (!states.includes(r.state)) throw new Error(`reservation ${id} is ${r.state}, not ${states.join(" or ")}`);
    return r;
  }

  /** Written before the request leaves. Only after this returns may the provider be called. */
  dispatch(id: string): void {
    this.locked(() => { this.expect(id, ["reserved"]); this.append({ t: "dispatch", id, at: now() }); });
  }

  /** Give back a reservation that was never dispatched (a pre-flight check refused the call). */
  release(id: string, why: string): void {
    this.locked(() => { this.expect(id, ["reserved"]); this.append({ t: "release", id, why, at: now() }); });
  }

  /** The actual charge of a dispatched call that reported its usage. */
  settle(id: string, input: { usage: CallUsageRecord; micros: number; billed: boolean }): void {
    if (!Number.isSafeInteger(input.micros) || input.micros < 0) throw new Error(`a charge is a whole number of micro-dollars (got ${input.micros})`);
    this.locked(() => { this.expect(id, ["dispatched"]); this.append({ t: "settle", id, usage: input.usage, micros: input.micros, billed: input.billed, at: now() }); });
  }

  /** A dispatched call that failed without usage: its whole reservation stays spent. */
  ambiguous(id: string, why: string): void {
    this.locked(() => { this.expect(id, ["dispatched"]); this.append({ t: "ambiguous", id, why, at: now() }); });
  }

  /** The owner's figure for an ambiguous or orphaned call (read off the Console). */
  reconcile(id: string, micros: number, source: string): void {
    if (!Number.isSafeInteger(micros) || micros < 0) throw new Error(`a reconciled charge is a whole number of micro-dollars (got ${micros})`);
    if (!source.trim()) throw new Error("a reconciliation names its source");
    this.locked(() => { this.expect(id, ["ambiguous", "dispatched"]); this.append({ t: "reconcile", id, micros, source, at: now() }); });
  }

  /**
   * After a restart: reservations of processes that are gone. One never dispatched is released (the
   * request provably did not leave); one dispatched but never settled becomes ambiguous and keeps
   * its reservation. Live processes' reservations are left alone.
   */
  recoverOrphans(): { released: string[]; ambiguous: string[] } {
    return this.locked(() => {
      const released: string[] = [];
      const ambiguous: string[] = [];
      for (const r of this.folded.reservations.values()) {
        const pid = Number(r.id.split("-")[1]);
        if (pid === process.pid || (Number.isInteger(pid) && alive(pid))) continue;
        if (r.state === "reserved") { this.append({ t: "release", id: r.id, why: "orphaned before dispatch: the request never left", at: now() }); released.push(r.id); }
        else if (r.state === "dispatched") { this.append({ t: "ambiguous", id: r.id, why: "orphaned after dispatch: the process ended before usage was recorded", at: now() }); ambiguous.push(r.id); }
      }
      return { released, ambiguous };
    });
  }

  reservation(id: string): Reservation | undefined {
    const r = this.folded.reservations.get(id);
    return r ? { ...r } : undefined;
  }

  /** The current state, re-read from disk. */
  summary(): LedgerSummary {
    return this.locked(() => this.summaryNow());
  }

  private summaryNow(): LedgerSummary {
    const f = this.folded;
    if (!f.open) throw new Error("the campaign ledger has no header");
    let committed = 0, pilot = 0, billed = 0, inFlight = 0, ambiguous = 0;
    const overruns: string[] = [];
    for (const r of f.reservations.values()) {
      committed += r.chargedMicros;
      if (r.phase === "pilot") pilot += r.chargedMicros;
      if (r.state === "settled" && r.billed) billed += r.chargedMicros;
      if (r.state === "reconciled") billed += r.chargedMicros;
      if (r.state === "reserved" || r.state === "dispatched") inFlight++;
      if (r.state === "ambiguous") ambiguous++;
      if (r.state === "settled" && r.chargedMicros > r.maxMicros) overruns.push(r.id);
    }
    const games = [...f.games.values()];
    const pilotGames = games.filter((g) => g.phase === "pilot").length;
    const caps = f.open.caps;
    return {
      campaign: f.open.campaign,
      caps,
      dryRun: f.open.dryRun,
      committedMicros: committed,
      pilotCommittedMicros: pilot,
      billedMicros: billed,
      inFlight,
      ambiguous,
      overruns,
      games: { pilot: pilotGames, total: games.length, finished: games.filter((g) => g.outcome !== null).length },
      remaining: {
        pilotMicros: Math.max(0, Math.min(caps.pilot.micros - pilot, caps.total.micros - committed)),
        totalMicros: Math.max(0, caps.total.micros - committed),
        pilotGames: Math.max(0, Math.min(caps.pilot.games - pilotGames, caps.total.games - games.length)),
        totalGames: Math.max(0, caps.total.games - games.length),
      },
      reservations: f.reservations.size,
    };
  }
}
