import { frozenUnderReviewContext } from "./under-standing-review-fixture";
/** R528 actual loader and native adapters; explicitly staged boards and synthetic roots remain mechanism evidence. */
import assert from "node:assert/strict";
import areaSources from "./fixtures/combo-standing-source.json";
import underSources from "./fixtures/under-standing-observer-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { freshAppliedEffectRoot, recordAppliedEffect } from "../../src/lib/arena/vm/applied-effect-receipt";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { moved } from "../../src/lib/arena/vm/flow";
import { forbiddenBy, spendProhibitionUse } from "../../src/lib/arena/vm/program";
import { expireStandingNegationBatch } from "../../src/lib/arena/vm/standing-negation-runtime";
import { vmHost } from "../../src/lib/arena/vm/host";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { nativeUnderDefinitions } from "../../src/lib/arena/vm/under-native-policy";
import { nativeUnderPhysicalFacts, type NativeUnderState } from "../../src/lib/arena/vm/under-native-observation";
import { issueNativeUnderRead, nativeUnderReadMatches, nativeUnderSkillsNegated, nativeUnderAttackProhibited } from "../../src/lib/arena/vm/under-native-read";
import { initializeNativeUnderStanding, prepareNativeUnderMutation, requireNativeUnderMutation, settleNativeUnderMutation } from "../../src/lib/arena/vm/under-native-transaction";
import { projectNativeUnderWrite, type NativeUnderWritePlan } from "../../src/lib/arena/vm/under-native-plan";
import { NotYet } from "../../src/lib/arena/vm/errors";
const defs: EngineContext["defs"] = { L: card("L", { type: "LEADER", skill: null }), F: card("F", { skill: null }) };
for (const [id, { card: c }] of Object.entries({ ...areaSources, ...underSources })) defs[id] = card(id, {
    name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"], energyCost: c.cost === null ? null : Number(c.cost),
    power: c.power, characters: c.characters, traits: c.traits, skill: c.skill,
});
const ctx: EngineContext = { defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((row, id) =>
    ({ ...row, id, status: row.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
const original = frozenUnderReviewContext(ctx);
assert.deepEqual(ctx.scripts!["BT23-070"].bySkill[0].unsupported, []);
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
let cases = 0;
function test(name: string, run: () => void) { run(); cases++; console.log(`PASS ${name}`); }
function setup(p: PlayerId, hostCard = "BT1-034", foreign = false) {
    const state = RULES.createGame({ defs: { L: defs.L, F: defs.F } }, { seed: 528,
        p1: { name: "One", leader: "L", main: fifty("F"), z: [] }, p2: { name: "Two", leader: "L", main: fifty("F"), z: [] } }).state as NativeUnderState;
    const stage = (owner: PlayerId, cardId: string, zone: string) => {
        const id = state.sides[owner].zones.deck.at(-1)!; state.cards[id].cardId = cardId;
        assert.ok(moveCard(state, game, id, zone, { owner }).ok); return id;
    };
    const host = stage(p, hostCard, "hand"), source = stage(foreign ? other(p) : p, "BT23-070", "drop");
    initializeNativeUnderStanding(ctx, game, state);
    const act = (plan: NativeUnderWritePlan) => {
        const before = JSON.stringify(state), token = prepareNativeUnderMutation(ctx, game, state, plan);
        assert.equal(JSON.stringify(state), before, "preflight does not mutate live state");
        requireNativeUnderMutation(ctx, game, state, token);
        const next = projectNativeUnderWrite(ctx, game, state, plan);
        if (!next.state.battle) delete state.battle;
        Object.assign(state, next.state);
        settleNativeUnderMutation(ctx, game, state, token, next.results);
        return state.underStandingNegationHistory!;
    };
    const enter = () => act({ moves: [{ route: "flow", card: host, to: "battle", options: { owner: p, energyEntryCleanup: true } }] });
    const attach = () => act({ moves: [{ route: "under", card: source, host }] });
    const detach = () => act({ moves: [{ route: "host", card: source, to: "drop", options: { owner: state.cards[source].owner, energyEntryCleanup: true, carry: false } }] });
    return { state, host, source, stage, act, enter, attach, detach };
}
test("strict native reader keeps original unsupported record refused", () => {
    assert.throws(() => nativeUnderDefinitions(original, "BT23-070", "front"), NotYet);
    assert.equal(nativeUnderDefinitions(ctx, "BT23-070", "front").length, 1);
});
for (const p of ["p1", "p2"] as const) {
    for (const zone of ["deck", "hand", "drop", "energy", "battle"]) test(`${p} exact unattached policy inactive in ${zone}`, () => {
        const t = setup(p); t.act({ moves: [{ route: "flow", card: t.source, to: zone, options: { owner: p, energyEntryCleanup: true } }] });
        assert.equal(t.state.underStandingNegationHistory!.active.length, 0); issueNativeUnderRead(ctx, game, t.state);
    });
    for (const id of ["BT1-034", "BT1-043", "TB1-097"]) for (const foreign of [false, true]) test(`${p} independent suppression/ban ${id} foreign ${foreign}`, () => {
        const t = setup(p, id, foreign); t.enter(); t.attach();
        assert.equal(nativeUnderSkillsNegated(t.state, t.host), id === "BT1-034");
        assert.equal(nativeUnderAttackProhibited(t.state, t.host)!.master, p);
        assert.equal(nativeUnderAttackProhibited(t.state, t.host)!.source, t.source);
    });
    for (const id of ["DB1-066", "BT10-153"]) test(`${p} older ${id} yields only its generation`, () => {
        const t = setup(p, id); const first = t.enter().active[0].serial; t.attach();
        assert.equal(t.state.underStandingNegationHistory!.active.length, 1);
        assert.ok(t.state.underStandingNegationHistory!.active[0].serial > first);
        assert.equal(nativeUnderSkillsNegated(t.state, t.host), true);
    });
    test(`${p} actual epoch detach/reattach does not resurrect serial`, () => {
        const t = setup(p); t.enter(); const first = t.attach().active[0].serial; t.detach();
        assert.equal(nativeUnderAttackProhibited(t.state, t.host), null);
        assert.ok(t.attach().active[0].serial > first);
    });
    test(`${p} private draw revalidates identical ledger; order change keeps seal`, () => {
        const t = setup(p); t.enter(); t.attach(); const history = JSON.stringify(t.state.underStandingNegationHistory);
        const draw = t.state.sides[p].zones.deck[0]; assert.ok(moveCard(t.state, game, draw, "hand").ok);
        assert.equal(nativeUnderReadMatches(ctx, t.state), false); assert.throws(() => nativeUnderSkillsNegated(t.state, t.host), NotYet);
        issueNativeUnderRead(ctx, game, t.state); assert.equal(JSON.stringify(t.state.underStandingNegationHistory), history);
        t.state.sides[p].zones.deck.reverse(); assert.equal(nativeUnderReadMatches(ctx, t.state), true);
    });
    test(`${p} changed area occurrence cannot reseal through read`, () => {
        const t = setup(p); t.enter(); t.attach(); const before = JSON.stringify(t.state.underStandingNegationHistory);
        t.state.cards[t.host].zoneEpoch = (t.state.cards[t.host].zoneEpoch ?? 0) + 1;
        assert.throws(() => issueNativeUnderRead(ctx, game, t.state), NotYet);
        assert.equal(JSON.stringify(t.state.underStandingNegationHistory), before);
    });
    test(`${p} all-current newly granted keyword deleted while already suppressed`, () => {
        const t = setup(p); t.enter(); t.attach();
        t.act({ effects: [{ kind: "add", spec: { target: t.host, kind: "keyword", value: { name: "Blocker" }, until: "game" } }] });
        assert.equal(t.state.resolvedGrantDeletions!.at(-1)!.deleted, true);
        t.detach(); assert.equal(t.state.resolvedGrantDeletions!.at(-1)!.deleted, true);
    });
    test(`${p} added full original copied Auto deleted and stays deleted`, () => {
        const t = setup(p); t.enter(); t.attach();
        t.act({ effects: [{ kind: "add", spec: { target: t.host, kind: "copiedSkills", value: 0, until: "game",
            copied: { cardId: "BT7-008", side: "front", skills: [0], from: t.source } } }] });
        assert.equal(t.state.resolvedGrantDeletions!.at(-1)!.deleted, true); t.detach();
        assert.equal(t.state.resolvedGrantDeletions!.at(-1)!.deleted, true);
    });

    test(`${p} native under writer captures and settles its own actual movement record`, () => {
        const t = setup(p); t.enter();
        assert.equal(vmHost(ctx, game, t.state, []).placeUnder(t.source, t.host), true);
        assert.equal(nativeUnderSkillsNegated(t.state, t.host), true);
        assert.equal(nativeUnderAttackProhibited(t.state, t.host)!.source, t.source);
    });
    test(`${p} real flow arrival and host detach settle independent attack legality`, () => {
        const t = setup(p, "BT1-043"), events: import("../../src/lib/arena/types").GameEvent[] = [];
        moved(ctx, game, t.state, events, t.host, "battle", { owner: p });
        const host = vmHost(ctx, game, t.state, events);
        assert.equal(host.placeUnder(t.source, t.host), true);
        assert.equal(nativeUnderSkillsNegated(t.state, t.host), false);
        assert.ok(forbiddenBy(ctx, game, t.state, "attack", { player: p, card: t.host }));
        host.move(t.source, "drop", t.state.cards[t.source].owner);
        assert.equal(forbiddenBy(ctx, game, t.state, "attack", { player: p, card: t.host }), null);
        assert.ok(events.some(event => event.type === "move" && event.card === t.source));
    });
    test(`${p} native retained-frame grant is deleted and real counted prohibition matcher spends`, () => {
        const t = setup(p); t.enter(); t.attach();
        // Mechanism root only: native activation provenance is covered separately.
        const frame = freshAppliedEffectRoot(t.state, { card:t.source,master:p,skillIndex:20,ops:[],ip:0,vars:{} }, "activate");
        const host = vmHost(ctx, game, t.state, [], frame);
        host.addEffect({ target:t.host,kind:"keyword",value:{name:"Blocker"},until:"game" });
        assert.equal(t.state.resolvedGrantDeletions!.at(-1)!.deleted, true);
        host.addEffect({ target:t.host,kind:"forbid",value:0,until:"game",forbid:{what:"attack",uses:2} });
        spendProhibitionUse(ctx, game, t.state, "attack", { player:p,card:t.host });
        assert.equal(t.state.effects.find(effect => effect.kind === "forbid")!.forbid!.uses, 1);
        assert.ok(nativeUnderReadMatches(ctx,t.state));
    });
    test(`${p} unattached policy does not block dormant native stack material placement`, () => {
        const t = setup(p), incoming = t.stage(p, "F", "hand");
        issueNativeUnderRead(ctx, game, t.state);
        moved(ctx, game, t.state, [], t.host, "battle", { owner:p });
        assert.equal(resolvePlay(ctx, game, t.state, [], incoming, p, { onto:t.host }), true);
        assert.ok(t.state.cards[incoming].under.includes(t.host));
        assert.ok(nativeUnderReadMatches(ctx,t.state));
    });
    test(`${p} active standing stack top refuses before incoming play or material mutation`, () => {
        const t = setup(p), incoming = t.stage(p, "DB1-066", "hand");
        issueNativeUnderRead(ctx, game, t.state); moved(ctx, game, t.state, [], t.host, "battle", {owner:p});
        const before = JSON.stringify(t.state), events: import("../../src/lib/arena/types").GameEvent[] = [];
        assert.throws(() => resolvePlay(ctx,game,t.state,events,incoming,p,{onto:t.host}),NotYet);
        assert.equal(JSON.stringify(t.state),before);assert.equal(events.length,0);
    });
    test(`${p} unattached policy permits native Token insertion through actual token context`, () => {
        const t = setup(p), tokens = withTokens(ctx), host = vmHost(tokens,game,t.state,[]);
        const id = host.createToken(p,"Standing proof Token",10000,0,0,["Red"]);
        assert.ok(id); assert.ok(t.state.sides[p].zones.battle.includes(id));
        assert.ok(nativeUnderReadMatches(tokens,t.state));
    });
    test(`${p} unattached policy permits ordinary native Hidden changes`, () => {
        const t = setup(p); moved(ctx,game,t.state,[],t.host,"battle",{owner:p});
        const host = vmHost(ctx,game,t.state,[]); host.setHidden(t.host,true); host.setHidden(t.host,false);
        assert.equal(t.state.cards[t.host].hidden,false); assert.ok(nativeUnderReadMatches(ctx,t.state));
    });
    test(`${p} native Token creation preflights unknown context and active source qualification`, () => {
        const t = setup(p), before=JSON.stringify(t.state), events: import("../../src/lib/arena/types").GameEvent[]=[];
        assert.throws(() => vmHost(ctx,game,t.state,events).createToken(p,"Missing definition Token",10000,0,0,["Red"]),NotYet);
        assert.equal(JSON.stringify(t.state),before);assert.deepEqual(events,[]);
        const u=setup(p,"DB1-066");u.enter();const tokens=withTokens(ctx);
        const id=vmHost(tokens,game,u.state,[]).createToken(p,"Suppressed Token",10000,0,0,["Red"]);
        assert.ok(id);assert.equal(nativeUnderSkillsNegated(u.state,id),true);assert.ok(nativeUnderReadMatches(tokens,u.state));
    });
    test(`${p} dormant native top promotion uses actual up and down records`, () => {
        const t=setup(p), incoming=t.stage(p,"F","hand");issueNativeUnderRead(ctx,game,t.state);t.enter();
        const host=vmHost(ctx,game,t.state,[]);assert.equal(host.placeUnder(incoming,t.host),true);
        assert.equal(host.placeOnTop(incoming,t.host),true);assert.ok(t.state.cards[incoming].under.includes(t.host));
        assert.ok(nativeUnderReadMatches(ctx,t.state));
    });
    test(`${p} dormant control transfer uses actual movement and loan expiry is bounded before mutation`, () => {
        const t=setup(p);t.enter();const events: import("../../src/lib/arena/types").GameEvent[]=[];
        const host=vmHost(ctx,game,t.state,events);host.move(t.host,"battle",other(p));
        host.addEffect({target:t.host,kind:"control",value:0,until:"turn",control:{from:p}});
        const loan=JSON.stringify(t.state), loanEvents=events.length;
        assert.throws(()=>expireStandingNegationBatch(ctx,t.state,events,(state,ev)=>endEffects(state,ev,"turn"),[{kind:"end",until:"turn"}]),NotYet);
        assert.equal(JSON.stringify(t.state),loan);assert.equal(events.length,loanEvents);
        host.move(t.host,"battle",p);assert.ok(t.state.sides[p].zones.battle.includes(t.host));
        t.attach();const before=JSON.stringify(t.state), count=events.length;
        assert.throws(()=>host.move(t.host,"battle",other(p)),NotYet);
        assert.equal(JSON.stringify(t.state),before);assert.equal(events.length,count);
    });
    test(`${p} scripted grant preserves staged R495 root independently of bare producers`, () => {
        const t = setup(p); t.enter(); t.attach();
        const frame = freshAppliedEffectRoot(t.state, {card:t.source,master:p,skillIndex:20,ops:[],ip:0,vars:{}}, "activate");
        const spec = { target:t.host,kind:"keyword" as const,value:{name:"Blocker" as const},until:"game" as const };
        const before = JSON.stringify(frame);
        const token = prepareNativeUnderMutation(ctx, game, t.state, {effects:[{kind:"scriptAdd",spec,frame}]});
        assert.equal(JSON.stringify(frame), before);
        requireNativeUnderMutation(ctx, game, t.state, token);
        recordAppliedEffect(t.state, frame, t.host, () => addEffect(t.state, [], spec));
        settleNativeUnderMutation(ctx, game, t.state, token);
        assert.ok(Object.keys(t.state.appliedEffectOwnership!).length);
        assert.equal(t.state.resolvedGrantDeletions!.at(-1)!.deleted, true);
    });
    test(`${p} retained producer frame cannot change between projection and live writer`, () => {
        const t=setup(p);t.enter();t.attach();
        const frame=freshAppliedEffectRoot(t.state,{card:t.source,master:p,skillIndex:20,ops:[],ip:0,vars:{}},"activate");
        const token=prepareNativeUnderMutation(ctx,game,t.state,{effects:[{kind:"scriptAdd",frame,spec:{target:t.host,kind:"power",value:1000,until:"turn"}}]});
        frame.vars={changed:[t.host]};
        const before=JSON.stringify(t.state);
        assert.throws(()=>requireNativeUnderMutation(ctx,game,t.state,token),NotYet);
        assert.equal(JSON.stringify(t.state),before);
    });
    test(`${p} captured scripted producer cannot be replaced by bare add`, () => {
        const t = setup(p); t.enter(); t.attach();
        const frame = freshAppliedEffectRoot(t.state, {card:t.source,master:p,skillIndex:20,ops:[],ip:0,vars:{}}, "activate");
        const spec = {target:t.host,kind:"power" as const,value:1000,until:"turn" as const};
        const token = prepareNativeUnderMutation(ctx, game, t.state, {effects:[{kind:"scriptAdd",spec,frame}]});
        requireNativeUnderMutation(ctx, game, t.state, token); addEffect(t.state, [], spec);
        assert.throws(() => settleNativeUnderMutation(ctx, game, t.state, token), NotYet);
    });
    test(`${p} late unproved immunity reactivation refuses before source departure`, () => {
        const t = setup(p,"BT1-043");
        t.enter();
        // Staged external negation is a qualification mechanism, not a legal in-play negation of Whis.
        t.act({effects:[{kind:"add",spec:{target:t.host,kind:"negateSkills",value:0,until:"turn"}}]});
        t.attach(); t.act({effects:[{kind:"end",until:"turn"}]});
        const before=JSON.stringify(t.state);
        assert.throws(() => t.detach(), NotYet); assert.equal(JSON.stringify(t.state),before);
    });
    test(`${p} whole source disable and actual expiry use original generation history`, () => {
        const t=setup(p);t.enter();const first=t.attach().active[0].serial;
        t.act({effects:[{kind:"add",spec:{target:t.source,kind:"negateSkills",value:0,until:"turn"}}]});
        assert.equal(nativeUnderAttackProhibited(t.state,t.host),null);
        const next=t.act({effects:[{kind:"end",until:"turn"}]}).active[0].serial;assert.ok(next>first);
    });
    test(`${p} real pile release removes only actual under-source generation`, () => {
        const t=setup(p);t.enter();t.attach();
        t.act({moves:[{route:"flow",card:t.host,to:"drop",options:{owner:p,energyEntryCleanup:true}}]});
        assert.ok(t.state.sides[t.state.cards[t.source].owner].zones.drop.includes(t.source));
        assert.equal(t.state.underStandingNegationHistory!.active.length,0);
    });
    test(`${p} unswept fresh grant cannot acquire a read seal`, () => {
        const t = setup(p); t.enter(); t.attach(); addEffect(t.state, [], { target: t.host, kind: "keyword", value: { name: "Blocker" }, until: "turn" });
        assert.throws(() => issueNativeUnderRead(ctx, game, t.state), NotYet);
    });
    test(`${p} missing and dual history cannot be initialized or sealed`, () => {
        const t = setup(p); t.state.turn = 1; delete t.state.underStandingNegationHistory;
        assert.throws(() => initializeNativeUnderStanding(ctx, game, t.state), NotYet);
        assert.throws(() => issueNativeUnderRead(ctx, game, t.state), NotYet);
        const u = setup(p); u.state.standingNegationHistory = {} as never;
        assert.throws(() => issueNativeUnderRead(ctx, game, u.state), NotYet);
    });

    test(`${p} read seal binds game ID and the original rules definition`, () => {
        const t=setup(p);t.state.game="fusion";
        assert.equal(nativeUnderReadMatches(ctx,t.state),false);
        assert.throws(() => nativeUnderSkillsNegated(t.state,t.host),NotYet);
        assert.throws(() => issueNativeUnderRead(ctx,game,t.state),NotYet);
        const u=setup(p), definition=structuredClone(game);issueNativeUnderRead(ctx,definition,u.state);
        definition.zones.deck.visibility="all";assert.equal(nativeUnderReadMatches(ctx,u.state),false);
        assert.throws(() => nativeUnderSkillsNegated(u.state,u.host),NotYet);
    });
    test(`${p} unused definitions do not select a new family`, () => {
        const state=RULES.createGame({defs:{L:defs.L,F:defs.F}},{seed:1,p1:{name:"one",leader:"L",main:fifty("F"),z:[]},p2:{name:"two",leader:"L",main:fifty("F"),z:[]}}).state as NativeUnderState;
        initializeNativeUnderStanding(ctx,game,state);assert.equal(state.underStandingNegationHistory,undefined);
    });
    test(`${p} original Goku participant and Combo threshold settle as one native plan`, () => {
        const t=setup(p,"BT20-086"), old=t.state.sides[p].zones.leader[0];
        const prum=t.stage(other(p),"DB2-086","hand"), own=Array.from({length:8},()=>t.stage(p,"F","hand"));
        t.act({moves:[{route:"flow",card:old,to:"drop",options:{owner:p,energyEntryCleanup:true}},{route:"flow",card:t.host,to:"leader",options:{owner:p,energyEntryCleanup:true}}]});
        t.act({moves:[{route:"flow",card:prum,to:"combo",options:{owner:other(p),energyEntryCleanup:true}}]});
        const guard=t.state.sides[other(p)].zones.leader[0];t.act({battle:{kind:"begin",attacker:t.host,guard}});
        for(let i=0;i<8;i++){
            t.act({moves:[{route:"flow",card:own[i],to:"combo",options:{owner:p,energyEntryCleanup:true}}]});
            assert.equal(nativeUnderSkillsNegated(t.state,prum),i>=6);
        }
        const serial=t.state.underStandingNegationHistory!.active[0].serial;
        t.act({moves:[{route:"flow",card:guard,to:"drop",options:{owner:other(p),energyEntryCleanup:true}}]});
        assert.equal(t.state.underStandingNegationHistory!.observation.area.battle!.guard.present,false);
        assert.equal(t.state.underStandingNegationHistory!.active[0].serial,serial);
        t.act({battle:{kind:"end"}});assert.equal(nativeUnderSkillsNegated(t.state,prum),false);
    });
    for (const mutation of ["danglingZone", "duplicateZone", "crossZone", "danglingPile", "duplicatePile", "dictionary"] as const) test(`${p} ${mutation} never silently omitted`, () => {
        const t = setup(p);
        if (mutation === "danglingZone") t.state.sides[p].zones.hand.push("missing");
        if (mutation === "duplicateZone") t.state.sides[p].zones.hand.push(t.host);
        if (mutation === "crossZone") t.state.sides[other(p)].zones.hand.push(t.host);
        if (mutation === "danglingPile") t.state.cards[t.host].under.push("missing");
        if (mutation === "duplicatePile") t.state.cards[t.host].under.push(t.source);
        if (mutation === "dictionary") t.state.cards[t.host].id = "different";
        assert.throws(() => nativeUnderPhysicalFacts(t.state), NotYet);
        assert.throws(() => issueNativeUnderRead(ctx, game, t.state), NotYet);
    });
    for (const corruption of ["tokenClone", "otherBoard", "wrongRecord", "extraEffect", "participant", "relation", "staleInput"] as const) test(`${p} captured writer rejects ${corruption}`, () => {
        const t = setup(p), plan: NativeUnderWritePlan = { moves: [{ route: "flow", card: t.host, to: "battle", options: { owner: p, energyEntryCleanup: true } }] };
        const token = prepareNativeUnderMutation(ctx, game, t.state, plan);
        if (corruption === "tokenClone") { assert.throws(() => requireNativeUnderMutation(ctx, game, t.state, structuredClone(token)), NotYet); return; }
        if (corruption === "otherBoard") { assert.throws(() => requireNativeUnderMutation(ctx, game, setup(p).state, token), NotYet); return; }
        if (corruption === "staleInput") { addEffect(t.state, [], { target: t.host, kind: "power", value: 1, until: "turn" }); assert.throws(() => requireNativeUnderMutation(ctx, game, t.state, token), NotYet); return; }
        requireNativeUnderMutation(ctx, game, t.state, token); const projected = projectNativeUnderWrite(ctx, game, t.state, plan); Object.assign(t.state, projected.state);
        if (corruption === "wrongRecord") projected.results[0].to = "drop";
        if (corruption === "extraEffect") addEffect(t.state, [], { target: t.host, kind: "power", value: 1, until: "turn" });
        if (corruption === "participant") t.state.battle = { attacker: t.host, guard: t.state.sides[other(p)].zones.leader[0], target: t.host, step: "offense", negated: false, blockerOffered: false, counters: [] };
        if (corruption === "relation") assert.ok(moveCard(t.state, game, t.source, "drop", { under: t.host }).ok);
        const before = JSON.stringify(t.state); assert.throws(() => settleNativeUnderMutation(ctx, game, t.state, token, projected.results), NotYet); assert.equal(JSON.stringify(t.state), before);
    });
}
console.log(`under-native-contract-5: ${cases} contract cases PASS (actual exact loader output; staged boards and synthetic roots labeled)`);
