/** Pure validation and deterministic merge helpers for the local immersion asset pack. */
export type CatalogEvidenceRow = {
  card_number: string;
  card_name: string | null;
  card_character: string[] | null;
  card_back_name: string | null;
  card_back_character: string[] | null;
};

export type PackValidationInput = {
  assets: ReadonlyMap<string, Uint8Array>;
  catalog?: readonly CatalogEvidenceRow[];
  digest?: (sheet: string, bytes: Uint8Array) => string;
};

export type PackMergeCounts = {
  addedCharacters: number;
  unchangedCharacters: number;
  addedMappings: number;
  unchangedMappings: number;
};

const POSES = ["attack", "guard", "hit"];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function safeCharacterSheetPath(sheet: unknown): sheet is string {
  if (typeof sheet !== "string" || !sheet.startsWith("/arena/characters/")) return false;
  if (sheet.includes("\\") || sheet.includes("?") || sheet.includes("#") || sheet.includes("%")) return false;

  let decoded = sheet;
  for (let i = 0; i < 5; i += 1) {
    if (decoded.split("/").some((part) => part === ".." || part === ".")) return false;
    if (decoded.includes("\\")) return false;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return false;
    }
  }
  if (decoded.includes("%")) return false;
  return decoded.startsWith("/arena/characters/") &&
    decoded.split("/").every((part) => part !== ".." && part !== ".");
}

function inspectPng(bytes: Uint8Array): { width: number; height: number; hasAlpha: boolean } | null {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return null;
  const colorType = bytes[25];
  let hasTransparencyChunk = false;
  let offset = 8;
  let sawIhdr = false;
  let sawIend = false;
  let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (offset + 12 + length > bytes.length) return null;
    if (type === "IHDR") {
      if (sawIhdr || offset !== 8 || length !== 13) return null;
      sawIhdr = true;
    }
    if (type === "tRNS") hasTransparencyChunk = true;
    if (type === "IDAT") sawIdat = true;
    offset += 12 + length;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIhdr || !sawIdat || !sawIend) return null;
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 || (colorType === 3 && hasTransparencyChunk) };
}

