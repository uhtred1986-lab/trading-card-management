/** BT4-089 source correction remains independent of R532 Auto admission. */
import assert from "node:assert/strict";
import source from "./fixtures/chichi-trait-source-5.json";
import { FIELD_CORRECTIONS, correctCardFields, unmatchedFieldCorrections } from "../../src/lib/catalog/errata";
import { shapeCatalog } from "../../src/lib/catalog/deckplanet";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { describeScript } from "../../src/lib/arena/vm/script";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const raw = source.card;
const before = { name: raw.name, backName: raw.backName, characters: raw.characters, traits: raw.traits };
const wanted = ["Earthling", "Goku's Lineage"];
assert.deepEqual(FIELD_CORRECTIONS[raw.id], { traits: [["Goku's Lineage"], wanted] });
const input = clone(before), saved = clone(input), after = correctCardFields(raw.id, input);
assert.deepEqual(input, saved, "correction is input-pure");
assert.deepEqual(after, { ...before, traits: wanted });
assert.deepEqual(correctCardFields(raw.id, after), after, "second apply is idempotent");
assert.deepEqual(unmatchedFieldCorrections(new Map([[raw.id, before]])), []);
assert.deepEqual(unmatchedFieldCorrections(new Map([[raw.id, after]])), [`${raw.id}: traits ["Goku's Lineage"] are now ["Earthling","Goku's Lineage"]`], "upstream repaired source is reported, not silently claimed as a matching correction");
assert.deepEqual(unmatchedFieldCorrections(new Map()), [], "absent source is not stale");
for (const traits of [[], ["Earthling"], ["Saiyan", "Goku's Lineage"], ["Goku's Lineage", "Earthling"], ["Goku's lineage"]]) {
    const changed = { ...before, traits };
    assert.deepEqual(correctCardFields(raw.id, changed), changed, "only exact observed source is corrected");
    assert.equal(unmatchedFieldCorrections(new Map([[raw.id, changed]])).length, 1, "mismatch remains visible");
}
const legacy = { name: raw.name, backName: null, characters: raw.characters };
assert.deepEqual(correctCardFields(raw.id, legacy), legacy, "name-only caller does not infer absent traits");
assert.equal(unmatchedFieldCorrections(new Map([[raw.id, legacy]])).length, 1, "missing trait input cannot conceal a stale claim");
assert.deepEqual(correctCardFields("BT4-090", before), before, "same source list on another card is unchanged");
assert.deepEqual(correctCardFields("FB01-001", before), before, "Fusion identity has no Masters correction");
// Isolated returned lists must not alias either the input or correction table.
after.traits.push("Mutation probe");
assert.deepEqual(correctCardFields(raw.id, before).traits, wanted);
assert.deepEqual(FIELD_CORRECTIONS[raw.id].traits![1], wanted);

// Shape an actual Deckplanet-format row from the complete frozen source record.
// Non-source catalog bookkeeping is explicitly fixture data. No sync or DB use.
const dp = { id: 531089, card_number: raw.id, card_name: raw.name, card_type: raw.type, card_color: raw.colors.join("/"), card_energy_cost: raw.cost,
    card_power: String(raw.power), card_character: raw.characters, card_traits: raw.traits, card_skill_unstyled: raw.skill,
    card_back_name: raw.backName, card_back_skill_unstyled: raw.backSkill, card_rarity: "C" };
const shapedInput = clone(dp), original = clone(shapedInput);
const shaped = shapeCatalog([shapedInput], "dbs").cards[0];
assert.deepEqual(shapedInput, original);
assert.deepEqual(shaped.traits, wanted);
assert.equal(shaped.game, "dbs");
assert.deepEqual([shaped.name, shaped.characters, shaped.colors, shaped.energyCost, shaped.power, shaped.skill, shaped.backName, shaped.backSkill],
    [raw.name, raw.characters, raw.colors, raw.cost, raw.power, raw.skill, raw.backName, raw.backSkill], "all other source values preserved");
assert.deepEqual(shapeCatalog([{ ...dp, card_traits: shaped.traits }], "dbs").cards[0], shaped, "shaping an already-corrected source is idempotent");
const neighbor = shapeCatalog([{ ...dp, card_number: "BT4-090" }], "dbs").cards[0];
assert.deepEqual(neighbor.traits, raw.traits);
const fusion = shapeCatalog([{ ...dp, card_number: "FB01-001", card_energy_cost: 1 }], "fusion").cards[0];
assert.equal(fusion.game, "fusion"); assert.deepEqual(fusion.traits, raw.traits);
assert.equal(fusion.energyCost, "1");
const mismatched = shapeCatalog([{ ...dp, card_traits: ["Saiyan"] }], "dbs").cards[0];
assert.deepEqual(mismatched.traits, ["Saiyan"], "shapeCatalog also respects exact source guard");

// All previous name/character corrections keep both their API and shape behavior.
for (const [id, correction] of Object.entries(FIELD_CORRECTIONS)) {
    if (id === raw.id) continue;
    const old = { name: correction.name?.[0] ?? id, backName: correction.backName?.[0] ?? null, characters: correction.characters?.[0] ?? [id] };
    const fixed = correctCardFields(id, old);
    assert.deepEqual(fixed, { name: correction.name?.[1] ?? old.name, backName: correction.backName?.[1] ?? old.backName, characters: correction.characters?.[1] ?? old.characters });
    assert.deepEqual(correctCardFields(id, fixed), fixed);
    assert.deepEqual(unmatchedFieldCorrections(new Map([[id, old]])), []);
    assert.equal(unmatchedFieldCorrections(new Map([[id, fixed]])).length, 1);
    const catalog = shapeCatalog([{ ...dp, card_number: id, card_name: old.name, card_back_name: old.backName, card_character: old.characters }], "dbs").cards[0];
    assert.deepEqual([catalog.name, catalog.backName, catalog.characters], [fixed.name, fixed.backName, fixed.characters]);
    assert.deepEqual(catalog.traits, raw.traits, "trait correction is card-specific");
}
const def = cardDefFrom(shaped as never);
assert.deepEqual(def.traits, wanted, "actual shaped catalog loads both traits into arena definition");
const originalTraits = { ...def, traits: raw.traits };
assert.deepEqual(skillRecords(def), skillRecords(originalTraits), "trait correction itself changes no skill record");
const expected = clone(Object.values(source.allRecords)) as ReturnType<typeof skillRecords>;
assert.equal(expected.length, 1);
expected[0].ops[0] = { ...expected[0].ops[0], upTo: true } as typeof expected[0]["ops"][number];
expected[0].reads = describeScript(expected[0].ops);
assert.deepEqual(clone(skillRecords(def)), expected, "R532 changes only the exact optional flag and narration; every other frozen field survives");
console.log("chichi-trait-source-5: exact traits, actual shaping/load, idempotence, stale/missing/mismatched sources, input purity, previous field fixes and Fusion separation passed");
