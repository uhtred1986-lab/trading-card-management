/** R527 saved boundaries. Mutation probes are corruption, not gameplay paths. */
import assert from "node:assert/strict";
import { stepScript } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import { fresh, begin, tap, clone, game } from "./incremental-look-harness-5";
import { requireInspectionPrompt, captureLookSource, activateLook, stepIncrementalLook } from "../../src/lib/arena/vm/incremental-look";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { ScriptFrame } from "../../src/lib/arena/vm/script";
import type { Fixture } from "./incremental-look-harness-5";
let cases = 0;
function corrupt(f: Fixture, mutate: (s: VmState, frame: ScriptFrame) => void) { const state = clone(f.state), frame = state.programs.find(f => f.lookExecution)!; mutate(state, frame); const before = JSON.stringify(state); assert.throws(() => requireInspectionPrompt(f.ctx, game, state), e => e instanceof Error && /R527|unreviewed|rebuild/.test(e.message)); assert.equal(JSON.stringify(state), before); cases++; }
for (const p of ["p1", "p2"] as const) {
    const f = fresh(p);
    begin(f);
    tap(f, 0);
    const mutations: Array<(s: VmState, frame: ScriptFrame) => void> = [
        (_, x) => { x.incrementalLook!.mode = { ip: 3, index: 0 }; }, (_, x) => { x.incrementalLook!.order = []; },
        (_, x) => { delete x.lookExecution; }, (_, x) => { x.lookExecution = null as never; }, (_, x) => { x.lookExecution!.active = undefined; }, (_, x) => { x.lookExecution!.source = null as never; }, (_, x) => { x.lookExecution!.source.script.ops = [null] as never; }, (_, x) => { x.lookExecution!.source.skill.cost = null as never; },
        (_, x) => { delete x.incrementalLook; }, (_, x) => { x.incrementalLook = null as never; }, (_, x) => { x.incrementalLook!.deck = [null] as never; }, (_, x) => { x.incrementalLook!.maximum++; }, (_, x) => { x.incrementalLook!.inspected.push(x.incrementalLook!.deck[3]); }, (_, x) => { x.incrementalLook!.inspected.reverse(); x.incrementalLook!.inspected.push(x.incrementalLook!.inspected[0]); }, (_, x) => { x.incrementalLook!.op.side = "opponent"; }, (_, x) => { x.incrementalLook!.definitions = {}; }, (_, x) => { x.incrementalLook!.phase = "complete"; }, (_, x) => { x.ip = 1; }, (_, x) => { x.ops = []; }, (_, x) => { x.vars.looked = [f.top[0]]; }, (_, x) => { x.awaiting = "mode"; }, (_, x) => { x.arrivalResume = { frame: clone(x) } as never; },
        s => { s.cards[f.top[0]].zoneEpoch = (s.cards[f.top[0]].zoneEpoch ?? 0) + 1; }, s => { s.cards[f.top[0]].hiddenCount = (s.cards[f.top[0]].hiddenCount ?? 0) + 1; }, s => { s.sides[p].zones.deck.reverse(); }, s => { s.programs = []; }, s => { if (s.prompt.kind === "chooseMode")
            s.prompt.options = ["Stop looking"]; }, s => { if (s.prompt.kind === "chooseMode")
            s.prompt.inspection = "forged"; }, s => { if (s.prompt.kind === "chooseMode")
            s.prompt.player = f.q; },
    ];
    for (const mutate of mutations)
        corrupt(f, mutate);
    for (let i = 1; i < 7; i++)
        tap(f, 0);
    tap(f, 0);
    corrupt(f, s => { if (s.prompt.kind === "chooseCards")
        s.prompt.choice.candidates.push(f.top[6]); });
    corrupt(f, s => { if (s.prompt.kind === "chooseCards")
        s.prompt.choice.max = 7; });
    const t = fresh(p, "EX02-01");
    begin(t);
    tap(t, 0);
    tap(t, 0);
    tap(t, 0);
    t.take({ type: "choose", player: p, cards: [] });
    corrupt(t, (_, x) => { x.incrementalLook!.choices.c0.candidates = []; });
    corrupt(t, (_, x) => { x.incrementalLook!.mode = { index: 1, ip: 3 }; });
    corrupt(t, (_, x) => { x.lookExecution!.source.script.ops[3] = { op: "chooseMode", modes: [null] } as never; });
    tap(t, 1);
    assert.equal(t.state.prompt.kind, "chooseCards");
    corrupt(t, (_, x) => { x.vars["arrange@3"] = [t.top[2]]; });
    corrupt(t, (_, x) => { x.incrementalLook!.order = [t.top[0], t.top[0]]; x.vars["arrange@3"] = [t.top[0], t.top[0]]; });
    corrupt(t, s => { if (s.prompt.kind === "chooseCards")
        s.prompt.choice.candidates.push(t.top[2]); });
    corrupt(t, (_, x) => { x.moveLoop = { kind: "moveTo", ids: [t.top[2]], index: 0, to: "hand", reason: "effect" }; });
    const replaced = fresh(p);
    begin(replaced);
    stepScript(vmHost(replaced.ctx, game, replaced.state, []), { card: replaced.source, master: p, ops: [{ op: "replaceLeave", target: { var: "pick" }, to: "hand", optional: true, until: "turn" }], ip: 0, vars: { pick: [replaced.top[0]] } });
    for (let i = 0; i < 7; i++)
        tap(replaced, 0);
    tap(replaced, 0);
    replaced.take({ type: "choose", player: p, cards: [replaced.top[0]] });
    assert.equal(replaced.state.prompt.kind, "replaceMove");
    corrupt(replaced, (_, x) => { const look = x.incrementalLook!, bad = look.inspected[6]; look.choices.c0.ids = [bad.card]; look.choices.c0.candidates.push(bad); x.vars.c0 = [bad.card]; x.vars.looked = look.inspected.map(c => c.card).filter(id => id !== bad.card); x.moveLoop!.ids = [bad.card]; });
    corrupt(replaced, (_, x) => { x.moveLoop!.ids = [replaced.top[8]]; });
    corrupt(replaced, (_, x) => { x.moveLoop!.index = 2; });
    tap(replaced, 0);
    assert.equal(replaced.state.prompt.kind, "main");
    assert.ok(replaced.state.sides[p].zones.hand.includes(replaced.top[0]));
    cases++;
    // Empty deck is a direct kernel contract, since ordinary native zero-deck
    // state-based processing would end a match before this Auto can resolve.
    const empty = fresh(p);
    moveCard(empty.state, game, empty.source, "battle", { owner: p });
    for (const id of [...empty.state.sides[p].zones.deck])
        moveCard(empty.state, game, id, "warp", { owner: p });
    const showing = skillsShowing(empty.ctx, empty.state, empty.source), skill = showing.skills.find(s => s.index === 0)!, script = showing.scripts.bySkill[0], frame: ScriptFrame = { card: empty.source, master: p, skillIndex: 0, ops: clone(script.ops), ip: 0, vars: {}, lookExecution: { source: captureLookSource(empty.ctx, empty.state, empty.source, p, skill, script) } };
    activateLook(frame, false);
    assert.equal(stepIncrementalLook(empty.ctx, game, empty.state, frame, script.ops[0] as never), "wait");
    assert.deepEqual(empty.state.prompt.kind === "chooseMode" && empty.state.prompt.options, ["Continue"]);
    assert.equal(requireInspectionPrompt(empty.ctx, game, empty.state)?.incrementalLook?.maximum, 0);
    cases++;
}
console.log(`${cases} incremental look saved/empty contracts`);
