/**
 * #1121 (20-16): "If you do" is true only when the optional action happened.
 *
 * BT31-139 Absorb and Power Up, with its compiler program (v8: `choose c0`, then
 * `may{choose android, move under c0}`, then `if did(may){...}`, no `if chose`).
 * The text is the one scripts/verify/cell-binding-938-939.ts uses (the batch-5
 * receipt quotes the same sentences, shortened). With no white Cell Battle Card
 * the offer is taken but nothing can go under anything, so nothing is played.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { mayBlockWitnessable, type Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const ABSORB =
  "[Activate: Main] Draw 1 card, then choose 1 of your white ≪Cell≫ Battle Cards. You may place 1 ≪Android≫ card from your Drop Area under the chosen card. If you do, play up to 1 white ≪Cell≫ card with an energy cost of 4 or less from your Drop Area on top of the originally chosen card in Active Mode.";
const SUMMON =
  "[Activate: Main/Battle] Play 2 Cell Jr. Tokens and they gain [Blocker] for the turn. (Cell Jr. Tokens have 10000 power, 0 combo cost, and 5000 combo power.)";

const cell = (id: string, o: Partial<CardDef> = {}): CardDef => card(id, { colors: ["White"], traits: ["Cell"], energyCost: 3, skill: null, ...o });
const extra = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", colors: ["White"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  ABSORB938: extra("ABSORB938", ABSORB),
  SUMMON939: extra("SUMMON939", SUMMON),
  HOSTA938: cell("HOSTA938", { name: "Host A" }),
  HOSTB938: cell("HOSTB938", { name: "Host B" }),
  REDCELL938: cell("REDCELL938", { colors: ["Red"] }),
  WHITEOTHER938: cell("WHITEOTHER938", { traits: ["Saiyan"] }),
  DROID938: card("DROID938", { colors: ["White"], traits: ["Android"], energyCost: 2, skill: null }),
  DROIDB938: card("DROIDB938", { colors: ["Red"], traits: ["Android"], energyCost: 2, skill: null }),
  NODROID938: card("NODROID938", { colors: ["White"], traits: ["Saiyan"], energyCost: 2, skill: null }),
  NEWA938: cell("NEWA938", { energyCost: 4, power: 20000 }),
  NEWB938: cell("NEWB938", { energyCost: 2, power: 15000 }),
  BIGCELL938: cell("BIGCELL938", { energyCost: 5 }),
  REDNEW938: cell("REDNEW938", { colors: ["Red"], energyCost: 2 }),
  OTHERNEW938: cell("OTHERNEW938", { traits: ["Saiyan"], energyCost: 2 }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
// Drafted records, written out and read back: the production row path.
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = withTokens({ ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) });
const apply = (s: VmState, a: Action): VmState => RULES.apply(ctx, roundtrip(s), a).state as VmState;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** A fresh Main Phase for `seat`. */
function board(seed: number, seat: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const step = (a: Action) => { s = apply(s, a); };
  step({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) step({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  if (seat === "p2") { step({ type: "endMain", player: "p1" }); step({ type: "charge", player: "p2", card: null }); }
  assert.equal(s.turnPlayer, seat);
  assert.equal(s.prompt.kind, "main");
  return s;
}
type Area = "battle" | "drop" | "hand";
function stage(s: VmState, p: PlayerId, def: string, area: Area): string {
  const id = s.sides[p].zones.deck[0];
  assert.ok(id);
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = "active";
  return id;
}
const activation = (s: VmState, id: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);
const choose = (s: VmState, p: PlayerId, cards: string[]): VmState => apply(s, { type: "choose", player: p, cards });
const mode = (s: VmState, p: PlayerId, index: number): VmState => apply(s, { type: "chooseMode", player: p, index });


const line = compileCard(defs.ABSORB938).bySkill[0];
const shape = JSON.stringify(line.ops);
assert.ok(shape.includes('"op":"may"') && !shape.includes('"kind":"chose"'), "the compiler program, not the Claude draft: a may with no `if chose` around it");
assert.ok(shape.includes('"kind":"did","what":"may"'), "the play waits on did(may)");

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const setup = (seed: number, o: { cells: boolean }) => {
    const s = board(seed, seat);
    const t = {
      card: stage(s, seat, "ABSORB938", "hand"),
      host: o.cells ? stage(s, seat, "HOSTA938", "battle") : "",
      red: stage(s, seat, "REDCELL938", "battle"),
      foeCell: stage(s, foe, "HOSTA938", "battle"),
      droid: stage(s, seat, "DROID938", "drop"),
      newA: stage(s, seat, "NEWA938", "drop"),
    };
    return { s, t };
  };
  const finish = (s0: VmState, t: ReturnType<typeof setup>["t"], answers: "take" | "decline") => {
    let s = apply(s0, activation(s0, t.card)!.action);
    // Answer only what is asked: the choice of host, the offer, the Android, the replacement.
    for (let i = 0; i < 8 && s.prompt.kind !== "main"; i++) {
      if (s.prompt.kind === "chooseMode") s = mode(s, seat, answers === "take" ? 0 : 1);
      else if (s.prompt.kind === "chooseCards") s = choose(s, seat, [s.prompt.choice.candidates.find((c) => [t.host, t.droid, t.newA].includes(c)) ?? s.prompt.choice.candidates[0]]);
      else break;
    }
    assert.equal(s.prompt.kind, "main");
    return s;
  };

  // No white Cell Battle Card: the offer may be taken, nothing goes under nothing, so nothing is played.
  {
    const { s: s0, t } = setup(1121_000, { cells: false });
    const s = finish(s0, t, "take");
    const z = s.sides[seat].zones;
    assert.ok(z.drop.includes(t.newA), `${seat}: the white Cell stays in the Drop`);
    assert.ok(z.drop.includes(t.droid), `${seat}: the Android stays in the Drop`);
    assert.ok(!z.battle.includes(t.newA), `${seat}: nothing is played`);
    assert.equal(s.cards[t.red].under.length, 0);
  }
  // Full board, offer taken: the Android goes under and the white Cell is played on the host.
  {
    const { s: s0, t } = setup(1121_010, { cells: true });
    const s = finish(s0, t, "take");
    const z = s.sides[seat].zones;
    assert.ok(z.battle.includes(t.newA) && s.cards[t.newA].under.includes(t.host), `${seat}: the Cell is played onto the host`);
    assert.ok(s.cards[t.newA].under.includes(t.droid) || s.cards[t.host].under.includes(t.droid), `${seat}: the Android went under`);
    assert.equal(s.cards[t.newA].mode, "active");
  }
  // Offer declined: nothing is played.
  {
    const { s: s0, t } = setup(1121_020, { cells: true });
    const s = finish(s0, t, "decline");
    const z = s.sides[seat].zones;
    assert.ok(z.drop.includes(t.newA) && z.drop.includes(t.droid) && z.battle.includes(t.host), `${seat}: declined, nothing moved`);
  }
}

// What counts as "happened": a block made only of recorded steps is judged by them; any other step keeps the answer given.
{
  const chooseAndroid = { op: "choose", sel: { side: "you", area: "drop" }, as: "c1" } as unknown as Op;
  const move = { op: "moveTo", target: { var: "c1" }, to: "under", under: { var: "c0" } } as unknown as Op;
  assert.ok(mayBlockWitnessable([chooseAndroid, move]), "choose + move under is witnessed");
  assert.ok(mayBlockWitnessable([{ op: "draw", n: 1 } as unknown as Op]), "a draw is witnessed");
  assert.ok(!mayBlockWitnessable([chooseAndroid]), "a choose alone has nothing to witness");
  assert.ok(!mayBlockWitnessable([move, { op: "power", target: { var: "c0" }, n: 1000 } as unknown as Op]), "a block with an unrecorded step keeps the answer");
}
