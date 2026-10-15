import manifest from "./characters.json";
import type { CombatCharacter } from "./types";

type Face = "front" | "back";
type CharacterManifest = typeof manifest;
type Character = CharacterManifest["characters"][number];

const charactersById = new Map<string, Character>(
  manifest.characters.map((character) => [character.id, character]),
);

/** Resolve only catalog rows explicitly reviewed in characters.json. */
export function resolveCharacter(
  cardId: string,
  name: string,
  flipped: boolean,
): CombatCharacter | null {
  const face: Face = flipped ? "back" : "front";
  const mapping = manifest.mappings.find(
    (candidate) => candidate.cardId === cardId && candidate.face === face && candidate.name === name,
  );
  if (!mapping) return null;

  const character = charactersById.get(mapping.characterId);
  return character
    ? { id: character.id, name: character.name, sheet: character.sheet }
    : null;
}
