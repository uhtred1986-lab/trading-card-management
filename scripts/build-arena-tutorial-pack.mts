/**
 * Offline, reproducible build. No catalog connection and no run-time compilation.
 *
 * `--records` (a follow-up to #1071) adds the typed `kind`, `usage` and `validity` v1 records to the
 * pinned pack WITHOUT recompiling: the pinned programs are the lesson's, and the compiler has since
 * changed its reading of some of these cards (BT1-093 is unread now), so a full rebuild refuses. The
 * records come from the functions `compileSkill` itself uses (`compileUsage`, `compileValidity`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cardDefFrom } from '../src/lib/arena/load';
import { compileCard, aegisPriceLine } from '../src/lib/arena/compile';
import { compileSkillPrice } from '../src/lib/arena/compile/prices';
import { parseSkills } from '../src/lib/arena/text/cards';
import { compileUsage } from '../src/lib/arena/vm/usage';
import { compileValidity } from '../src/lib/arena/vm/validity';
if (process.argv.includes('--records')) {
  const url = new URL('../src/lib/arena/tutorial/classic-pack.json', import.meta.url);
  const pack = JSON.parse(readFileSync(url, 'utf8'));
  let added = 0;
  const repriced: string[] = [];
  for (const [key, script] of Object.entries(pack.scripts) as [string, { bySkill: Record<string, Record<string, unknown>> }][]) {
    const back = key.endsWith('#back');
    const def = pack.defs[back ? key.slice(0, -5) : key];
    const skills = parseSkills((back ? def.back?.skill : def.skill) ?? null);
    for (const [index, entry] of Object.entries(script.bySkill)) {
      const sk = skills.find((x) => x.index === Number(index));
      if (!sk) throw new Error(`${key} skill ${index}: no printed skill at that index`);
      if (entry.usage === undefined) { entry.kind = sk.kind; entry.usage = compileUsage(sk); entry.validity = compileValidity(sk); added++; }
      // The typed payment v1 (#1066) too: the pinned price carries only its condition and program.
      const price = entry.price as { payment?: unknown; condition: unknown; ops: unknown };
      if (price.payment === undefined) {
        // Take the compiler's whole price: before #1066 the engine charged the printed cost from the card's
        // text, so a pinned null price still paid it (BT1-065's Life-to-Drop); the record now has to say so.
        const fresh = compileSkillPrice(aegisPriceLine(sk));
        if (JSON.stringify([fresh.condition, fresh.ops]) !== JSON.stringify([price.condition, price.ops])) repriced.push(key + ' skill ' + index);
        entry.price = fresh;
      }
    }
  }
  writeFileSync(url, JSON.stringify(pack, null, 2) + '\n');
  if (repriced.length) console.log(`Price condition/program now compiled (was pinned null): ${repriced.join(", ")}`);
  console.log(`Added typed records to ${added} pinned skills`);
  process.exit(0);
}
const source = JSON.parse(readFileSync(new URL('../docs/arena-tutorial-classic-cards.json', import.meta.url), 'utf8'));
const defs = Object.fromEntries(source.cards.map((row: Parameters<typeof cardDefFrom>[0]) => [row.id, cardDefFrom(row)]));
const scripts: Record<string, ReturnType<typeof compileCard>> = {};
const art: Record<string, { front: string; back: string | null }> = {};
for (const def of Object.values(defs) as ReturnType<typeof cardDefFrom>[]) {
  for (const side of def.back ? ['front', 'back'] as const : ['front'] as const) {
    const compiled = compileCard(def, side);
    if (!compiled.complete || compiled.unsupported.length) throw new Error(`${def.id} ${side}: incomplete ${compiled.unsupported.join('; ')}`);
    scripts[def.id + (side === 'back' ? '#back' : '')] = compiled;
  }
  art[def.id] = { front: `/arena/tutorial/classic/${def.id}-front.png`, back: def.back ? `/arena/tutorial/classic/${def.id}-back.png` : null };
}
writeFileSync(new URL('../src/lib/arena/tutorial/classic-pack.json', import.meta.url), JSON.stringify({ version: 2, source: source.source, defs, scripts, art }, null, 2) + '\n');
console.log(`Pinned ${Object.keys(defs).length} cards / ${Object.keys(scripts).length} complete faces`);