export function validateCharacterPack(pack: unknown, input: PackValidationInput): string[] {
  const errors: string[] = [];
  if (!isRecord(pack) || pack.version !== 1) return ["manifest must be an object with version 1"];
  if (!Array.isArray(pack.sources) || pack.sources.length === 0 || pack.sources.some((source) =>
    !isRecord(source) || !nonEmptyString(source.kind) || !nonEmptyString(source.provenance) || !nonEmptyString(source.license))) {
    errors.push("manifest sources must be a non-empty array of records with kind, provenance, and license");
  }
  const characters = pack.characters;
  const mappings = pack.mappings;
  if (!Array.isArray(characters)) errors.push("manifest characters must be an array");
  if (!Array.isArray(mappings)) errors.push("manifest mappings must be an array");
  if (!Array.isArray(characters) || !Array.isArray(mappings)) return errors;

  const characterIds = new Set<string>();
  const sheetPaths = new Set<string>();
  for (const [index, raw] of characters.entries()) {
    const label = `characters[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const { id, name, sheet, sha256, width, height, frames } = raw;
    if (!nonEmptyString(id) || !/^[a-z0-9-]+$/.test(id)) errors.push(`${label}.id is invalid`);
    else if (characterIds.has(id)) errors.push(`duplicate character id ${id}`);
    else characterIds.add(id);
    if (!nonEmptyString(name)) errors.push(`${label}.name is required`);
    if (!safeCharacterSheetPath(sheet)) errors.push(`${label}.sheet is unsafe or outside /arena/characters`);
    else if (sheetPaths.has(sheet)) errors.push(`duplicate character sheet path ${sheet}`);
    else sheetPaths.add(sheet);
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) errors.push(`${label}.sha256 is invalid`);
    if (!Array.isArray(frames) || frames.length !== POSES.length || frames.some((pose, i) => pose !== POSES[i])) {
      errors.push(`${label}.frames must be attack, guard, hit in order`);
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) < 1 || Number(height) < 1) {
      errors.push(`${label} width and height must be positive integers`);
    }
    if (!safeCharacterSheetPath(sheet)) continue;

    const bytes = input.assets.get(sheet);
    if (!bytes) {
      errors.push(`${label} asset is missing: ${sheet}`);
      continue;
    }
    const png = inspectPng(bytes);
    if (!png) {
      errors.push(`${label} asset is not a complete PNG`);
      continue;
    }
    if (png.width !== png.height * 3) errors.push(`${label} PNG must have a 3:1 horizontal sprite-sheet ratio`);
    if (!png.hasAlpha) errors.push(`${label} PNG must contain alpha transparency`);
    if (png.width !== width || png.height !== height) errors.push(`${label} dimensions differ from the PNG header`);
    if (typeof sha256 === "string" && input.digest && input.digest(sheet, bytes) !== sha256) {
      errors.push(`${label} SHA-256 differs from the PNG bytes`);
    }
  }

  const mappingKeys = new Set<string>();
  const mappedCharacters = new Set<string>();
  const catalogById = input.catalog ? new Map(input.catalog.map((row) => [row.card_number, row])) : undefined;
  for (const [index, raw] of mappings.entries()) {
    const label = `mappings[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const { cardId, face, name, characterId, evidence } = raw;
    if (!nonEmptyString(cardId)) errors.push(`${label}.cardId is required`);
    if (face !== "front" && face !== "back") errors.push(`${label}.face must be front or back`);
    if (!nonEmptyString(name)) errors.push(`${label}.name is required`);
    if (!nonEmptyString(characterId) || !characterIds.has(characterId)) errors.push(`${label} references an unknown character`);
    else mappedCharacters.add(characterId);
    if (nonEmptyString(cardId) && (face === "front" || face === "back")) {
      const key = `${cardId}\u0000${face}`;
      if (mappingKeys.has(key)) errors.push(`duplicate mapping for ${cardId} ${face}`);
      mappingKeys.add(key);
    }
    if (!isRecord(evidence)) {
      errors.push(`${label}.evidence is required`);
      continue;
    }
    if (!nonEmptyString(evidence.catalogCardName) || !Array.isArray(evidence.catalogCharacter)) {
      errors.push(`${label} needs catalog name and character evidence`);
    }
    if (face === "front" && evidence.catalogCardName !== name) {
      errors.push(`${label} front name differs from its recorded catalog evidence`);
    }
    if (face === "back" && (!nonEmptyString(evidence.catalogBackName) || evidence.catalogBackName !== name || !Array.isArray(evidence.catalogBackCharacter))) {
      errors.push(`${label} back mapping needs matching back-name and character evidence`);
    }
    if (typeof evidence.reviewedCardArtUrl !== "string" || !/^https?:\/\//.test(evidence.reviewedCardArtUrl)) {
      errors.push(`${label} needs an http(s) reviewedCardArtUrl`);
    }
    if (typeof evidence.reviewedCardArtSha256 !== "string" || !/^[a-f0-9]{64}$/.test(evidence.reviewedCardArtSha256)) {
      errors.push(`${label} needs a reviewed card-art SHA-256`);
    }
    if (!nonEmptyString(evidence.visualReview)) errors.push(`${label} needs a written visual form review`);

    if (catalogById && nonEmptyString(cardId) && (face === "front" || face === "back")) {
      const row = catalogById.get(cardId);
      if (!row) {
        errors.push(`${label} card id is absent from the supplied catalog`);
        continue;
      }
      const expectedName = face === "front" ? row.card_name : row.card_back_name;
      const expectedCharacters = face === "front" ? row.card_character : row.card_back_character;
      if (name !== expectedName) errors.push(`${label} face name differs from the supplied catalog`);
      if (!expectedCharacters?.length) errors.push(`${label} face has no character evidence in the supplied catalog`);
      if (evidence.catalogCardName !== row.card_name) errors.push(`${label} catalog card-name evidence drift`);
      if (JSON.stringify(evidence.catalogCharacter) !== JSON.stringify(row.card_character)) errors.push(`${label} catalog character evidence drift`);
      if (face === "back") {
        if (evidence.catalogBackName !== row.card_back_name) errors.push(`${label} catalog back-name evidence drift`);
        if (JSON.stringify(evidence.catalogBackCharacter) !== JSON.stringify(row.card_back_character)) errors.push(`${label} catalog back-character evidence drift`);
      }
    }
  }
  for (const id of characterIds) if (!mappedCharacters.has(id)) errors.push(`character ${id} has no reviewed card mapping`);
  return errors;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function mergeCharacterPacks(base: unknown, candidate: unknown): {
  merged: Record<string, unknown> | null;
  errors: string[];
  counts: PackMergeCounts;
} {
  const errors: string[] = [];
  const counts: PackMergeCounts = { addedCharacters: 0, unchangedCharacters: 0, addedMappings: 0, unchangedMappings: 0 };
  if (!isRecord(base) || !isRecord(candidate) || base.version !== 1 || candidate.version !== 1) {
    return { merged: null, errors: ["base and candidate must be version 1 manifests"], counts };
  }
  if (!Array.isArray(base.sources) || !Array.isArray(candidate.sources) ||
      !Array.isArray(base.characters) || !Array.isArray(candidate.characters) ||
      !Array.isArray(base.mappings) || !Array.isArray(candidate.mappings)) {
    return { merged: null, errors: ["base and candidate need sources, characters, and mappings arrays"], counts };
  }

  const characters = [...base.characters];
  const byId = new Map<string, unknown>();
  const bySheet = new Map<string, unknown>();
  const candidateIds = new Set<string>();
  const candidateSheets = new Set<string>();
  for (const character of characters) {
    if (!isRecord(character) || typeof character.id !== "string" || typeof character.sheet !== "string") {
      errors.push("base contains a malformed character");
      continue;
    }
    byId.set(character.id, character);
    bySheet.set(character.sheet, character);
  }
  for (const character of candidate.characters) {
    if (!isRecord(character) || typeof character.id !== "string" || typeof character.sheet !== "string") {
      errors.push("candidate contains a malformed character");
      continue;
    }
    if (candidateIds.has(character.id)) { errors.push(`duplicate candidate character id: ${character.id}`); continue; }
    if (candidateSheets.has(character.sheet)) { errors.push(`duplicate candidate sheet path: ${character.sheet}`); continue; }
    candidateIds.add(character.id);
    candidateSheets.add(character.sheet);
    const sameId = byId.get(character.id);
    const sameSheet = bySheet.get(character.sheet);
    if (sameId) {
      if (stable(sameId) === stable(character)) counts.unchangedCharacters += 1;
      else errors.push(`character id conflict: ${character.id}`);
      continue;
    }
    if (sameSheet) {
      errors.push(`sheet path conflict: ${character.sheet}`);
      continue;
    }
    characters.push(character);
    byId.set(character.id, character);
    bySheet.set(character.sheet, character);
    counts.addedCharacters += 1;
  }

  const mappings = [...base.mappings];
  const byCardFace = new Map<string, unknown>();
  for (const mapping of mappings) {
    if (!isRecord(mapping) || typeof mapping.cardId !== "string" || typeof mapping.face !== "string") {
      errors.push("base contains a malformed mapping");
      continue;
    }
    byCardFace.set(`${mapping.cardId}\u0000${mapping.face}`, mapping);
  }
  const candidateMappingKeys = new Set<string>();
  for (const mapping of candidate.mappings) {
    if (!isRecord(mapping) || typeof mapping.cardId !== "string" || typeof mapping.face !== "string") {
      errors.push("candidate contains a malformed mapping");
      continue;
    }
    const key = `${mapping.cardId}\u0000${mapping.face}`;
    if (candidateMappingKeys.has(key)) { errors.push(`duplicate candidate card/face mapping: ${mapping.cardId} ${mapping.face}`); continue; }
    candidateMappingKeys.add(key);
    const existing = byCardFace.get(key);
    if (existing) {
      if (stable(existing) === stable(mapping)) counts.unchangedMappings += 1;
      else errors.push(`card/face mapping conflict: ${mapping.cardId} ${mapping.face}`);
      continue;
    }
    mappings.push(mapping);
    byCardFace.set(key, mapping);
    counts.addedMappings += 1;
  }

  const sourcesByValue = new Map<string, unknown>();
  for (const source of [...base.sources, ...candidate.sources]) sourcesByValue.set(stable(source), source);
  const sources = [...sourcesByValue.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value);
  characters.sort((a, b) => (String(isRecord(a) ? a.id : "") < String(isRecord(b) ? b.id : "") ? -1 : String(isRecord(a) ? a.id : "") > String(isRecord(b) ? b.id : "") ? 1 : 0));
  mappings.sort((a, b) => {
    const aa = isRecord(a) ? `${String(a.cardId)}\u0000${String(a.face)}\u0000${String(a.name)}` : "";
    const bb = isRecord(b) ? `${String(b.cardId)}\u0000${String(b.face)}\u0000${String(b.name)}` : "";
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });
  return { merged: errors.length ? null : { version: 1, sources, characters, mappings }, errors, counts };
}
