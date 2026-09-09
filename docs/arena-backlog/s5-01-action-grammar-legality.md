---
title: Arena: ACTION declarations and generic legalActions/rejectedActions from WHEN, FOR, COST and REFUSE
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-lang, phase:rules-stage5, model:opus-5
stage: 5
---
**Source:** plan Stage 5 (`ACTION play { WHEN prompt main AND turn(you); FOR card IN you.[hand] WHERE type = BATTLE; COST pay(energy(card)); DO move(card, [battle]); fire played; REFUSE … }`); `docs/arena-workflow-spec.md` §3.2 (one rejection per card per action type; per skill line for an activation) and the two places that assert it — `scripts/verify/harness.ts` and `scripts/arena-playthrough.mts`; `legalActions`/`rejectedActions` in `src/lib/arena/engine/engine.ts`.

**Problem.** Legality is a predicate per action with a hand-written `whyNot*` twin per predicate. The rules engine must derive both from one declaration, so that adding an action to a game is a paragraph in `actions.rules` and the refusal comes for free.

**Build.**
1. The `ACTION` form in the `DEFINE` grammar (Stage 3 declared it; this issue gives it semantics): `WHEN` (the prompt and turn it is offered in), `FOR` (the candidates — a selector), `COST` (the language's cost items), `DO` (a program), `REFUSE` (named requirements with a `Requirement` shape each, in the order the legality check runs).
2. `vm/actions.ts`: `legalActions` = for each declared action whose `WHEN` holds, each `FOR` candidate whose `REFUSE` list is empty and whose `COST` is payable; `rejectedActions` = the first failing requirement per candidate — **one per card per action type**, and one per skill line for `activate`, as an interpreter property. The `Requirement` shapes are the existing ones so `wording.ts` needs no change.
3. `apply` charges `COST`, runs `DO`, fires the declared events; `IllegalAction` on anything not in `legalActions` (the contract's "a client picks a move by index" rule depends on this).

**Out of scope.** The DBS actions themselves (next issues) — this issue ships with one, `pass`, re-declared, and a test action.

**Acceptance.**
- Gate; `npm test`: the invariant `legal ∩ rejected = ∅` and the one-per-card rule hold on the rules engine for a fixture with three candidates and two refusals; `harness.ts`'s assertion runs on both engines.
- `docs/arena-ruleset-spec.md` gains "how an action is declared" with the `play` example.
