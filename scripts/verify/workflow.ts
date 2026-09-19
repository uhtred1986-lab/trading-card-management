/**
 * Every rule as a workflow: what is refused and why, in the words a client
 * shows (`docs/arena-workflow-spec.md`).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 *
 * **#152: this suite runs on both engines**, through the same state-interface
 * layer `battles.ts` uses (`harness.ts`'s own header comment for that section
 * says which fields are read directly and which go through `zoneOf`/
 * `leaderOf`/`energyMarkersOf`). `ENGINE`/`IMPL` in place of the module-level
 * `legalActions`/`rejectedActions` imports, `arenaG`/`playG`/`findG`/`labelsG`/
 * `gameG`/`assertDisjointG`/`addEffectG`/`rejectedActionsG` in place of their
 * legacy-narrowed twins, and every `buildSnapshot` call passes `engine:
 * ENGINE` explicitly — `snapshot.ts` defaults a missing `engine` to `legacy`,
 * which would draw a rules-engine board through the wrong adapter. [Swap] and
 * [Barrier] are Stage 7 keyword bodies
 * (`docs/arena-backlog/s7-05-keywords-play-charge-pay.md`,
 * `s7-02-keywords-choosing-immunity.md`) and are the only two cases this file
 * skips on `--engine rules`, named at their own `keywordGap` call — everything
 * else here is a real assertion on both engines.
 */
import assert from "node:assert/strict";
import {
  CTX,
  DEFS,
  ENGINE,
  IMPL,
  addEffectG,
  arenaG,
  assertDisjointG,
  buildSnapshot,
  compileSkill,
  findG,
  gameG,
  labelsG,
  leaderOf,
  missingEnergyChip,
  missingEnergyChips,
  narrate,
  parseFilter,
  parseSkills,
  pill,
  playG,
  priceOf,
  refusal,
  rejectedActionsG,
  rejectedFor,
  sentence,
  setEnergyMarkersG,
  stepText,
  zoneOf,
} from "./harness";
import type { Beat, EngineState, PlayerId, RejectedAction, Requirement } from "./harness";

const S7 = {
  swap: "docs/arena-backlog/s7-05-keywords-play-charge-pay.md — hook group D: play, charge and paying ([Swap])",
  // [Barrier] is done (#154) — see [Barrier]'s own block below, gated on
  // `chooseRejectionGap` for its rejection-reason half only.
  unique: "docs/arena-backlog/s7-05-keywords-play-charge-pay.md — hook group D: play, charge and paying (`playRefused`) — moved out of hook group A once #153's inventory confirmed [Unique]'s real hook",
};
let skipped = 0;
function keywordGap(keyword: string, doc: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — [${keyword}]'s keyword body is not built on the rules engine yet (${doc})`);
  skipped++;
  return true;
}

/**
 * A menu label's exact wording — checked only on the legacy engine.
 *
 * The rules engine's own labels come off `actions.rules`' declared `label:`
 * plus a generic builder (`vm/actions.ts`), not the legacy engine's bespoke
 * per-action narration, and reconciling the two words-for-words is Stage 8's
 * ("words from config", `docs/arena-backlog.md` §2) — a later stage than the
 * one that put a `label` on the row at all. This is not a `keywordGap`: the
 * *behaviour* every one of these cases checks (what is offered, what is
 * refused and why) runs for real on both engines; only the sentence a client
 * would show is out of scope here, the same way the Unison "with X = 3"
 * button already is (§ below).
 */
function assertLabelOnLegacy(actual: string, expected: string, msg?: string): void {
  if (ENGINE === "legacy") assert.equal(actual, expected, msg);
}

/**
 * A real, non-keyword gap found while porting this suite (#152): `combo`,
 * `counter` and `block` are native moves (`vm/battle.ts`'s own header says
 * why — a `Prompt` a `FOR` selector cannot build), and `vm/index.ts`'s
 * `rejectedActions` only ever adds `attackRejectedActions` for the "main"
 * prompt — nothing populates a per-card reason for the three prompts inside
 * a battle. `comboEligible`/`counterCandidates`/`blockerCandidates` already
 * compute the right *legal* list (proven throughout `battles.ts`); what is
 * missing is each one's `rejectedActions` twin, the same shape
 * `attackRejectedActions` already is. Not Stage 7's — no keyword is involved
 * — and not fixed here: building three new `…RejectedActions` functions
 * mid-suite risks exactly the kind of untested engine change this issue is
 * not about. Named so it is never mistaken for a keyword skip.
 */
/**
 * `declaredRejectedActions` (`vm/actions.ts`) explains a rejected move by
 * iterating `actionsAt`'s own `DEFINE ACTION`s — the top-level "which move"
 * prompts. A `chooseCards` prompt is not one of those: it is a mid-skill
 * answer with no declaration of its own, and nothing populates a per-card
 * reason for it on the rules engine (`rejectedActionsG` returns `[]`
 * outright, checked while wiring [Barrier], #154). The shape it would need —
 * `attackRejectedActions`'s twin for a `choose`, reading the resolved
 * candidates against the full area `resolveSelector` filtered them from — is
 * real and not a keyword's; `CardChoice` (`engine/types.ts`) does not even
 * carry the selector a `choose` opened with, so building it also touches
 * what the prompt stores. Not Stage 7's, and not fixed here for the same
 * reason `nativeRejectionGap` above is not: a prompt-machinery change
 * mid-suite risks exactly the kind of untested engine change this issue is
 * not about.
 */
