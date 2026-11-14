/**
 * The words of the Claude deck components, so a game's screens can speak their own language
 * (`GAME_INFO[game].uiLang`): the English sets are what the Dragon Ball screens always showed, the German
 * sets are for the Pokémon screens. Strings only (with `{n}` / `{id}` placeholders), so a server page can
 * hand a set to a client component. No server import here: client components use it.
 */

export interface NewDeckWithClaudeLabels {
  open: string;
  openTitle: string;
  disabledTitle: string;
  heading: string;
  close: string;
  game: string;
  bothGames: string;
  /** Game names by game id, for the game select (`dbs`: "Masters"). */
  gameNames: Record<string, string>;
  colour: string;
  anyColour: string;
  searchAria: string;
  searchPlaceholder: string;
  searching: string;
  noMatch: string;
  searchError: string;
  readAbilities: string;
  /** "you own {n}". */
  youOwn: string;
  notOwned: string;
  /** "own {n}". */
  own: string;
  pickFirst: string;
  drafting: string;
  draft: string;
  footnotePre: string;
  footnoteEmph: string;
  footnotePost: string;
  // A game without a Leader (Pokémon): a wish and / or a card instead of a Leader search.
  wishLabel: string;
  wishPlaceholder: string;
  formatLabel: string;
  formatNames: Record<string, string>;
  seedLabel: string;
  seedNone: string;
  seedChange: string;
  wishNeeded: string;
  build: string;
}

export interface NewDeckFromCardLabels {
  open: string;
  openTitle: string;
  disabledTitle: string;
  heading: string;
  close: string;
  searchPlaceholder: string;
  change: string;
  leaderPre: string;
  leaderLink: string;
  leaderPost: string;
  pickFirst: string;
  drafting: string;
  draft: string;
  footnotePre: string;
  footnoteEmph: string;
  footnotePost: string;
  // The free draft (Pokémon).
  freeDraft: string;
  freeDrafting: string;
  withClaude: string;
  freeNote: string;
  formatLabel: string;
  formatNames: Record<string, string>;
}

export interface DeckAiLabels {
  heading: string;
  disabled: string;
  summarise: string;
  resummarise: string;
  strong: string;
  weak: string;
  goodAgainst: string;
  badAgainst: string;
  keyCards: string;
  legality: string;
  summarised: string;
  summaryHint: string;
  wizardHeading: string;
  wizardHint: string;
  /** "{n} open right now." */
  openNow: string;
  contextPlaceholder: string;
  scopeAny: string;
  scopeOwned: string;
  presets: { label: string; value: string }[];
  /** After a run: "{n} suggestion(s)" and "{n} open", singular and plural, then the hint, then {assessment} is appended. */
  suggestionOne: string;
  suggestionMany: string;
  suggestionHint: string;
  noSwaps: string;
  thinking: string;
  suggestSwaps: string;
}

export const NEW_DECK_WITH_CLAUDE_LABELS_EN: NewDeckWithClaudeLabels = {
  open: "✦ Deck from a leader",
  openTitle: "Pick a leader and Claude drafts a deck around it",
  disabledTitle: "Set ANTHROPIC_API_KEY",
  heading: "Deck from a leader",
  close: "close",
  game: "Game",
  bothGames: "Both games",
  gameNames: { dbs: "Masters", fusion: "Fusion World" },
  colour: "Colour",
  anyColour: "Any colour",
  searchAria: "Search leaders for a new deck",
  searchPlaceholder: "Leader name or number, e.g. Bardock",
  searching: "Searching…",
  noMatch: "No leader matches that.",
  searchError: "Could not search leaders. Try again.",
  readAbilities: "Read leader abilities",
  youOwn: "you own {n}",
  notOwned: "not in your collection",
  own: "own {n}",
  pickFirst: "Pick a leader first",
  drafting: "Drafting… (a minute or two)",
  draft: "Draft a deck with Claude",
  footnotePre: "Creates a ",
  footnoteEmph: "virtual",
  footnotePost: " deck, preferring cards you own and listing anything you'd need to buy.",
  wishLabel: "What kind of deck?",
  wishPlaceholder: "e.g. a fast fire deck",
  formatLabel: "Format",
  formatNames: { standard: "Standard", expanded: "Expanded" },
  seedLabel: "Built around",
  seedNone: "no card picked",
  seedChange: "change",
  wishNeeded: "Say what kind of deck you want, or pick a card.",
  build: "Build a deck with Claude",
};

export const NEW_DECK_FROM_CARD_LABELS_EN: NewDeckFromCardLabels = {
  open: "✦ Deck around a card",
  openTitle: "Pick a card and Claude builds a Leader and a deck around it",
  disabledTitle: "Set ANTHROPIC_API_KEY",
  heading: "Deck around a card",
  close: "close",
  searchPlaceholder: "Card name or number, e.g. BT18-020",
  change: "change",
  leaderPre: "That's a Leader — use ",
  leaderLink: "Build a deck with Claude",
  leaderPost: " on the Leaders page instead.",
  pickFirst: "Pick a card first",
  drafting: "Drafting… (a minute or two)",
  draft: "Draft a deck with Claude",
  footnotePre: "Claude also picks a Leader, preferring cards you own and listing anything you'd need to buy. Creates a ",
  footnoteEmph: "virtual",
  footnotePost: " deck.",
  freeDraft: "Free draft",
  freeDrafting: "Building the draft…",
  withClaude: "With Claude",
  freeNote: "The free draft needs no Claude: it adds the card's evolution line, Energy and the Trainers you own.",
  formatLabel: "Format",
  formatNames: { standard: "Standard", expanded: "Expanded" },
};

export const DECK_AI_LABELS_EN: DeckAiLabels = {
  heading: "AI analysis",
  disabled: "Set ANTHROPIC_API_KEY to enable deck analysis.",
  summarise: "Summarise deck",
  resummarise: "Re-summarise",
  strong: "Strong",
  weak: "Weak",
  goodAgainst: "Good against",
  badAgainst: "Bad against",
  keyCards: "Key cards: ",
  legality: "Legality",
  summarised: "Summarised",
  summaryHint: "Get an archetype summary, game plan and matchup notes reasoned from the card text.",
  wizardHeading: "Improvement wizard",
  wizardHint: "Suggestions are saved and appear under the card they replace, so you only pay for a run once. They expire after 7 days.",
  openNow: " {n} open right now.",
  contextPlaceholder: "Anything else for Claude? e.g. “I keep losing to yellow aggro” or “I never draw my leader's combo pieces”.",
  scopeAny: "Any legal card",
  scopeOwned: "Only cards I own",
  presets: [
    { label: "Quick suggestion", value: "" },
    { label: "I feel something's missing", value: "Something feels missing — say what role or effect this deck lacks and fill it." },
    { label: "More consistency", value: "Prioritise consistency: searching, draw, and hitting energy on curve." },
    { label: "Faster / more aggressive", value: "Optimise for pressure and speed — win earlier, even at the cost of late-game power." },
    { label: "Survive longer", value: "Optimise for surviving into the late game: removal, blockers and card advantage." },
    { label: "Cheaper to build", value: "Prefer swaps that keep the deck affordable; avoid expensive rares where a common does the job." },
  ],
  suggestionOne: "{n} suggestion",
  suggestionMany: "{n} suggestions",
  suggestionHint: " — open the ▸ under a card to see them.",
  noSwaps: "No swaps suggested.",
  thinking: "Thinking…",
  suggestSwaps: "Suggest swaps",
};
