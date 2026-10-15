import { createHash } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  mergeCharacterPacks,
  safeCharacterSheetPath,
  validateCharacterPack,
  type CatalogEvidenceRow,
} from "../src/lib/arena/immersion/pack-validation.ts";

const root = process.cwd();
let candidatePath: string | undefined;
let catalogPath: string | undefined;
let write = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--write") write = true;
  else if (args[i] === "--dry-run") write = false;
  else if (args[i] === "--catalog" && args[i + 1]) catalogPath = path.resolve(args[++i]);
  else if (args[i].startsWith("--")) throw new Error(`Unknown option: ${args[i]}`);
  else if (!candidatePath) candidatePath = path.resolve(args[i]);
  else throw new Error(`Unexpected argument: ${args[i]}`);
}
if (!candidatePath) {
  throw new Error("Usage: scripts/import-arena-character-pack.mts [--dry-run|--write] <candidate.json> [--catalog <masters-catalog.json>]");
}

const manifestPath = path.join(root, "src/lib/arena/immersion/characters.json");
const originalBytes = await readFile(manifestPath);
const existing = JSON.parse(originalBytes.toString("utf8")) as unknown;
const candidate = JSON.parse(await readFile(candidatePath, "utf8")) as unknown;
const merge = mergeCharacterPacks(existing, candidate);
if (merge.errors.length || !merge.merged) {
  console.error(merge.errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

const characters = Array.isArray(merge.merged.characters) ? merge.merged.characters as Array<{ sheet?: unknown }> : [];
const assets = new Map<string, Uint8Array>();
for (const character of characters) {
  if (!safeCharacterSheetPath(character.sheet)) continue;
  const filePath = path.join(root, "public", character.sheet.replace(/^\//, ""));
  try {
    assets.set(character.sheet, await readFile(filePath));
  } catch {
    // The reusable validator reports a missing asset without the importer writing anything.
  }
}
let catalog: CatalogEvidenceRow[] | undefined;
if (catalogPath) catalog = JSON.parse(await readFile(catalogPath, "utf8")) as CatalogEvidenceRow[];
const validationErrors = validateCharacterPack(merge.merged, {
  assets,
  catalog,
  digest: (_sheet, bytes) => createHash("sha256").update(bytes).digest("hex"),
});
if (validationErrors.length) {
  console.error(validationErrors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

const serialized = `${JSON.stringify(merge.merged, null, 2)}\n`;
console.log(`characters: ${merge.counts.addedCharacters} added, ${merge.counts.unchangedCharacters} unchanged`);
console.log(`mappings: ${merge.counts.addedMappings} added, ${merge.counts.unchangedMappings} unchanged`);
if (!write) {
  console.log("dry run: merged pack validated; pass --write to update the manifest");
} else {
  const currentBytes = await readFile(manifestPath);
  if (!currentBytes.equals(originalBytes)) throw new Error("manifest changed during validation; rerun the import");
  let updated = false;
  if (currentBytes.toString("utf8") !== serialized) {
    const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
    try {
      await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o644 });
      await rename(temporaryPath, manifestPath);
      updated = true;
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
  console.log(updated ? "manifest updated atomically" : "manifest already matches the merged pack");
}
