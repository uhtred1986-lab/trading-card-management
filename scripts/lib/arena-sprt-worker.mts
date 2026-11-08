/**
 * A worker process of `scripts/arena-sprt.mts`: loads the fixtures and any `--players-module`, then
 * plays the deals the runner sends, one at a time, and sends each `PairOutcome` back. It decides
 * nothing: the runner orders the outcomes by deal and runs the test.
 */
import { pathToFileURL } from "node:url";
import { loadAuditFixtures, type Fixture } from "../verify/arena-policy-fixtures.mts";
import { playDeal, type DealOptions, type DealSpec } from "./arena-sprt-deal";

export type ToWorker =
  | { type: "init"; fixtures: string[]; playersModules: string[]; options: DealOptions }
  | { type: "deal"; spec: DealSpec };
export type FromWorker =
  | { type: "ready" }
  | { type: "result"; outcome: Awaited<ReturnType<typeof playDeal>> }
  | { type: "fatal"; error: string };

/** Fixtures by name, in the order asked; the four audited SD15/SD5 matchups only. */
export async function loadSprtFixtures(names: string[]): Promise<Map<string, Fixture>> {
  const all = await loadAuditFixtures();
  const unknown = names.filter((n) => !all.some((f) => f.name === n));
  if (unknown.length) throw new Error(`unknown fixture ${unknown.join(",")} (known: ${all.map((f) => f.name).join(", ")})`);
  return new Map(all.filter((f) => names.includes(f.name)).map((f) => [f.name, f]));
}

export async function importPlayerModules(files: string[]): Promise<void> {
  for (const file of files) await import(pathToFileURL(file).href);
}

if (process.send && process.argv.includes("--arena-sprt-worker")) {
  const send = (message: FromWorker) => process.send!(message);
  let fixtures: Map<string, Fixture> | null = null;
  let options: DealOptions | null = null;
  // One message at a time: the runner sends the next deal only after this one's result.
  let queue = Promise.resolve();
  process.on("message", (message: ToWorker) => {
    queue = queue.then(async () => {
      try {
        if (message.type === "init") {
          await importPlayerModules(message.playersModules);
          fixtures = await loadSprtFixtures(message.fixtures);
          options = message.options;
          send({ type: "ready" });
        } else {
          if (!fixtures || !options) throw new Error("a deal arrived before init");
          send({ type: "result", outcome: await playDeal(message.spec, fixtures.get(message.spec.fixture)!, options) });
        }
      } catch (error) {
        send({ type: "fatal", error: String(error instanceof Error ? (error.stack ?? error.message) : error) });
      }
    });
  });
  process.on("disconnect", () => process.exit(0));
}
