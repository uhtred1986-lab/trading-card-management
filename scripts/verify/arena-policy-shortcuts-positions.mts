/**
 * #645 (plan O2-02): the positions the free-choice shortcut proofs walk
 * (`arena-policy-shortcuts.mts`, and the recorder that wrote
 * `fixtures/arena-policy-shortcuts/before.json` from origin/main's `freeChoice`).
 *
 * Every position is a (context, engine state, legal list, actor) the online
 * opponent could be asked about — `chooseMove` is only ever called with the
 * seat the engine is asking. Sources:
 *
 *   641      #641's fixed-seed game, 120 moves
 *   642:<id> every #642 scenario, at every position it reaches
 *   644/<n>  the compound-choice fixture (Red/Blue decks of cost 1-2), 8 seeds
 *   rules/<n>
 *            a synthetic deck of mixed cost, colour and one X-cost Unison, on a
 *            plain `EngineContext` exactly as the online game holds it, on both
 *            engines, 16 seeds — enough to reach redraws, off-colour charges and tied charge scores
 *   empower  the [Empower] carry question, staged as `keywords.ts` stages it
 *            (rules engine; the harness is imported only when asked for)
 *
 * Deterministic: seeds and the mover (`pick`) are fixed, so a position's label means the
 * same position on every run.
 */
import { RULES } from "../../src/lib/arena/vm";
import type { EngineState } from "../../src/lib/arena/engines";
import { createPinnedMatch, applyMove, legalMoves } from "../../src/lib/arena/browser.ts";
import { defsFrom } from "../../src/lib/arena/vm/common";
import type { Action, CardDef, EngineContext, LegalAction, PlayerId } from "../../src/lib/arena/types";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { pick } from "./arena-browser-scenario.ts";
import { runScenario, scenarioIds } from "./arena-scenarios.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_SEED } from "./arena-policy-fixture.ts";

export interface Position {
  label: string;
  ctx: EngineContext;
  state: EngineState;
  legal: LegalAction[];
  /** The seat the engine is asking. */
  seat: PlayerId;
  /** Set for positions held as a pinned match (the policy boundary can read those). */
  match?: import("../../src/lib/arena/browser.ts").PinnedMatch;
}

