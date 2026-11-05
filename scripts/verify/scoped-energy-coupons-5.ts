/** R448: exact activation-scoped card-energy coupons. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { programProblem } from "../../src/lib/arena/vm/script-schema";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { energyCouponContract, requireEnergyCouponFrame } from "../../src/lib/arena/vm/energy-coupon-saves";
import type { Op, ScriptFrame } from "../../src/lib/arena/vm/script";
import { run } from "../../src/lib/arena/vm/flow";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { cardPrice } from "../../src/lib/arena/vm/costs";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const printed = "[auto] When this card is played, look at up to 7 cards from the top of your deck, add up to 1 blue Extra with an energy cost of 1 to your hand, then shuffle your deck.<br>[activate: main][limit 1][spirit boost 1] Blue Unison with 15000 power or more: During that turn, the next time you activate the [activate: main] skill on a blue Extra with an energy cost of 1 from your hand, reduce the energy cost by {u}.";
const defs: Record<string, CardDef> = {
    BASE: card("BASE", { type: "LEADER", colors: ["Blue"], traits: ["Bardock's Crew"] }),
    FILLER: card("FILLER", { colors: ["Blue"] }),
    "P-524": card("P-524", { colors: ["Blue"], skill: printed }),
    PAYER: card("PAYER", { type: "UNISON", power: 15000, colors: ["Blue"], energyCost: 2 }),
    PRICE: card("PRICE", { type: "EXTRA", colors: ["Blue"], energyCost: 1, skill: "[Activate: Main] Choose 1 of your Battle Cards and KO it: Draw 1 card." }),
    REPLACE: card("REPLACE", { skill: "[Permanent] If this card would be KO'd, you may discard 1 card from your hand instead." }),
    FAIL: card("FAIL", { type: "EXTRA", colors: ["Blue"], energyCost: 1, skill: "[Activate: Main] Choose 1 of your Battle Cards and switch it to Rest Mode, and choose 1 of your Unison Cards and remove 2 markers from it: Draw 1 card." }),
    MIXED: card("MIXED", { skill: "[Activate: Main] During this turn, the next time you activate the [Activate: Main] skill on a blue Extra with an energy cost of 1 from your hand, reduce the energy cost by {u}. [Activate: Main] Choose 1 blue Extra Card in your hand and reduce its energy cost by {u} for the turn." }),
    FLIP: card("FLIP", { type: "LEADER", colors: ["Blue"], skill: "[Activate: Main] Choose 1 blue Extra Card in your hand and reduce its energy cost by {u} for the turn.", back: { name: "Back", power: 15000, skill: "[Activate: Main] During this turn, the next time you activate the [Activate: Main] skill on a blue Extra with an energy cost of 1 from your hand, reduce the energy cost by {u}." } }),
    "EX25-13": card("EX25-13", { type: "BATTLE", name: "Tora, Disappointment", colors: ["Blue"], characters: ["Tora"], traits: ["Saiyan", "Bardock's Crew"], energyCost: 4, skill: correctSkillText("EX25-13", "[Deflect]\n[Auto] Place this card into its owner's Drop: When this card is played, play up to 1 {Final Strike Bardock} from your hand or Drop in Rest Mode.\n[Activate: Main][Limit 1]{b}, if your Leader is a blue \u226aBardock's Crew\u226b card and you have 3 or more energy: Play this card from your hand, and during this turn, the next time you activate the [Activate: Main] skill on {Tora's Red Armband} from your hand, reduce the energy cost by 2.") }),
    "TB3-032": card("TB3-032", { type: "EXTRA", name: "Tora's Red Armband", colors: ["Blue"], characters: [], traits: [], energyCost: 4, skill: correctSkillText("TB3-032", "[Activate: Main] If your Leader Card is a \u226aBardock's Crew\u226b card, choose 1 blue &lt;Tora&gt; card in your Drop Area and send it to your Warp: Draw 4 cards, choose up to 1 {Final Strike Bardock} in your Battle Area and switch it to Active Mode, and it gets +10000 power and [Double Strike] for the duration of the turn. At the end of the turn, choose up to 1 of your energy and switch it to Active Mode.") }),
    TORAFILL: card("TORAFILL", { colors: ["Blue"], characters: ["Tora"] }),
    REDMAIN: card("REDMAIN", { type: "EXTRA", colors: ["Red"], energyCost: 1, skill: "[Activate: Main] Draw 1 card." }),
    TWO: card("TWO", { type: "EXTRA", colors: ["Blue"], energyCost: 2, skill: "[Activate: Main] Draw 1 card." }),
    MAIN: card("MAIN", { type: "EXTRA", colors: ["Blue"], energyCost: 1, skill: "[Activate: Main] Draw 1 card." }),
    BOTH: card("BOTH", { type: "EXTRA", colors: ["Blue"], energyCost: 1, skill: "[Activate: Main/Battle] Draw 1 card." }),
    FIELD: card("FIELD", { type: "EXTRA", colors: ["Blue"], energyCost: 1, skill: "[Field]" }),
    COUNTER: card("COUNTER", { type: "EXTRA", colors: ["Blue"], energyCost: 1, skill: "[Counter: Attack] Negate the attack." }),
};
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(rows.map((r, id) => ({ ...r, id, status: "confirmed", source: "compiler" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(p: PlayerId) { let s = RULES.createGame(ctx, { seed: 448, p1: { name: "One", leader: "BASE", main: fifty("FILLER") }, p2: { name: "Two", leader: "BASE", main: fifty("FILLER") } }).state as VmState; for (const a of [{ type: "chooseFirst", player: s.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false }, { type: "charge", player: p, card: null }] as Action[])
    s = take(s, a); s.sides.p1.attrs.energyMarkers = 0; s.sides.p2.attrs.energyMarkers = 0; return s; }
function stage(s: VmState, p: PlayerId, id: string, area: string) { const cid = s.sides[p].zones.deck.at(-1)!; s.cards[cid].cardId = id; assert.ok(moveCard(s, game, cid, area, { owner: p }).ok); s.pending = []; return cid; }
let cases = 0;
for (const p of ["p1", "p2"] as const)
    for (const targetDef of ["MAIN", "BOTH", "FIELD", "FAIL"]) {
        let s = fresh(p);
        const source = stage(s, p, "P-524", "battle"), payer = stage(s, p, "PAYER", "unison");
        s.cards[payer].markers = 2;
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        assert.equal(s.cards[payer].markers, 1);
        assert.ok(s.effects.some(e => e.energyActivation === "main"));
        const target = stage(s, p, targetDef, "hand"); // enters after coupon resolves
        assert.equal(attrsNow(ctx, game, s, target).costOf, 1, "ordinary attributes stay unchanged");
        assert.equal(cardPrice(ctx, game, s, target).total, 1, "unscoped payment stays unchanged");
        const action = RULES.legalActions(ctx, s).map(row => row.action).find(a => a.type === "activate" && a.card === target);
        assert.equal(!!action, ["MAIN", "FIELD"].includes(targetDef), `${targetDef} eligibility`);
        if (action) {
            s = take(s, action);
            assert.ok(!s.effects.some(e => e.energyActivation), "successful zero-energy activation consumes coupon");
            if (targetDef === "FIELD")
                assert.ok(s.sides[p].zones.battle.includes(target));
            else
                assert.ok(s.sides[p].zones.drop.includes(target));
        }
        else
            assert.ok(s.effects.some(e => e.energyActivation), "unmatched or unpayable activation does not consume");
        cases++;
    }
for (const p of ["p1", "p2"] as const) {
    for (const variant of ["oldEffect", "strippedScope", "oldFrame"]) {
        let s = fresh(p);
        const source = stage(s, p, "P-524", "battle"), payer = stage(s, p, "PAYER", "unison");
        s.cards[payer].markers = 2;
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        const target = stage(s, p, "MAIN", "hand");
        if (variant === "oldFrame") {
            const ops = copy(ctx.scripts!["P-524"].bySkill[10]!.ops);
            const op = ops.find(op => op.op === "costReduction");
            assert.ok(op?.op === "costReduction");
            delete op.energyActivation;
            s.effects = [];
            s.programs = [{ card: source, master: p, skillIndex: 10, ops, ip: 0, vars: {}, skillEffectOrigin: { version: 2, kind: "activate" } }];
            run(ctx, game, s, []);
            assert.equal(s.outcome?.kind, "interrupted");
            assert.match(s.outcome?.privateContext?.detail ?? "", /coupon/);
            assert.equal(s.effects.length, 0);
        }
        else {
            const effect = s.effects.find(e => e.energyActivation)!;
            delete effect.energyActivation;
            if (variant === "oldEffect")
                delete effect.costOrigin;
            assert.throws(() => attrsNow(ctx, game, s, target), /coupon/);
        }
        cases++;
    }
    {
        let s = fresh(p);
        const source = stage(s, p, "MIXED", "battle"), target = stage(s, p, "MAIN", "hand");
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        assert.equal(s.prompt.kind, "chooseCards");
        s = take(s, { type: "choose", player: p, cards: [target] });
        assert.equal(attrsNow(ctx, game, s, target).costOf, 0, "valid ordinary reduction on another source line stays global");
        assert.ok(s.effects.some(e => e.kind === "cost" && !e.energyActivation && e.costOrigin?.skillIndex === 10));
        cases++;
    }
}
for (const p of ["p1", "p2"] as const) {
    {
        let s = fresh(p);
        const source = s.sides[p].zones.leader[0];
        s.cards[source].cardId = "FLIP";
        const target = stage(s, p, "MAIN", "hand");
        s = take(s, { type: "activate", player: p, card: source, skill: 0 });
        s = take(s, { type: "choose", player: p, cards: [target] });
        s.cards[source].flipped = true;
        assert.equal(attrsNow(ctx, game, s, target).costOf, 0, "new ordinary front-side coupon survives back-side index collision");
        cases++;
    }
    {
        let s = fresh(p);
        const source = stage(s, p, "P-524", "battle"), payer = stage(s, p, "PAYER", "unison");
        s.cards[payer].markers = 2;
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        const target = stage(s, p, "COUNTER", "hand");
        assert.equal(cardPrice(ctx, game, s, target, { kind: "counter:attack", keyword: null }).total, 1, "Counter pays full card energy");
        assert.ok(s.effects.some(e => e.energyActivation));
        cases++;
    }
}
for (const p of ["p1", "p2"] as const) {
    for (const replaced of [false, true]) {
        let s = fresh(p);
        const source = stage(s, p, "P-524", "battle"), payer = stage(s, p, "PAYER", "unison");
        s.cards[payer].markers = 2;
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        const target = stage(s, p, "PRICE", "hand"), material = stage(s, p, replaced ? "REPLACE" : "FILLER", "battle");
        const deck = s.sides[p].zones.deck.length;
        s = take(s, { type: "activate", player: p, card: target, skill: 0 });
        assert.equal(s.prompt.kind, "chooseCards");
        assert.ok(s.effects.some(e => e.energyActivation), "action price hasn't yet consumed coupon");
        assert.ok(s.programs.some(f => f.activationEnergyPayment?.ids.length));
        s = take(copy(s), { type: "choose", player: p, cards: [material] });
        if (replaced) {
            assert.equal(s.prompt.kind, "replaceMove");
            s = take(s, { type: "chooseMode", player: p, index: 0 });
            assert.equal(s.prompt.kind, "chooseCards");
            const discard = s.sides[p].zones.hand.find(id => s.prompt.kind === "chooseCards" && s.prompt.choice.candidates.includes(id))!;
            s = take(s, { type: "choose", player: p, cards: [discard] });
        }
        assert.equal(s.effects.some(e => e.energyActivation), replaced);
        assert.equal(s.sides[p].zones.deck.length, deck - (replaced ? 0 : 1));
        cases++;
    }
    for (const stale of [false, true]) {
        let s = fresh(p);
        const source = stage(s, p, "P-524", "battle"), payer = stage(s, p, "PAYER", "unison");
        s.cards[payer].markers = 3;
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        const target = stage(s, p, "FAIL", "hand"), rest = stage(s, p, "FILLER", "battle");
        s = take(s, { type: "activate", player: p, card: target, skill: 0 });
        assert.equal(s.prompt.kind, "chooseCards");
        assert.ok(s.effects.some(e => e.energyActivation));
        if (stale) {
            s.cards[payer].markers = 1;
            assert.throws(() => take(copy(s), { type: "choose", player: p, cards: [rest] }));
            assert.ok(s.effects.some(e => e.energyActivation));
        }
        else {
            s = take(copy(s), { type: "choose", player: p, cards: [rest] });
            if (s.prompt.kind === "chooseCards")
                s = take(s, { type: "choose", player: p, cards: [payer] });
            assert.ok(!s.effects.some(e => e.energyActivation));
            assert.ok(s.sides[p].zones.drop.includes(payer));
        }
        cases++;
    }
}
for (const p of ["p1", "p2"] as const) {
    let s = fresh(p);
    const source = stage(s, p, "EX25-13", "hand");
    for (let i = 0; i < 3; i++)
        stage(s, p, "FILLER", "energy");
    s = take(s, { type: "activate", player: p, card: source, skill: 20 });
    if (s.prompt.kind === "chooseMode")
        s = take(s, { type: "chooseMode", player: p, index: s.prompt.options.length - 1 });
    assert.ok(s.effects.some(e => e.energyActivation === "main"));
    assert.ok(s.sides[p].zones.battle.includes(source));
    const target = stage(s, p, "TB3-032", "hand"), material = stage(s, p, "TORAFILL", "drop");
    stage(s, p, "TORAFILL", "drop");
    const deck = s.sides[p].zones.deck.length;
    assert.equal(cardPrice(ctx, game, s, target).total, 4);
    s = take(s, { type: "activate", player: p, card: target, skill: 0 });
    assert.equal(s.prompt.kind, "chooseCards");
    assert.ok(s.effects.some(e => e.energyActivation));
    s = take(s, { type: "choose", player: p, cards: [material] });
    assert.ok(!s.effects.some(e => e.energyActivation));
    assert.equal(s.sides[p].zones.deck.length, deck - 4);
    assert.ok(s.sides[p].zones.warp.includes(material));
    cases++;
}
for (const p of ["p1", "p2"] as const) {
    for (const variant of ["duplicates", "missing", "expired"]) {
        let s = fresh(p);
        const source = stage(s, p, "P-524", "battle"), payer = stage(s, p, "PAYER", "unison");
        s.cards[payer].markers = 2;
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        const target = stage(s, p, "PRICE", "hand"), material = stage(s, p, "FILLER", "battle");
        s = take(s, { type: "activate", player: p, card: target, skill: 0 });
        const pending = s.programs.find(f => f.pricedBy)!;
        assert.ok(pending.activationEnergyPayment?.ids.length);
        if (variant === "duplicates")
            pending.activationEnergyPayment!.ids.push(pending.activationEnergyPayment!.ids[0]);
        else if (variant === "missing")
            delete pending.activationEnergyPayment;
        else
            s.effects = s.effects.filter(e => !pending.activationEnergyPayment!.ids.includes(e.id));
        s = take(copy(s), { type: "choose", player: p, cards: [material] });
        if (variant === "expired") {
            assert.notEqual(s.outcome?.kind, "interrupted");
            assert.ok(!s.effects.some(e => e.energyActivation));
            assert.ok(s.sides[p].zones.drop.includes(material));
        }
        else {
            assert.equal(s.outcome?.kind, "interrupted");
            assert.match(s.outcome?.privateContext?.detail ?? "", /coupon/);
            assert.ok(s.sides[p].zones.battle.includes(material));
        }
        cases++;
    }
    {
        const s = fresh(p), source = stage(s, p, "MIXED", "battle");
        const base: Extract<Op, {
            op: "costReduction";
        }> = { op: "costReduction", target: { sel: { area: "hand", side: "you" } }, amount: 1, until: "turn", uses: 1 };
        const ops: Op[] = [{ ...base, energyActivation: "main" }, { ...base, energyActivation: "battle" }, base];
        const frame: ScriptFrame = { card: source, master: p, skillIndex: 0, ip: 0, vars: {}, ops, energyCouponContract: energyCouponContract(ops) };
        assert.doesNotThrow(() => requireEnergyCouponFrame(ctx, s, copy(frame)));
        const bad = copy(frame);
        delete (bad.ops[0] as typeof base).energyActivation;
        assert.throws(() => requireEnergyCouponFrame(ctx, s, bad), /coupon/);
        cases++;
    }
}
for (const p of ["p1", "p2"] as const)
    for (const variant of ["color", "side", "area", "cost"]) {
        let s = fresh(p);
        const source = stage(s, p, "P-524", "battle"), payer = stage(s, p, "PAYER", "unison");
        s.cards[payer].markers = 2;
        s = take(s, { type: "activate", player: p, card: source, skill: 10 });
        const target = stage(s, variant === "side" ? other(p) : p, variant === "color" ? "REDMAIN" : variant === "cost" ? "TWO" : "MAIN", variant === "area" ? "drop" : "hand");
        assert.equal(cardPrice(ctx, game, s, target, { kind: "activate:main", keyword: null }).total, variant === "cost" ? 2 : 1, variant);
        assert.ok(s.effects.some(e => e.energyActivation));
        cases++;
    }
for (const r of rows.filter(r => /next time.*activate/i.test(r.printed))) {
    const rule = copy({ kind: r.kind, trigger: r.trigger, cost: r.cost, usage: r.usage, validity: r.validity, cond: r.cond, ops: r.ops }) as Rule;
    assert.equal(validateRule(rule, r.kind), null);
    const parsed = parseRule(printRule(rule));
    assert.ok(parsed.ok);
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value, (key, v) => key === "upTo" && v === false ? undefined : v && typeof v === "object" && Array.isArray(v.areas) ? { ...v, area: undefined } : v));
    assert.deepEqual(plain(parsed.value), plain(rule));
}
assert.ok(programProblem([{ op: "costReduction", target: { sel: { special: "self" } }, amount: 1, what: "skill", energyActivation: "main" }]));
assert.ok(programProblem([{ op: "costReduction", target: { sel: { special: "self" } }, amount: 1, energyActivation: "unknown" }]));
assert.equal(programProblem([{ op: "costModifier", target: { sel: { special: "self" } }, amount: 1, energyActivation: "main" }]), null);
console.log(`Scoped energy coupons5: ${cases} cases passed`);
