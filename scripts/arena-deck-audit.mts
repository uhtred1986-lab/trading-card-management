/**
 * Offline-MVP deck audit (#649, plan O4-01) — no database, no network by default.
 *
 * Reads a small dated catalog snapshot (`docs/arena-backlog/evidence/649/
 * catalog-subset-2026-10-13.json`, only the cards of the two candidate decks),
 * resolves the two decklists, runs the app's own `legality()`, runs the repo's
 * own compiler (`compileCard`) over every card face, and reports for each
 * mechanic the deck needs whether the engine has *runtime evidence* for it
 * (a supported `CAPABILITY_EVIDENCE` row) or only a compile result. Compiling
 * is never counted as support.
 *
 *   npx tsx scripts/arena-deck-audit.mts              # markdown report on stdout
 *   npx tsx scripts/arena-deck-audit.mts --check      # assertions only (exit 1 on drift)
 *   npx tsx scripts/arena-deck-audit.mts --json       # machine-readable report
 *   npx tsx scripts/arena-deck-audit.mts --live       # re-fetch the public deckplanet feed (read-only GETs)
 *                                                     # and compare the deck cards with the snapshot
 *   npx tsx scripts/arena-deck-audit.mts --write-snapshot   # (with --live) rewrite the snapshot subset
 *
 * Deck A is an owner-amended variant of the printed starter (13 Oct 2026: BT10-008 x1, BT5-023 x3; see `DeckSpec.amended`).
 * The deck lists are copied from `scripts/import-starter-decks.mts` (that file
 * opens a database connection at import time, so it cannot be imported); the
 * `--check` run proves the copies still equal the importer's source text.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { legality, type LegalityCard } from "../src/lib/decks/legality";
import { cardDefFrom } from "../src/lib/arena/load";
import { compileCard, compileCostProgram, costIsOnlyOrbs, priceCondition } from "../src/lib/arena/compile";
import { triggersOf } from "../src/lib/arena/gaps";
import { emitsStatic } from "../src/lib/arena/engine/state";
import { skillsOf } from "../src/lib/arena/text/cards";
import { CAPABILITY_EVIDENCE } from "../src/lib/arena/capability-inventory";
import { KEYWORDS } from "../src/lib/arena/glossary";
import { DECISION_WINDOWS } from "../src/lib/arena/policy/contract";
import type { CatalogCard } from "../src/lib/catalog/deckplanet";
import type { Skill } from "../src/lib/arena/types";

const args = new Set(process.argv.slice(2));
const SNAPSHOT = "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json";

// ── the two candidate decks ────────────────────────────────────────────────

type Entry = { quantity: number; number?: string; name?: string; leader?: true };
export interface DeckSpec {
  key: string;
  name: string;
  setCode: string;
  /** Where the quantities come from, as the importer's own comment states it. */
  source: string;
  entries: Entry[];
  /**
   * Owner-decided departures from the importer's printed list (`entries` holds
   * the amended quantities; `printed` is what the importer carries, which
   * `--check` still requires to be there).
   */
  amended?: { decision: string; changes: { number: string; printed: number; amended: number }[] };
}
const n = (quantity: number, name: string): Entry => ({ quantity, name });
const id = (quantity: number, number: string): Entry => ({ quantity, number });

export const DECKS: DeckSpec[] = [
  {
    key: "A",
    name: "[Starter] Pride of the Saiyans",
    setCode: "SD15",
    source: "athenagames.com reproduction of Bandai's official SD15 Pieces table; main deck sums to 50.",
    // Owner-amended variant (decision of 13 Oct 2026, #649/#655): the printed
    // starter has BT10-008 x2 (restricted to 1, illegal) and BT5-023 x2; the
    // owner drops one BT10-008 and adds a third BT5-023 (still 50 cards). The
    // importer is NOT changed - it reflects the printed starter.
    amended: {
      decision: "Owner decision of 13 Oct 2026: BT10-008 x2 -> x1 (limit 1) and BT5-023 x2 -> x3.",
      changes: [{ number: "BT10-008", printed: 2, amended: 1 }, { number: "BT5-023", printed: 2, amended: 3 }],
    },
    entries: [
      { quantity: 1, leader: true },
      id(2, "SD15-02"), id(2, "SD15-03"), id(2, "SD15-04"), id(2, "SD15-05"),
      id(2, "BT1-014"), id(2, "BT1-027"), id(2, "BT3-027"), id(2, "BT4-012"), id(3, "BT5-023"),
      id(2, "BT6-010"), id(2, "BT6-011"), id(2, "BT6-025"), id(2, "BT6-026"), id(2, "BT9-031"),
      id(1, "BT10-008"), id(2, "BT11-008"), id(2, "BT11-011"), id(2, "BT14-006"), id(4, "BT14-010"),
      id(2, "TB1-023"), id(2, "TB1-055"), id(2, "DB1-019"), id(2, "DB2-004"), id(2, "DB3-001"),
    ],
  },
  {
    key: "B",
    name: "[Starter] The Crimson Saiyan",
    setCode: "SD5",
    source: "poggers.com reproduction of SD05; main deck sums to 50.",
    entries: [
      { quantity: 1, leader: true },
      n(4, "SSB Son Goku, at the Apex"), n(4, "Indomitable Dynasty SS Son Goku"), n(4, "Dependable Dynasty Son Goku"),
      n(4, "Dynasty Deferred Son Goku"), n(4, "Intrepid Dynasty Son Gohan"), n(4, "Prodigal Dynasty Son Goten"),
      n(4, "Plucky Dynasty Pan"), n(4, "Dynasty's Solace Chi-Chi"), n(4, "Adoptive Father Son Gohan"),
      n(4, "Instant Transmission"), n(2, "Power Charge Bardock"), n(2, "Reborn Might SS4 Son Goku"),
      n(2, "Ultimate Potential SS2 Son Gohan"), n(2, "Unbroken Dynasty Son Goku"), n(2, "10x Kamehameha"),
    ],
  },
];

/**
 * The other two Masters lists the importer carries. They were considered and
 * not chosen (see `--live --candidates`); kept here so the comparison is
 * reproducible, not so they are audited.
 */
export const REJECTED: DeckSpec[] = [
  {
    key: "C",
    name: "[Starter] Clan Collusion",
    setCode: "SD13",
    source: "poggers.com reproduction of SD13; main deck sums to 50.",
    entries: [
      { quantity: 1, leader: true },
      n(4, "Avenging Frieza"), n(4, "Yamcha, the Cunning"), n(4, "Frieza, Cosmic Horror"), n(4, "Frieza, Terrifying Transformation"),
      n(4, "Dodoria the Cold-Blooded"), n(4, "Zarbon the Gorgeous"), n(4, "Frieza's Call"), n(4, "Shocking Death Ball"),
      n(4, "One-Star Ball, Parasitic Darkness"), n(3, "Frieza the Power Monger"), id(2, "SD13-02"),
      n(2, "Ginyu, Frieza's Greatest Soldier"), n(2, "Zarbon, Frieza's Right-Hand Man"), n(2, "Dodoria, Frieza's Devoted Servant"),
      n(2, "Burter, Fastest in the Universe"), n(1, "Cold Bloodlust"),
    ],
  },
  {
    key: "D",
    name: "[Starter] The Extreme Evolution",
    setCode: "SD2",
    source: "poggers.com reproduction of SD02; main deck sums to 50.",
    entries: [
      { quantity: 1, leader: true },
      n(4, "Unbreakable Super Saiyan Son Goku"), n(4, "Pint-sized Warrior Son Goku"), n(4, "Shocking Future Son Goku"),
      n(4, "Quick Rush Trunks"), n(4, "Handy Giru"), n(4, "Hidden Power Uub"), n(4, "Bodyguard Ledgic"),
      n(4, "Unending Awakening"), n(4, "Grand Tour Spaceship"), n(2, "Broken Limits Super Saiyan 3 Son Goku"),
      n(2, "Rushing Warrior Pan"), n(2, "Chain Attack Trunks"), n(2, "Pan"), n(2, "Power-absorbing Luud"),
      n(2, "Dr. Myuu Under Baby's Control"), n(2, "Hidden Ability, General Rilldo"),
    ],
  },
];

// ── snapshot ────────────────────────────────────────────────────────────────