const card = (id: string, o: Partial<CardDef> = {}): CardDef => ({
  id, name: id, type: "BATTLE", colors: ["Red"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 1, comboPower: 5000, skill: null, characters: [], traits: [], ...o,
});

/** Costs 0-6 over four colours, a few colourless-of-leader ones, and an X-cost Unison. */
const SYNTH: CardDef[] = [
  card("L-RED", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  card("L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  ...[0, 1, 2, 3, 4, 5, 6].flatMap((cost) => [
    card(`R${cost}`, { colors: ["Red"], energyCost: cost }),
    card(`B${cost}`, { colors: ["Blue"], energyCost: cost }),
  ]),
  card("G3", { colors: ["Green"], energyCost: 3 }),
  card("Y5", { colors: ["Yellow"], energyCost: 5 }),
  card("RB2", { colors: ["Red", "Blue"], energyCost: 2 }),
  card("U-X", { type: "UNISON", colors: ["Red"], energyCost: "X", power: 5000, comboCost: null, comboPower: null }),
];
const SYNTH_CTX: EngineContext = { defs: defsFrom(SYNTH), scripts: {} };

/** A 50-card main deck: seeds alternate cheap-heavy and expensive-heavy so both mulligan answers occur. */
function deckFor(seed: number, side: 0 | 1): string[] {
  const cheap = (seed + side) % 2 === 0;
  const pool = cheap
    ? ["R0", "R1", "B1", "R2", "RB2", "B2", "R3", "B3", "G3", "U-X"]
    : ["R4", "B4", "R5", "Y5", "B5", "R6", "B6", "R3", "G3", "R1", "U-X"];
  return Array.from({ length: 50 }, (_, i) => pool[(i * 7 + seed * 3 + side) % pool.length]);
}

const actorOf = (state: EngineState): PlayerId | null => {
  if (state.phase === "over") return null;
  return (state.prompt as { player?: PlayerId }).player ?? null;
};

export async function collectPositions(options: { empower?: boolean } = {}): Promise<Position[]> {
  const out: Position[] = [];
  const add = (label: string, ctx: EngineContext, state: EngineState, legal: LegalAction[], match?: Position["match"]) => {
    const seat = actorOf(state);
    if (!seat || !legal.length) return;
    out.push({ label, ctx, state, legal, seat, ...(match ? { match } : {}) });
  };

  // 641 and 642.
  const bundle641 = await fixtureBundle();
  {
    let { match } = await createPinnedMatch({ bundle: bundle641, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION });
    add("641/0", match.ctx, match.state, legalMoves(match), match);
    for (let n = 1; n <= 120 && match.state.phase !== "over"; n++) {
      const action = pick(n, legalMoves(match));
      if (!action) break;
      match = applyMove(match, action).match;
      add(`641/${n}`, match.ctx, match.state, match.state.phase === "over" ? [] : legalMoves(match), match);
    }
  }
  for (const id of scenarioIds()) {
    let n = 0;
    await runScenario(id, {
      bundle: bundle641,
      interpreterRevision: FIXTURE_REVISION,
      observe: (match) => add(`642:${id}/${n++}`, match.ctx, match.state, match.state.phase === "over" ? [] : legalMoves(match), match),
    });
  }

  // 644's fixture decks, several seeds.
  const bundle644 = await policyFixtureBundle();
  for (let k = 0; k < 8; k++) {
    let { match } = await createPinnedMatch({ bundle: bundle644, seed: POLICY_FIXTURE_SEED + k, interpreterRevision: POLICY_FIXTURE_REVISION });
    add(`644/${k}/0`, match.ctx, match.state, legalMoves(match), match);
    for (let n = 1; n <= 90 && match.state.phase !== "over"; n++) {
      const action = pick(n + k, legalMoves(match));
      if (!action) break;
      match = applyMove(match, action).match;
      add(`644/${k}/${n}`, match.ctx, match.state, match.state.phase === "over" ? [] : legalMoves(match), match);
    }
  }

  // The synthetic deck on a plain context — the online game's own shape.
  for (const engineId of ["rules"] as const) {
    const engine = RULES;
    for (let k = 0; k < 16; k++) {
      let state = engine.createGame(SYNTH_CTX, { seed: 1000 + k, p1: { name: "You", leader: "L-RED", main: deckFor(k, 0) }, p2: { name: "Claude", leader: "L-BLUE", main: deckFor(k, 1) } }).state;
      let legal = engine.legalActions(SYNTH_CTX, state);
      add(`${engineId}/${k}/0`, SYNTH_CTX, state, legal);
      for (let n = 1; n <= 70 && state.phase !== "over"; n++) {
        const action = pick(n + k, legal);
        if (!action) break;
        state = engine.apply(SYNTH_CTX, state, action).state;
        legal = state.phase === "over" ? [] : engine.legalActions(SYNTH_CTX, state);
        add(`${engineId}/${k}/${n}`, SYNTH_CTX, state, legal);
      }
    }
  }

  if (options.empower) {
    const h = await import("./harness");
    {
      const { CTX, DEFS, IMPL, arenaG, findG } = h;
      const play = (s: EngineState, a: Action) => IMPL.apply(CTX, s, a).state;
      for (const [id, skill] of [["EMP", "[Empower Red 2]"], ["EMP1", "[Empower Red 1]"], ["EMPANY", "[Empower 2]"]] as const) {
        DEFS[id] = { ...DEFS.U1, id, name: id, skill };
        let s = arenaG({ hand: ["U1", id], energy: ["V1", "V1", "V1", "V1", "V1"] });
        s = play(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "U1"), x: 3 });
        s = play(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", id), x: 1 });
        add(`empower/${id}`, CTX, s, IMPL.legalActions(CTX, s));
        delete DEFS[id];
      }
    }
  }
  return out;
}
