/** Offline, reproducible build. No catalog connection and no run-time compilation. */
import { readFileSync, writeFileSync } from 'node:fs';
import { cardDefFrom } from '../src/lib/arena/load';
import { compileCard } from '../src/lib/arena/compile';
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
