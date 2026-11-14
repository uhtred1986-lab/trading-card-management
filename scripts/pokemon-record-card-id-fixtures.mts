/**
 * Records the TCGdex answers behind the card-ID searches ("MEW 6", "SWSH062", "TG12") under
 * scripts/verify/fixtures/pokemon/, for scripts/verify/pokemon-tcgdex.mts. Reads only, free, no key.
 *
 *   npx tsx scripts/pokemon-record-card-id-fixtures.mts
 *
 * Files written (the test's stubbed fetch serves them by these names):
 *   sets-abbr-<CODE>.en.json        GET en/sets?abbreviation.official=eq:<CODE>
 *   list-<lang>-id-<card id>.json   GET <lang>/cards?id=eq:<card id>
 *   list-<lang>-localid-<ID>.json   GET <lang>/cards?localId=eq:<ID>
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "https://api.tcgdex.net/v2";
const OUT = path.resolve("scripts/verify/fixtures/pokemon");

async function save(file: string, url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = await res.json();
  fs.writeFileSync(path.join(OUT, file), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${file}: ${Array.isArray(body) ? `${body.length} entries` : "object"}`);
}

await save("sets-abbr-MEW.en.json", `${BASE}/en/sets?abbreviation.official=eq:MEW`);
for (const lang of ["de", "en"]) {
  await save(`list-${lang}-id-sv03.5-006.json`, `${BASE}/${lang}/cards?id=eq:sv03.5-006`);
  for (const id of ["SWSH062", "TG12", "GG01", "SV001"]) await save(`list-${lang}-localid-${id}.json`, `${BASE}/${lang}/cards?localId=eq:${id}`);
}
