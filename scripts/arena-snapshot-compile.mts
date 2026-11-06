/**
 * `npm run arena:compile-snapshot -- --snapshot <catalog.json> --out <readings.json> [--against <before.json>] [--diff <diff.md>]`
 *
 * The batch agent's corpus diff, offline: compiles every card of an `arena:snapshot` file with THIS
 * checkout's compiler (the catalog text corrected by `errata.ts`, as a sync would store it) and writes
 * one reading per skill: `{ "BT1-001#10b": { kind, trigger, reads, unread, printed } }`.
 *
 * With `--against` (the same command's output from the branch point), it compares the two and prints
 * the counts: skills that went from read to unread (a regression unless deliberate), unread to read,
 * and changed readings. `--diff` writes every change, printed text beside old and new reading, as
 * Markdown for review. No database, no network: seconds to a minute.
 */
import fs from "node:fs";
import { skillRecords } from "../src/lib/arena/draft";
import { cardDefFrom } from "../src/lib/arena/load";
import { correctCardFields, correctSkillText } from "../src/lib/catalog/errata";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const snapshot = arg("--snapshot"), out = arg("--out"), against = arg("--against"), diffOut = arg("--diff");
if (!snapshot || !out) throw new Error("usage: arena:compile-snapshot -- --snapshot <catalog.json> --out <readings.json> [--against <before.json>] [--diff <diff.md>]");

interface SnapCard { id: string; type: string; colors: string[]; cost: string | null; specified: string | null; z: string | null; power: number | null;
  name: string; characters: string[]; traits: string[]; skill: string | null; backName: string | null; backSkill: string | null }
interface Reading { kind: string; trigger: string[]; reads: string; unread: string[]; printed: string }

const snap = JSON.parse(fs.readFileSync(snapshot, "utf8")) as { cards: SnapCard[] };
const readings: Record<string, Reading> = {};
let failed = 0;
for (const c of snap.cards) {
  const f = correctCardFields(c.id, { name: c.name, backName: c.backName, characters: c.characters, traits: c.traits });
  const row = {
    id: c.id, name: f.name, cardType: c.type, colors: c.colors, energyCost: c.cost, zEnergyCost: c.z, power: c.power, comboCost: null, comboPower: null,
    skill: correctSkillText(c.id, c.skill), characters: f.characters, traits: f.traits, backName: f.backName, backPower: null,
    backSkill: correctSkillText(c.id, c.backSkill), specifiedCost: c.specified, game: "dbs",
  };
  try {
    for (const r of skillRecords(cardDefFrom(row as never))) {
      readings[`${c.id}#${r.skillIndex}${r.side === "back" ? "b" : ""}`] = { kind: r.kind, trigger: [...(r.trigger ?? [])], reads: r.reads, unread: [...r.unread], printed: r.printed };
    }
  } catch (e) {
    failed++;
    readings[`${c.id}#ERR`] = { kind: "error", trigger: [], reads: "", unread: [String(e)], printed: c.skill ?? "" };
  }
}
fs.writeFileSync(out, JSON.stringify(readings));
const all = Object.values(readings);
console.log(`arena:compile-snapshot: ${snap.cards.length} cards, ${all.length} skills, ${all.filter((r) => !r.unread.length).length} read, ${all.filter((r) => r.unread.length).length} unread${failed ? `, ${failed} cards threw` : ""} → ${out}`);

if (against) {
  const before = JSON.parse(fs.readFileSync(against, "utf8")) as Record<string, Reading>;
  const show = (r?: Reading) => (!r ? "(no skill)" : r.unread.length ? `UNREAD: ${r.unread.join(" | ")}` : `${r.reads || "(nothing)"}${r.trigger.length ? `  [trigger: ${r.trigger.join(", ")}]` : ""}`);
  const groups: Record<string, string[]> = { "read → unread": [], "unread → read": [], "changed": [], "new skill": [], "skill gone": [] };
  for (const key of new Set([...Object.keys(before), ...Object.keys(readings)])) {
    const a = before[key], b = readings[key];
    if (show(a) === show(b)) continue;
    const group = !a ? "new skill" : !b ? "skill gone" : !a.unread.length && b.unread.length ? "read → unread" : a.unread.length && !b.unread.length ? "unread → read" : "changed";
    groups[group].push(key);
  }
  console.log(Object.entries(groups).map(([g, ks]) => `${g}: ${ks.length}`).join("; "));
  if (groups["read → unread"].length) console.log(`read → unread: ${groups["read → unread"].join(" ")}`);
  if (diffOut) {
    const md = [`# Reading diff: ${against} → this checkout`, ""];
    for (const [g, ks] of Object.entries(groups)) {
      if (!ks.length) continue;
      md.push(`## ${g} (${ks.length})`, "");
      for (const k of ks.sort()) md.push(`- **${k}**`, `  PRINTED: ${(readings[k] ?? before[k]).printed}`, `  BEFORE:  ${show(before[k])}`, `  AFTER:   ${show(readings[k])}`);
      md.push("");
    }
    fs.writeFileSync(diffOut, md.join("\n"));
    console.log(`diff → ${diffOut}`);
  }
}
