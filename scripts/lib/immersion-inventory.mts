/**
 * Pure core of `npm run arena:immersion-inventory` (#852). No database, no file or network access:
 * the CLI reads rows and the repository's fixtures and hands them in, the offline test hands in
 * sanitized ones. Nothing here may carry a deck name, description, owner or deck id into the output.
 */
import { createHash } from "node:crypto";

export interface DeckRow { id: number; game: string; isBuilt: boolean; isTesting: boolean; owner: string | null; name: string; description: string | null }
export interface DeckCardRow { deckId: number; cardId: string; zone: string; quantity: number }
export interface CardRow { id: string; name: string; cardType: string; characters: string[]; backName: string | null }
export interface TrainingFixture { name: string; source: string; leaderId?: string; signature?: string }
export interface MappingRow { cardId: string; face: "front" | "back"; name: string; characterId: string }

export type Face = "front" | "back";
export type Coverage = "covered" | "missing" | "exception";

/** The text markers that make a legacy deck worth a human look, never an exclusion on their own. */
export const TRAINING_MARKERS = /\b(ai[- ]?training|training deck|training fixture|test fixture|proposed recipe|authored (public )?proposal)\b/i;

/** Tranche 1 is the eight sheets of the first delivery (#862); every other sheet in the pack is tranche 2. */
export const TRANCHE1_CHARACTERS = ["buu", "cell", "frieza", "gohan", "goku", "krillin", "piccolo", "vegeta"];

export const normalizeName = (name: string): string =>
  name.toLowerCase().replace(/[‒-―−]/g, "-").replace(/\s+/g, " ").trim();

/** Order-free identity of a decklist: leader, main and Z zones with quantities; side deck ignored. */
export function listSignature(rows: readonly { cardId: string; zone: string; quantity: number }[]): string {
  const part = (zone: string) =>
    [...rows.filter((r) => r.zone === zone)]
      .sort((a, b) => a.cardId.localeCompare(b.cardId))
      .map((r) => `${r.cardId}*${r.quantity}`)
      .join(",");
  return `leader:${part("leader")}|main:${part("main")}|z:${part("z")}`;
}

export type DeckClass = "included" | "excluded-testing" | "excluded-training-confirmed" | "uncertain";

export interface DeckVerdict { klass: DeckClass; reasons: string[] }

export function classifyDeck(
  deck: DeckRow,
  rows: readonly DeckCardRow[],
  fixtures: readonly TrainingFixture[],
): DeckVerdict {
  if (deck.isTesting) return { klass: "excluded-testing", reasons: ["is_testing flag"] };
  const sig = listSignature(rows);
  const leader = rows.find((r) => r.zone === "leader")?.cardId;
  const name = normalizeName(deck.name);
  const nameHit = fixtures.filter((f) => normalizeName(f.name) === name);
  const listHit = fixtures.filter((f) => f.signature && f.signature === sig);
  const markerHit = TRAINING_MARKERS.test(`${deck.name}\n${deck.description ?? ""}`);
  const reasons: string[] = [];
  if (nameHit.length) reasons.push(`exact name of a known training recipe (${[...new Set(nameHit.map((f) => f.source))].join(", ")})`);
  if (nameHit.some((f) => f.leaderId && f.leaderId === leader)) reasons.push("same Leader as that recipe");
  if (listHit.length) reasons.push(`decklist identical to a known training recipe (${[...new Set(listHit.map((f) => f.source))].join(", ")})`);
  if (markerHit) reasons.push("training/fixture wording in name or description");
  // Two independent signals (a name AND an identical list) are provenance; anything less is a question for a human.
  if (nameHit.length && listHit.length) return { klass: "excluded-training-confirmed", reasons };
  if (reasons.length) return { klass: "uncertain", reasons };
  return { klass: "included", reasons: [] };
}

export interface Entry {
  character: string;
  face: Face;
  form: string;
  cardIds: string[];
  deckCount: number;
  copies: number;
  multiCharacter: boolean;
  status: Coverage;
  characterId: string | null;
  tranche: 1 | 2 | null;
  detail: string[];
}

export interface InventoryInput {
  decks: readonly DeckRow[];
  deckCards: readonly DeckCardRow[];
  cards: readonly CardRow[];
  fixtures: readonly TrainingFixture[];
  mappings: readonly MappingRow[];
  /** Restrict to this owner; when omitted the candidate decks must belong to exactly one owner. */
  owner?: string;
  now: Date;
}