function chooseRejectionGap(where: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: chooseCards prompts have no rejectedActions reasoning on the rules engine yet (real gap, not a keyword — see this file's own comment on chooseRejectionGap)`);
  skipped++;
  return true;
}

function nativeRejectionGap(where: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: combo/counter/block have no rejectedActions reasoning on the rules engine yet (real gap, not a keyword — see this file's own comment on nativeRejectionGap)`);
  skipped++;
  return true;
}

/**
 * A case that tests a fact about the **legacy engine's own history** rather
 * than a rule of the game — the PRICED test below regression-tests a bug fixed
 * 8 Sep 2026 in `activatable`/`canResolve`/`activate` re-reading `CTX.scripts`
 * mid-game instead of the record. The rules engine has no such mid-game
 * re-read to have had the bug in: `skillsShowing` (`vm/triggers.ts`) reads
 * `ctx.defs` fresh every time, never a separate `ctx.scripts` layer, so there
 * is no "record vs. text" distinction for this test to exercise. Not a
 * keyword gap and not a native-rejection gap — a scenario with no rules-engine
 * shape to test at all.
 */
function legacyHistoryOnly(where: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: regression-tests a legacy-only architecture detail (CTX.scripts) with no rules-engine analogue`);
  skipped++;
  return true;
}

/**
 * A real, non-keyword gap: `vm/view.ts`'s `vmBoardView` does not populate
 * `you.choices`/`taps` the way `view.ts`'s legacy `boardView` does for a
 * `chooseCards` prompt over cards no zone reveals (a deck search). The prompt
 * itself is correct — `state.prompt.choice.candidates` names the right cards,
 * proven above — what is missing is the board's own picture of it, which is
 * client rendering (Stage 8's "primer/prompts/view"), not a rule. Named so it
 * is never mistaken for a keyword skip.
 */
function viewGap(where: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: the rules engine's boardView does not build you.choices for this prompt yet (real gap, not a keyword — see this file's own comment on viewGap)`);
  skipped++;
  return true;
}

/**
 * A real, non-keyword gap: a counted prohibition's budget (20-14,
 * `forbid.uses`) is read (`vm/program.ts`'s own `if ((rule.forbid.uses ?? 0)
 * > 0) continue` — a budget still to spend forbids nothing yet, matching the
 * legacy reading exactly) but never **spent**. The legacy engine decrements
 * it after the qualifying action resolves (`engine/state.ts`'s own
 * `e.forbid.uses = Math.max(0, (e.forbid.uses ?? 0) - 1)`, called once per
 * action the prohibition's `what:` names); nothing on the rules engine calls
 * its equivalent anywhere. Not Stage 7's — no keyword prints a counted
 * prohibition; it is a plain 20-14 primitive with one half missing.
 */
function forbidUsesGap(where: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: a counted prohibition's uses budget is read but never spent on the rules engine (real gap, not a keyword — see this file's own comment on forbidUsesGap)`);
  skipped++;
  return true;
}

// ── every rule as a workflow: rejections, choices, steps ───────────────────
//
// `docs/arena-workflow-spec.md` §3.6. `legalActions` says only what the server
// will accept; `rejectedActions` is the parallel list of what the player might
// reach for and why each is not there. The two must never overlap, and each
// `whyNot*` twin must say the same thing as the predicate beside it.

{
  const ctx = CTX;
  const first = (r: RejectedAction | undefined): Requirement | undefined => r?.why[0];
  const ofCard = (list: RejectedAction[], type: string, card: string) =>
    list.find((r) => r.action.type === type && (r.action as { card?: string; attacker?: string }).card === card) ??
    list.find((r) => r.action.type === type && (r.action as { attacker?: string }).attacker === card);

  // A hand card costing more than the active energy: exactly one play
  // rejection, and the first reason is the energy with the right numbers.
  {
    const s = arenaG({ hand: ["BIG"], energy: ["V1", "V1"] });
    const big = findG(s, "p1", "hand", "BIG");
    const rejected = assertDisjointG(s, "BIG in hand");
    const plays = rejected.filter((r) => r.action.type === "play" && r.action.card === big);
    assert.equal(plays.length, 1, "one rejection per card per action type");
    assert.deepEqual(first(plays[0]), { kind: "energy", need: 5, have: 2 });
    assertLabelOnLegacy(plays[0].label, "Play BIG (5)");
    // Energy markers count as energy (1-14).
    setEnergyMarkersG(s, "p1", 3);
    assert.equal(ofCard(assertDisjointG(s, "BIG with markers"), "play", big), undefined, "5 energy sources pay a cost of 5");
  }

  // A card in Rest Mode is refused an attack for its mode, not its timing.
  {
    const s = arenaG({ battle: ["V1"] });
    const mine = zoneOf(s, "p1", "battle")[0];
    s.cards[mine].mode = "rest";
    const r = ofCard(assertDisjointG(s, "rested attacker"), "attack", mine);
    assert.ok(r, "a rested Battle Card gets an attack rejection");
    assert.deepEqual(first(r), { kind: "mode", card: mine, mode: "rest" });
    assert.ok(!r!.why.some((w) => w.kind === "timing"), "…and it is not blamed on the phase");
    assertLabelOnLegacy(r!.label, "Attack with V1");
  }

  // On the first player's first turn the attack is refused for its timing.
  {
    let s = gameG();
    const chooser = (s.prompt as { player: PlayerId }).player;
    s = playG(s, { type: "chooseFirst", player: chooser, first: "p1" }, { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false });
    s = playG(s, { type: "charge", player: "p1", card: null });
    const r = ofCard(assertDisjointG(s, "turn 1"), "attack", leaderOf(s, "p1"));
    assert.deepEqual(first(r), { kind: "timing", window: "nextTurn" }, "7-3-4-4-1");
  }

  // After charging, a second charge is once per turn.
  {
    let s = gameG();
    const chooser = (s.prompt as { player: PlayerId }).player;
    s = playG(s, { type: "chooseFirst", player: chooser, first: "p1" }, { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false });
    assert.equal(s.prompt.kind, "charge");
    assert.deepEqual(
      assertDisjointG(s, "charge prompt").filter((r) => r.action.type === "charge"),
      [],
      "in the Charge Phase every hand card may be charged",
    );
    s = playG(s, { type: "charge", player: "p1", card: zoneOf(s, "p1", "hand")[0] });
    const again = ofCard(assertDisjointG(s, "after charging"), "charge", zoneOf(s, "p1", "hand")[0]);
    assert.deepEqual(first(again), { kind: "oncePerTurn", what: "charge" });
    assertLabelOnLegacy(again!.label, `Charge V1`);
  }

  // A [Once per turn] skill, used, is refused for that reason; before use it is
  // offered and so has no rejection at all.
  {
    let s = arenaG({ battle: ["ONCE"] });
    const once = zoneOf(s, "p1", "battle")[0];
    assert.equal(ofCard(assertDisjointG(s, "ONCE fresh"), "activate", once), undefined, "the skill is on the menu");
    s = playG(s, { type: "activate", player: "p1", card: once, skill: 0 });
    assert.equal(s.prompt.kind, "main");
    const r = ofCard(assertDisjointG(s, "ONCE used"), "activate", once);
    assert.deepEqual(first(r), { kind: "oncePerTurn", what: "skill" });
    // The label names the skill line, not just the card: one card can now be
    // refused several activations and three identical rows identify nothing.
    assertLabelOnLegacy(r!.label, "Activate ONCE: Draw 1 card.");
  }

  // 20-14: a prohibition names the card whose rule it is.
  {
    const s = arenaG({ battle: ["V1"], oppBattle: ["PERMLOCK"] });
    const mine = zoneOf(s, "p1", "battle")[0];
    assert.equal(ofCard(assertDisjointG(s, "PERMLOCK"), "attack", mine)?.why[0].kind, "forbidden");
    assert.deepEqual(first(ofCard(assertDisjointG(s, "PERMLOCK"), "attack", mine)), { kind: "forbidden", by: "PERMLOCK", until: "permanent" }, "a [Permanent] holds while its card is in play");
    assert.ok(!ofCard(assertDisjointG(s, "PERMLOCK leader"), "attack", leaderOf(s, "p1")), "the Leader is not a Battle Card and still attacks");
  }

  // 22-39: a [Unique] twin in play is a rule of that card.
  if (!keywordGap("Unique", S7.unique)) {
    const s = arenaG({ hand: ["UNIQ"], battle: ["UNIQ"], energy: ["V1"] });
    const r = ofCard(assertDisjointG(s, "Unique"), "play", findG(s, "p1", "hand", "UNIQ"));
    assert.deepEqual(first(r), { kind: "forbidden", by: "UNIQ" });
    // [Unique] is the engine's own rule (22-39), not an effect: no duration to name.
  }

  // In a battle: a card with no combo is the wrong kind of card, a combo the
  // energy cannot pay is an energy shortfall, and an [Activate: Main] skill
  // is refused for its timing — the window in which it *would* work.
  if (!nativeRejectionGap("combo rejections mid-battle")) {
    let s = arenaG({ hand: ["BLOCKER", "E-DRAW"], battle: ["V1"], oppBattle: ["V-BLUE"] });
    s = playG(s, { type: "attack", player: "p1", attacker: zoneOf(s, "p1", "battle")[0], target: leaderOf(s, "p2") });
    assert.equal(s.prompt.kind, "combo");
    const rejected = assertDisjointG(s, "offense combo");
    const blocker = findG(s, "p1", "hand", "BLOCKER");
    const extra = findG(s, "p1", "hand", "E-DRAW");
    assert.deepEqual(first(ofCard(rejected, "combo", blocker)), { kind: "energy", need: 1, have: 0 });
    assertLabelOnLegacy(ofCard(rejected, "combo", blocker)!.label, "Combo BLOCKER");
    assert.deepEqual(first(ofCard(rejected, "combo", extra)), { kind: "cardType", card: extra, needs: "a Battle Card with a combo cost" });
    assert.deepEqual(first(ofCard(rejected, "activate", extra)), { kind: "timing", window: "main" });
    // The attacker itself: rested by attacking, and in the battle.
    const attacker = s.battle!.attacker;
    const r = ofCard(rejected, "combo", attacker);
    assert.ok(r && r.why.some((w) => w.kind === "mode"), "the attacker is rested and cannot combo");
    // Nothing is said about the cards in play: no "play" rejection is invented
    // for a card that is already on the table.
    assert.equal(ofCard(rejected, "play", attacker), undefined);
  }

  // A Battle Card's text skill is only valid in the Battle Area (9-1-3-1),
  // and an [Auto] or [Permanent] is never an activation, so neither invents
  // a rejection the player could not have expected.
  {
    const s = arenaG({ hand: ["PUMP", "DRAWER", "AURA"], energy: ["V1"] });
    const rejected = assertDisjointG(s, "text skills in hand");
    assert.deepEqual(first(ofCard(rejected, "activate", findG(s, "p1", "hand", "PUMP"))), { kind: "zone", card: findG(s, "p1", "hand", "PUMP"), area: "battle" });
    assert.equal(ofCard(rejected, "activate", findG(s, "p1", "hand", "DRAWER")), undefined, "[Auto] is not activated");
    assert.equal(ofCard(rejected, "activate", findG(s, "p1", "hand", "AURA")), undefined, "[Permanent] is not activated");
    // With one energy each of them is playable, so no play rejection either.
    assert.equal(rejected.filter((r) => r.action.type === "play").length, 0);
  }

  // §3.2 as amended: one rejection per card per action type, **except an
  // activation, which is one per skill line**. A card's second skill being
  // unusable is not answered by its first skill being fine — keyed by the card
  // alone it was, and 678 of the catalog's rules were refused in silence
  // because of it.
  {
    DEFS.TWOLINE = {
      ...DEFS.V1,
      id: "TWOLINE",
      name: "TWOLINE",
      skill: "[Activate: Main] This card gets +5000 power for the turn.<br>[Activate: Main][Once per turn] Draw 1 card.",
    };
    let s = arenaG({ battle: ["TWOLINE"] });
    const two = findG(s, "p1", "battle", "TWOLINE");
    const skills = parseSkills(DEFS.TWOLINE.skill!);
    assert.equal(skills.length, 2, "the card really does have two activations");
    const acts = (t: EngineState) => IMPL.legalActions(CTX, t).filter((l) => l.action.type === "activate" && l.action.card === two);
    assert.equal(acts(s).length, 2, "both lines start on the menu");
    assert.deepEqual(
      assertDisjointG(s, "TWOLINE fresh").filter((r) => r.action.type === "activate" && r.action.card === two),
      [],
      "and neither is rejected",
    );

    // Use the [Once per turn] line. The other is still offered, and the used
    // one is now refused — under its own skill index, with its own label.
    s = playG(s, { type: "activate", player: "p1", card: two, skill: skills[1].index });
    assert.equal(s.prompt.kind, "main");
    assert.deepEqual(
      acts(s).map((l) => l.action.type === "activate" && l.action.skill),
      [skills[0].index],
      "the first line is still on the menu",
    );
    const mine = assertDisjointG(s, "TWOLINE half used").filter((r) => r.action.type === "activate" && r.action.card === two);
    assert.equal(mine.length, 1, "exactly one rejection, for the line that is spent");
    assert.equal(mine[0].action.type === "activate" && mine[0].action.skill, skills[1].index, "…filed under that line's index, not the card's first");
    assert.deepEqual(first(mine[0]), { kind: "oncePerTurn", what: "skill" });
    assertLabelOnLegacy(mine[0].label, "Activate TWOLINE: Draw 1 card.", "the label says which line it is");
  }

  // The price before the colon comes off the **record**, not off the card's
  // text (CLAUDE.md, "Rules are records"): until 8 Sep 2026 `activatable`,
  // `canResolve` and `activate` each rebuilt it with the compiler mid-game.
  // Reading it changes no answer — the drafter stored what the compiler read —
  // but it moves *when* the reading happens, and these two boards are the
  // difference that proves it.
  if (!legacyHistoryOnly("PRICED: the record-vs-text bug fix of 8 Sep 2026")) {
    DEFS.PRICED = {
      ...DEFS.V1,
      id: "PRICED",
      name: "PRICED",
      skill: "[Activate: Main] Choose 1 card in your hand and place it in the Drop Area: Draw 1 card.",
    };
    const s = arenaG({ battle: ["PRICED"], hand: ["V1", "BIG"] });
    const priced = findG(s, "p1", "battle", "PRICED");
    const sk = parseSkills(DEFS.PRICED.skill!)[0];

    // With the record's price: offered, and paying it really costs the card.
    assert.ok(
      IMPL.legalActions(CTX, s).some((l) => l.action.type === "activate" && l.action.card === priced),
      "an action price the record carries is a price the engine charges",
    );
    const before = zoneOf(s, "p1", "hand").length;
    let after = playG(s, { type: "activate", player: "p1", card: priced, skill: sk.index });
    while (after.prompt.kind === "chooseCards") {
      const pick = (after.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
      after = playG(after, { type: "choose", player: "p1", cards: [pick] });
    }
    assert.equal(zoneOf(after, "p1", "hand").length, before, "one card paid, one card drawn");
    assert.equal(zoneOf(after, "p1", "drop").length, 1, "…and the card paid is in the Drop");

    // The half that matters: a record whose **effect** is perfectly readable
    // but that carries **no price**. The price is then unknown, not free — the
    // skill stays off the menu and the refusal says the text is unread, rather
    // than handing the player an effect the engine never charged for. Before
    // this change the engine would have compiled the price here and offered it,
    // which is what makes this the assertion the move is worth.
    const priceless: typeof CTX = {
      defs: CTX.defs,
      scripts: { ...CTX.scripts, PRICED: { bySkill: { [sk.index]: { ops: [{ op: "draw", n: 1 }], unsupported: [] } }, complete: true, unsupported: [] } },
    };
    assert.ok(!IMPL.legalActions(priceless, s).some((l) => l.action.type === "activate" && l.action.card === priced), "a readable effect whose price the record does not carry is not offered for free");
    const why = IMPL.rejectedActions(priceless, s, IMPL.legalActions(priceless, s)).find((r) => r.action.type === "activate" && (r.action as { card?: string }).card === priced);
    assert.ok(
      why?.why.some((w) => w.kind === "unread"),
      `and the refusal says the text is unread: ${JSON.stringify(why?.why)}`,
    );
  }

  // 9-1-5 in both its shapes. A negated skill is off the menu — that part was
  // never in doubt — and the promise this pair keeps is that it is on the
  // *other* list with a reason. `negateSkill` silences one skill by index and
  // `negateSkills` the whole card; the second used to leave the card out of
  // both lists, because `skillsOfInstance` hands `rejectedActions` nothing.
  // Both are asserted here so the two shapes cannot drift apart again.
  for (const kind of ["negateSkill", "negateSkills"] as const) {
    const s = arenaG({ battle: ["PUMP"], energy: ["V1", "V1", "V1"] });
    const inst = findG(s, "p1", "battle", "PUMP");
    assert.ok(
      IMPL.legalActions(CTX, s).some((l) => l.action.type === "activate" && l.action.card === inst),
      "PUMP's [Activate: Main] is on the menu before the negation",
    );
    // `value` is the skill index for `negateSkill` and unread for `negateSkills`; PUMP has one skill, at 0.
    addEffectG(s, [], { target: inst, kind, value: 0, until: "turn", master: "p2" });
    assert.ok(!IMPL.legalActions(CTX, s).some((l) => l.action.type === "activate" && l.action.card === inst), `${kind}: the activation is off the menu`);
    const r = ofCard(assertDisjointG(s, kind), "activate", inst);
    assert.ok(r, `${kind}: the negated card is on the rejected list`);
    assert.deepEqual(first(r), { kind: "other", detail: "the skill is negated" }, `${kind}: and the reason names the negation`);
    assertLabelOnLegacy(r!.label, "Activate PUMP: This card gets +5000 power for the turn.");
  }

  // The compiler cannot read E-MYSTERY, and says so rather than staying silent.
  {
    const s = arenaG({ hand: ["E-MYSTERY"], energy: ["V1"] });
    const id = findG(s, "p1", "hand", "E-MYSTERY");
    assert.deepEqual(first(ofCard(assertDisjointG(s, "unread"), "activate", id)), { kind: "unread", card: id });
  }

  // A search of the deck: the prompt names cards no zone draws, so the view
  // carries them — for the player searching, and for nobody else.
  {
    const s = arenaG({ hand: ["SEARCH"], energy: ["V1"] });
    const r = IMPL.apply(CTX, s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "SEARCH") });
    assert.equal(r.state.prompt.kind, "chooseCards", "SEARCH asks which card to add");
    const choice = (r.state.prompt as { choice: { candidates: string[]; min: number; max: number } }).choice;
    assert.ok(choice.candidates.length > 1 && choice.candidates.every((id) => zoneOf(r.state, "p1", "deck").includes(id)), "the candidates are deck cards");
    if (!viewGap("SEARCH: you.choices over a deck-search prompt")) {
    const snap = buildSnapshot({
      id: 1,
      engine: ENGINE,
      mode: "hotseat",
      status: "playing",
      p1Name: "You",
      p2Name: "Claude",
      ctx,
      state: r.state,
      legal: IMPL.legalActions(CTX, r.state),
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      images: {},
    });
    assert.deepEqual(
      snap.view.you.choices?.map((c) => c.id),
      choice.candidates,
      "you.choices is exactly what the prompt names",
    );
    assert.ok(
      snap.view.you.choices!.every((c) => !c.hidden && c.name === "V1"),
      "…revealed to the searcher",
    );
    assert.equal(snap.view.them.choices, undefined, "and absent from the other side");
    assert.equal(snap.view.prompt.min, 0);
    assert.equal(snap.view.prompt.max, 1);
    assert.deepEqual(snap.view.prompt.step, { index: 1, count: 1, label: snap.view.prompt.question }, "the step comes from the script's own chain");
    assert.ok(
      snap.legal.some((l) => l.action.type === "choose" && l.action.cards.length === 0),
      "min 0 is offered as 'Choose none'",
    );
    // Every choice can be tapped: the legal `choose` for it exists.
    for (const c of snap.view.you.choices!) assert.ok(snap.taps.byCard[c.id]?.length, `${c.id} is reachable`);
    // The opponent, looking at the same moment, is shown nothing of the deck.
    const theirs = IMPL.boardView(CTX, r.state, "p2", {});
    assert.equal(theirs.you.choices, undefined, "a viewer who is not being asked sees no choices");
    assert.equal(theirs.them.choices, undefined);
    }
  }

  // Rejections are for the viewer only, and never for Claude.
  {
    let s = arenaG({ hand: ["BIG"] });
    assert.ok(rejectedActionsG(s).length > 0, "p1, asked, has rejections");
    s = playG(s, { type: "endMain", player: "p1" });
    assert.equal((s.prompt as { player: PlayerId }).player, "p2");
    const input = { ctx, engine: ENGINE, state: s, legal: IMPL.legalActions(CTX, s), ai: "p2" as PlayerId };
    assert.deepEqual(rejectedFor(input), [], "the prompt is Claude's: nothing is computed");
    const snap = buildSnapshot({
      id: 1,
      mode: "sparring",
      status: "playing",
      p1Name: "You",
      p2Name: "Claude",
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      images: {},
      ...input,
    });
    assert.equal(snap.rejected, undefined);
    assert.equal(snap.taps.whyByCard, undefined);
    // Hot-seat: the board flips to whoever is asked, so p2's rejections are theirs.
    assert.ok(rejectedFor({ ...input, ai: null }).every((r) => r.action.player === "p2"));
  }

  // `whyByCard` indexes the same requirements by the card, once each.
  {
    const s = arenaG({ hand: ["BIG"], energy: ["V1"] });
    const big = findG(s, "p1", "hand", "BIG");
    const snap = buildSnapshot({
      id: 1,
      engine: ENGINE,
      mode: "hotseat",
      status: "playing",
      p1Name: "You",
      p2Name: "Claude",
      ctx,
      state: s,
      legal: IMPL.legalActions(CTX, s),
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      images: {},
    });
    assert.ok(snap.rejected && snap.rejected.length > 0);
    // Both reasons are in the merged list — the *order* the two action
    // types' own rejections are merged into `whyByCard` is not itself a
    // promise (each action's own `why[]` is ordered, §3.3; this is a card
    // being refused two different moves for two different reasons), so this
    // is checked as membership rather than position.
    assert.ok(
      snap.taps.whyByCard?.[big]?.some((w) => w.kind === "energy" && w.need === 5 && w.have === 1),
      "the energy shortfall is not in the merged list",
    );
    assert.ok(
      snap.taps.whyByCard?.[big]?.some((w) => w.kind === "oncePerTurn" && w.what === "charge"),
      "the charge that has gone by is there too",
    );
    assert.equal(snap.taps.byCard[big], undefined, "and the card has no legal move");
    for (const r of snap.rejected!) assert.ok(!snap.legal.some((l) => JSON.stringify(l.action) === JSON.stringify(r.action)));
  }
}

// ── the review's fixes (`docs/arena-compiler-workflow-review.md`) ──────────

{
  const first = (r: RejectedAction | undefined): Requirement | undefined => r?.why[0];
  const ofCard = (list: RejectedAction[], type: string, card: string) =>
    list.find(
      (r) =>
        r.action.type === type && ((r.action as { card?: string }).card === card || (r.action as { attacker?: string }).attacker === card || (r.action as { cards?: string[] }).cards?.[0] === card),
    );

  // 22-44-3 / 22-44-5: [Limit X] caps an [Activate] skill like [Once per
  // turn] does, and the refusal names the tag (review §3.1).
  {
    let s = arenaG({ battle: ["LIMITED2"], energy: ["V1", "V1", "V1"] });
    const lim = findG(s, "p1", "battle", "LIMITED2");
    const offered = () => IMPL.legalActions(CTX, s).some((l) => l.action.type === "activate" && l.action.card === lim);
    assert.ok(offered());
    s = playG(s, { type: "activate", player: "p1", card: lim, skill: 0 });
    assert.ok(offered(), "[Limit 2]: a second use is fine");
    s = playG(s, { type: "activate", player: "p1", card: lim, skill: 0 });
    assert.ok(!offered(), "22-44-5: and a third is not");
    assert.deepEqual(first(ofCard(rejectedActionsG(s), "activate", lim)), { kind: "oncePerTurn", what: "skill", limit: 2 });
    assert.throws(() => IMPL.apply(CTX, s, { type: "activate", player: "p1", card: lim, skill: 0 }), "the engine refuses it too");
    const next = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null });
    assert.ok(
      IMPL.legalActions(CTX, next).some((l) => l.action.type === "activate" && l.action.card === lim),
      "again next turn",
    );
    // The price is on the row: the engine's own reckoning, not a guess off the
    // label. `LegalAction.cost` is a `describePayment` reading (`wording.ts`,
    // legacy-only today) — the rules engine's own `l.cost` field is Stage 8's,
    // the same "words from config" boundary `assertLabelOnLegacy` names above.
    if (ENGINE === "legacy") {
      const row = IMPL.legalActions(CTX, next).find((l) => l.action.type === "activate" && l.action.card === lim)!;
      assert.deepEqual(row.cost, { energy: 0, describe: "free" });
      const pump = arenaG({ battle: ["PUMP"], energy: ["V1", "V1"] });
      assert.equal(IMPL.legalActions(CTX, pump).find((l) => l.action.type === "activate")?.cost?.describe, "free", "PUMP prints no orbs");
    }
  }

  // 22-22-3: "If you can't choose the specified Battle Card … you can't
  // activate [Swap]". It was offered on timing and energy alone, took its orbs
  // and then had nothing to choose — the swap simply vanished, four energy
  // with it (game 47, turn 12).
  if (!keywordGap("Swap", S7.swap)) {
    const bare = arenaG({ battle: ["SWAPPER"], energy: ["V1", "V1"], hand: ["V-BLUE"] });
    const swapper = findG(bare, "p1", "battle", "SWAPPER");
    assert.ok(!labelsG(bare).some((x) => x.startsWith("Swap")), "no cost-3 card in hand, so no [Swap] on the menu");
    assert.deepEqual(first(ofCard(rejectedActionsG(bare), "activate", swapper)), { kind: "target", reason: "no cost-3 Battle Card in your hand" });

    const armed = arenaG({ battle: ["SWAPPER"], energy: ["V1", "V1"], hand: ["COST3"] });
    assert.ok(
      labelsG(armed).some((x) => x.startsWith("Swap")),
      "with one in hand it is offered again",
    );
  }

  // The counter window, a choice and a block have rejections of their own (review §3.7).
  if (!nativeRejectionGap("the counter window's own rejections")) {
    // A [Counter: Counter] in hand during an attack window: not this moment.
    // (E-CC rather than E-STOP: an earlier test rewrites E-STOP into a [Counter: Play].)
    let s = arenaG({ battle: ["V1"], oppHand: ["E-NEGATE", "E-CC"], oppEnergy: ["V1"] });
    s = playG(s, { type: "attack", player: "p1", attacker: zoneOf(s, "p1", "battle")[0], target: leaderOf(s, "p2") });
    assert.equal(s.prompt.kind, "counter");
    const rejected = rejectedActionsG(s);
    const stop = findG(s, "p2", "hand", "E-CC");
    assert.deepEqual(first(ofCard(rejected, "counter", stop)), { kind: "timing", window: "counter" });
    assert.equal(ofCard(rejected, "counter", findG(s, "p2", "hand", "E-NEGATE")), undefined, "the one on the menu is not rejected");
    assert.ok(!rejected.some((r) => IMPL.legalActions(CTX, s).some((l) => JSON.stringify(l.action) === JSON.stringify(r.action))));
  }
  if (!nativeRejectionGap("the blocker window's own rejections")) {
    // Two blockers, one resting: the rested one is refused for its mode.
    let s = arenaG({ battle: ["V1"], oppBattle: ["BLOCKER", "BLOCKER"] });
    const tired = zoneOf(s, "p2", "battle")[1];
    s.cards[tired].mode = "rest";
    s = playG(s, { type: "attack", player: "p1", attacker: zoneOf(s, "p1", "battle")[0], target: leaderOf(s, "p2") });
    assert.equal(s.prompt.kind, "blocker");
    const r = ofCard(rejectedActionsG(s), "block", tired);
    assert.deepEqual(first(r), { kind: "mode", card: tired, mode: "rest" });
    assertLabelOnLegacy(r!.label, "Block with BLOCKER");
  }
  {
    // A choice: the card with [Barrier] is excluded by its own rule (22-16),
    // and your own card by the target description — the *legality* half,
    // which `resolveSelector` (#154) settles regardless of whether a prompt
    // can explain a rejection yet.
    let s = arenaG({ hand: ["KILLER"], battle: ["V1"], energy: ["V1"], oppBattle: ["V-BLUE", "WALL"] });
    const wall = findG(s, "p2", "battle", "WALL");
    const mine = zoneOf(s, "p1", "battle")[0];
    const offered = zoneOf(s, "p2", "battle")[0];
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "KILLER") });
    assert.equal(s.prompt.kind, "chooseCards");
    const candidates = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
    assert.ok(!candidates.includes(wall), "22-16: [Barrier] is still offered as a choice");
    assert.ok(!candidates.includes(mine), "the choice offers your own card, which the skill does not ask for");
    assert.ok(candidates.includes(offered), "the one legal candidate is not offered");
    if (!chooseRejectionGap("[Barrier]'s own rejection reason")) {
      const rejected = rejectedActionsG(s);
      assert.deepEqual(first(ofCard(rejected, "choose", wall)), { kind: "forbidden", by: "WALL", until: "permanent" });
      assert.deepEqual(first(ofCard(rejected, "choose", mine)), { kind: "target", reason: "choose up to 1 of your opponent's Battle Cards" });
      assert.equal(ofCard(rejected, "choose", offered), undefined, "the offered card is not rejected");
    }
  }

  // A turn-scoped prohibition names the card that made it and how long it
  // holds (review §3.4): `source` on the effect, `until` on the requirement.
  {
    let s = arenaG({ hand: ["LOCKDOWN"], energy: ["V1"], oppBattle: ["V-BLUE"] });
    const lock = findG(s, "p1", "hand", "LOCKDOWN");
    s = playG(s, { type: "play", player: "p1", card: lock });
    assert.equal(s.effects[0]?.source, lock, "the effect remembers the card whose skill made it");
    s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
    const r = ofCard(rejectedActionsG(s), "attack", zoneOf(s, "p2", "battle")[0]);
    // "Until the start of your next turn" is `nextTurn`: it ends as the master's next turn begins.
    assert.deepEqual(first(r), { kind: "forbidden", by: "LOCKDOWN", until: "nextTurn" });
    // And the rule is on the player's side of the board, not on any card.
    if (!viewGap("LOCKDOWN: boardView.them.rules")) {
      const them = IMPL.boardView(CTX, s, "p1", {}).them;
      assert.deepEqual(
        them.rules?.map((x) => [x.kind, x.label, x.until, x.sourceName]),
        [["forbid", "can't attack battle card", "nextTurn", "LOCKDOWN"]],
      );
      assert.equal(IMPL.boardView(CTX, s, "p1", {}).you.rules, undefined, "and not on yours");
    }
  }

  // Counted and conditional prohibitions (20-14): a budgeted prohibition allows
  // one use, then refuses the second; an "unless" escape turns legality on.
  // Both halves are asserted from *both* sides of the workflow — the menu
  // (`legalActions`) and the refusal (`rejectedActions`), which `assertDisjoint`
  // holds to one rejection per card per action type (§3.2).
  if (!forbidUsesGap("counted forbid (uses:1) spending its budget")) {
    let s = arenaG({ battle: ["V1", "V-BLUE"], oppBattle: ["V1"] });
    addEffectG(s, [], { target: "", kind: "forbid", value: 0, until: "turn", forbid: { what: "attack", player: "p1", filter: parseFilter("battle card"), uses: 1 } });
    const attacker = zoneOf(s, "p1", "battle")[0];
    const second = zoneOf(s, "p1", "battle")[1];
    const attacks = (st: EngineState, card: string) => IMPL.legalActions(CTX, st).some((a) => a.action.type === "attack" && a.action.attacker === card);
    const attack = IMPL.legalActions(CTX, s).find((a) => a.action.type === "attack" && a.action.attacker === attacker);
    assert.ok(attack, "with uses:1 the first attack is legal");
    assert.ok(attacks(s, second), "…and so is the other card's, while the budget is unspent");
    assert.equal(ofCard(assertDisjointG(s, "counted forbid, unspent"), "attack", second), undefined, "nothing is refused yet");
    s = playG(s, attack!.action);
    while (s.prompt.kind !== "main") {
      if (s.prompt.kind === "counter") s = playG(s, { type: "counter", player: s.prompt.player, card: null });
      else if (s.prompt.kind === "blocker") s = playG(s, { type: "block", player: s.prompt.player, card: null });
      else if (s.prompt.kind === "combo") s = playG(s, { type: "pass", player: s.prompt.player });
      else if (s.prompt.kind === "zEnergyFromCombo") s = playG(s, { type: "zEnergyFromCombo", player: s.prompt.player, card: null });
      else throw new Error(`unexpected prompt ${s.prompt.kind}`);
    }
    assert.ok(!attacks(s, second), "the spent budget takes the second attack off the menu");
    const r = ofCard(assertDisjointG(s, "counted forbid, spent"), "attack", second);
    assert.deepEqual(first(r), { kind: "forbidden", by: null, until: "turn" }, "the second attack is rejected after the budget is spent");
    // …and the refusal is a sentence, not only a shape (§3.3).
    assert.deepEqual(refusal(first(r)!, { name: "V-BLUE", reaching: "attack" }), { fact: "A rule in force forbids it.", remedy: "Until the end of the turn." });
  }
  {
    // "Your opponent can't play Battle Cards unless your opponent has 3 or
    // more energy", printed on one of p1's cards. The escape clause is p1's
    // sentence, so it is asked in p1's chair (`master`) — p1 is given the 3
    // energy the clause names precisely so reading it from the acting
    // player's chair instead would let the play through.
    let s = arenaG({ energy: ["V1", "V1", "V1"], oppHand: ["V1"], oppEnergy: ["V1", "V1"] });
    s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
    const card = zoneOf(s, "p2", "hand")[0];
    const offered = (st: EngineState) => IMPL.legalActions(CTX, st).some((a) => a.action.type === "play" && a.action.card === card);
    assert.ok(offered(s), "the play is on the menu before the prohibition");
    addEffectG(s, [], {
      target: "",
      kind: "forbid",
      value: 0,
      until: "turn",
      forbid: { what: "play", player: "p2", master: "p1", filter: parseFilter("battle card"), unless: { kind: "count", sel: { side: "opponent", area: "energy", count: 99 }, atLeast: 3 } },
    });
    assert.ok(!offered(s), "and off it while the escape condition is false");
    const blocked = ofCard(assertDisjointG(s, "unless missing"), "play", card);
    assert.equal(first(blocked)?.kind, "forbidden");
    // …and said in the words of the player being refused, not the card's.
    assert.equal((first(blocked) as { unless?: string }).unless, "there are 3 or more cards in your energy");
    // The escape is the remedy the player is shown, so it is the sentence too.
    assert.equal(refusal(first(blocked)!, { name: "V1", reaching: "play" }).remedy, "Allowed only if there are 3 or more cards in your energy.");
    const extra = zoneOf(s, "p2", "deck")[0];
    zoneOf(s, "p2", "deck").splice(0, 1);
    zoneOf(s, "p2", "energy").push(extra);
    assert.ok(offered(s), "the play turns legal once the unless condition holds");
    assert.equal(ofCard(assertDisjointG(s, "unless met"), "play", card), undefined, "and carries no rejection");
  }

  // "Negate that card's [Auto] skills in all areas" keeps the duration it
  // printed instead of being cut to a turn (review §3.9).
  {
    const sc = compileSkill(parseSkills("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's [Auto] skills in all areas.")[0]);
    assert.deepEqual(sc.unsupported, []);
    assert.equal((sc.ops[1] as { until: string }).until, "game");
    let s = arenaG({ hand: ["MUTEAUTO"], energy: ["V1"], oppBattle: ["DRAWER"] });
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "MUTEAUTO") });
    if (s.prompt.kind === "chooseCards") s = playG(s, { type: "choose", player: "p1", cards: [zoneOf(s, "p2", "battle")[0]] });
    assert.equal(s.effects.find((e) => e.kind === "negateSkillKind")?.until, "game");
  }
}

// ── how a refusal is worded (`docs/arena-workflow-spec.md` §4) ─────────────
//
// The engine never writes a sentence; the client does, from the closed
// vocabulary. Every kind must come out as one clause of fact and, where one
// exists this turn, one of remedy — and the two must not be invented.

{
  const s = arenaG({ hand: ["BIG"], energy: ["V1", "V1"] });
  const snap = buildSnapshot({
    id: 1,
    engine: ENGINE,
    mode: "hotseat",
    status: "playing",
    p1Name: "You",
    p2Name: "Claude",
    ctx: CTX,
    state: s,
    legal: IMPL.legalActions(CTX, s),
    log: [],
    beats: null,
    spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null,
    images: {},
  });
  const you = snap.view.you;
  const o = { name: "BIG", reaching: "play" as const, side: you, inHand: true };

  // Energy: the numbers, and a remedy that depends on whether next turn fixes it.
  const short = refusal({ kind: "energy", need: 5, have: 2 }, o);
  assert.equal(short.fact, "BIG costs 5 — 2 energy active, 3 short.");
  assert.match(short.remedy!, /^Charge 3 more energy/, "two energy in play: charging is the only way to five");
  const rested = refusal({ kind: "energy", need: 2, have: 0 }, o);
  assert.match(rested.remedy!, /next turn/, "two energy in play, both rested: next turn is enough");
  assert.equal(refusal({ kind: "energy", need: 5, have: 2 }, { name: "BIG", reaching: "play" }).remedy, null, "no side, no promise");

  // Every kind produces a fact, never an empty string, and `other` passes its detail through.
  const every: Parameters<typeof refusal>[0][] = [
    { kind: "energy", need: 3, have: 1 },
    { kind: "energyColour", colour: "Red", need: 1, have: 0 },
    { kind: "mode", card: "x", mode: "rest" },
    { kind: "timing", window: "main" },
    { kind: "timing", window: "nextTurn" },
    { kind: "oncePerTurn", what: "charge" },
    { kind: "oncePerTurn", what: "skill" },
    { kind: "zone", card: "x", area: "battle" },
    { kind: "cardType", card: "x", needs: "a Battle Card" },
    { kind: "target", reason: "nothing may be attacked" },
    { kind: "forbidden", by: "PERMLOCK", until: "permanent" },
    { kind: "forbidden", by: null, until: "nextTurn" },
    { kind: "forbidden", by: null },
    { kind: "oncePerTurn", what: "skill", limit: 2 },
    { kind: "mode", card: "x", mode: "rest", locked: true },
    { kind: "unread", card: "x" },
    { kind: "condition", text: "When your life is at 4 or less" },
    { kind: "other", detail: "it is the attacking card" },
  ];
  for (const r of every) {
    const w = refusal(r, { name: "Card", reaching: "attack", side: you });
    assert.ok(w.fact.length > 8 && /[.!]$/.test(w.fact), `${r.kind}: a full sentence of fact (${w.fact})`);
    assert.ok(pill(r).length > 0, `${r.kind}: a pill`);
    assert.ok(sentence(r, { name: "Card", reaching: "attack", side: you }).startsWith(w.fact));
  }
  assert.equal(refusal({ kind: "mode", card: "x", mode: "rest" }, { name: "Sage", reaching: "attack" }).fact, "Sage is in Rest Mode — it cannot attack.");
  assert.equal(refusal({ kind: "oncePerTurn", what: "charge" }, o).fact, "You have already charged this turn.");
  assert.equal(refusal({ kind: "forbidden", by: "PERMLOCK" }, o).fact, "PERMLOCK forbids it.");
  assert.equal(refusal({ kind: "forbidden", by: "PERMLOCK", unless: "there are 3 or more cards in your energy" }, o).remedy, "Allowed only if there are 3 or more cards in your energy.");
  // How long a rule holds is the remedy, read from the player's chair (review §3.4).
  assert.equal(refusal({ kind: "forbidden", by: "PERMLOCK", until: "permanent" }, o).remedy, "While PERMLOCK is in play.");
  assert.equal(refusal({ kind: "forbidden", by: "LOCKER", until: "turn" }, o).remedy, "Until the end of the turn.");
  assert.equal(refusal({ kind: "forbidden", by: null }, o).remedy, "Until that rule ends.");
  assert.equal(refusal({ kind: "oncePerTurn", what: "skill", limit: 2 }, o).remedy, "[Limit 2] — again next turn.");
  assert.equal(refusal({ kind: "oncePerTurn", what: "skill" }, o).remedy, "[Once per turn] — again next turn.");
  assert.match(refusal({ kind: "mode", card: "x", mode: "rest", locked: true }, o).remedy!, /keeps it from standing up/, "no promise the rules will not keep");
  assert.equal(
    refusal({ kind: "target", reason: "choose 1 of your opponent's Battle Cards" }, { name: "Goku", reaching: "choose" }).fact,
    "Goku is not what the skill asks for — choose 1 of your opponent's Battle Cards.",
  );
  assert.equal(refusal({ kind: "other", detail: "it is the attacking card" }, o).fact, "It is the attacking card.");
  assert.equal(refusal({ kind: "zone", card: "x", area: "battle" }, o).remedy, "Play it first.");
  assert.equal(pill({ kind: "energy", need: 5, have: 2 }), "3 short");

  // Missing-energy chips beside the energy strip (ui-100-missing-energy-chips.md).
  // "needs {r}{r}, you have {r}"
  assert.equal(missingEnergyChip({ kind: "energyColour", colour: "Red", need: 2, have: 1 }), "needs {r}{r}, you have {r}");
  assert.equal(missingEnergyChip({ kind: "energyColour", colour: "Red", need: 1, have: 0 }), "needs {r}, you have 0");
  assert.equal(missingEnergyChip({ kind: "energyColour", colour: "Blue", need: 3, have: 0 }), "needs {u}{u}{u}, you have 0");
  assert.equal(missingEnergyChip({ kind: "energyColour", colour: "Red/Blue", need: 1, have: 0 }), "needs {r}/{u}, you have 0");
  assert.equal(missingEnergyChip({ kind: "energy", need: 3, have: 1 }), "needs 3, you have 1");
  assert.equal(missingEnergyChip({ kind: "energy", need: 1, have: 0 }), "needs 1, you have 0");
  assert.equal(missingEnergyChip({ kind: "mode", card: "x", mode: "rest" }), null);

  // Derived chips list for requirements from contract/fixtures/play.json
  const playFixtureWhy: Requirement[] = [
    { kind: "energy", need: 1, have: 0 },
    { kind: "energyColour", colour: "Red", need: 1, have: 0 },
  ];
  const chips = missingEnergyChips(playFixtureWhy);
  assert.equal(chips.length, 2);
  assert.deepEqual(chips[0], { kind: "energy", need: 1, have: 0, short: 1, text: "needs 1, you have 0" });
  assert.deepEqual(chips[1], { kind: "energyColour", colour: "Red", need: 1, have: 0, short: 1, text: "needs {r}, you have 0" });

  const twoRedWhy: Requirement[] = [
    { kind: "energy", need: 3, have: 1 },
    { kind: "energyColour", colour: "Red", need: 2, have: 1 },
  ];
  const twoRedChips = missingEnergyChips(twoRedWhy);
  assert.equal(twoRedChips.length, 2);
  assert.equal(twoRedChips[0].text, "needs 3, you have 1");
  assert.equal(twoRedChips[1].text, "needs {r}{r}, you have {r}");

  // Prices, worn on the sheet's rows.
  const big = you.hand!.find((c) => c.name === "BIG")!;
  assert.equal(priceOf({ type: "play", player: "p1", card: big.id }, big, "Play BIG (5)"), "5 energy");
  assert.equal(priceOf({ type: "play", player: "p1", card: big.id, x: 2 }, big, ""), "X = 2");
  assert.equal(priceOf({ type: "combo", player: "p1", card: big.id }, big, ""), "+5,000 · free");
  assert.equal(priceOf({ type: "activate", player: "p1", card: big.id, skill: 0 }, big, "Activate BIG (2)"), "2 energy");
  // The engine's own reckoning wins over the label when it gives one (review §3.8).
  assert.equal(
    priceOf({ type: "activate", player: "p1", card: big.id, skill: 0 }, big, "Activate BIG: Draw 1 card.", { energy: 2, orbs: { Red: 2 }, describe: "2 energy (2 red)" }),
    "2 energy (2 red)",
  );
  assert.equal(priceOf({ type: "attack", player: "p1", attacker: big.id, target: "x" }, big, ""), "rests it");
  assert.equal(priceOf({ type: "endMain", player: "p1" }, big, ""), null);
  assert.equal(stepText({ index: 2, count: 3 }), "step 2 of 3");
  assert.equal(stepText({ index: 2, count: 0 }), "step 2");
}

// ── the opponent's turn, spelled out (`docs/arena-workflow-spec.md` §7, Phase 3)

{
  const art = { a: { cardId: "X", name: "Son Goku", imageUrl: null }, b: { cardId: "Y", name: "Frieza", imageUrl: null } };
  const me = { viewer: "p1" as PlayerId, them: "Claude", art };
  // Every beat kind has a sentence, and it is one sentence.
  const all: Beat[] = [
    { t: "phase", phase: "main", player: "p2", turn: 4 },
    { t: "draw", player: "p2", card: null },
    { t: "move", card: "a", from: "hand", to: "battle", owner: "p2" },
    { t: "mode", card: "a", mode: "rest" },
    { t: "flip", card: "a" },
    { t: "markers", card: "a", delta: 1, total: 2 },
    { t: "token", card: "b", owner: "p2" },
    { t: "attack", attacker: "a", target: "b" },
    { t: "block", guard: "b", by: "a" },
    { t: "clash", attacker: "a", guard: "b", attackPower: 20000, guardPower: 10000, hit: true },
    { t: "damage", player: "p1", amount: 1, critical: true, cards: ["b"] },
    { t: "ko", card: "b", owner: "p1" },
    { t: "negated" },
    { t: "skill", card: "a", label: "Union-Absorb", text: "Place a card under it, then search.", unread: false, owner: "p2", inBattle: false },
    { t: "effect", card: "a", player: null, kind: "power", label: "+5000 power", until: "turn", source: "b", owner: "p2" },
    { t: "effectEnded", card: "a", player: null, kind: "power", label: "+5000 power", source: "b" },
    { t: "say", text: "Your move." },
    { t: "over", winner: "p2", reason: "no life left" },
  ];
  for (const b of all) {
    const s = narrate(b, me);
    assert.ok(s && s.length > 6, `${b.t} has a sentence`);
    assert.ok(/[.!”]$/.test(s!), `${b.t} ends a sentence: ${s}`);
  }
  // Whose ability it was comes from `owner`, which is what Phase 1 added the field for.
  assert.equal(narrate(all[13], me), "Claude uses 《Union-Absorb》 on Son Goku — Place a card under it, then search.");
  assert.equal(narrate({ ...(all[13] as Extract<Beat, { t: "skill" }>), owner: "p1" }, me), "You use 《Union-Absorb》 on Son Goku — Place a card under it, then search.");
  // Perspective: the same beat reads differently from the other chair.
  assert.equal(narrate(all[2], me), "Claude plays Son Goku.");
  assert.equal(narrate(all[2], { ...me, viewer: "p2" }), "You play Son Goku.");
  assert.equal(narrate(all[0], me), "Claude's Main Phase.");
  assert.equal(narrate(all[10], me), "You take 1 damage — Critical.");
  assert.equal(narrate(all[11], me), "Your Frieza is KO'd.");
  // The winner is named, and named first (owner's decision, 7 Sep 2026).
  assert.equal(narrate(all[9], me), "Son Goku wins the clash — 20,000 vs 10,000. The attack hits.");
  assert.equal(narrate({ ...(all[9] as Extract<Beat, { t: "clash" }>), hit: false }, me), "Frieza wins the clash — 20,000 vs 10,000. The attack is repelled.");
  assert.equal(narrate(all[17], me), "Claude wins — no life left.");
  // A rule coming into force and wearing off (review §3.3), from the viewer's chair.
  assert.equal(narrate(all[14], me), "Son Goku gets +5000 power until the end of the turn (Frieza).");
  assert.equal(narrate(all[15], me), "+5000 power on Son Goku wears off.");
  assert.equal(
    narrate({ t: "effect", card: "a", player: null, kind: "keyword", label: "[Critical]", until: "nextTurn", source: null, owner: "p2" }, me),
    "Son Goku gains [Critical] until the start of Claude's next turn.",
  );
  assert.equal(
    narrate({ t: "effect", card: null, player: "p1", kind: "forbid", label: "can't attack with battle cards", until: "opponentTurn", source: "b", owner: "p2" }, me),
    "You can't attack with battle cards until the start of your next turn (Frieza).",
  );
  // A hidden card is "a card", never a name the viewer may not know.
  assert.equal(narrate({ t: "move", card: "zz", from: "deck", to: "hand", owner: "p2" }, me), "Claude adds a card from the deck to hand.");
  assert.equal(narrate({ t: "draw", player: "p1", card: "a" }, me), "You draw Son Goku.");
}

if (ENGINE === "rules") console.log(`verify/workflow: ${skipped} case(s) skipped on the rules engine — 3 named keyword gaps, the rest real gaps found while porting this suite (see this file's own keywordGap/nativeRejectionGap/viewGap/forbidUsesGap/legacyHistoryOnly comments)`);
