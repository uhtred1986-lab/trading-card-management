/**
 * A loaded ruleset, grouped back by the file each declaration came from —
 * what `/arena/rules/game` shows (issue #163): one section per `.rules`
 * file, printed by the language's own printer rather than the raw text, so
 * what is shown is what was actually parsed.
 *
 * Client-safe, like the rest of `rulesets/`: reads `GameDefinition.sources`
 * (already built by `load.ts`) and the printer in `lang/print.ts`, nothing
 * else.
 */
import type { Definition } from "../lang";
import { printDefinitions } from "../lang";
import type { GameDefinition } from "./types";

/** `{define: "ZONE", name: "battle"}` → `"zone:battle"`, the same key `load.ts`'s own `sources` map uses. */
function keyOf(def: Definition): string {
  return `${def.define.toLowerCase()}:${def.name}`;
}

export interface PrintedDeclaration {
  /** `"trigger-played"` — an anchor id, so a WHEN/COST chip elsewhere in the app can link straight to the declaration it names. */
  id: string;
  define: string;
  name: string;
  text: string;
}

/** Every declaration, printed on its own and grouped by the file it was read from — in the order the file listed them, files in the order they are first seen. */
export function printedByFile(def: GameDefinition): { file: string; declarations: PrintedDeclaration[] }[] {
  const byFile = new Map<string, Definition[]>();
  for (const d of def.definitions) {
    const file = def.sources[keyOf(d)] ?? "?";
    (byFile.get(file) ?? byFile.set(file, []).get(file)!).push(d);
  }
  return [...byFile.entries()].map(([file, defs]) => ({
    file,
    declarations: defs.map((d) => ({ id: `${d.define.toLowerCase()}-${d.name}`, define: d.define, name: d.name, text: printDefinitions([d]) })),
  }));
}

/** The whole file's declarations printed one after another, exactly as `printDefinitions` over the file's own list would read — the round-trip promise §163's own test holds to. */
export function printedFile(def: GameDefinition, file: string): string {
  const defs = def.definitions.filter((d) => (def.sources[keyOf(d)] ?? "?") === file);
  return printDefinitions(defs);
}

/** The file's own leading `--` comment block, before its first declaration — the manual sections and the narrative `docs/arena-ruleset-spec.md` cites line by line, shown as a note beside what was actually parsed rather than folded into it. */
export function leadingComment(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("--")) out.push(trimmed.replace(/^--\s?/, ""));
    else break;
  }
  // Trailing blank lines the loop above kept from the gap before `DEFINE`.
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
