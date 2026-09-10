"use client";

import { LayoutGroup, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { act, advanceGame } from "@/app/arena/actions";

import type { Action, PlayerId, Requirement } from "@/lib/arena/engine";
import type { NumberedBeat } from "@/lib/arena/beats";
import { feel } from "@/lib/arena/feel";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { CardView } from "@/lib/arena/view";
import { useWakeLock } from "@/lib/arena/wake";
import type { CardState } from "../ArenaCard";
import { FeelToggle } from "../FeelToggle";
import { PaceToggle } from "../PaceToggle";
import { SkinToggle } from "../SkinToggle";
import { usePace } from "@/lib/arena/pace";
import { colourOf, DEFAULT_LIGHTING, turnVars, type TurnLighting } from "@/lib/arena/lighting";
import type { ArenaSkin } from "@/lib/arena/skin";
import { ReportBug } from "../ReportBug";
import { narrate } from "@/lib/arena/narration";
import { missingEnergyChips } from "@/lib/arena/wording";
import {
  AttackBeam,
  CardPreview,
  CardSheet,
  SearchSheet,
  Sheet,
  SkillSpotlight,
  StepBanner,
  TopStrip,
  TurnStrip,
  cardsOnTable,
  isGhostAction,
  refusalLine,
  type SheetMove,
} from "../shared";
import { battleShape, BattleVerdict, firedInBattle } from "./BattleParts";
import { DuelBand } from "./DuelBand";
import { Ghosts } from "./Ghosts";
import { Hand } from "./Hand";
import { StagingToggle } from "../StagingToggle";
import type { ArenaStaging } from "@/lib/arena/staging";
import type { Moment } from "./StageCard";
import { Takeover } from "./Takeover";
import { useBeatPlayer } from "./useBeatPlayer";
import { useLiveGame } from "./useLiveGame";
import { useIdle } from "./useIdle";
import { PromptPanel } from "./PromptPanel";
import { BattleRow, cardIdOf, ClashBand, HandBacks, MenuSection, ReferenceCounts, SideRail } from "./StageZones";

/**
 * The motion board.
 *
 * Same pieces as the classic board and the same rule that it knows no rules —
 * everything tappable still comes from the engine's `legalActions`. What is new
 * is that it shows the *change* rather than only the result: a card flies from
 * hand to Battle Area because it is one element that changed parent, and a
 * whole opponent turn plays out beat by beat instead of arriving as a jump.
 *
 * Selected by the `boardStyle` cookie; `?board=classic` goes back.
 *
 * A battle is staged one of three ways (`docs/arena-battle-staging-spec.md`):
 * in place, in a band across the board, or as a takeover. All three read the
 * same `battleShape`, and the two that lift the fight off the board take the
 * cards out of their rows so each card is drawn once — a card's `layoutId` is
 * what flies it there and back, so it may exist in exactly one place.
 */
export function ArenaStage({
  gameId,
  snapshot,
  skin = "night",
  staging = "band",
  lighting = DEFAULT_LIGHTING,
}: {
  gameId: number;
  snapshot: Snapshot;
  skin?: ArenaSkin;
  staging?: ArenaStaging;
  lighting?: TurnLighting;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** The card whose action sheet is open — from a tap, a long press or a right-click. */
  const [sheet, setSheet] = useState<CardView | null>(null);
  /** The last refused tap: which card, and the sentence the rules gave for it. */
  const [refusal, setRefusal] = useState<{ card: string; text: string; at: number } | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  /** The search prompt the player closed to look at the board; it reopens on the next prompt. */
  const [closedSearch, setClosedSearch] = useState<string | null>(null);
  /** The last sentence the story told, kept after playback stops until you act. */
  const [held, setHeld] = useState<{ text: string; n: number; mine: boolean } | null>(null);
  const [hover, setHover] = useState<{ card: CardView; box: DOMRect } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const asked = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLDivElement | null>(null);

  /**
   * Whether to start polling — and the **only** thing still derived from the
   * server-rendered prop (`docs/arena-hud-spec.md` §1, §5).
   *
   * It has to be, because it is an argument to the hook that produces `live`:
   * a value read from `live` could go false before the first poll ever
   * returned, and the poll would then never start. Everything the board
   * *states* reads `live` instead, below. Do not "simplify" these two back
   * into one expression — that is exactly the bug this fixed: the headline
   * said "Majin Buu is thinking…" over a prompt asking the viewer to act,
   * because it kept reading a prop that went stale the moment the poll
   * returned, and the same stale value kept the poll alive to boot.
   */
  const pollWhile = snapshot.waiting === "opponent" || snapshot.waiting === "referee";

  // While the server is deciding, watch the row rather than the clock: Claude's
  // moves are committed as they are made, so they can be shown as they happen
  // instead of all at once when the request finally returns.
  const live = useLiveGame(gameId, snapshot, pending || pollWhile);
  const { view, legal, taps, log, beats } = live;

  // Everything rendered reads the live snapshot. `waitingFor` already returns
  // "you" whenever the prompt belongs to the viewer, so the server was never
  // wrong about this — only which snapshot this file asked.
  const waitingOnServer = live.waiting === "opponent" || live.waiting === "referee";
  // Whether the *server* is the thing to wait for. In a 1 v 1 the opponent is
  // a person on another phone, so there is nothing to kick off — only a
  // referee ruling is the server's, and either side may trigger that.
  const serverDecides = live.game.mode !== "versus" ? waitingOnServer : live.waiting === "referee";
  const rejected = live.rejected ?? [];
  const playable = live.game.status === "playing";

  // Reduced motion is not a second code path: it simply never queues anything,
  // which is the same state the board reaches the instant you press Skip.
  const still = useReducedMotion();
  const pace = usePace();

  // The fight, worked out once (`BattleParts`) and drawn by whichever staging
  // is chosen. `inplace` is the original board and lifts nothing.
  const staged = staging !== "inplace" && !!view.battle;
  const shape = staged ? battleShape(view, firedInBattle(beats?.list)) : null;
  // Every card the staging draws, so the rows below do not draw it a second
  // time: one `layoutId` may exist in exactly one place, and it is what flies
  // the card out of its row and back again.
  const lifted = new Set(shape?.cards.map((c) => c.id) ?? []);
  // The counters are in the Drop but on screen in the chain, so they arrive
  // like any other card and are never ghosted away to the pile they are in.
  const kept = new Set((shape ? (view.battle?.counters ?? []) : []).map((c) => c.card.id));

  const playback = useBeatPlayer(beats, !still, boardRef, pace, view.you.player, kept);

  /**
   * A staging must never hide a card the player is being asked to tap.
   *
   * The takeover covers the board, and a combo, a counter and a blocker are all
   * chosen from cards it is covering — so a fight it had taken over asked
   * "Combo? Tap a glowing card" over a screen with no glowing card on it. When
   * the prompt names anything the fight is not already drawing, the takeover
   * stands down and the band takes it, which leaves the board legible
   * underneath (owner's report, 7 Sep 2026).
   *
   * The band dims the board rather than covering it, so it only has to stop
   * dimming so hard.
   */
  const asksForBoard = playable && !playback.playing && view.prompt.player === view.you.player && Object.keys(taps.byCard).some((id) => !lifted.has(id));
  const takeoverOn = !!shape && staging === "takeover" && !asksForBoard;
  const bandOn = !!shape && !takeoverOn;

  useWakeLock(playable && !view.over);

  // The narration follows the beat on screen (workflow spec §7, Phase 3): one
  // sentence per beat, from the same stream the motion plays, so the words and
  // the pictures never disagree about the order of events.
  /** Whose beat this is: the player it names, the card's owner, or whoever's turn it is. */
  const actorOf = (b: NumberedBeat): PlayerId | null => {
    if ("player" in b) return b.player;
    if ("owner" in b && b.owner) return b.owner;
    if ("attacker" in b) return view.you.battle.some((c) => c.id === b.attacker) || view.you.leader?.id === b.attacker || view.you.unison?.id === b.attacker ? view.you.player : view.them.player;
    return b.t === "say" ? view.them.player : view.turnPlayer;
  };

  const beatNow = playback.current;
  if (beatNow && held?.n !== beatNow.n) {
    // Adjusted while rendering rather than in an effect, as the beat player
    // does: it is a change of props the board reflects on the same paint.
    const ownerOf = (id: string): typeof view.you.player | null => {
      for (const side of [view.you, view.them]) {
        for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, ...side.energy, ...(side.hand ?? []), side.dropTop]) if (c?.id === id) return side.player;
      }
      return null;
    };
    const text = narrate(beatNow, { viewer: view.you.player, them: view.them.name, art: beats?.art ?? {}, ownerOf });
    if (text) setHeld({ text, n: beatNow.n, mine: actorOf(beatNow) === view.you.player });
  }

  // Only for arriving at a game that is already mid-turn — a normal move runs
  // the opponent's reply inside `act` itself.
  useEffect(() => {
    if (!serverDecides || asked.current) return;
    asked.current = true;
    startTransition(async () => {
      const r = await advanceGame(gameId);
      if (r.error) setError(r.error);
    });
  }, [serverDecides, gameId]);

  /**
   * How tall the prompt bar is, published as a CSS variable on the board.
   *
   * The takeover is anchored to the viewport and the prompt bar was anchored
   * to the document, so on a short window the bar landed across the middle of
   * the two cards. The bar is fixed while a takeover is open (below) and the
   * takeover ends where it begins — but only this can say where that is, since
   * the bar grows a line whenever a question is long or its buttons wrap.
   */
  useEffect(() => {
    const bar = promptRef.current;
    const board = boardRef.current;
    if (!bar || !board) return;
    const measure = () => board.style.setProperty("--arena-prompt-h", `${Math.round(bar.getBoundingClientRect().height)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  /**
   * Reading a card stops the fight (`docs/arena-battle-staging-spec.md`
   * decision 6). A battle that runs on behind an open card is the reason the
   * inspector exists at all. It re-runs when playback starts, so a queue that
   * arrives while a card is open is held too rather than playing underneath it.
   */
  const { pause, resume } = playback;
  useEffect(() => {
    if (sheet) pause();
    else resume();
  }, [sheet, playback.playing, pause, resume]);

  // A refusal is said once and then gets out of the way; the card it was
  // about keeps its red badge, which is the board saying it before you tap.
  useEffect(() => {
    if (!refusal) return;
    const t = setTimeout(() => setRefusal(null), 5000);
    return () => clearTimeout(t);
  }, [refusal]);
  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShaking(null), 400);
    return () => clearTimeout(t);
  }, [shaking]);

  const select = (id: string | null) => {
    setSelected(id);
    setRefusal(null);
  };

  const send = (action: Action) => {
    setSheet(null);
    setSelected(null);
    setHover(null);
    setError(null);
    setRefusal(null);
    setHeld(null);
    feel("tap");
    startTransition(async () => {
      const r = await act(gameId, action);
      if (r.error) {
        setError(r.error);
        feel("illegal");
      }
    });
  };

  const targetsOf = (id: string) => taps.attackTargets[id];
  const isTargeting = selected != null && !!targetsOf(selected);
  // While the story of the last turn is still being told, the board is a
  // picture rather than a control surface.
  const busy = pending || playback.playing;

  /** A card as the board currently draws it, wherever it sits. */
  const cardOf = (id: string): CardView | null => {
    for (const side of [view.you, view.them]) {
      for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, ...side.energy, ...(side.hand ?? []), ...side.lifeFaceUp, ...side.zDeckFaceUp, ...(side.choices ?? []), side.dropTop]) {
        if (c?.id === id) return c;
      }
    }
    return null;
  };
  const whyOf = (id: string): Requirement[] | undefined => taps.whyByCard?.[id];
  const reaching = (id: string) => rejected.find((r) => cardIdOf(r.action) === id)?.action.type ?? "play";

  // Missing energy chips beside the energy strip (ui-100-missing-energy-chips.md).
  // Shown for the card the player has selected or the last refused tap, hidden during playback.
  const focusCard = selected ?? (sheet ? sheet.id : null) ?? (refusal ? refusal.card : null);
  const focusWhy = focusCard && !playback.playing ? (whyOf(focusCard) ?? rejected.find((r) => cardIdOf(r.action) === focusCard)?.why ?? []) : [];
  const energyChips = focusWhy.length > 0 ? missingEnergyChips(focusWhy) : [];

  /** The rows the action sheet lists for one card: attacks folded into one row that starts targeting. */
  const movesFor = (id: string): SheetMove[] => {
    const options = taps.byCard[id] ?? [];
    const targets = targetsOf(id);
    const out: SheetMove[] = [];
    let attackShown = false;
    for (const i of options) {
      const l = legal[i];
      if (l.action.type === "attack") {
        if (attackShown) continue;
        attackShown = true;
        out.push({ index: i, legal: l, targets: Object.keys(targets ?? {}).length });
        continue;
      }
      out.push({ index: i, legal: l });
    }
    return out;
  };

  /**
   * Say no out loud (`docs/arena-workflow-spec.md` §4): the card shakes, the
   * prompt bar names the requirement that failed, and a second tap on the
   * same card opens the sheet with every reason on it.
   */
  const refuse = (id: string, why: Requirement[]) => {
    const card = cardOf(id);
    if (refusal?.card === id) {
      if (card) setSheet(card);
      return;
    }
    feel("illegal");
    setShaking(id);
    const inHand = !!view.you.hand?.some((c) => c.id === id);
    setRefusal({ card: id, text: refusalLine(why, { name: card?.name ?? "That card", reaching: reaching(id), side: view.you, inHand }) ?? "Not now.", at: Date.now() });
  };

  const tapCard = (id: string) => {
    if (!playable || busy) return;
    if (isTargeting) {
      const idx = targetsOf(selected!)?.[id];
      if (idx != null) return send(legal[idx].action);
      select(null);
      return;
    }
    const options = taps.byCard[id];
    const why = whyOf(id);
    if (!options?.length) {
      if (why?.length) refuse(id, why);
      return;
    }
    // Only attacks: straight to picking a target, as before. Anything richer —
    // several moves, or a move beside a refusal — is a sheet with the prices
    // and the reasons on it. Charging is a one-way trip from hand to energy,
    // so it always goes through the sheet for an explicit second tap, even
    // when it is the card's only option — a misclick here is too costly.
    const targets = targetsOf(id);
    if (targets && options.every((i) => legal[i].action.type === "attack") && !why?.length) return select(id);
    if (options.length === 1 && !why?.length && legal[options[0]].action.type !== "charge") return send(legal[options[0]].action);
    const card = cardOf(id);
    if (card) setSheet(card);
  };

  const pickMove = (m: SheetMove) => {
    if (m.targets) {
      setSheet(null);
      select(cardIdOf(m.legal.action)!);
      return;
    }
    send(m.legal.action);
  };

  const stateOf = (id: string): CardState => {
    if (isTargeting) return targetsOf(selected!)?.[id] != null ? "legal" : selected === id ? "selected" : "dim";
    if (view.battle?.attacker === id) return "attacker";
    if (view.battle?.guard === id) return "guard";
    if (!taps.byCard[id]?.length) return whyOf(id)?.length && !busy ? "dead" : "plain";
    return busy ? "dim" : "legal";
  };

  /**
   * What a card is putting into the open battle, for the sheet
   * (`docs/arena-battle-staging-spec.md` §3.5). Which side's figure it is part
   * of comes from the shape, so a counter reads against the guard's number —
   * which is the one it moved.
   */
  const shareOf = (id: string) => {
    if (!shape) return null;
    const n = shape.contributions[id];
    if (n == null) return null;
    const onAttack = shape.attack.main?.id === id || shape.attack.chain.some((l) => l.card.id === id);
    return { contribution: n, total: onAttack ? shape.attack.power : shape.defence.power, side: onAttack ? ("attack" as const) : ("guard" as const) };
  };

  const hoverOf = (c: CardView) => (box: DOMRect | null) => setHover(box ? { card: c, box } : null);
  /** Whose chair the words are read from, for "until the start of your next turn". */
  const narrator = { viewer: view.you.player, them: view.them.name };

  const modal = view.prompt.kind === "chooseMode" || view.prompt.kind === "replaceMove";
  // A search of a hidden zone: the prompt names cards no zone draws, so the
  // board opens them as a list. Keyed on the prompt so closing it to look at
  // the board does not close the next one too.
  const choices = view.you.choices ?? [];
  const searchKey = `${view.prompt.question}|${choices.map((c) => c.id).join(",")}`;
  const searching = choices.length > 0 && playable && !busy && view.prompt.player === view.you.player;
  const searchOpen = searching && closedSearch !== searchKey;
  const chooseNone = taps.bare.find((i) => legal[i].action.type === "choose" && (legal[i].action as { cards: string[] }).cards.length === 0) ?? null;
  // The bar's buttons. While a search is on, "Choose none" lives in the sheet
  // and the bar keeps one button that reopens it, so the question has room.
  const bare = taps.bare.filter((i) => !(searching && i === chooseNone)).map((i) => ({ i, l: legal[i] }));
  const inlineBare = !playback.playing && !isTargeting && playable && !modal ? bare.slice(0, 3) : [];
  const primaryBare = inlineBare.findIndex(({ l }) => !isGhostAction(l.action));
  const yourTurn = view.prompt.player === view.you.player;
  const step = view.battle ? `battle:${view.battle.step}` : `phase:${view.phase}`;

  /**
   * Whose move the board states (`docs/arena-hud-spec.md` §2.1). One
   * expression, used once.
   *
   * `waitingFor` already means exactly "the prompt belongs to the viewer", so
   * this is the server's answer and nothing else. There is deliberately no
   * second opinion about whose move it is anywhere on this screen — that is
   * what makes §1's contradiction impossible rather than merely fixed.
   */
  const yourMove = live.waiting === "you";

  /**
   * The room belongs to whoever is acting (`docs/arena-turn-presence-spec.md`).
   *
   * One expression, used once, from the same `view.turnPlayer` the turn strip
   * reads — so the words and the light can never end up saying different
   * things. Everything after this is CSS: no component below learns a rule,
   * and nothing was added to the snapshot to make it work.
   */
  const acting = view.turnPlayer === view.you.player;
  const actor = acting ? view.you : view.them;
  const turnStyle = turnVars(
    {
      colour: colourOf(actor.leader?.colors),
      art: actor.leader?.imageUrl ?? null,
      yours: acting,
      // Exact primary-colour match only. Two perceptually *close* colours —
      // Red against Yellow — do not count: a ΔE threshold would be more
      // correct and much harder to reason about.
      mirror: !!colourOf(view.you.leader?.colors) && colourOf(view.you.leader?.colors) === colourOf(view.them.leader?.colors),
    },
    lighting,
  ) as React.CSSProperties;

  // After a few quiet seconds the cards that can be tapped say so. The clock
  // restarts on anything that changes what you could do, so it never nags.
  const idle = useIdle(4000, `${view.prompt.question}|${selected}|${busy}|${playback.playing}`);
  const nudging = idle && playable && yourTurn && !busy && !isTargeting && !searchOpen;
  const moveCount = Object.keys(taps.byCard).length + bare.length;

  // The storyboard, driven by the beat on screen rather than by whatever a
  // re-render happens to notice. `docs/arena-ui-motion-spec.md` §7.
  const beat = playback.current;
  const mine = (id: string) => view.you.battle.some((c) => c.id === id) || view.you.leader?.id === id || view.you.unison?.id === id;
  /**
   * Whose card this is, or null when the board cannot see it any more. The
   * verdict colours itself from this, and a card that won a fight and then left
   * it — a guard KO'd by [Double Strike] — must not be coloured as the
   * opponent's just because it is no longer in a row.
   */
  const sideOf = (id: string): "yours" | "theirs" | null => {
    for (const side of [view.you, view.them]) {
      for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, side.dropTop]) if (c?.id === id) return side === view.you ? "yours" : "theirs";
    }
    return null;
  };
  const momentOf = (id: string): Moment | null => {
    if (shaking === id) return "refuse";
    if (!beat) return null;
    // Your side sits below theirs, so an attack of yours throws itself upward.
    if (beat.t === "attack" && beat.attacker === id) return mine(id) ? "lungeUp" : "lungeDown";
    if (beat.t === "clash" && beat.hit && beat.guard === id) return "hit";
    if (beat.t === "flip" && beat.card === id) return "awaken";
    if ((beat.t === "token" && beat.card === id) || (beat.t === "move" && beat.card === id)) return "arrive";
    if (beat.t === "effect" && beat.card === id) return "surge";
    if (beat.t === "effectEnded" && beat.card === id) return "settle";
    return null;
  };
  const hurting = beat?.t === "damage" ? beat.player : null;

  // The skill banner is bound to the `skill` beat on screen, so each ability
  // in a turn gets its moment in the story's order — the row's `spotlight`
  // only ever names the last one.
  const beatSpotlight =
    beat?.t === "skill"
      ? {
          seq: beat.n,
          cardId: beats?.art[beat.card]?.cardId ?? "",
          name: beats?.art[beat.card]?.name ?? "",
          label: beat.label,
          text: beat.text,
          unread: beat.unread,
          imageUrl: beats?.art[beat.card]?.imageUrl ?? null,
        }
      : null;

  /**
   * A card in a battle staging always opens (§3.5): a tap on one with no move
   * reads it rather than doing nothing, because the whole point of lifting the
   * fight onto its own surface is that you can look at what is in it.
   */
  const stagedProps = (c: CardView) => {
    const p = cardProps(c);
    return { ...p, onTap: p.onTap ?? (() => setSheet(c)) };
  };

  const cardProps = (c: CardView) => ({
    card: c,
    state: stateOf(c.id),
    suppressed: playback.suppressed.has(c.id),
    nudge: nudging && !!taps.byCard[c.id]?.length,
    moment: momentOf(c.id),
    onTap: taps.byCard[c.id]?.length || whyOf(c.id)?.length || isTargeting ? () => tapCard(c.id) : undefined,
    onInspect: () => setSheet(c),
    onHover: hoverOf(c),
  });

  return (
    <LayoutGroup>
      <div ref={boardRef} className="arena relative mx-auto flex w-full max-w-7xl flex-col gap-2 sm:gap-3" data-skin={skin} style={turnStyle}>
        {/* Speed lines under an attack — a skin's moment, driven by the beat on
            screen like every other; it draws nothing on the night table. */}
        {beat && (beat.t === "attack" || beat.t === "clash") && <div key={beat.n} className="arena-speedlines pointer-events-none absolute inset-0 z-20" aria-hidden />}
        <StepBanner step={step} />
        {/* A skill fired inside a staged battle is said on the card that fired
            it, so the banner would be the same sentence twice over the fight. */}
        <SkillSpotlight spotlight={shape && beat?.t === "skill" && beat.inBattle ? null : beatSpotlight} />
        <TopStrip view={view} />

        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start lg:gap-4">
          <SideRail side={view.them} them active={!acting} cardProps={cardProps} hurt={hurting === view.them.player} narrator={narrator} lifted={lifted} className="lg:col-start-3 lg:row-start-1" />

          <section className="arena-stage relative rounded-xl border border-space-700/70 p-2 sm:rounded-2xl sm:p-3 lg:col-start-2 lg:row-start-1 lg:p-4" aria-label="Battle Areas">
            {/* Dimmed and blurred under the band, never hidden: the position
                being fought over stays legible while the fight resolves. */}
            <div className={bandOn ? (asksForBoard ? "arena-behind-soft" : "arena-behind") : ""}>
              <HandBacks count={view.them.handCount} />
              <BattleRow cards={view.them.battle.filter((c) => !lifted.has(c.id))} cardProps={cardProps} zone="p2:battle" label={`${view.them.name} has no Battle Cards`} />
              <ClashBand view={view} cardProps={cardProps} staged={!!shape} />
              <BattleRow cards={view.you.battle.filter((c) => !lifted.has(c.id))} cardProps={cardProps} zone="p1:battle" label="You have no Battle Cards" />
            </div>
            {bandOn && shape && <DuelBand shape={shape} cardProps={stagedProps} beat={beat} progress={playback.playing ? { index: playback.index, total: playback.total } : null} />}
          </section>

          <SideRail side={view.you} active={acting} cardProps={cardProps} hurt={hurting === view.you.player} narrator={narrator} lifted={lifted} energyChips={energyChips} className="lg:col-start-1 lg:row-start-1" />
        </div>

        {/* The bottom two slots of the header stack (`docs/arena-hud-spec.md`
            §2): *whose move*, then *what is being asked*, in that order,
            always. They share one positioned wrapper because the strip has to
            stay directly above the ask — a sticky bar with a static strip
            above it comes apart the moment the board scrolls.

            While a takeover has the screen the pair is pinned to the viewport
            with it, because a sticky bar and a fixed overlay are measured
            against two different things and will always end up on top of each
            other on a short window. `promptRef` measures this wrapper rather
            than the bar alone: it is what tells the takeover where to stop,
            and the takeover has to clear both. */}
        <div ref={promptRef} className={`z-30 flex flex-col gap-1.5 ${takeoverOn ? "fixed inset-x-2 bottom-2 mx-auto max-w-7xl sm:inset-x-4" : "sticky bottom-2"}`}>
          {playable && !view.over && <TurnStrip view={view} yours={yourMove} moves={moveCount} />}
          <PromptPanel
            view={view}
            playable={playable}
            yourTurn={yourTurn}
            waitingOnServer={waitingOnServer}
            busy={busy}
            playing={playback.playing}
            held={held}
            refusalText={refusal?.text ?? null}
            error={error}
            pace={pace}
            playingMine={!!(beat && actorOf(beat) === view.you.player)}
            playingIndex={playback.index}
            playingTotal={playback.total}
            yourPlayer={view.you.player}
            isTargeting={isTargeting}
            onCancelTargeting={() => select(null)}
            searching={searching}
            searchOpen={searchOpen}
            choicesCount={choices.length}
            onReopenSearch={() => setClosedSearch(null)}
            inlineBare={inlineBare}
            primaryBare={primaryBare}
            onSend={send}
            onNext={playback.next}
            onSkip={playback.skip}
          />
        </div>

        {playable && !playback.playing && !isTargeting && (modal || bare.length > 3) && (
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {(modal ? bare : bare.slice(3)).map(({ i, l }) => (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => send(l.action)}
                className="tap rounded-lg border border-space-600 bg-space-800 px-3 py-1.5 text-xs text-space-100 hover:border-ki-500/60 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
              >
                {l.label}
              </button>
            ))}
          </div>
        )}

        <Hand
          cards={view.you.hand ?? []}
          count={view.you.handCount}
          name={view.you.name}
          cardProps={cardProps}
          controls={
            <>
              <button type="button" onClick={() => setLogOpen((x) => !x)} className="tap uppercase tracking-widest text-ki-300 hover:text-ki-400">
                {logOpen ? "hide log" : "log"}
              </button>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className="tap flex h-11 w-11 items-center justify-center rounded-full border border-space-600 text-xl leading-none text-space-300 hover:border-ki-500/60 hover:text-ki-300"
                aria-label="Open arena settings and counts"
              >
                ⋯
              </button>
            </>
          }
        >
          {/* The log no longer replaces the hand: you can read what just
              happened and look at your cards at the same time. */}
          {logOpen && (
            <ol className="mb-2 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10px] leading-relaxed text-space-400 sm:max-h-56 sm:text-xs">
              {log.slice(-80).map((line, i) => (
                <li key={i} className={line.startsWith("—") ? "mt-1 text-space-200" : ""}>
                  {line}
                </li>
              ))}
              {log.length === 0 && <li>nothing has happened yet</li>}
            </ol>
          )}
        </Hand>

        {view.battle && !shape && <AttackBeam from={view.battle.attacker} to={view.battle.guard} hostRef={boardRef} />}

        {moreOpen && (
          <Sheet title="Board controls" onClose={() => setMoreOpen(false)}>
            <MenuSection title="Feel">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-widest text-space-300 sm:text-xs">
                <FeelToggle />
                <PaceToggle />
              </div>
            </MenuSection>
            <MenuSection title="Board">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-widest text-space-300 sm:text-xs">
                <StagingToggle gameId={gameId} staging={staging} />
                <SkinToggle gameId={gameId} skin={skin} />
              </div>
            </MenuSection>
            <MenuSection title="Reference">
              <div className="space-y-2">
                <ReferenceCounts side={view.you} />
                <ReferenceCounts side={view.them} />
              </div>
            </MenuSection>
            <MenuSection title="Help">
              <div className="text-[11px] text-space-300 sm:text-xs">
                <ReportBug gameId={gameId} cards={cardsOnTable(view)} />
              </div>
            </MenuSection>
          </Sheet>
        )}

        {takeoverOn && <Takeover shape={shape} cardProps={stagedProps} beat={beat} progress={playback.playing ? { index: playback.index, total: playback.total } : null} />}

        {/* Who won the fight, named. Outside the stagings on purpose: it must
            appear on all three, and a battle that has already closed by the
            time the beats arrive has no band left to carry it. */}
        <BattleVerdict beat={beat} art={beats?.art ?? {}} sideOf={sideOf} />

        <Ghosts ghosts={playback.ghosts} art={beats?.art ?? {}} />

        {hover && !sheet && !searchOpen && <CardPreview card={hover.card} box={hover.box} narrator={narrator} />}

        {sheet && (
          <CardSheet
            card={sheet}
            side={view.you}
            narrator={narrator}
            moves={playable && !busy && !isTargeting ? movesFor(sheet.id) : []}
            rejected={playable && !busy ? rejected.filter((r) => cardIdOf(r.action) === sheet.id) : []}
            onPick={pickMove}
            onClose={() => setSheet(null)}
            battle={shareOf(sheet.id)}
          />
        )}

        {searchOpen && !sheet && (
          <SearchSheet
            prompt={view.prompt}
            choices={choices}
            indexOf={(id) => taps.byCard[id]?.[0]}
            none={chooseNone}
            onPick={(i) => send(legal[i].action)}
            onClose={() => setClosedSearch(searchKey)}
          />
        )}
      </div>
    </LayoutGroup>
  );
}
