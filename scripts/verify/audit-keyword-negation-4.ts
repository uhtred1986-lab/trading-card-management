/** R-400/R-401: RM 5-2-3–6; official Q&A BT2-048, DB1-093 and BT6-057. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { expandMacros, rulesetFor } from "../../src/lib/arena/rulesets";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { describeScript, negateAs, validateProgram, type Op, type Ref } from "../../src/lib/arena/vm/script";
import { RULES } from "../../src/lib/arena/vm";
import { run } from "../../src/lib/arena/vm/flow";
import { hasKeyword, resolveRef } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const EXACT = "[Counter: Battle Card Attack] Play this card. Then, choose 1 keyword skill of the attacking card and negate it for the duration of the turn.";
const MODAL = "[arrival green/yellow] {g}<br>[energy-exhaust]<br>[auto] When you play this card, choose one-<br>・ Your opponent chooses 1 card in their hand and places it in their Drop Area. <br>・ Choose a keyword skill on one of your opponent's Battle Cards in Rest Mode and negate it for the duration of the turn.";
const OPTIONAL = "[Auto] When you combo with this card, choose up to 1 of the keyword skills on 1 of your opponent's Battle Cards and negate it for the duration of the turn.";
const chosen = (ops: Op[]): Extract<Op, { op: "negateChosenKeyword" }>[] => ops.flatMap(op => op.op === "negateChosenKeyword" ? [op] : op.op === "chooseMode" ? op.modes.flatMap(m => chosen(m.ops)) : []);
for (const [id, skill, index, mandatory] of [["BT2-048", EXACT, 0, true], ["DB1-093", MODAL, 20, true], ["BT6-057", OPTIONAL, 0, false]] as const) {
  const row = skillRecords(card(id, { skill })).find(r => r.skillIndex === index)!;
  assert.ok(row, `${id}: actual skill index`);
  assert.deepEqual(row.unread, [], `${id}: whole skill reads`);
  const ops = chosen(row.ops);
  assert.equal(ops.length, 1);
  assert.equal(!!ops[0].mandatory, mandatory, `${id}: printed optionality survives compilation`);
  assert.match(describeScript([ops[0]]), mandatory ? /^choose 1 keyword/ : /^choose up to 1 keyword/);
}
for (const tail of ["that skill", "them"]) for (const count of ["2", "up to 2", "0", "two", "up to two", "1 or more"]) {
  const out = compileSkill(parseSkills(`[Activate: Main] Choose ${count} keyword skills on your opponent's Battle Cards and negate ${tail} for the turn.`)[0]);
  assert.ok(out.unsupported.length, `${count}: never silently reduced to one`);
  assert.deepEqual(out.ops, [], "unsupported skill counts cannot fall back to card choice and negation");
}

const all = compileSkill(parseSkills("[Activate: Main] Choose all of the keyword skills on your opponent's Battle Cards and negate them for the turn.")[0]);
assert.deepEqual(all.unsupported, []);
assert.equal(all.ops[0].op, "negateSkillsOfKind", "supported all-keyword wording stays supported");

const permanent = compileSkill(parseSkills("[Activate: Main] Place 3 cards from under this card into their owner's Drop: Choose up to 1 [Permanent] skill other than a keyword skill on your yellow ≪Frieza Clan≫ card with an energy cost of 11 and negate it for the turn.")[0]);
assert.deepEqual(permanent.unsupported, ["Choose up to 1 [Permanent] skill other than a keyword skill on your yellow ≪Frieza Clan≫ card with an energy cost of 11"], "BT27-070 remains outside the keyword-choice count guard");
assert.equal(permanent.ops.at(-1)?.op, "negateSkills", "unrelated partial reading stays unchanged");

const target: Ref = { sel: { side: "opponent", area: "battle" } };
const alias = (mandatory?: boolean): Op => ({ op: "negateChosenKeyword", target: copy(target), until: "turn", ...(mandatory === undefined ? {} : { mandatory }) });
const defs: Record<string, CardDef> = {
  K4_LEADER: card("K4_LEADER", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  K4_FILLER: card("K4_FILLER", {}),
  K4_SOURCE: card("K4_SOURCE", {}),
  K4_TARGET: card("K4_TARGET", { skill: "[Barrier][Blocker]" }),
  K4_PROTECTED: card("K4_PROTECTED", { skill: "[Barrier][Blocker][Permanent] This card's skills can't be negated in any area." }),
};
const rows = Object.values(defs).flatMap(d => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(rows), defs) };
assert.deepEqual(skillRecords(defs.K4_PROTECTED).flatMap(r => r.unread), [], "negation prohibition fixture reads");

let scenarios = 0;
for (const gameId of ["dbs", "fusion"] as const) {
  const loaded = rulesetFor(gameId);
  assert.ok(loaded.ok);
  const game = loaded.definition;
  const fresh = (): VmState => {
    let s = RULES.createGame(ctx, { game: gameId, seed: 19, p1: { name: "First", leader: "K4_LEADER", main: fifty("K4_FILLER") }, p2: { name: "Second", leader: "K4_LEADER", main: fifty("K4_FILLER") } }).state as VmState;
    for (const action of [
      { type: "chooseFirst", player: s.chooser, first: "p1" },
      { type: "mulligan", player: "p1", redraw: false },
      { type: "mulligan", player: "p2", redraw: false },
      { type: "charge", player: "p1", card: null },
    ] as Action[]) s = copy(RULES.apply(ctx, s, action).state as VmState);
    return s;
  };
  const stage = (s: VmState, player: PlayerId, def: string) => {
    const id = s.sides[player].zones.deck.at(-1)!;
    s.cards[id].cardId = def;
    assert.ok(moveCard(s, game, id, "battle", { owner: player }).ok);
    s.pending = [];
    return id;
  };
  for (const mandatory of [undefined, false, true]) {
    const op = alias(mandatory);
    const lowered = expandMacros([op], game);
    assert.equal(lowered.length, 1);
    assert.equal(lowered[0].op, "negate");
    assert.deepEqual(negateAs(lowered[0]), op, `${gameId}: alias/primitive including absent vs false`);
    for (const ops of [[op], lowered]) {
      assert.ok(validateProgram(ops));
      const rule: Rule = { kind: "activate:main", trigger: [], cost: null, cond: null, ops };
      assert.equal(validateRule(rule, rule.kind), null);
      const parsed = parseRule(printRule(rule));
      assert.ok(parsed.ok);
      assert.deepEqual(copy(parsed.value.ops), copy(ops), "explicit false, true and absence round-trip");
      for (const master of ["p1", "p2"] as const) for (const pick of ["Barrier", "Blocker"] as const) {
        let s = fresh();
        const other = master === "p1" ? "p2" : "p1";
        const source = stage(s, master, "K4_SOURCE");
        const victim = stage(s, other, "K4_TARGET");
        const frame = { ops: copy(ops), ip: 0, vars: {}, card: source, master };
        assert.deepEqual(resolveRef(ctx, game, s, frame, target), gameId === "dbs" ? [] : [victim], "ordinary Masters card choices respect Barrier; Fusion declares no Barrier hook");
        const before = JSON.stringify(frame.ops);
        s.programs.push(frame);
        run(ctx, game, s, []);
        assert.equal(s.prompt.kind, "chooseMode");
        assert.ok(s.prompt.kind === "chooseMode");
        const options = s.prompt.options;
        assert.equal(options.includes("None"), mandatory !== true);
        assert.deepEqual(options.filter(x => x !== "None").sort(), ["[Barrier]", "[Blocker]"], "either skill on the Barrier card is offered");
        const legal = RULES.legalActions(ctx, s).map(l => l.action);
        assert.equal(legal.filter(a => a.type === "chooseMode").length, options.length);
        assert.throws(() => RULES.apply(ctx, copy(s), { type: "chooseMode", player: master, index: options.length }), "a forged decline index is illegal");
        s = copy(s); // Saved prompt and frame; no compiler at resolution.
        if (!mandatory) {
          const declined = RULES.apply(ctx, copy(s), { type: "chooseMode", player: master, index: options.indexOf("None") }).state as VmState;
          assert.ok(hasKeyword(ctx, game, declined, victim, "Barrier") && hasKeyword(ctx, game, declined, victim, "Blocker"));
        }
        s = RULES.apply(ctx, s, { type: "chooseMode", player: master, index: options.indexOf(`[${pick}]`) }).state as VmState;
        assert.equal(hasKeyword(ctx, game, s, victim, pick), false);
        assert.equal(hasKeyword(ctx, game, s, victim, pick === "Barrier" ? "Blocker" : "Barrier"), true, "other keyword remains");
        assert.equal(JSON.stringify(frame.ops), before, "the stored target/program is not mutated by Barrier bypass");
        let steps = 0;
        while (s.turn === 1 && steps++ < 12) {
          const next = RULES.legalActions(ctx, s).map(l => l.action).find(a => a.type === "endMain" || a.type === "pass" || a.type === "charge" || a.type === "counter");
          assert.ok(next, "can reach turn cleanup");
          s = RULES.apply(ctx, s, next).state as VmState;
        }
        assert.ok(s.turn > 1);
        assert.ok(hasKeyword(ctx, game, s, victim, pick), "negation expires at turn cleanup");
        scenarios++;
      }
      for (const def of ["K4_FILLER", "K4_PROTECTED"]) {
        const s = fresh(), source = stage(s, "p1", "K4_SOURCE"), victim = stage(s, "p2", def);
        s.programs.push({ ops: copy(ops), ip: 0, vars: {}, card: source, master: "p1" });
        run(ctx, game, s, []);
        assert.equal(s.prompt.kind, "main", `${def}: no candidate, no question`);
        assert.equal(s.effects.some(e => e.kind === "negateKeyword" && e.target === victim), false, "no keyword negated");
        scenarios++;
      }
    }
  }
}
console.log(`audit keyword negation 4: ${scenarios} alias/primitive, both-ruleset, both-seat scenarios; exact/optional, Barrier, no-candidate, prohibition, reload and duration checks passed`);
