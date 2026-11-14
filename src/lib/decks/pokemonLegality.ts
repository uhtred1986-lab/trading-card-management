/**
 * Pokémon deck checking (docs/pokemon/plan.md §7). Like the Bandai checker it only labels: nothing
 * here blocks an edit. Texts are German (`GAME_INFO.pokemon.uiLang`), short, in "du" form.
 *
 * Rules: exactly 60 cards, no Leader or Z-Deck, at most 4 cards with the same *name* (basic Energy
 * unlimited), at most one ACE SPEC and one Radiant Pokémon per deck, at least one Basic Pokémon, and
 * every card legal in the deck's format. A card with no legality data is reported as unknown (a
 * warning), never guessed.
 */
import { gameInfo, type Game } from "@/lib/catalog/games";
import { pokemonDetails } from "@/lib/pokemon/types";
import type { DeckFlag, DeckIssue, DeckLegality, DeckStatus, IssueSeverity, LegalityCard } from "./legality";

const FORMAT_LABEL: Record<string, string> = { standard: "Standard", expanded: "Expanded" };

/** The deck's format, falling back to the game's default for a missing or unknown one. */
export function pokemonFormatOf(format: string | null | undefined): string {
  const formats = gameInfo("pokemon").deck.formats;
  return format && formats.includes(format) ? format : formats[0];
}

/** The key the 4-copy limit counts: the English name when the card has one, else its own name. */
export function pokemonNameKey(r: Pick<LegalityCard, "name" | "details">): string {
  const en = pokemonDetails(r.details).names?.en;
  return (en && en.trim() ? en : r.name).trim().toLowerCase();
}

const cards = (n: number) => (n === 1 ? "1 Karte" : `${n} Karten`);

export function pokemonLegality(rows: LegalityCard[], game: Game, format?: string | null): DeckLegality {
  const info = gameInfo(game);
  const rules = info.deck;
  const fmt = pokemonFormatOf(format);
  const fmtLabel = FORMAT_LABEL[fmt] ?? fmt;
  const issues: DeckIssue[] = [];
  const flags: Record<string, DeckFlag> = {};
  const rank: Record<IssueSeverity, number> = { warning: 0, incomplete: 1, illegal: 2 };
  const flag = (r: LegalityCard, severity: IssueSeverity, label: string) => {
    const key = `${r.zone}:${r.cardId}`;
    if (!flags[key] || rank[severity] > rank[flags[key].severity]) flags[key] = { severity, label };
  };
  const issue = (severity: IssueSeverity, message: string, cardId?: string) => issues.push({ severity, message, cardId });
  const count = (zone: string) => rows.filter((r) => r.zone === zone).reduce((n, r) => n + r.quantity, 0);
  const mainCount = count("main");
  const leaderCount = count("leader");
  const zCount = count("z");
  const sideCount = count("side");

  // Size.
  if (mainCount < rules.main) issue("incomplete", `Noch ${cards(rules.main - mainCount)} bis ${rules.main}`);
  else if (mainCount > rules.mainMax) issue("illegal", `${cards(mainCount - rules.mainMax)} zu viel (höchstens ${rules.mainMax})`);

  // No Leader slot and no Z-Deck: cards left there from another game's deck are flagged, not hidden.
  for (const r of rows) {
    if (r.zone === "leader" || r.zone === "z") {
      flag(r, "illegal", "Hier gibt es keinen Leader- oder Z-Deck-Platz");
      issue("illegal", `${r.name} liegt im ${r.zone === "z" ? "Z-Deck" : "Leader-Platz"}, den es bei Pokémon nicht gibt`, r.cardId);
    }
  }

  const inDeck = rows.filter((r) => r.zone === "main");
  const own: LegalityCard[] = [];
  for (const r of inDeck) {
    if (r.game && r.game !== game) {
      flag(r, "illegal", `Eine ${gameInfo(r.game).short}-Karte in einem Pokémon-Deck`);
      issue("illegal", `${r.name} (${r.cardId}) ist eine ${gameInfo(r.game).short}-Karte und gehört nicht in ein Pokémon-Deck`, r.cardId);
    } else if (info.nonDeckTypes.includes(r.cardType)) {
      flag(r, "illegal", "Keine Deckkarte");
      issue("illegal", `${r.name} (${r.cardId}) ist keine Deckkarte`, r.cardId);
    } else own.push(r);
  }

  // At most 4 with the same name; basic Energy is unlimited. Two printings of one Pokémon share the limit.
  const byName = new Map<string, { n: number; rows: LegalityCard[] }>();
  for (const r of own) {
    if (pokemonDetails(r.details).basicEnergy) continue;
    const key = pokemonNameKey(r);
    const e = byName.get(key) ?? { n: 0, rows: [] };
    e.n += r.quantity;
    e.rows.push(r);
    byName.set(key, e);
  }
  for (const { n, rows: group } of byName.values()) {
    if (n <= rules.copies) continue;
    const label = `Höchstens ${rules.copies} Karten mit dem Namen ${group[0].name} (du hast ${n})`;
    for (const r of group) flag(r, "illegal", label);
    issue("illegal", label, group[0].cardId);
  }

  // One ACE SPEC and one Radiant Pokémon per deck.
  const ONE: { kind: "ace-spec" | "radiant"; what: string }[] = [
    { kind: "ace-spec", what: "ACE-SPEC-Karte" },
    { kind: "radiant", what: "Strahlendes Pokémon" },
  ];
  for (const { kind, what } of ONE) {
    const members = own.filter((r) => pokemonDetails(r.details).onePerDeck === kind);
    const n = members.reduce((sum, r) => sum + r.quantity, 0);
    if (n <= 1) continue;
    const label = `Höchstens 1 ${what} pro Deck (du hast ${n})`;
    for (const r of members) flag(r, "illegal", label);
    issue("illegal", label, members[0].cardId);
  }

  // At least one Basic Pokémon (only worth saying once the deck has cards).
  const hasBasic = own.some((r) => r.cardType === "POKEMON" && pokemonDetails(r.details).stage === "Basic");
  if (own.length > 0 && !hasBasic) issue(mainCount >= rules.main ? "illegal" : "incomplete", "Du brauchst mindestens ein Basis-Pokémon");

  // Format: false is illegal, missing data is unknown.
  const unknown: LegalityCard[] = [];
  for (const r of own) {
    if (r.isBanned) {
      flag(r, "illegal", "Gesperrt");
      issue("illegal", `${r.name} (${r.cardId}) ist gesperrt`, r.cardId);
    }
    const allowed = pokemonDetails(r.details).legal?.[fmt as "standard" | "expanded"];
    if (allowed === false) {
      flag(r, "illegal", `Im ${fmtLabel}-Format nicht mehr erlaubt`);
      issue("illegal", `${r.name} ist im ${fmtLabel}-Format nicht mehr erlaubt`, r.cardId);
    } else if (typeof allowed !== "boolean") unknown.push(r);
  }
  for (const r of unknown) flag(r, "warning", `Legalität im ${fmtLabel}-Format unbekannt`);
  if (unknown.length) {
    const names = [...new Set(unknown.map((r) => r.name))];
    issue("warning", `Für ${names.length === 1 ? "eine Karte" : `${names.length} Karten`} ist die Legalität im ${fmtLabel}-Format unbekannt: ${names.join(", ")}`);
  }

  const status: DeckStatus = issues.some((i) => i.severity === "illegal") ? "illegal" : issues.some((i) => i.severity === "incomplete") ? "incomplete" : "legal";
  return { status, keywordRules: [], leaderCount, mainCount, zCount, sideCount, issues, flags };
}
