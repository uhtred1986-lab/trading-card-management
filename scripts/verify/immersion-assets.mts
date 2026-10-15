import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import manifest from "../../src/lib/arena/immersion/characters.json";

type CatalogRow = {
  card_number: string;
  card_name: string | null;
  card_character: string[] | null;
  card_back_name: string | null;
  card_back_character: string[] | null;
};

const root = process.cwd();
const catalogPath = path.resolve(process.argv[2] ?? "work/masters-catalog.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as CatalogRow[];
const rowsById = new Map(catalog.map((row) => [row.card_number, row]));
const characterIds = new Set<string>();
const sheetPaths = new Set<string>();

assert.equal(manifest.version, 1, "unsupported immersion manifest version");
assert.equal(manifest.characters.length, 8, "expected the initial eight-character tranche");

for (const character of manifest.characters) {
  assert.match(character.id, /^[a-z0-9-]+$/, `invalid character id: ${character.id}`);
  assert.ok(!characterIds.has(character.id), `duplicate character id: ${character.id}`);
  characterIds.add(character.id);
  assert.ok(character.name.trim(), `${character.id} needs a display name`);
  assert.ok(character.sheet.startsWith("/arena/characters/"), `${character.id} sheet must be local`);
  assert.ok(!sheetPaths.has(character.sheet), `duplicate sheet path: ${character.sheet}`);
  sheetPaths.add(character.sheet);
  assert.deepEqual(character.frames, ["attack", "guard", "hit"], `${character.id} frame order`);
  assert.equal(character.width, 2172, `${character.id} width`);
  assert.equal(character.height, 724, `${character.id} height`);
  const filePath = path.join(root, "public", character.sheet.replace(/^\//, ""));
  const bytes = await readFile(filePath);
  assert.equal(bytes.readUInt32BE(16), character.width, `${character.id} PNG width`);
  assert.equal(bytes.readUInt32BE(20), character.height, `${character.id} PNG height`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), character.sha256, `${character.id} SHA-256`);
}

const mappingKeys = new Set<string>();
for (const mapping of manifest.mappings) {
  assert.ok(characterIds.has(mapping.characterId), `unknown character ${mapping.characterId}`);
  assert.ok(mapping.face === "front" || mapping.face === "back", `invalid face for ${mapping.cardId}`);
  const key = `${mapping.cardId}\u0000${mapping.face}\u0000${mapping.name}`;
  assert.ok(!mappingKeys.has(key), `duplicate mapping ${mapping.cardId} ${mapping.face} ${mapping.name}`);
  mappingKeys.add(key);

  const row = rowsById.get(mapping.cardId);
  assert.ok(row, `catalog has no exact card id ${mapping.cardId}`);
  const catalogName = mapping.face === "front" ? row.card_name : row.card_back_name;
  const catalogCharacters = mapping.face === "front" ? row.card_character : row.card_back_character;
  assert.equal(mapping.name, catalogName, `${mapping.cardId} ${mapping.face} mapping name differs from catalog`);
  assert.ok(catalogCharacters?.length, `${mapping.cardId} ${mapping.face} has no catalog character evidence`);
  assert.deepEqual(mapping.evidence.catalogCharacter, row.card_character, `${mapping.cardId} front evidence drift`);
  assert.equal(mapping.evidence.catalogCardName, row.card_name, `${mapping.cardId} front name evidence drift`);
  if (mapping.face === "back") {
    assert.deepEqual(mapping.evidence.catalogBackCharacter, row.card_back_character, `${mapping.cardId} back evidence drift`);
    assert.equal(mapping.evidence.catalogBackName, row.card_back_name, `${mapping.cardId} back name evidence drift`);
  }
}

const mappedCharacters = new Set(manifest.mappings.map((mapping) => mapping.characterId));
assert.deepEqual(mappedCharacters, characterIds, "every sheet needs at least one reviewed card mapping");
console.log(`immersion-assets: ${manifest.characters.length} sheets, ${manifest.mappings.length} exact mappings verified`);
