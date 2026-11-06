import { keywordSkillsNegated } from "../../src/lib/arena/vm/effects";
import { frozenUnderReviewContext, stageIsolatedUnder } from "./under-standing-review-fixture";
/** R523 actual-board isolated observer proofs; no native standing admission. */
import assert from "node:assert/strict";
import fixture from "./fixtures/under-standing-observer-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { RULES } from "../../src/lib/arena/vm";
import type { CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { reviewUnderStandingDefinitions as review, requireReviewedUnderDefinition, UNDER_REVIEW_REFUSAL } from "../../src/lib/arena/vm/standing-negation-under-definition";
import { observeUnderStandingFacts as observe } from "../../src/lib/arena/vm/standing-negation-under-observation";
import { initializeUnderObservationProof as initialize, captureUnderStandingObservation as capture,
    finishUnderStandingObservation as finish, assertUnderObservation as read } from "../../src/lib/arena/vm/standing-negation-under-proof";
const clone = <T,>(v: T): T => structuredClone(v);
const defs: Record<string, CardDef> = { L: card("L", { type: "LEADER", skill: null }), F: card("F", { skill: null }) };
for (const [id, { card: c }] of Object.entries(fixture)) defs[id] = card(id, { name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"],
    energyCost: c.cost === null ? null : Number(c.cost), power: c.power, characters: c.characters, traits: c.traits, skill: c.skill });
const records = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = frozenUnderReviewContext({ defs, scripts: rulesFromRows(records.map((r, id) => ({ ...r, id, status: r.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) });
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const reviewed = review(ctx, "BT23-070", "front");
let checks = 0;
const test = (f: () => void) => { f(); checks++; };
function setup(p: PlayerId, owner: PlayerId = p, target = "BT1-034", area = "battle") {
    const state = RULES.createGame(ctx, { seed: 523, p1: { name: "One", leader: "L", main: fifty("F"), z: [] }, p2: { name: "Two", leader: "L", main: fifty("F"), z: [] } }).state as VmState;
    const stage = (holder: PlayerId, place: string, id: string, top?: string) => {
        const key = state.sides[holder].zones.deck.at(-1)!; state.cards[key].cardId = id;
        assert.ok(moveCard(state, game, key, place, { owner: holder, ...(top ? { under: top } : {}) }).ok); return key;
    };
    const host = stage(p, area, target), source = stage(owner, "drop", "BT23-070");
    const history = initialize(ctx, game, state, reviewed);
    return { state, host, source, history, stage };
}
test(() => {
    assert.deepEqual(JSON.parse(JSON.stringify(records.filter(r => r.cardId === "BT23-070"))), Object.values(fixture["BT23-070"].records));
    assert.deepEqual(reviewed[0].script, ctx.scripts!["BT23-070"].bySkill[0]);
    assert.deepEqual(reviewed[0].script.unsupported, [UNDER_REVIEW_REFUSAL]);
    assert.equal(ctx.scripts!["BT23-070"].complete, false); assert.ok(ctx.scripts!["BT23-070"].bySkill[10].unsupported.length); assert.ok(ctx.scripts!["BT23-070"].bySkill[20].unsupported.length);
});
for (const fault of ["admitted", "unread", "body", "price", "usage", "definition", "descriptor"] as const) test(() => {
    const context = clone(ctx), script = context.scripts!["BT23-070"].bySkill[0];
    if (fault === "admitted") script.unsupported = [];
    if (fault === "unread") script.unsupported.push("unread extra clause");
    if (fault === "body") script.ops.pop();
    if (fault === "price") script.price!.payment.orbs = { any: 1 };
    if (fault === "usage") script.usage!.oncePerTurn = true;
    if (fault === "definition") context.defs["BT23-070"].name += " changed";
    const value = clone(reviewed[0]); if (fault === "descriptor") value.skill.index = 10;
    assert.throws(() => requireReviewedUnderDefinition(context, value), NotYet);
});
for (const p of ["p1", "p2"] as PlayerId[]) for (const foreign of [false, true]) for (const target of ["BT1-034", "BT1-043", "TB1-097"]) test(() => {
    const t = setup(p, foreign ? other(p) : p, target), before = JSON.stringify(t.state), history = JSON.stringify(t.history);
    read(ctx, game, t.state, t.history, reviewed); assert.equal(JSON.stringify(t.state), before);
    const token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host));
    const placed = JSON.stringify(t.state), result = finish(ctx, game, t.state, token);
    assert.equal(JSON.stringify(t.state), placed); assert.equal(JSON.stringify(t.history), history);
    assert.equal(result.plan.negate.length, target === "BT1-034" ? 1 : 0); assert.equal(result.plan.forbidAttack.length, 1);
    assert.equal(result.observation.under[0].relation.host.holder, p); assert.equal(result.observation.under[0].source.occurrence.owner, foreign ? other(p) : p);
    result.plan.forbidAttack.length = 0; assert.equal(read(ctx, game, t.state, result.history, reviewed).forbidAttack.length, 1);
    assert.throws(() => finish(ctx, game, t.state, token), NotYet); assert.throws(() => initialize(ctx, game, t.state, reviewed), NotYet);
    if (target === "BT1-034") assert.equal(keywordSkillsNegated(t.state, t.host), false, "isolated output does not write native keyword negation");
    assert.equal(t.state.standingNegationHistory, undefined); assert.equal(t.state.mixedStandingNegationHistory, undefined);
});
for (const p of ["p1", "p2"] as PlayerId[]) test(() => {
    const t = setup(p, other(p), "BT1-043", "combo"), token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host)); const result = finish(ctx, game, t.state, token);
    assert.equal(result.plan.negate.length, 1); assert.equal(result.plan.forbidAttack.length, 1); // ordinary Battle immunity is inactive in Combo
});
for (const p of ["p1", "p2"] as PlayerId[]) for (const fault of ["unknown", "incomplete", "empty", "qualified", "broad", "copied", "battle", "hidden", "duplicate", "nested", "area", "type"] as const) test(() => {
    const t = setup(p), context = clone(ctx);
    if (fault === "unknown") delete context.scripts!["BT1-034"].bySkill[0]; // keyword is unrelated: add unknown Permanent instead below
    if (["unknown", "incomplete", "empty", "qualified"].includes(fault)) {
        t.state.cards[t.host].cardId = "BT1-043";
        if (fault === "unknown") delete context.scripts!["BT1-043"].bySkill[10]; else if (fault === "incomplete") context.scripts!["BT1-043"].bySkill[10].unsupported = ["unread immunity"];
        if (fault === "empty") context.scripts!["BT1-043"].bySkill[10].ops = [];
        if (fault === "qualified") context.defs["BT1-043"].skill = context.defs["BT1-043"].skill!.replace("[Permanent]", "[Permanent][Once per turn]");
    }
    if (fault === "broad") t.stage(p, "battle", "P-680");
    if (fault === "copied") addEffect(t.state, [], { target: t.source, kind: "copiedSkills", value: 0, until: "turn", copied: { cardId: "BT23-070", side: "front", skills: [0], from: t.source } });
    assert.ok(moveCard(t.state, game, t.source, "drop", { under: t.host }).ok); // explicitly constructed observation, not admitted #10
    if (fault === "battle") t.state.battle = { attacker: t.host, guard: t.state.sides[other(p)].zones.leader[0] } as VmState["battle"];
    if (fault === "hidden") t.state.cards[t.host].hidden = true;
    if (fault === "duplicate") t.state.cards[t.host].under.push(t.source);
    if (fault === "nested") t.state.cards[t.source].under.push(t.state.sides[p].zones.deck[0]);
    if (fault === "area") { t.state.sides[p].zones.battle.splice(t.state.sides[p].zones.battle.indexOf(t.host), 1); t.state.sides[p].zones.energy.push(t.host); }
    if (fault === "type") t.state.cards[t.host].cardId = "L";
    const before = JSON.stringify(t.state); assert.throws(() => observe(context, game, t.state, t.history, reviewed), NotYet); assert.equal(JSON.stringify(t.state), before);
});
for (const p of ["p1", "p2"] as PlayerId[]) test(() => {
    const t = setup(p), material = t.stage(p, "under", "F", t.host);
    t.history = initialize(ctx, game, t.state, reviewed);
    let token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host)); let result = finish(ctx, game, t.state, token);
    const serial = result.history.active[0].serial;
    token = capture(ctx, game, t.state, result.history, reviewed, { kind: "reorder", host: t.host });
    t.state.cards[t.host].under = [t.source, material]; // supplied permitted reorder mechanism, no printed reorder claim
    result = finish(ctx, game, t.state, token); assert.equal(result.history.active[0].serial, serial);
    token = capture(ctx, game, t.state, result.history, reviewed, { kind: "detach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source));
    result = finish(ctx, game, t.state, token); assert.equal(result.plan.negate.length + result.plan.forbidAttack.length, 0);
    token = capture(ctx, game, t.state, result.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host)); result = finish(ctx, game, t.state, token); assert.ok(result.history.active[0].serial > serial);
});
for (const p of ["p1", "p2"] as PlayerId[]) test(() => {
    const t = setup(other(p), p, "BT1-034", "combo");
    assert.ok(moveCard(t.state, game, t.host, "combo", { owner: p, carry: true }).ok);
    t.history = initialize(ctx, game, t.state, reviewed);
    const token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host)); const result = finish(ctx, game, t.state, token);
    assert.equal(result.observation.under[0].relation.host.owner, other(p));assert.equal(result.observation.under[0].relation.host.holder, p);
    assert.equal(result.plan.sources[0].master, p); // never the legacy Combo master/physical owner
});
for (const p of ["p1", "p2"] as PlayerId[]) for (const kind of ["line", "whole"] as const) test(() => {
    const t = setup(p), token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host)); let result = finish(ctx, game, t.state, token);
    const next = capture(ctx, game, t.state, result.history, reviewed, { kind: "effects" });
    const effect = addEffect(t.state, [], { target: t.source, kind: kind === "line" ? "negateSkill" : "negateSkills", value: 0, until: "turn" });
    result = finish(ctx, game, t.state, next); assert.equal(result.plan.negate.length + result.plan.forbidAttack.length, 0);
    const again = capture(ctx, game, t.state, result.history, reviewed, { kind: "effects" });
    t.state.effects = t.state.effects.filter(e => e.id !== effect.id); result = finish(ctx, game, t.state, again);
    assert.equal(result.plan.negate.length, 1); assert.equal(result.plan.forbidAttack.length, 1);
});
for (const p of ["p1", "p2"] as PlayerId[]) for (const fault of ["board", "context", "game", "epoch", "control", "face", "promotion", "missingPile", "history", "aba"] as const) test(() => {
    const t = setup(p), token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host));
    if (fault === "board") { assert.throws(() => finish(ctx, game, clone(t.state), token), NotYet); return; }
    if (fault === "context") { assert.throws(() => finish(clone(ctx), game, t.state, token), NotYet); return; }
    if (fault === "game") { assert.throws(() => finish(ctx, { ...game }, t.state, token), NotYet); return; }
    if (fault === "history") { const bad = clone(t.history); bad.nextSerial = 0; assert.throws(() => observe(ctx, game, t.state, bad, reviewed), NotYet); return; }
    if (fault === "epoch") t.state.cards[t.source].zoneEpoch!++;
    if (fault === "control") { t.state.sides[p].zones.battle.splice(t.state.sides[p].zones.battle.indexOf(t.host), 1); t.state.sides[other(p)].zones.battle.push(t.host); }
    if (fault === "face") t.state.cards[t.source].flipped = true;
    if (fault === "promotion") t.state.cards[t.host].cardId = "BT7-008";
    if (fault === "missingPile") t.state.cards[t.host].under = null as never;
    if (fault === "aba") { assert.ok(moveCard(t.state, game, t.source, "drop", { owner: p }).ok); assert.ok(moveCard(t.state, game, t.source, "drop", { under: t.host }).ok); }
    const before = JSON.stringify(t.state); assert.throws(() => finish(ctx, game, t.state, token), NotYet); assert.equal(JSON.stringify(t.state), before);
});
for (const p of ["p1", "p2"] as PlayerId[]) test(() => {
    const t = setup(p, p, "BT1-043");
    const suppression = addEffect(t.state, [], { target: t.host, kind: "negateSkill", value: 10, until: "turn" });
    t.history = initialize(ctx, game, t.state, reviewed);
    const token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host));const result = finish(ctx, game, t.state, token);assert.equal(result.plan.negate.length, 1);
    const next = capture(ctx, game, t.state, result.history, reviewed, { kind: "effects" });
    t.state.effects = t.state.effects.filter(e => e.id !== suppression.id);
    const before = JSON.stringify(t.state);assert.throws(() => finish(ctx, game, t.state, next), NotYet);assert.equal(JSON.stringify(t.state), before);
});
for (const p of ["p1", "p2"] as PlayerId[]) test(() => {
    const t = setup(p), granted = addEffect(t.state, [], { target: t.host, kind: "keyword", value: { name: "Blocker" }, until: "turn" });
    t.history = initialize(ctx, game, t.state, reviewed);
    const token = capture(ctx, game, t.state, t.history, reviewed, { kind: "attach", source: t.source, host: t.host });
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host));const before = JSON.stringify(t.state), result = finish(ctx, game, t.state, token);
    assert.deepEqual(result.plan.deleteGrants, [{ effect: granted.id, target: t.host }]);assert.equal(JSON.stringify(t.state), before);
    assert.equal(t.state.resolvedGrantDeletions?.find(r => r.grant === granted.id)?.deleted, false);
    for (const viewer of [p, other(p)]) assert.throws(() => RULES.boardView(ctx, t.state, viewer, {}), NotYet, "historic isolated context is not admitted native view history");
});
for (const p of ["p1", "p2"] as PlayerId[]) for (const mode of ["timed", "immune", "areaPolicy", "copiedAuto", "grantMutation"] as const) test(() => {
    const t = setup(p), context = clone(ctx);
    if (mode === "areaPolicy") {
        const d = card("MECHANISM", { skill: "[Permanent] Negate the skills of all other Battle Cards." });
        context.defs[d.id] = d;
        Object.assign(context.scripts!, rulesFromRows(skillRecords(d).map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as RuleRow), context.defs));
        t.stage(p, "battle", d.id); // exact policy interaction mechanism, not a shortened actual card
        assert.throws(()=>initialize(context, game, t.state, reviewed), NotYet);return;
    }
    if (mode === "timed") addEffect(t.state, [], { target:t.host, kind:"forbid", value:0, until:"turn", forbid:{what:"beNegated"} });
    if (mode === "immune") addEffect(t.state, [], { target:t.host, kind:"immune", value:0, until:"turn", immune:{from:other(p)} });
    if (["timed","immune"].includes(mode)) { const before=JSON.stringify(t.state);assert.throws(()=>initialize(ctx, game, t.state, reviewed),NotYet);assert.equal(JSON.stringify(t.state),before);return; }
    const grant=addEffect(t.state,[],{target:t.host,kind:"copiedSkills",value:0,until:"turn",copied:{cardId:"BT7-008",side:"front",skills:[0],from:t.host}});
    t.history=initialize(ctx,game,t.state,reviewed);
    const token=capture(ctx,game,t.state,t.history,reviewed,{kind:"attach",source:t.source,host:t.host});
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host));
    if(mode==="grantMutation") { grant.until="game";const before=JSON.stringify(t.state);assert.throws(()=>finish(ctx,game,t.state,token),NotYet);assert.equal(JSON.stringify(t.state),before);return; }
    const result=finish(ctx,game,t.state,token);assert.deepEqual(result.plan.deleteGrants,[{effect:grant.id,target:t.host}]);
    const added=addEffect(t.state,[],{target:t.host,kind:"keyword",value:{name:"Blocker"},until:"turn"});
    assert.deepEqual(read(ctx,game,t.state,result.history,reviewed).deleteGrants,[{effect:grant.id,target:t.host},{effect:added.id,target:t.host}]);
});
for (const p of ["p1", "p2"] as PlayerId[]) for (const fault of ["receiptMissing", "receiptRestored"] as const) test(() => {
    const t=setup(p),grant=addEffect(t.state,[],{target:t.host,kind:"keyword",value:{name:"Blocker"},until:"turn"});
    const receipt=t.state.resolvedGrantDeletions!.find(r=>r.grant===grant.id)!;
    if(fault==="receiptRestored")receipt.deleted=true;
    t.history=initialize(ctx,game,t.state,reviewed);
    const token=capture(ctx,game,t.state,t.history,reviewed,{kind:"attach",source:t.source,host:t.host});
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host));
    if(fault==="receiptMissing")t.state.resolvedGrantDeletions=[];else receipt.deleted=false;
    const before=JSON.stringify(t.state);assert.throws(()=>finish(ctx,game,t.state,token),NotYet);assert.equal(JSON.stringify(t.state),before);
});
for (const p of ["p1", "p2"] as PlayerId[]) test(() => {
    const t=setup(p,p,"BT1-043"),context=clone(ctx);
    t.history=initialize(context,game,t.state,reviewed);
    const token=capture(context,game,t.state,t.history,reviewed,{kind:"attach",source:t.source,host:t.host});
    assert.ok(stageIsolatedUnder(t.state, game, t.source, t.host));
    context.defs["BT1-043"].name+=" changed";
    const before=JSON.stringify(t.state);assert.throws(()=>finish(context,game,t.state,token),NotYet);assert.equal(JSON.stringify(t.state),before);
});
console.log(`under-standing-observer-5: ${checks} isolated actual-board cases PASS`);