export interface Inventory {
  version: 1;
  generatedAt: string;
  snapshotHash: string;
  scope: { game: "dbs"; built: true; virtual: true; excludesTestFlag: true };
  counts: {
    candidateDecks: number; eligibleDecks: number; builtDecks: number; virtualDecks: number;
    excludedTesting: number; excludedTrainingConfirmed: number; uncertainForReview: number;
    distinctCards: number; distinctCardFaces: number; characters: number; entries: number;
    duplicateFormMerges: number; multiCharacterCards: number;
  };
  coverage: {
    cardFaces: { covered: number; missing: number; exception: number };
    entries: { covered: number; missing: number; exception: number };
    characters: { covered: number; partial: number; missing: number; exception: number };
    tranche1CardFaces: number; tranche2CardFaces: number;
  };
  /** Decks whose provenance needs a human; ordinal only, never name/owner/id. */
  review: { ordinal: number; built: boolean; reasons: string[]; cardCount: number; listHash: string }[];
  entries: Entry[];
  note: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function buildInventory(input: InventoryInput): Inventory {
  const candidates = input.decks.filter((d) => d.game === "dbs");
  const owners = new Set(candidates.map((d) => d.owner));
  if (input.owner === undefined && owners.size > 1) {
    throw new Error(`candidate decks belong to ${owners.size} owners; pass --owner NAME (the name is never written to the output)`);
  }
  const scoped = input.owner === undefined ? candidates : candidates.filter((d) => d.owner === input.owner);
  const rowsByDeck = new Map<number, DeckCardRow[]>();
  for (const r of input.deckCards) (rowsByDeck.get(r.deckId) ?? rowsByDeck.set(r.deckId, []).get(r.deckId)!).push(r);

  const eligible: { deck: DeckRow; rows: DeckCardRow[] }[] = [];
  const review: Inventory["review"] = [];
  let excludedTesting = 0, excludedTraining = 0;
  for (const deck of [...scoped].sort((a, b) => a.id - b.id)) {
    const rows = rowsByDeck.get(deck.id) ?? [];
    const verdict = classifyDeck(deck, rows, input.fixtures);
    if (verdict.klass === "excluded-testing") { excludedTesting++; continue; }
    if (verdict.klass === "excluded-training-confirmed") { excludedTraining++; continue; }
    eligible.push({ deck, rows });
    if (verdict.klass === "uncertain") {
      review.push({
        ordinal: review.length + 1, built: deck.isBuilt, reasons: verdict.reasons,
        cardCount: rows.reduce((n, r) => n + r.quantity, 0), listHash: sha(listSignature(rows)).slice(0, 16),
      });
    }
  }

  const cardById = new Map(input.cards.map((c) => [c.id, c]));
  const mappingByFace = new Map(input.mappings.map((m) => [`${m.cardId}|${m.face}`, m]));

  type Acc = { cardIds: Set<string>; decks: Set<number>; copies: number; multi: boolean; rawForms: Set<string> };
  const acc = new Map<string, Acc & { character: string; face: Face; form: string }>();
  const cardFaceKeys = new Set<string>();
  const cardsSeen = new Set<string>();
  const multiCards = new Set<string>();
  let merges = 0;
  for (const { deck, rows } of eligible) {
    for (const r of rows) {
      if (r.zone === "side") continue;
      const card = cardById.get(r.cardId);
      if (!card) continue;
      cardsSeen.add(card.id);
      const faces: { face: Face; form: string }[] = [{ face: "front", form: card.name }];
      if (card.backName) faces.push({ face: "back", form: card.backName });
      const labels = card.characters.length ? card.characters : ["(no character label)"];
      if (card.characters.length > 1) multiCards.add(card.id);
      for (const f of faces) {
        cardFaceKeys.add(`${card.id}|${f.face}`);
        for (const character of labels) {
          const key = `${normalizeName(character)}|${f.face}|${normalizeName(f.form)}`;
          let a = acc.get(key);
          if (!a) { a = { character, face: f.face, form: f.form, cardIds: new Set(), decks: new Set(), copies: 0, multi: false, rawForms: new Set() }; acc.set(key, a); }
          a.rawForms.add(f.form);
          a.cardIds.add(card.id);
          a.decks.add(deck.id);
          a.copies += r.quantity;
          if (card.characters.length > 1) a.multi = true;
        }
      }
    }
  }
  for (const a of acc.values()) if (a.cardIds.size > 1) merges++;

  // Coverage is judged exactly as the runtime resolver does: card id + face + printed name, nothing fuzzier.
  const faceStatus = new Map<string, { status: Coverage; characterId: string | null; detail: string }>();
  for (const key of cardFaceKeys) {
    const [cardId, face] = key.split("|") as [string, Face];
    const card = cardById.get(cardId)!;
    const form = face === "front" ? card.name : card.backName!;
    const m = mappingByFace.get(key);
    if (!m) faceStatus.set(key, { status: "missing", characterId: null, detail: "" });
    else if (m.name !== form) faceStatus.set(key, { status: "exception", characterId: m.characterId, detail: `mapping for ${cardId} ${face} names a different face than the catalog` });
    else faceStatus.set(key, { status: "covered", characterId: m.characterId, detail: "" });
  }

  const entries: Entry[] = [...acc.values()]
    .map((a): Entry => {
      const cardIds = [...a.cardIds].sort();
      const parts = cardIds.map((id) => faceStatus.get(`${id}|${a.face}`)!);
      const detail: string[] = [];
      let status: Coverage;
      if (a.character === "(no character label)") { status = "exception"; detail.push("catalog carries no character label"); }
      else if (parts.some((p) => p.status === "exception")) { status = "exception"; detail.push(...new Set(parts.filter((p) => p.detail).map((p) => p.detail))); }
      else if (parts.every((p) => p.status === "covered")) status = "covered";
      else if (parts.some((p) => p.status === "covered")) { status = "exception"; detail.push("some printings mapped, others not"); }
      else status = "missing";
      const characterId = parts.find((p) => p.characterId)?.characterId ?? null;
      return {
        character: a.character, face: a.face, form: a.form, cardIds, deckCount: a.decks.size, copies: a.copies,
        multiCharacter: a.multi, status, characterId,
        tranche: characterId ? (TRANCHE1_CHARACTERS.includes(characterId) ? 1 : 2) : null, detail,
      };
    })
    .sort((x, y) => x.character.localeCompare(y.character) || x.face.localeCompare(y.face) || x.form.localeCompare(y.form));

  const tally = (items: Coverage[]) => ({
    covered: items.filter((s) => s === "covered").length,
    missing: items.filter((s) => s === "missing").length,
    exception: items.filter((s) => s === "exception").length,
  });
  const byCharacter = new Map<string, Coverage[]>();
  for (const e of entries) (byCharacter.get(e.character) ?? byCharacter.set(e.character, []).get(e.character)!).push(e.status);
  // A character is covered only when every one of its forms is; a mix of covered and uncovered forms is "partial".
  const characterTally = { covered: 0, partial: 0, missing: 0, exception: 0 };
  for (const list of byCharacter.values()) {
    if (list.every((s) => s === "covered")) characterTally.covered++;
    else if (list.every((s) => s === "missing")) characterTally.missing++;
    else if (list.every((s) => s === "exception")) characterTally.exception++;
    else characterTally.partial++;
  }
  const faceStatuses = [...faceStatus.values()];

  const counts: Inventory["counts"] = {
    candidateDecks: scoped.length, eligibleDecks: eligible.length,
    builtDecks: eligible.filter((e) => e.deck.isBuilt).length, virtualDecks: eligible.filter((e) => !e.deck.isBuilt).length,
    excludedTesting, excludedTrainingConfirmed: excludedTraining, uncertainForReview: review.length,
    distinctCards: cardsSeen.size, distinctCardFaces: cardFaceKeys.size, characters: byCharacter.size,
    entries: entries.length, duplicateFormMerges: merges, multiCharacterCards: multiCards.size,
  };
  const coverage: Inventory["coverage"] = {
    cardFaces: tally(faceStatuses.map((s) => s.status)),
    entries: tally(entries.map((e) => e.status)),
    characters: characterTally,
    tranche1CardFaces: faceStatuses.filter((s) => s.status === "covered" && s.characterId && TRANCHE1_CHARACTERS.includes(s.characterId)).length,
    tranche2CardFaces: faceStatuses.filter((s) => s.status === "covered" && s.characterId && !TRANCHE1_CHARACTERS.includes(s.characterId)).length,
  };

  // The hash covers what the snapshot was made of (every eligible decklist and the faces read), not the clock.
  const snapshotHash = sha(JSON.stringify({
    lists: eligible.map((e) => listSignature(e.rows)).sort(),
    faces: [...cardFaceKeys].sort().map((k) => { const [id, face] = k.split("|"); const c = cardById.get(id)!; return [k, face === "front" ? c.name : c.backName, c.characters]; }),
  }));

  return {
    version: 1, generatedAt: input.now.toISOString(), snapshotHash,
    scope: { game: "dbs", built: true, virtual: true, excludesTestFlag: true },
    counts, coverage, review, entries,
    note: "Counts describe the current owner's eligible decks only; catalog-wide counts are not current-deck coverage. Uncertain decks stay in the inventory until the coordinator rules on them.",
  };
}

const csvCell = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function inventoryCsv(inv: Inventory): string {
  const head = ["character", "face", "form", "card_ids", "deck_count", "copies", "multi_character", "status", "character_id", "tranche", "detail"];
  const lines = inv.entries.map((e) =>
    [e.character, e.face, e.form, e.cardIds.join(" "), e.deckCount, e.copies, e.multiCharacter, e.status, e.characterId ?? "", e.tranche ?? "", e.detail.join("; ")].map(csvCell).join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}