interface Snapshot {
  source: { url: string; retrieved: string; rawRecords: number; note: string };
  cards: CatalogCard[];
}
const norm = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[–—]/g, "-").replace(/[^a-z0-9']+/g, " ").trim();

export interface Resolved { card: CatalogCard; quantity: number; zone: "leader" | "main" | "z" }

export function resolveDeck(spec: DeckSpec, catalog: CatalogCard[]): { rows: Resolved[]; problems: string[] } {
  const rows: Resolved[] = [];
  const problems: string[] = [];
  const byId = new Map(catalog.map((c) => [c.id, c]));
  for (const e of spec.entries) {
    let hit: CatalogCard | undefined;
    if (e.leader) {
      const leaders = catalog.filter((c) => c.setCode === spec.setCode && c.cardType === "LEADER");
      if (leaders.length !== 1) problems.push(`leader: set ${spec.setCode} has ${leaders.length} LEADER cards in the snapshot`);
      else hit = leaders[0];
    } else if (e.number) {
      hit = byId.get(e.number);
      if (!hit) problems.push(`${e.number}: not in the snapshot`);
    } else if (e.name) {
      const m = catalog.filter((c) => norm(c.name) === norm(e.name!));
      hit = m.length === 1 ? m[0] : m.filter((c) => c.setCode === spec.setCode).length === 1 ? m.find((c) => c.setCode === spec.setCode) : undefined;
      if (!hit) problems.push(`"${e.name}": ${m.length} matches in the snapshot`);
    }
    if (hit) rows.push({ card: hit, quantity: e.quantity, zone: hit.cardType === "LEADER" ? "leader" : "main" });
  }
  return { rows, problems };
}

const toLegalityRow = (r: Resolved): LegalityCard => ({
  cardId: r.card.id, zone: r.zone, quantity: r.quantity, name: r.card.name, cardType: r.card.cardType,
  colors: r.card.colors, limitedTo: r.card.limitedTo, isBanned: r.card.isBanned, skill: r.card.skill, game: "dbs",
});

export function loadSnapshot(): Snapshot {
  return JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
}

/** Read-only GETs of the public deckplanet feed (the catalog sync's own source); nothing is written to a database. */
async function liveCatalog(): Promise<{ cards: CatalogCard[]; rawRecords: number }> {
  const { fetchDeckplanet, shapeCatalog } = await import("../src/lib/catalog/deckplanet");
  const raw = await fetchDeckplanet("dbs");
  return { cards: shapeCatalog(raw, "dbs").cards, rawRecords: raw.length };
}

// ── mechanics ──────────────────────────────────────────────────────────────

type OpLike = Record<string, unknown>;
function collect(ops: unknown, out: { ops: Set<string>; conds: Set<string> }): void {
  const cond = (c: unknown) => {
    if (Array.isArray(c)) return c.forEach(cond);
    if (c && typeof c === "object") {
      const o = c as OpLike;
      if (typeof o.kind === "string") out.conds.add(o.kind);
      for (const k of ["cond", "conds"]) if (k in o) cond(o[k]);
    }
  };
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as OpLike;
    if (typeof o.op === "string") out.ops.add(o.op);
    for (const [k, val] of Object.entries(o)) {
      if (k === "cond" || k === "conds") cond(val);
      else walk(val);
    }
  };
  walk(ops);
}

export interface SkillAudit {
  cardId: string;
  face: "front" | "back";
  index: number;
  kind: string;
  keyword: string | null;
  text: string;
  read: boolean;
  unread: string[];
  mechanics: string[];
  /** Moments `triggersOf` (the engine's own reader of printed [Auto] wording) finds in the text. */
  triggers: string[];
  /** null when the skill prints no price; otherwise whether the engine can read the price. */
  priceRead: boolean | null;
  /** [Permanent] only: does the static layer have an op to apply? */
  staticEmits: boolean | null;
  /**
   * A [Counter] whose printed price is more than orbs. Until #716 the rules
   * engine never offered one (refused as `unread`); since #716 it offers one
   * whose price record reads and can be paid in full (`vm/battle.ts`
   * `counterRoutes`), so this is descriptive and no longer a tier-B blocker.
   */
  counterNonOrbPrice: boolean;
}

const TAG_MECHANICS: [RegExp, string][] = [
  [/spirit boost/i, "tag:Spirit Boost"],
  [/once per turn/i, "tag:Once per turn"],
];

export function auditCard(card: CatalogCard): SkillAudit[] {
  const def = cardDefFrom(card as never);
  const out: SkillAudit[] = [];
  for (const face of ["front", "back"] as const) {
    if (face === "back" && !def.back) continue;
    const scripts = compileCard(def, face);
    for (const sk of skillsOf(def, face) as Skill[]) {
      const s = scripts.bySkill[sk.index];
      const body = { ops: new Set<string>(), conds: new Set<string>() };
      const price = { ops: new Set<string>(), conds: new Set<string>() };
      collect(s?.ops, body);
      collect(s?.price?.ops, price);
      collect(s?.price?.condition, price);
      const m = new Set<string>();
      m.add(`kind:${sk.kind}`);
      if (sk.keyword) m.add(`kw:${sk.keyword.name}`);
      for (const [re, id] of TAG_MECHANICS) if (sk.tags.some((t) => re.test(t))) m.add(id);
      for (const o of body.ops) m.add(`op:${o}`);
      for (const c of body.conds) m.add(`cond:${c}`);
      for (const o of price.ops) m.add(`price:${o}`);
      for (const c of price.conds) m.add(`pricecond:${c}`);
      if (s?.price?.x) m.add("price:X");
      for (const u of s?.unsupported ?? []) m.add(`unread:${u}`);
      const triggers = sk.kind === "auto" || sk.keyword ? triggersOf(sk) : [];
      for (const t of triggers) m.add(`trigger:${t}`);
      const priceRead = sk.kind === "auto" || sk.kind.startsWith("activate") || sk.kind.startsWith("counter")
        ? (sk.cost.trim() === "" ? null : costIsOnlyOrbs(sk.cost) || !!compileCostProgram(sk) || !!priceCondition(sk))
        : null;
      const staticEmits = sk.kind === "permanent" && s ? emitsStatic(s.ops) : null;
      out.push({
        cardId: card.id,
        face,
        index: sk.index,
        kind: sk.kind,
        keyword: sk.keyword?.name ?? null,
        text: (sk.cost ? `${sk.cost} : ` : "") + sk.effect,
        read: (s?.unsupported.length ?? 1) === 0,
        unread: s?.unsupported ?? ["no program"],
        mechanics: [...m].sort(),
        triggers,
        priceRead,
        staticEmits,
        counterNonOrbPrice: sk.kind.startsWith("counter:") && sk.cost.trim() !== "" && !costIsOnlyOrbs(sk.cost),
      });
    }
  }
  return out;
}

// ── offline play-through: what the local policy actually meets ─────────────

export interface PlayStats {
  matchup: string;
  games: number;
  finished: number;
  winners: Record<string, number>;
  /** How finished games ended (the engine's own end reason), by count. */
  endings: Record<string, number>;
  /** Games (of this matchup) in which a card id was in a Battle, Unison or Combo Area at some decision. */
  reached: Record<string, number>;
  /** Games in which a Leader id was flipped to its awakened side. */
  awakened: Record<string, number>;
  /** Games in which a manual skill (`cardId#skillIndex`) was on the legal list at some decision. */
  offered: Record<string, number>;
  /** Games in which the engine refused a manual skill as `unread` (its own refusal reason) at some decision. */
  refusedUnread: Record<string, number>;
  /** Why unfinished games stopped (reason text, count). */
  stops: Record<string, number>;
  /** Engine prompt kinds the policy was asked, by count, across every game of the matchup. */
  prompts: Record<string, number>;
  /** Distinct `chooseCards` reasons (the card-named question the engine asked), by count. */
  choices: Record<string, number>;
}

export const RUNTIME = "a649000000000000000000000000000000000649";

/**
 * The owner's `cards.specified_cost` values (U7, migration 0049), the same
 * committed file the offline pack builder carries (`OWNER_SPECIFIED_COSTS_PATH`
 * there). The played games use them so a filter on a Unison's specified cost
 * — SD15-01's [Awaken] (#728) — meets the cost the owner ruled rather than an
 * unknown one. Read here, not imported, because the pack builder imports this file.
 */
const OWNER_SPECIFIED_COSTS: Record<string, string> = (JSON.parse(readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json", "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;

export async function deckBundle(cards: CatalogCard[], decks: { p1: DeckSpec; p2: DeckSpec }, all: CatalogCard[]) {
  const [{ makeReplayBundle }, { DBS_FILES }] = await Promise.all([import("../src/lib/arena/replay-core"), import("../src/lib/arena/rulesets/dbs")]);
  const defs: Record<string, ReturnType<typeof cardDefFrom>> = {};
  const scripts: Record<string, ReturnType<typeof compileCard>> = {};
  const art: Record<string, { front: string | null; back: string | null }> = {};
  for (const c of cards) {
    const def = cardDefFrom({ ...(c as never as Parameters<typeof cardDefFrom>[0]), specifiedCost: OWNER_SPECIFIED_COSTS[c.id] ?? null });
    defs[c.id] = def;
    scripts[c.id] = compileCard(def, "front");
    if (def.back) scripts[`${c.id}#back`] = compileCard(def, "back");
    art[c.id] = { front: c.imageUrl, back: c.backImageUrl };
  }
  const bundle = await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime: RUNTIME });
  const input = (spec: DeckSpec) => {
    const rows = resolveDeck(spec, all).rows;
    const expand = (z: Resolved["zone"]) => rows.filter((r) => r.zone === z).flatMap((r) => Array.from({ length: r.quantity }, () => r.card.id));
    return { name: spec.name, leader: expand("leader")[0], main: expand("main") };
  };
  return JSON.parse(JSON.stringify({ ...bundle, decks: { p1: input(decks.p1), p2: input(decks.p2) } }));
}

export async function playMatchups(all: CatalogCard[], games: number, maxMoves = 3000): Promise<PlayStats[]> {
  const [{ playDuel }, { localPolicy }, { legalMoves, RULES_ENGINE }] = await Promise.all([
    import("./verify/arena-policy-duel.ts"),
    import("../src/lib/arena/policy/combat"),
    import("../src/lib/arena/browser"),
  ]);
  const cards = [...new Map(DECKS.flatMap((d) => resolveDeck(d, all).rows.map((r) => [r.card.id, r.card] as const))).values()];
  // #650: the complete local policy; a question none of its handlers reads interrupts the game (a stop below).
  const policy = localPolicy();
  const out: PlayStats[] = [];
  for (const p1 of DECKS) {
    for (const p2 of DECKS) {
      const bundle = await deckBundle(cards, { p1, p2 }, all);
      const s: PlayStats = { matchup: `${p1.key} (p1) vs ${p2.key} (p2)`, games, finished: 0, winners: {}, endings: {}, reached: {}, awakened: {}, offered: {}, refusedUnread: {}, stops: {}, prompts: {}, choices: {} };
      for (let g = 0; g < games; g++) {
        const seen = new Set<string>();
        const flipped = new Set<string>();
        const offeredNow = new Set<string>();
        const refusedNow = new Set<string>();
        const r = await playDuel({
          bundle, interpreterRevision: RUNTIME, gameSeed: 649 + g, policySeed: 1000 + g, testSeat: "p1", test: policy, baseline: policy, maxMoves,
          observe: (match) => {
            const pr = match.state.prompt as { kind: string; choice?: { reason: string } };
            s.prompts[pr.kind] = (s.prompts[pr.kind] ?? 0) + 1;
            if (pr.kind === "chooseCards" && pr.choice) s.choices[pr.choice.reason] = (s.choices[pr.choice.reason] ?? 0) + 1;
            // [Counter] cards the engine put in a counter window / blockers it offered a block.
            if (pr.kind === "counter" || pr.kind === "blocker") {
              for (const inst of (match.state.prompt as unknown as { candidates: string[] }).candidates ?? []) offeredNow.add(`${match.state.cards[inst]?.cardId}#${pr.kind}`);
            }
            // Manual skills (Awaken included) the engine offered, and those it refused because it holds the skill as unread.
            if (pr.kind === "main" || pr.kind === "combo" || pr.kind === "counter") {
              const legal = legalMoves(match);
              const keyOf = (a: { card?: string; skill?: number }) => `${match.state.cards[a.card ?? ""]?.cardId}#${a.skill ?? 0}`;
              for (const l of legal) if (l.action.type === "activate") offeredNow.add(keyOf(l.action as never));
              for (const r of RULES_ENGINE.rejectedActions(match.ctx, match.state, legal)) {
                if ((r.action.type === "activate" || r.action.type === "counter") && r.why.some((w) => w.kind === "unread")) refusedNow.add(keyOf(r.action as never));
              }
            }
            // Which printed cards actually reached play, and which Leaders awakened, in this game.
            for (const p of ["p1", "p2"] as const) {
              const z = match.state.sides[p].zones as Record<string, string[]>;
              for (const area of ["battle", "unison", "combo"]) for (const inst of z[area] ?? []) seen.add(match.state.cards[inst].cardId);
              for (const inst of z.leader ?? []) if (match.state.cards[inst].flipped) flipped.add(match.state.cards[inst].cardId);
            }
          },
        });
        for (const k of offeredNow) s.offered[k] = (s.offered[k] ?? 0) + 1;
        for (const k of refusedNow) s.refusedUnread[k] = (s.refusedUnread[k] ?? 0) + 1;
        for (const id of seen) s.reached[id] = (s.reached[id] ?? 0) + 1;
        for (const id of flipped) s.awakened[id] = (s.awakened[id] ?? 0) + 1;
        if (r.over) {
          s.finished++;
          const w = r.winner === "test" ? "p1" : r.winner === "baseline" ? "p2" : "draw";
          s.winners[w] = (s.winners[w] ?? 0) + 1;
          const why = r.reason ?? "unknown";
          s.endings[why] = (s.endings[why] ?? 0) + 1;
        } else {
          const why = (r.stopped ?? "unknown").replace(/\d+/g, "N");
          s.stops[why] = (s.stops[why] ?? 0) + 1;
        }
      }
      out.push(s);
    }
  }
  return out;
}


// ── tiers and mechanic families ─────────────────────────────────────────────
//
// Support is a claim about *runtime*, never about compilation:
//
//   E  a supported CAPABILITY_EVIDENCE row whose own fixture covers the shape
//   K  a named verify scenario plays the keyword on the rules engine
//   D  a deck-building rule: nothing happens in a game (legality() enforces it)
//   P  a scenario exists but the glossary records a known difference (not counted)
//   C  compiled only: the compiler reads it; no scenario plays the audited
//      wording (generic suites may mention the op - that is a pointer, not proof)
//   B  blocked: unread, price/trigger the engine cannot read, or refused "unread"
//   S  structural (the skill's kind), not graded on its own
export type Tier = "S" | "E" | "K" | "D" | "P" | "C" | "B";
export const TIER_LABEL: Record<Tier, string> = {
  S: "structural",
  E: "runtime evidence (capability row)",
  K: "runtime evidence (named scenario)",
  D: "deck rule only",
  P: "partial (known difference)",
  C: "compiled only - not supported",
  B: "blocked",
};

export interface Family {
  key: string;
  label: string;
  match: RegExp;
  tier: Tier;
  /** Supported `CAPABILITY_EVIDENCE` ids (tier E) or the nearest row quoted for context (tier C/P). */
  evidence?: string[];
  /** Named verify scenarios, as `file — what it plays`. */
  refs?: string[];
  /** Existing issues that own the mechanic or its gap, and unowned-blocker ids (`U1`..) from UNOWNED. */
  owners?: (number | string)[];
  /** `DECISION_WINDOWS` kinds the mechanic opens for the policy. */
  windows?: string[];
  note: string;
}

export const UNOWNED: Record<string, string> = {
  U1: "Card-level scenario gates: nothing plays these cards' wordings on the rules engine; every compiled-only mechanic needs one deterministic scenario per deck (`arena:scenario`/`stage()` fixtures), then its tier can move to E/K.",
  U2: "Resolved by #728: SD15-01 [Awaken] was refused as `unread` because the printed OR condition (life <= 4, or a red Unison with a specified cost of 2) was dropped from the record's price. The specified cost is now a filter measure read against the owner's stored value, the condition is the record's price, and the Awaken is offered at 4 life or with SD15-02 ({r}{r}) in play (`scripts/verify/sd15-readings-728.ts`).",
  U3: "Resolved by #728: the specified-cost filter and the [Spirit Boost 1] printed after a reminder note now read, so SD15-01 awakened [Auto] #0 (Double Strike to a red cost-2 Unison with no keyword skills) and SD15-03 #10/#20 compile whole; SD15-03 #20 answers to an opponent's skill sending it to the Drop (`droppedByOpponent`) or a KO. Known difference: [Limit 1] is counted per card instance, not across copies (glossary, 22-44).",
  U4: "Resolved by #729: BT4-079's [Swap] with an action price (\"{y}, choose 1 card from your hand and place it in your Drop Area\") was refused as `unread`. The rules engine now compiles the price and pays it after the energy on the strict action-price host, offering the [Swap] only when the whole price is payable and a specified card is still in hand afterwards (22-22-3) (`arena-swap-action-price`).",
  U5: "Resolved by #716: a [Counter] whose printed price is more than orbs was never offered (refused as `unread`). The rules engine now reads BT5-023's and BT6-026's \"Your Leader Card is red:\" condition and BT10-008's restriction price and offers each when the whole price can be paid (`arena-counter-action-price`).",
  U6: "Resolved by #731: [Swap] named a trait (<<Goku's Lineage>>) but the engine filtered by energy cost only, offering off-trait Battle Cards (the owner did not accept the approximation, 13 Oct 2026). Both engines now read the printed description with the filter grammar on the offer and the choice (SD5-04/SD5-05's ASCII \"<<...>>\" included), and the glossary badge is `engine` (`arena-swap-specified-card`).",
  U7: "Unison cards carry no energy cost or specified cost in the public feed; the owner's hand-entered `cards.specified_cost` (database) is an input the offline pack must carry, and this audit cannot see it. Resolved: the owner ruled SD15-02 and DB3-001 `{r}{r}` on 13 Oct 2026 (migration 0049, #733); the pack builder carries them from a committed data file.",
  U8: "Resolved by #730: [Unique]'s 21-11 half (two same-named copies in one Battle Area) kept the newest on the legacy engine and was not processed at all on the rules engine (glossary: partial). The rules engine now processes it as interruptive rule processing: the master chooses the copy that stays (`chooseCards`, reloadable, answered by the local policy) and the rest go to the Drop Area through 9-10 (`arena-unique-master-choice`, `scripts/verify/unique-730.ts`).",
};

/** Manual skills the engine refused as `unread` in the audit play-through (validated by `--play`). */
export const KNOWN_REFUSALS: Record<string, string> = {};

export const FAMILIES: Family[] = [
  { key: "kind-main", label: "[Activate: Main] skill", match: /^kind:activate:main$/, tier: "S", windows: ["main"], note: "Offered on the Main Phase menu." },
  { key: "kind-battle", label: "[Activate: Battle] skill", match: /^kind:activate:battle$/, tier: "S", windows: ["combo"], note: "Offered at the combo prompt of a battle." },
  { key: "kind-counter", label: "[Counter: Attack] / [Counter: Play] skill", match: /^kind:counter:(attack|play)$/, tier: "S", windows: ["counter"], note: "Offered in the counter window." },
  { key: "kind-auto", label: "[Auto] skill", match: /^kind:auto$/, tier: "S", windows: ["orderPending"], note: "Simultaneous Autos ask the turn player for an order." },
  { key: "kind-other", label: "[Permanent] and keyword lines", match: /^kind:(permanent|keyword)$/, tier: "S", note: "No decision of their own." },

  { key: "trig-combo-entry", label: "Auto at genuine combo entry (\"when you combo with this card\")", match: /^trigger:comboUsed$/, tier: "E", evidence: ["arena-combo-entry-auto-timing"], owners: [672], note: "Timing evidence only: when the Auto pends, not what its effect does." },
  { key: "trig-combo-end", label: "Auto at the end of a battle after a combo from hand", match: /^trigger:comboed$/, tier: "E", evidence: ["arena-combo-from-hand-battle-end", "arena-combo-cleanup-checkpoints"], owners: [572, 609], note: "BT6-010 and TB1-055 bind this copy's hand origin; BT6-010 also the opponent's turn." },
  { key: "trig-attack", label: "Auto when a card attacks / a Leader or Unison is attacked", match: /^trigger:(attacks|yourLeaderAttacked|opponentAttacksRedUnison2)$/, tier: "C", refs: ["scripts/verify/readings.ts, readings-571.ts - the reading of these triggers (parse level), not a played game"], owners: [571, "U1"], note: "SD15-01's red-Unison-only trigger is a #571 reading." },
  { key: "trig-played", label: "Auto when a card is played", match: /^trigger:played$/, tier: "C", owners: ["U1"], note: "The most common trigger; generic suites use it, no scenario names these wordings." },
  { key: "trig-dropped", label: "Auto when an opponent's skill sends this card from the Battle Area to the Drop", match: /^trigger:droppedByOpponent$/, tier: "K", refs: ["scripts/verify/sd15-readings-728.ts - SD15-03: an opponent's skill drops it, [Spirit Boost 1] takes a marker off SD15-02 and it plays itself back"], owners: [728], note: "SD15-03 #20; [Limit 1] is counted per card instance, not across copies (glossary, 22-44)." },
  { key: "trig-koed", label: "Auto when this card is KO'd", match: /^trigger:koed$/, tier: "C", refs: ["scripts/verify/sd15-readings-728.ts - SD15-03's \"or KO'd\" half (reading only)"], owners: ["U1"], note: "SD15-03 #20's second half; no scenario KOs it." },
  { key: "trig-other", label: "Auto at turn end / Unison to Drop / [Spirit Boost] payment", match: /^trigger:(turnEnd|unisonToDrop|spiritBoostPaid)$/, tier: "C", owners: ["U1"], note: "Each is one card (BT4-081, SD15-02, SD15-05)." },

  { key: "kw-blocker", label: "[Blocker]", match: /^kw:Blocker$/, tier: "K", refs: ["scripts/verify/battles.ts:92-127 - [Blocker] redirect, rested Blocker not offered"], windows: ["blocker"], note: "" },
  { key: "kw-barrier", label: "[Barrier]", match: /^kw:Barrier$/, tier: "K", refs: ["scripts/verify/workflow.ts:539-550 - 22-16 candidate exclusion", "scripts/verify/vm.ts:3612-3657 - exemptions do not leak"], note: "" },
  { key: "kw-deflect", label: "[Deflect]", match: /^kw:Deflect$/, tier: "K", refs: ["scripts/verify/keywords.ts:2269-2333 - [Counter: Play] window not opened"], note: "" },
  { key: "kw-critical", label: "[Critical]", match: /^kw:Critical$/, tier: "K", refs: ["scripts/verify/battles.ts:244 - life goes to the Drop", "scripts/verify/keywords.ts:3437-3450"], note: "" },
  { key: "kw-strike", label: "[Strike] / [Double Strike]", match: /^kw:Strike$/, tier: "K", refs: ["scripts/verify/battles.ts:244,309 - 2 damage, markers off a Unison"], note: "" },
  { key: "kw-attack", label: "[Attack X]", match: /^kw:Attack$/, tier: "C", owners: ["U1"], note: "Glossary says the engine plays it; no scenario located (grep of scripts/verify)." },
  { key: "kw-awaken", label: "[Awaken]", match: /^kw:Awaken$/, tier: "K", windows: ["main"], refs: ["scripts/verify/battles.ts:380 - offered only when the printed condition holds, flips the Leader", "scripts/verify/sd15-readings-728.ts - SD15-01: offered at 4 life or with a {r}{r} red Unison, not with an unknown-cost, blue or one-orb one; flips"], note: "SD5-01's and SD15-01's Awakens are offered in the audit play-through (U2 resolved by #728)." },
  { key: "kw-swap", label: "[Swap X]", match: /^kw:Swap$/, tier: "K", evidence: ["arena-swap-specified-card", "arena-swap-action-price"], refs: ["scripts/verify/swap-729-731.ts - specified card only on offer and choice (SD5-05's <<Goku's Lineage>>), BT4-079's price on the strict host", "scripts/verify/keywords.ts:317 - specified cost-X card, both engines", "scripts/verify/workflow.ts:498-513"], owners: [731, 729], windows: ["chooseCards"], note: "U6 resolved by #731 (the printed description is read); U4 resolved by #729 (BT4-079's action price is paid on the strict host)." },
  { key: "kw-unique", label: "[Unique]", match: /^kw:Unique$/, tier: "K", evidence: ["arena-unique-master-choice"], refs: ["scripts/verify/battles.ts:361 - second copy cannot be played", "scripts/verify/unique-730.ts - SD15-05 played beside itself by a skill: the master chooses the copy that stays before the skill continues, the rest go to the Drop Area"], owners: [730], windows: ["chooseCards"], note: "U8 resolved by #730 (21-11: the master chooses; legacy engine still keeps the newest)." },
  { key: "kw-supercombo", label: "[Super Combo] (deck limit 4)", match: /^kw:Super Combo$/, tier: "D", note: "legality() counts it (see the legality block)." },

  { key: "tag-spirit", label: "[Spirit Boost X] marker price", match: /^tag:Spirit Boost$/, tier: "C", evidence: ["arena-auto-own-cost"], owners: [549, "U1"], note: "Glossary: the supported Auto continuation charges it after the payable decision (#549); no scenario names SD15-01's back Auto." },
  { key: "tag-once", label: "[Once per turn]", match: /^tag:Once per turn$/, tier: "C", owners: ["U1"], note: "" },

  { key: "price-choose", label: "Auto/Activate price: choose a card and move it (hand to Drop, life to hand)", match: /^price:(choose|moveTo)$/, tier: "C", evidence: ["arena-auto-own-cost"], owners: [549, "U1"], windows: ["chooseMode", "chooseCards"], note: "BT9-031 is the named hand-to-Drop shape; DB2-004 and SD5-04 move a Life card to the hand, a shape the row does not name. Auto prices ask pay/decline through a `chooseMode` today, not the `optionalCost` prompt." },
  { key: "price-cond", label: "Condition-only price (\"If your Leader is red and life <= 4:\", SD15-01's \"life <= 4 or a red Unison with a specified cost of 2\")", match: /^pricecond:(leaderMatches|life|count)$/, tier: "C", evidence: ["arena-auto-own-cost"], owners: [549, "U1"], note: "Row: public-area condition-only Autos stay compulsory." },
  { key: "price-restriction", label: "Restriction printed as a [Counter] price (\"You can't activate the [Counter: Play] skills of other cards for the turn:\")", match: /^price:forbid$/, tier: "E", evidence: ["arena-counter-action-price"], owners: [716], windows: ["counter"], note: "BT10-008's own text is the #716 fixture: put in force before the skill, binding other cards' [Counter: Play] only." },
  { key: "op-altcost", label: "Counter alternative price (Life card instead of energy; free with markers)", match: /^op:altCost$/, tier: "C", evidence: ["arena-counter-alternative-action-price"], owners: ["U1"], windows: ["counter", "chooseCards"], note: "The row is one ALTC fixture shape; BT5-023, BT4-097 and BT10-008 are not that fixture." },

  { key: "op-choose", label: "Choose cards / targets", match: /^op:choose$/, tier: "C", owners: ["U1"], windows: ["chooseCards"], note: "\"Up to N\" picks, energy picks, hand picks." },
  { key: "op-may", label: "Optional effect (\"you may\") and printed modes", match: /^op:(may|chooseMode)$/, tier: "C", owners: ["U1"], windows: ["chooseMode"], note: "" },
  { key: "op-effects", label: "Draw, power, combo power, damage, KO, negate attack, grant, forbid", match: /^op:(draw|power|comboPower|damage|ko|negateAttack|grant|forbid)$/, tier: "C", owners: ["U1"], note: "" },
  { key: "op-moves", label: "Card movement and state: moveTo, play, look, shuffle, switchMode, addMarker, lifeDownTo", match: /^op:(moveTo|play|look|shuffle|switchMode|addMarker|lifeDownTo)$/, tier: "C", owners: ["U1"], note: "" },
  { key: "op-if", label: "Conditional (\"if ...\")", match: /^op:if$/, tier: "C", owners: ["U1"], note: "" },
  { key: "cond", label: "Conditions: Leader match, life, counts, did/chose, battle, turn", match: /^cond:/, tier: "C", owners: ["U1"], note: "Condition readings are covered at parse level in readings.ts; no played scenario." },

  { key: "unread", label: "Clause the compiler cannot read", match: /^unread:/, tier: "B", owners: ["U3", 728], note: "The referee path is outside the offline MVP; an unread due skill interrupts the game (arena-skill-unread-referee)." },
];

/** Existing issues cited as owners, as read with `gh` on the audit date. */
export const OWNER_ISSUES: Record<number, { state: "open" | "closed"; title: string }> = {
  539: { state: "open", title: "card review 4 Oct 2026 - single-card misreadings and missing triggers" },
  549: { state: "open", title: "[P0] Resolve Auto skill costs with pay and decline decisions" },
  550: { state: "open", title: "[P1] Carry chosen cost values and targets into skill effects" },
  552: { state: "open", title: "[P1] Implement Counter Counter response chains" },
  571: { state: "closed", title: "[P1] Fix missing and over-broad card Auto trigger readings" },
  572: { state: "closed", title: "[P1] Bind end-of-battle Auto to this card comboed from hand" },
  577: { state: "open", title: "[P0] Arena delivery: Rule engine correctness" },
  609: { state: "closed", title: "[P1] Reconcile Combo-to-Drop and battle-end Auto checkpoint order" },
  650: { state: "open", title: "[P1] Arena O2-05: Complete constrained choices, payments and policy decision coverage" },
  651: { state: "open", title: "[P1] Arena O2-06: Evaluate the complete heuristic across seeds, seats and hidden states" },
  655: { state: "open", title: "[P1] Arena O4-02: Build complete versioned offline deck packs" },
  661: { state: "open", title: "[P1] Arena O4-06: Verify the airplane-mode MVP and publish the support matrix" },
  672: { state: "closed", title: "[P0] Resolve card-specific combo Autos at the combo-entry checkpoint" },
  728: { state: "open", title: "[P1] Arena: read the SD15 Unison filters, the [Awaken] OR condition and the Spirit Boost note (#539 child)" },
  729: { state: "open", title: "[P1] Arena: pay [Swap] action prices through the strict price host (BT4-079)" },
  730: { state: "open", title: "[P2] Arena: let the master choose which [Unique] copy stays (rule 21-11)" },
  731: { state: "open", title: "[P1] Arena: [Swap] must honour the printed trait filter, not energy cost only" },
  716: { state: "open", title: "[P1] Arena: pay [Counter] action prices through the strict price host" },
};

export function familyOf(mechanic: string): Family | undefined {
  return FAMILIES.find((f) => f.match.test(mechanic));
}

const UNIVERSAL_WINDOWS = ["chooseFirst", "mulligan", "charge", "main", "combo", "blocker", "counter", "zEnergyFromCombo", "payCost"];

export type SkillTier = Tier | "OK";
export function skillTier(a: SkillAudit): SkillTier {
  if (!a.read) return "B";
  if (a.face === "front" && KNOWN_REFUSALS[`${a.cardId}#${a.index}`]) return "B";
  if (a.priceRead === false) return "B";
  if (a.kind === "auto" && a.triggers.length === 0) return "B";
  if (a.kind === "permanent" && a.staticEmits === false) return "B";
  const tiers = a.mechanics.map((m) => familyOf(m)?.tier ?? "B");
  for (const t of ["B", "C", "P"] as const) if (tiers.includes(t)) return t;
  return "OK";
}

// ── the audit as data ──────────────────────────────────────────────────────

export interface DeckAudit {
  spec: DeckSpec;
  rows: Resolved[];
  problems: string[];
  legality: ReturnType<typeof legality>;
  skills: (SkillAudit & { tier: SkillTier; quantity: number })[];
}

export function auditDecks(catalog: CatalogCard[]): DeckAudit[] {
  return DECKS.map((spec) => {
    const { rows, problems } = resolveDeck(spec, catalog);
    const skills = rows.flatMap((r) => auditCard(r.card).map((a) => ({ ...a, tier: skillTier(a), quantity: r.quantity })));
    return { spec, rows, problems, legality: legality(rows.map(toLegalityRow), "dbs"), skills };
  });
}

// ── markdown blocks ─────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "..." : s);
const table = (head: string[], body: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...body.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");

export function renderDecks(audits: DeckAudit[], snap: Snapshot): string {
  const out: string[] = [];
  for (const a of audits) {
    const leader = a.rows.find((r) => r.zone === "leader")!.card;
    out.push(`#### Deck ${a.spec.key}: ${a.spec.name} (${a.spec.setCode})`, "");
    out.push(`Source: ${a.spec.source} Quantities are the importer's \`scripts/import-starter-decks.mts\` entries (checked by \`--check\`)${a.spec.amended ? `, except the owner-amended ones: ${a.spec.amended.decision} (printed ${a.spec.amended.changes.map((c) => `${c.number} x${c.printed}`).join(", ")})` : ""}; the Leader is the set's only LEADER card.`, "");
    out.push(`Leader: **${leader.id} ${leader.name}** (${leader.colors.join("/")}, ${leader.power} power) | back face: **${leader.backName}** (${leader.backPower} power). Z-Deck: none in the source (0 cards, limit 10). Main: ${a.legality.mainCount} cards in ${a.rows.filter((r) => r.zone === "main").length} distinct numbers.`, "");
    const body = a.rows.map((r) => {
      const c = r.card;
      return [`${r.quantity}`, c.id, c.name, c.cardType, c.colors.join("/"), c.energyCost ?? "-", c.power ?? "-", c.comboCost != null ? `${c.comboCost}/${c.comboPower}` : "-", c.limitedTo != null ? `${c.limitedTo}${c.isLimited ? " (restricted)" : ""}` : "-"];
    });
    out.push(table(["Qty", "Card", "Name", "Type", "Colour", "Cost", "Power", "Combo cost/power", "Copy limit"], body.map((r) => r.map(String))), "");
    const odd = a.rows.filter((r) => r.card.imageUrl !== `https://storage.googleapis.com/deckplanet_card_images/${r.card.id}.png`).map((r) => r.card.id);
    out.push(`Artwork references: ${a.rows.length} front images at \`https://storage.googleapis.com/deckplanet_card_images/<id>.png\`${odd.length ? ` (exceptions: ${odd.join(", ")})` : ""} and the Leader back \`${leader.id}_b.png\` (${leader.backImageUrl === `https://storage.googleapis.com/deckplanet_card_images/${leader.id}_b.png` ? "pattern holds" : "pattern differs"}). Reachability was not tested.`, "");
    out.push(`Generated/token dependencies: none found (no skill text names a token, a generated card or a Z-card; Z-Deck empty).`, "");
  }
  out.push(`Snapshot: \`${SNAPSHOT}\` - ${snap.cards.length} cards, retrieved ${snap.source.retrieved} from ${snap.source.rawRecords} raw deckplanet records.`);
  return out.join("\n");
}

export function renderLegality(audits: DeckAudit[]): string {
  const rows = audits.map((a) => {
    const l = a.legality;
    const illegal = l.issues.filter((i) => i.severity === "illegal").map((i) => i.message).join(" ") || "none";
    const warn = l.issues.filter((i) => i.severity === "warning").map((i) => i.message).join(" ") || "none";
    const kw = l.keywordRules.map((k) => `[${k.keyword}] ${k.used}/${k.max}`).join(", ") || "none";
    return [a.spec.key, l.status, `${l.leaderCount} / ${l.mainCount} / ${l.zCount}`, illegal, warn, kw];
  });
  return table(["Deck", "legality()", "Leader / main / Z", "Illegal", "Warnings", "Pooled keyword limits"], rows);
}

export function renderSkills(audits: DeckAudit[]): string {
  const out: string[] = [];
  for (const a of audits) {
    out.push(`#### Deck ${a.spec.key} skill faces`, "");
    const body = a.skills.map((s) => [
      `${s.cardId}${s.face === "back" ? " (back)" : ""}`,
      `${s.quantity}`,
      `#${s.index}`,
      s.keyword ? `${s.kind}:${s.keyword}` : s.kind,
      clip(s.text || "(keyword line)", 70),
      s.read ? "read" : `UNREAD x${s.unread.length}`,
      s.kind === "auto" ? (s.triggers.length ? s.triggers.join(",") : "NONE") : "-",
      s.priceRead === null ? "-" : s.priceRead ? "read" : "UNREADABLE",
      s.staticEmits === null ? "-" : s.staticEmits ? "applies" : "INERT",
      s.tier === "OK" ? "evidence" : s.tier,
    ]);
    out.push(table(["Face", "Qty", "Skill", "Kind", "Text (clipped)", "Compiler", "Trigger", "Price", "Static", "Tier"], body), "");
  }
  return out.join("\n");
}

export function summarise(audits: DeckAudit[]) {
  return audits.map((a) => {
    const t = (pred: (s: (typeof a.skills)[number]) => boolean) => a.skills.filter(pred).length;
    const total = a.skills.length;
    return {
      deck: a.spec.key,
      faces: new Set(a.skills.map((s) => `${s.cardId}${s.face}`)).size,
      skills: total,
      read: t((s) => s.read),
      unread: t((s) => !s.read),
      evidence: t((s) => s.tier === "OK"),
      partial: t((s) => s.tier === "P"),
      compiledOnly: t((s) => s.tier === "C"),
      blocked: t((s) => s.tier === "B"),
      blockedCards: [...new Set(a.skills.filter((s) => s.tier === "B").map((s) => s.cardId))],
      copiesWithBlocked: a.rows.filter((r) => a.skills.some((s) => s.cardId === r.card.id && s.tier === "B")).reduce((n, r) => n + r.quantity, 0),
    };
  });
}

export function renderMechanics(audits: DeckAudit[]): string {
  const byFamily = new Map<string, { fam: Family; ids: Set<string>; skills: Set<string> }>();
  for (const a of audits) {
    for (const s of a.skills) {
      for (const m of s.mechanics) {
        const fam = familyOf(m);
        if (!fam) continue;
        const e = byFamily.get(fam.key) ?? { fam, ids: new Set(), skills: new Set() };
        e.ids.add(m.replace(/^unread:.*/, "unread:(clause)"));
        e.skills.add(`${a.spec.key}:${s.cardId}${s.face === "back" ? "b" : ""}#${s.index}`);
        byFamily.set(fam.key, e);
      }
    }
  }
  const owner = (o: number | string) => (typeof o === "number" ? `#${o}${OWNER_ISSUES[o]?.state === "closed" ? " (closed)" : ""}` : o);
  const rows = FAMILIES.filter((f) => byFamily.has(f.key)).map((f) => {
    const e = byFamily.get(f.key)!;
    const evidence = [...(f.evidence ?? []).map((id) => `\`${id}\``), ...(f.refs ?? [])].join("; ") || "-";
    return [
      f.label,
      f.tier,
      `${e.skills.size}`,
      evidence,
      (f.owners ?? []).map(owner).join(", ") || "-",
      (f.windows ?? []).join(", ") || "-",
      f.note || "-",
    ];
  });
  return table(["Mechanic family", "Tier", "Skill faces", "Evidence / pointers", "Owner", "Decision windows", "Note"], rows);
}

export function renderWindows(audits: DeckAudit[], play: PlayStats[] | null): string {
  const needed = new Map<string, Set<string>>();
  const add = (w: string, why: string) => needed.set(w, (needed.get(w) ?? new Set()).add(why));
  for (const w of UNIVERSAL_WINDOWS) add(w, "every match");
  for (const a of audits) {
    for (const s of a.skills) {
      for (const m of s.mechanics) for (const w of familyOf(m)?.windows ?? []) add(w, `${s.cardId}${s.face === "back" ? "b" : ""}#${s.index}`);
    }
  }
  const seen = new Map<string, number>();
  for (const p of play ?? []) for (const [k, v] of Object.entries(p.prompts)) seen.set(k, (seen.get(k) ?? 0) + v);
  const rows = DECISION_WINDOWS.map((w) => {
    const why = needed.get(w);
    const sample = why ? [...why].filter((x) => x !== "every match").slice(0, 6).join(", ") : "";
    return [w, why ? (why.has("every match") ? "every match" : "by card") : "no audited card needs it", sample || "-", play ? String(seen.get(w) ?? 0) : "run --play"];
  });
  return table(["Window (DECISION_WINDOWS)", "Reachable", "Cards that open it (first six)", "Decisions seen in the audit play-through"], rows);
}

export function renderPlay(stats: PlayStats[]): string {
  const head = ["Matchup", "Games", "Finished", "p1 / p2 wins", "End reason", "Stopped"];
  const rows = stats.map((s) => [
    s.matchup,
    String(s.games),
    String(s.finished),
    `${s.winners.p1 ?? 0} / ${s.winners.p2 ?? 0}`,
    Object.keys(s.endings).length ? "all by empty Life Area (0-1-3-2)" : "-",
    Object.keys(s.stops).length ? Object.entries(s.stops).map(([k, v]) => `${v}x ${k}`).join("; ") : "none",
  ]);
  const prompts = new Map<string, number>();
  const offered = new Map<string, number>();
  const refused = new Map<string, number>();
  const reached = new Map<string, number>();
  const awakened = new Map<string, number>();
  for (const s of stats) {
    for (const [k, v] of Object.entries(s.prompts)) prompts.set(k, (prompts.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(s.offered)) offered.set(k, (offered.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(s.refusedUnread)) refused.set(k, (refused.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(s.reached)) reached.set(k, (reached.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(s.awakened)) awakened.set(k, (awakened.get(k) ?? 0) + v);
  }
  const choices = new Map<string, number>();
  for (const s of stats) for (const [k, v] of Object.entries(s.choices)) choices.set(k, (choices.get(k) ?? 0) + v);
  const fmt = (m: Map<string, number>) => [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  const games = stats.reduce((n, s) => n + s.games, 0);
  return [
    table(head, rows),
    "",
    `Games: ${games} (${stats[0]?.games ?? 0} per ordered matchup, seeds 649.., policy seeds 1000.., \`localPolicy()\` (#650: every window handled, an unreadable one interrupts) on both seats, 3000-move cap).`,
    "",
    `- Prompt kinds the policy was asked (decisions, all games): ${fmt(prompts)}.`,
    `- Games in which a manual skill (card#skill) was on the legal list at least once: ${fmt(offered)}.`,
    `- Games in which the engine refused a manual skill as \`unread\`: ${fmt(refused)}.`,
    `- Games in which a Leader awakened: ${fmt(awakened)}.`,
    `- Games in which a card reached a Battle, Unison or Combo Area: ${fmt(reached)}.`,
    "",
    "`chooseCards` questions asked (the engine's own reason text, decisions across all games):",
    "",
    ...[...choices].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `- ${v}x ${k}`),
  ].join("\n");
}

// ── doc blocks ──────────────────────────────────────────────────────────────

const DOC = "docs/arena-offline-deck-audit.md";
const BLOCKS = ["decks", "legality", "skills", "mechanics", "windows", "play"] as const;
type BlockName = (typeof BLOCKS)[number];

function blockRe(name: BlockName): RegExp {
  return new RegExp(`(<!-- GENERATED:${name} -->\\n)([\\s\\S]*?)(\\n<!-- /GENERATED:${name} -->)`);
}

function renderBlocks(catalog: CatalogCard[], snap: Snapshot, play: PlayStats[] | null): Partial<Record<BlockName, string>> {
  const audits = auditDecks(catalog);
  const out: Partial<Record<BlockName, string>> = {
    decks: renderDecks(audits, snap),
    legality: renderLegality(audits),
    skills: renderSkills(audits),
    mechanics: renderMechanics(audits),
    windows: renderWindows(audits, play),
  };
  if (play) out.play = renderPlay(play);
  return out;
}

// ── checks ──────────────────────────────────────────────────────────────────

function check(catalog: CatalogCard[], snap: Snapshot, play: PlayStats[] | null): string[] {
  const failures: string[] = [];
  const fail = (m: string) => failures.push(m);
  const audits = auditDecks(catalog);

  // 1. The decks resolve and have the shape the doc claims.
  for (const a of audits) {
    if (a.problems.length) fail(`deck ${a.spec.key}: ${a.problems.join("; ")}`);
    if (a.legality.mainCount !== 50 || a.legality.leaderCount !== 1 || a.legality.zCount !== 0) fail(`deck ${a.spec.key}: shape ${a.legality.leaderCount}/${a.legality.mainCount}/${a.legality.zCount}`);
  }
  const [A, B] = audits;
  // Deck A is the owner-amended variant (BT10-008 x1, BT5-023 x3): no illegal finding remains, only the two off-colour warnings.
  if (A.legality.status === "illegal" || A.legality.issues.some((i) => i.severity === "illegal")) fail("deck A: the owner-amended list should have no illegal finding");
  if (A.legality.issues.filter((i) => i.severity === "warning").map((i) => i.cardId).sort().join(",") !== "BT9-031,TB1-055") fail("deck A: expected exactly the BT9-031 and TB1-055 off-colour warnings");
  if (B.legality.status !== "legal" || B.legality.issues.length) fail("deck B: expected legal with no findings");

  // 2. The copied lists still equal the importer's source text.
  const importer = readFileSync("scripts/import-starter-decks.mts", "utf8");
  for (const spec of DECKS) {
    if (!importer.includes(`name: "${spec.name}"`) || !importer.includes(`source: "${spec.source}"`)) fail(`${spec.key}: importer name/source differ`);
    for (const e of spec.entries) {
      if (e.leader) continue;
      const printed = spec.amended?.changes.find((c) => c.number === e.number);
      if (printed && printed.amended !== e.quantity) fail(`${spec.key}: ${e.number} amended to ${printed.amended} but the entry says ${e.quantity}`);
      const needle = e.number ? `id(${printed?.printed ?? e.quantity}, "${e.number}")` : `n(${e.quantity}, "${e.name}")`;
      if (!importer.includes(needle)) fail(`${spec.key}: importer has no ${needle}`);
    }
  }
  const deckText = (spec: DeckSpec) => {
    const start = importer.indexOf(`name: "${spec.name}"`);
    const end = importer.indexOf("\n  },", start);
    return importer.slice(start, end);
  };
  for (const spec of DECKS) {
    const body = deckText(spec);
    const n = (body.match(/\b(?:id|n)\(\d+,/g) ?? []).length;
    if (n !== spec.entries.filter((e) => !e.leader).length) fail(`${spec.key}: importer lists ${n} entries, audit ${spec.entries.length - 1}`);
  }

  // 3. Every mechanic has a family; cited capability rows exist and are supported; owners exist.
  const caps = new Map(CAPABILITY_EVIDENCE.map((c) => [c.id, c]));
  const seenMech = new Set(audits.flatMap((a) => a.skills.flatMap((s) => s.mechanics)));
  for (const m of seenMech) if (!familyOf(m)) fail(`mechanic without a family: ${m}`);
  for (const f of FAMILIES) {
    for (const id of f.evidence ?? []) {
      const c = caps.get(id);
      if (!c) fail(`${f.key}: no capability row ${id}`);
      else if (f.tier === "E" && c.status !== "supported") fail(`${f.key}: tier E but ${id} is ${c.status}`);
    }
    if (f.tier === "E" && !(f.evidence ?? []).length) fail(`${f.key}: tier E without evidence`);
    if ((f.tier === "K" || f.tier === "P") && !(f.refs ?? []).length) fail(`${f.key}: tier ${f.tier} without a scenario reference`);
    for (const o of f.owners ?? []) {
      if (typeof o === "number" && !OWNER_ISSUES[o]) fail(`${f.key}: owner #${o} is not in OWNER_ISSUES`);
      if (typeof o === "string" && !UNOWNED[o]) fail(`${f.key}: unknown unowned id ${o}`);
    }
    for (const w of f.windows ?? []) if (!(DECISION_WINDOWS as readonly string[]).includes(w)) fail(`${f.key}: window ${w} is not a DECISION_WINDOWS kind`);
  }
  // Scenario references name files that exist, and quoted glossary badges still say what the table says.
  for (const f of FAMILIES) for (const r of f.refs ?? []) {
    const file = /^(scripts\/verify\/[\w.-]+\.(?:ts|mts))/.exec(r)?.[1];
    if (file && !existsSync(file)) fail(`${f.key}: ${file} does not exist`);
  }
  const badge = (k: keyof typeof KEYWORDS) => KEYWORDS[k].support;
  if (badge("Super Combo") !== "deck") fail("glossary: Super Combo is no longer a deck rule");
  for (const k of ["Blocker", "Barrier", "Deflect", "Critical", "Strike", "Awaken", "Swap", "Unique"] as const) if (badge(k) !== "engine") fail(`glossary: ${k} is no longer \`engine\` - revisit tier K`);
  // U6 resolved (#731): both engines read [Swap]'s printed description; U4
  // resolved (#729): its action price goes through the strict host.
  if (!/IN you\.hand asPrinted, as: "swapIn"/.test(readFileSync("src/lib/arena/rulesets/dbs/keywords.rules", "utf8"))) fail("keywords.rules: [Swap] no longer reads its printed description (asPrinted) - revisit U6 (#731)");
  if (!/readableAutomaticPrice\(ops, LABEL, OWNER\)/.test(readFileSync("src/lib/arena/vm/swap-costs.ts", "utf8"))) fail("vm/swap-costs.ts no longer reads [Swap] action prices through the strict host (#729) - revisit U4");
  if (A.skills.some((s) => s.kind === "counter:counter") || B.skills.some((s) => s.kind === "counter:counter")) fail("a [Counter: Counter] skill is now in a deck: #552 becomes a blocker");

  // 4. Unread tallies the doc quotes.
  const unreadIds = (a: DeckAudit) => [...new Set(a.skills.filter((s) => !s.read).map((s) => `${s.cardId}${s.face === "back" ? "b" : ""}#${s.index}`))].sort().join(",");
  if (unreadIds(A) !== "") fail(`deck A unread set changed: ${unreadIds(A)}`);
  if (unreadIds(B) !== "") fail(`deck B unread set changed: ${unreadIds(B)}`);
  const unreadPrice = (a: DeckAudit) => a.skills.filter((s) => s.priceRead === false).map((s) => `${s.cardId}#${s.index}`).join(",");
  if (unreadPrice(A) !== "" || unreadPrice(B) !== "") fail(`unreadable price set changed: A=${unreadPrice(A)} B=${unreadPrice(B)}`);
  const nonOrbCounters = (a: DeckAudit) => [...new Set(a.skills.filter((s) => s.counterNonOrbPrice).map((s) => `${s.cardId}#${s.index}`))].sort().join(",");
  if (nonOrbCounters(A) !== "BT10-008#0,BT5-023#0,BT6-026#0" || nonOrbCounters(B) !== "") fail(`non-orb Counter set changed: A=${nonOrbCounters(A)} B=${nonOrbCounters(B)}`);
  // The engine rule the table relies on is still in the source (#716: non-orb
  // [Counter] prices go through the strict action-price host).
  if (!/readableAutomaticPrice\(ops, "\[Counter\]", "#716"\)/.test(readFileSync("src/lib/arena/vm/battle.ts", "utf8"))) fail("vm/battle.ts no longer reads non-orb [Counter] prices through the strict host (#716) - revisit U5");

  // 5. The play-through still shows what the doc says (only with --play).
  if (play) {
    for (const s of play) if (s.finished !== s.games) fail(`${s.matchup}: ${s.games - s.finished} games did not finish: ${JSON.stringify(s.stops)}`);
    const refused = new Set(play.flatMap((s) => Object.keys(s.refusedUnread)));
    const nonOrb = new Set(audits.flatMap((a) => a.skills.filter((s) => s.counterNonOrbPrice).map((s) => `${s.cardId}#${s.index}`)));
    for (const k of Object.keys(KNOWN_REFUSALS)) if (!refused.has(k)) fail(`play-through no longer refuses ${k} as unread - move it out of KNOWN_REFUSALS`);
    for (const k of refused) if (!KNOWN_REFUSALS[k]) fail(`play-through refuses ${k} as unread and KNOWN_REFUSALS does not explain it${nonOrb.has(k) ? " (a non-orb [Counter]: U5 regressed, #716)" : ""}`);
    // U5 resolved (#716): the non-orb [Counter]s of the decks are put in a counter window.
    // Each card that is a playset in its deck must be offered in at least one game.
    // A single copy (BT10-008, the owner's amended x1) depends on the draw: since
    // #728 lets SD15-01 awaken, the seeded games run differently and it reached a
    // counter window in none of them — so its absence is reported, not failed,
    // while at least one non-orb [Counter] must still be offered (#728).
    const offeredCounters = new Set(play.flatMap((s) => Object.keys(s.offered)));
    const copies = (id: string) => Math.max(0, ...DECKS.map((d) => d.entries.filter((e) => e.number === id).reduce((n, e) => n + e.quantity, 0)));
    const unseen = [...nonOrb].filter((k) => !offeredCounters.has(`${k.split("#")[0]}#counter`));
    for (const k of unseen) {
      if (copies(k.split("#")[0]) > 1) fail(`play-through never offers ${k}'s [Counter] - U5 (#716) not visible in play`);
      else console.log(`  note: ${k}'s [Counter] (a single copy) was not offered in the ${play.reduce((n, s) => n + s.games, 0)} games played`);
    }
    if (nonOrb.size && unseen.length === nonOrb.size) fail("play-through never offers any non-orb [Counter] - U5 (#716) not visible in play");
  }

  // 6. The doc's generated blocks equal what the code produces now (the play block only when played).
  if (existsSync(DOC)) {
    const doc = readFileSync(DOC, "utf8");
    const blocks = renderBlocks(catalog, snap, play);
    for (const name of BLOCKS) {
      const want = blocks[name];
      if (want === undefined) continue;
      const m = blockRe(name).exec(doc);
      if (!m) fail(`${DOC}: missing GENERATED:${name} block`);
      else if (m[2] !== want) fail(`${DOC}: GENERATED:${name} block is stale (run --write-doc)`);
    }
  } else fail(`${DOC} is missing`);
  return failures;
}

// ── run ────────────────────────────────────────────────────────────────────

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (args.has("--live")) {
    const live = await liveCatalog();
    const liveCards = live.cards;
    if (args.has("--candidates")) {
      for (const spec of [...DECKS, ...REJECTED]) {
        const { rows, problems } = resolveDeck(spec, liveCards);
        const lg = legality(rows.map(toLegalityRow), "dbs");
        const unread = rows.filter((r) => auditCard(r.card).some((a) => !a.read));
        const unreadCopies = unread.reduce((t, r) => t + r.quantity, 0);
        console.log(
          `${spec.key} ${spec.name}: resolved ${rows.length} entries, main ${lg.mainCount}, legality ${lg.status} (${lg.issues.filter((i) => i.severity === "illegal").length} illegal, ${lg.issues.filter((i) => i.severity === "warning").length} warnings), cards with an unread skill: ${unread.length} (${unreadCopies} copies) ${unread.map((r) => r.card.id).join(",")}; unresolved: ${problems.join("; ") || "none"}`,
        );
      }
      return;
    }
    const subset = DECKS.flatMap((d) => resolveDeck(d, liveCards).rows.map((r) => r.card));
    const unique = [...new Map(subset.map((c) => [c.id, c])).values()].sort((a, b) => a.id.localeCompare(b.id));
    if (args.has("--write-snapshot")) {
      const out: Snapshot = {
        source: {
          url: "https://api.deckplanet.net/cardsearch/dbs_masters_cards?limit=500&page=N (all pages, shaped by src/lib/catalog/deckplanet.ts shapeCatalog)",
          retrieved: new Date().toISOString().slice(0, 10),
          rawRecords: live.rawRecords,
          note: "Only the cards of the two audited decks (and each deck's Leader) are kept; this is not a catalog dump.",
        },
        cards: unique,
      };
      writeFileSync(SNAPSHOT, JSON.stringify(out, null, 1) + "\n", "utf8");
      console.log(`wrote ${SNAPSHOT}: ${unique.length} cards`);
      return;
    }
    // Compare the live records of the audited cards with the committed snapshot.
    const saved = loadSnapshot();
    const savedById = new Map(saved.cards.map((c) => [c.id, c]));
    let drift = 0;
    for (const c of unique) {
      const was = savedById.get(c.id);
      const keys = ["name", "skill", "backSkill", "power", "energyCost", "comboCost", "comboPower", "limitedTo", "isBanned", "isLimited", "colors", "cardType"] as const;
      const diff = was ? keys.filter((k) => JSON.stringify(was[k]) !== JSON.stringify(c[k])) : ["(missing in snapshot)"];
      if (diff.length) { drift++; console.log(`DRIFT ${c.id}: ${diff.join(", ")}`); }
    }
    console.log(`${unique.length} audited cards compared with ${SNAPSHOT}: ${drift} drifted.`);
    process.exitCode = drift ? 1 : 0;
    return;
  }
  const snap = loadSnapshot();
  const catalog = snap.cards;

  const playN = flagValue("--play");
  const play = playN !== undefined ? await playMatchups(catalog, Number(playN) || 4) : null;

  if (args.has("--check")) {
    const failures = check(catalog, snap, play);
    if (failures.length) {
      console.error(`arena-deck-audit --check: ${failures.length} problem(s)`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    const sums = summarise(auditDecks(catalog));
    console.log(`arena-deck-audit --check ok${play ? ` (played ${play.reduce((n, s) => n + s.games, 0)} games)` : ""}: ${sums.map((s) => `deck ${s.deck} ${s.skills} skills (${s.unread} unread, ${s.blocked} blocked, ${s.compiledOnly} compiled-only, ${s.partial} partial, ${s.evidence} with evidence)`).join("; ")}`);
    return;
  }

  const blocks = renderBlocks(catalog, snap, play);
  if (args.has("--write-doc")) {
    let doc = readFileSync(DOC, "utf8");
    for (const name of BLOCKS) {
      const text = blocks[name];
      if (text === undefined) continue;
      if (!blockRe(name).test(doc)) throw new Error(`${DOC} has no GENERATED:${name} block`);
      doc = doc.replace(blockRe(name), (_m, a: string, _b: string, c: string) => `${a}${text}${c}`);
    }
    writeFileSync(DOC, doc, "utf8");
    console.log(`updated ${[...BLOCKS].filter((b) => blocks[b] !== undefined).join(", ")} in ${DOC}`);
    return;
  }
  if (args.has("--json")) {
    console.log(JSON.stringify({ summary: summarise(auditDecks(catalog)), play }, null, 1));
    return;
  }
  for (const name of BLOCKS) if (blocks[name] !== undefined) console.log(`<!-- ${name} -->\n${blocks[name]}\n`);
  console.log(JSON.stringify(summarise(auditDecks(catalog)), null, 1));
}
// Run only as a script: `scripts/verify/arena-policy-choices.mts` (#650) imports the decks and the bundle builder.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
