import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  safeCharacterSheetPath,
  validateCharacterPack,
  type CatalogEvidenceRow,
} from "../../src/lib/arena/immersion/pack-validation.ts";

const root = process.cwd();
let catalogPath: string | undefined;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--catalog" && args[i + 1]) catalogPath = path.resolve(args[++i]);
  else throw new Error(`Unknown argument: ${args[i]}`);
}

const manifestPath = path.join(root, "src/lib/arena/immersion/characters.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
const characterArray = manifest && typeof manifest === "object" && "characters" in manifest && Array.isArray(manifest.characters)
  ? manifest.characters as Array<{ sheet?: unknown }>
  : [];
const assets = new Map<string, Uint8Array>();
for (const character of characterArray) {
  if (!safeCharacterSheetPath(character.sheet)) continue;
  const filePath = path.join(root, "public", character.sheet.replace(/^\//, ""));
  try {
    assets.set(character.sheet, await readFile(filePath));
  } catch {
    // The pure validator reports the missing asset with the sheet path.
  }
}

let catalog: CatalogEvidenceRow[] | undefined;
if (catalogPath) catalog = JSON.parse(await readFile(catalogPath, "utf8")) as CatalogEvidenceRow[];
const errors = validateCharacterPack(manifest, {
  assets,
  catalog,
  digest: (_sheet, bytes) => createHash("sha256").update(bytes).digest("hex"),
});
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  const value = manifest as { characters: unknown[]; mappings: unknown[] };
  console.log(`immersion-assets: ${value.characters.length} sheets, ${value.mappings.length} exact mappings verified${catalogPath ? " against catalog" : ""}`);
}
