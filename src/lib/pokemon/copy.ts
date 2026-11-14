/**
 * Every German sentence of the Pokémon screens, in one file so the other lanes (add, decks, cart)
 * say the same things in the same words (docs/pokemon/design.md §10: short sentences, "du", plain
 * words, "Wunsch" not "Want-Liste"). Only the screens under `/pokemon` and what they open read it;
 * Settings and the shared Dragon Ball screens stay English.
 *
 * Plain strings, and small functions where a number or a name goes in. No imports: client
 * components, server pages and scripts can all use it.
 */

import type { PokemonFormat, PokemonVariant } from "./types";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const PK = {
  appName: "Karten",

  // ── Navigation ──────────────────────────────────────────────────────────────
  nav: {
    label: "Hauptnavigation",
    sammlung: "Sammlung",
    entdecken: "Entdecken",
    add: "Hinzufügen",
    addAria: "Karten hinzufügen",
    decks: "Decks",
    wishes: "Wünsche",
    /** The one entry an SL sees beside the Dragon Ball navigation. Settings and the header stay English for them. */
    pokemonEntry: "Pokémon",
  },

  // ── Words used on several screens ───────────────────────────────────────────
  common: {
    close: "Schließen",
    back: "Zurück",
    save: "Speichern",
    saving: "Speichere …",
    cancel: "Abbrechen",
    retry: "Nochmal versuchen",
    loading: "Lade …",
    more: "Mehr laden",
    offline: "Kein Internet. Versuche es gleich noch einmal.",
    error: "Das hat nicht geklappt. Versuche es noch einmal.",
    total: "Zusammen",
    noImage: "Kein Bild",
    price: "Preis",
    priceNote: "Cardmarket-Trend",
    priceUnknown: "Preis unbekannt",
    cardsCount: (n: number) => `${n} ${plural(n, "Karte", "Karten")}`,
    german: "Deutsch",
    english: "Englisch",
    germanShort: "DE",
    englishShort: "EN",
  },

  // ── The three verbs, in the grid, the viewer and the search results ─────────
  verbs: {
    have: "Hab ich",
    haveCount: (n: number) => `Hab ich ×${n}`,
    wish: "Wunsch",
    wished: "Gewünscht",
    wishAria: (name: string, on: boolean) => (on ? `${name} von den Wünschen nehmen` : `${name} wünschen`),
    deck: "Ins Deck",
  },

  // ── Sammlung ────────────────────────────────────────────────────────────────
  collection: {
    title: "Meine Sammlung",
    titleAll: "Sammlung aller Spieler",
    count: (n: number) => `${n} ${plural(n, "Karte", "Karten")}`,
    value: (formatted: string) => `${formatted} wert`,
    valueNote: "Der Wert ist der Cardmarket-Trend in Euro. Karten ohne Preis zählen nicht mit.",
    filters: { all: "Alle", inDeck: "Im Deck", de: "Deutsch", en: "Englisch" },
    filterLabel: "Filter",
    sortNewest: "Neueste zuerst",
    copies: (n: number) => `×${n}`,
    inDecks: (n: number) => `Deck ${n}`,
    ownPhoto: "Eigenes Foto",
    empty: "Noch keine Karten. Tippe auf ＋ und lies deine erste Karte vor.",
    emptyFilter: "Dazu gibt es in deiner Sammlung nichts.",
    emptyAction: "Karten hinzufügen",
    ownerLabel: (owner: string | null) => (owner ? `von ${owner}` : "ohne Besitzer"),
  },

  // ── Entdecken ───────────────────────────────────────────────────────────────
  discover: {
    title: "Entdecken",
    subtitle: "Live-Suche",
    searchLabel: "Karte suchen",
    searchPlaceholder: "Name oder Nummer",
    searchClear: "Suche leeren",
    voice: "Vorlesen",
    typeChips: "Typ",
    categoryChips: "Art der Karte",
    all: "Alle",
    categories: { POKEMON: "Pokémon", TRAINER: "Trainer", ENERGY: "Energie" } as Record<"POKEMON" | "TRAINER" | "ENERGY", string>,
    newestSets: "Neueste Sets",
    setBack: "Alle Sets",
    setCards: (name: string) => `Karten aus „${name}“`,
    setsLoading: "Lade die Sets …",
    noResult: "Keine Karte gefunden. Sag den Namen noch einmal oder tippe ihn.",
    unavailable: "Die Kartensuche ist gerade nicht erreichbar. Deine Sammlung funktioniert weiter.",
    moreLoading: "Lade weitere Karten …",
    end: "Das waren alle Karten.",
    ownedBadge: (n: number) => `✓ ${n}`,
    owned: (n: number) => `Du hast ${n}`,
    priceFrom: (formatted: string) => `ab ${formatted}`,
  },

  // ── Wünsche ─────────────────────────────────────────────────────────────────
  wishes: {
    title: "Meine Wünsche",
    count: (n: number) => `${n} ${plural(n, "Karte", "Karten")}`,
    empty: "Noch keine Wünsche. Tippe bei einer Karte auf das Herz.",
    emptyAction: "Karten entdecken",
    total: "Zusammen etwa",
    totalNote: "Preise sind der Cardmarket-Trend. Wenn du mehr Exemplare willst, steht die Zahl bei der Karte.",
    wantCopies: (n: number) => `×${n}`,
    remove: "Vom Wunsch nehmen",
  },

  // ── The swipe viewer ────────────────────────────────────────────────────────
  viewer: {
    close: "Betrachter schließen",
    position: (i: number, n: number) => `${i} / ${n}`,
    previous: "Vorherige Karte",
    next: "Nächste Karte",
    details: "Details",
    detailsAria: "Details und eigenes Foto",
    swipeHint: "Wische zur Seite, um weiterzublättern.",
    cardOf: (name: string, i: number, n: number) => `${name}, Karte ${i} von ${n}`,
    loadingDetails: "Lade Details …",
    detailsFailed: "Die Details sind gerade nicht erreichbar.",
  },

  // ── "Hab ich" sheet ─────────────────────────────────────────────────────────
  have: {
    title: "Hab ich",
    variant: "Variante",
    language: "Sprache der Karte",
    amount: "Wie viele?",
    less: "Eine weniger",
    more: "Eine mehr",
    save: "Speichern",
    saved: "Gespeichert",
    removed: "Aus der Sammlung genommen",
    youHave: (n: number) => `Du hast ${n} ${plural(n, "Karte", "Karten")} davon.`,
    noneYet: "Du hast diese Karte noch nicht.",
    variantLabels: { normal: "Normal", holo: "Holo", reverse: "Reverse", firstEdition: "1. Edition", wPromo: "Promo" } as Record<PokemonVariant, string>,
  },

  // ── "Ins Deck" sheet ────────────────────────────────────────────────────────
  deck: {
    title: "Ins Deck",
    choose: "In welches Deck?",
    none: "Du hast noch kein Pokémon-Deck.",
    newWithCard: "Neues Deck mit dieser Karte",
    newWithCardHint: "Die App schlägt dir passende Karten vor.",
    cardCount: (n: number) => `${n} / 60`,
    already: (n: number) => (n === 0 ? "noch nicht drin" : `${n}× schon drin`),
    added: (deck: string) => `In „${deck}“ gelegt`,
  },

  // ── Detail sheet ────────────────────────────────────────────────────────────
  detail: {
    names: "Name",
    english: "Englisch",
    german: "Deutsch",
    set: "Set",
    hp: "KP",
    type: "Typ",
    kind: "Art",
    evolvesFrom: "Entwickelt sich aus",
    attacks: "Attacken",
    abilities: "Fähigkeiten",
    weakness: "Schwäche",
    retreat: "Rückzug",
    rarity: "Seltenheit",
    format: "Format",
    allowed: "erlaubt",
    notAllowed: "nicht erlaubt",
    formatName: (f: PokemonFormat) => (f === "standard" ? "Standard" : "Erweitert"),
    price: "Preis",
    priceFrom: "ab",
    yourCopies: "Deine Karten",
    noCopies: "Du hast sie noch nicht.",
    copyLine: (variant: string, language: string, n: number) => `${n}× ${variant}, ${language}`,
    ownPhoto: "Eigenes Foto",
    ownPhotoNeedsCard: "Das eigene Foto geht, sobald du die Karte hast. Tippe auf „Hab ich“.",
    unknown: "unbekannt",
  },

  // ── The own-photo control (PhotoOverride labels) ────────────────────────────
  photo: {
    title: "Eigenes Foto",
    take: "Foto aufnehmen",
    retake: "Foto ersetzen",
    original: "Original zeigen",
    saving: "Speichere …",
    removing: "Entferne …",
    errorRead: "Diese Datei konnte nicht als Bild gelesen werden.",
    errorEncode: "Dieser Browser konnte das Bild nicht verkleinern.",
    errorTooLarge: "Das Bild ist auch verkleinert noch zu groß.",
    errorSave: "Das Foto konnte nicht gespeichert werden.",
  },

  // ── Stage names TCGdex sends in English ────────────────────────────────────
  stage: { Basic: "Basis", Stage1: "Phase 1", Stage2: "Phase 2", VMAX: "VMAX", VSTAR: "VSTAR", V: "V", BREAK: "BREAK", MEGA: "Mega", Restored: "Wiederhergestellt" } as Record<string, string>,
} as const;

/** "Basis", "Phase 1" ... for a TCGdex stage; the text itself when we have no translation. */
export function stageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return PK.stage[stage] ?? stage;
}
