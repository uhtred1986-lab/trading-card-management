"use client";

import { LayoutGroup, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { act, advanceGame, flagThisTurn, rematch } from "@/app/arena/actions";

import type { Action, PlayerId, Requirement } from "@/lib/arena/engine";
import type { NumberedBeat } from "@/lib/arena/beats";
import { feel } from "@/lib/arena/feel";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { CardView } from "@/lib/arena/view";
import { useWakeLock } from "@/lib/arena/wake";
import { ArenaCard, type CardState } from "../ArenaCard";
import { FeelToggle } from "../FeelToggle";
import { PaceToggle } from "../PaceToggle";
import { SkinToggle } from "../SkinToggle";
import { usePace } from "@/lib/arena/pace";
import { MatchColumn, PhaseChips, TurnBanner, TurnPill } from "./TurnPresence";
import type { TurnCall } from "./useBeatPlayer";
import { colourOf, DEFAULT_LIGHTING, turnVars, type TurnLighting } from "@/lib/arena/lighting";
import type { ArenaSkin } from "@/lib/arena/skin";
import { ReportBug } from "../ReportBug";
import { narrate } from "@/lib/arena/narration";
import { foldStory, type StoryLine } from "@/lib/arena/story";
import type { AdminDebug } from "@/lib/arena/admin-debug";
import { AdminContext } from "../admin-context";
import { AdminDrawer, AdminShield } from "./AdminDrawer";
import { missingEnergyChips, pill } from "@/lib/arena/wording";
import {
  ActionRows,
  AttackBeam,
  CardPreview,
  CardSheet,
  DockedInspector,
  InPlayList,
  InspectorColumn,
  SearchSheet,
  Sheet,
  SkillSpotlight,
  StatTiles,
  StepBanner,
  cardsOnTable,
  isGhostAction,
  refusalLine,
  type InPlaySide,
  type InspectorChip,
  type SheetMove,
} from "../shared";
import { battleShape, BattleVerdict, ClashBeam, firedInBattle } from "./BattleParts";
import { DuelBand } from "./DuelBand";
import { Ghosts } from "./Ghosts";
import { Hand } from "./Hand";
import type { DropState } from "./StageZones";
import { MarkerFlight } from "./MarkerFlight";
import { fxVars, msFor, turnBannerMs } from "./motion";
import { StagingToggle } from "../StagingToggle";
import { DEFAULT_STAGING, type ArenaStaging } from "@/lib/arena/staging";
import type { Moment } from "./StageCard";
import { Takeover } from "./Takeover";
import { GameEnd } from "./GameEnd";
import { useBeatPlayer } from "./useBeatPlayer";
import { useLiveGame } from "./useLiveGame";
import { useIdle } from "./useIdle";
import { PromptPanel } from "./PromptPanel";
import { StoryList } from "../shared-display";
import { BattleRow, cardIdOf, Lane, MenuSection, PlayerStrip, ReferenceCounts } from "./StageZones";
import { SpeedButton } from "./SpeedButton";

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
const REAL_SERVER = { act, advance: advanceGame, flag: flagThisTurn, rematch };

/**
 * Whether the board is wide enough for the docked inspector (Tailwind `lg`).
 * Behaviour only — the column itself is shown by CSS, so there is nothing to
 * mismatch on hydration. False on the server, which has no pointer to hover.
 */
const WIDE = "(min-width: 1024px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export function ArenaStage({
  gameId,
  snapshot,
  skin = "night",
  staging = DEFAULT_STAGING,
  lighting = DEFAULT_LIGHTING,
  server = REAL_SERVER,
  announceTurn = false,
  admin = false,
  adminDebug = null,
  menu = null,
}: {
  gameId: number;
  snapshot: Snapshot;
  skin?: ArenaSkin;
  staging?: ArenaStaging;
  lighting?: TurnLighting;
  /**
   * The two server actions the board calls. Defaults to the real ones; only
   * the fixture preview (`/arena/preview`, dev-only) injects stubs, so a tap
   * there goes nowhere instead of to a database that is not there.
   */
  server?: { act: typeof act; advance: typeof advanceGame; flag: typeof flagThisTurn; rematch: typeof rematch };
  /** Fixture preview only: open with the turn banner up, so a shot can catch a turn boundary (#344). */
  announceTurn?: boolean;
  /**
   * Whether the viewer is an arena admin (#350). Decided on the server by
   * `isArenaAdmin()` and passed down — never inferred here. False takes the
   * internals out of the render: the REF badge, the engine reading, raw ids,
   * the raw log and the drawer that holds them.
   */
  admin?: boolean;
  /** What only the server can say — seed, the opponent's hand, the decisions. Present only for an admin. */
  adminDebug?: AdminDebug | null;
  /**
   * The game page's own links (back to the Arena, give up, and for an admin
   * the debug view), drawn in the menu sheet's Game section. The page used to
   * put them in a row above the board; the board has the screen now.
   */
  menu?: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** The card whose action sheet is open — from a tap, a long press or a right-click. */
  const [sheet, setSheet] = useState<CardView | null>(null);
  /** The last refused tap: which card, and the sentence the rules gave for it. */
  const [refusal, setRefusal] = useState<{ card: string; text: string } | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  /**
   * A card being dragged out of the hand (rd-03). `x`/`y` are the pointer in
   * viewport pixels; `over` is the zone under it; `back` is the ghost flying
   * home after a refused or missed drop.
   */
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: "battle" | "energy" | null; back: boolean } | null>(null);
  const dragRef = useRef<{ id: string; pid: number; sx: number; sy: number; on: boolean } | null>(null);
  const dragEndedAt = useRef(0);
  // What the last press on a hand card was (rd-04): a finger or a mouse, when
  // it went down, and the `detail` of the click it made (0 is the keyboard, 2
  // is the second click of a double-click). A tap reads these, so the Charge
  // phase can charge on a touch tap and on a mouse double-click alone.
  const press = useRef({ type: "", at: 0, held: 0, detail: 0 });
  /** "+1 ENERGY" rising beside your energy after a charge (rd-04); `key` restarts it. */
  const [gain, setGain] = useState<{ key: number; ms: number } | null>(null);
  const gainTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeRaf = useRef<number | null>(null);
  const pointerAt = useRef({ x: 0, y: 0 });
  /** The search prompt the player closed to look at the board; it reopens on the next prompt. */
  const [closedSearch, setClosedSearch] = useState<string | null>(null);
  /** The last sentence the story told, kept after playback stops until you act. */
  const [held, setHeld] = useState<{ text: string; n: number; mine: boolean } | null>(null);
  const [hover, setHover] = useState<{ card: CardView; box: DOMRect } | null>(null);
  /**
   * The docked inspector (lg and up; `docs/arena-backlog/rd-05`). It follows
   * hover and keeps the last card so the pointer can travel to its buttons;
   * a pin (right-click, or a click on an In play row) holds it until another
   * pin or Escape. Reading is not a pause: only `sheet` stops playback.
   */
  const [inspected, setInspected] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  /** The In play row under the pointer, outlined on the board. */
  const [rowHover, setRowHover] = useState<string | null>(null);
  const wide = useWide();
  const [logOpen, setLogOpen] = useState(false);
  /** The desktop inspector's lower tab: In play, or the battle log (the bar's log button opens it). */
  const [deskTab, setDeskTab] = useState<"play" | "log">("play");
  const [adminOpen, setAdminOpen] = useState(false);
  /** The narration log (#350): what `NarrationRibbon` said, kept, oldest first. */
  const [story, setStory] = useState<StoryLine[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  /** The end screen was put away to look at the final board. */
  const [endDismissed, setEndDismissed] = useState(false);
  const asked = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

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
  // An archived game (issue #335) may still read `"playing"` — it is the
  // status it was archived at, kept for the record — but `legal` is already
  // empty and `waiting` already null, so nothing here is actually pending.
  const playable = live.game.status === "playing" && !live.game.archived;

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

  const playback = useBeatPlayer(beats, !still, boardRef, pace, view.you.player, kept, view.turn);

  // The turn banner is the walk's own step; the preview can also ask for one
  // at mount. Either way it is one banner, and the phase banner waits for it.
  const [previewCall, setPreviewCall] = useState<TurnCall | null>(() => (announceTurn ? { key: 0, player: view.turnPlayer, turn: view.turn } : null));
  useEffect(() => {
    if (!previewCall) return;
    const t = setTimeout(() => setPreviewCall(null), announceTurn && pace === "step" ? 60000 : turnBannerMs(pace));
    return () => clearTimeout(t);
  }, [previewCall, announceTurn, pace]);
  const turnCall = playback.turnCall ?? previewCall;

  /**
   * A staging must never hide a card the player is being asked to tap.
   *
   * The takeover covers the battle field, and a blocker or an energy to pay
   * with is chosen from cards it is covering — so a fight it had taken over
   * asked "Tap a glowing card" over a screen with no glowing card on it. When
   * the prompt names anything on the field the fight is not already drawing,
   * the takeover stands down and the band takes it, which leaves the board
   * legible underneath (owner's report, 7 Sep 2026). The hand is not the
   * field: it stays on screen under a takeover, so a combo chosen from it
   * keeps the fight up (redesign frame 07).
   *
   * The band dims the board rather than covering it, so it only has to stop
   * dimming so hard.
   */
  const yourAsk = playable && !playback.playing && view.prompt.player === view.you.player;
  const handIds = new Set((view.you.hand ?? []).map((c) => c.id));
  const asksForBoard = yourAsk && Object.keys(taps.byCard).some((id) => !lifted.has(id) && !handIds.has(id));
  const asksForHand = yourAsk && Object.keys(taps.byCard).some((id) => handIds.has(id));
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

  /** Whose card an instance is right now, read off the board rather than a beat, which does not always say. */
  const ownerOf = (id: string): typeof view.you.player | null => {
    for (const side of [view.you, view.them]) {
      for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, ...side.energy, ...(side.hand ?? []), side.dropTop]) if (c?.id === id) return side.player;
    }
    return null;
  };

  const beatNow = playback.current;
  if (beatNow && held?.n !== beatNow.n) {
    // Adjusted while rendering rather than in an effect, as the beat player
    // does: it is a change of props the board reflects on the same paint.
    const text = narrate(beatNow, { viewer: view.you.player, them: view.them.name, art: beats?.art ?? {}, ownerOf });
    if (text) setHeld({ text, n: beatNow.n, mine: actorOf(beatNow) === view.you.player });
  }

  // The narration log takes each beat as it is told, not as it arrives, so
  // reading it back never spoils a move the board has yet to play.
  const told = beats && playback.playing && beatNow ? { ...beats, list: beats.list.filter((b) => b.n <= beatNow.n) } : beats;
  const folded = foldStory(story, told, { viewer: view.you.player, them: view.them.name, art: beats?.art ?? {}, ownerOf }, view.turn, actorOf);
  if (folded !== story) setStory(folded);

  // Only for arriving at a game that is already mid-turn — a normal move runs
  // the opponent's reply inside `act` itself.
  useEffect(() => {
    if (!serverDecides || asked.current) return;
    asked.current = true;
    startTransition(async () => {
      const r = await server.advance(gameId);
      if (r.error) setError(r.error);
    });
  }, [serverDecides, gameId, server]);

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

  // Escape lets go of a pinned card; hover takes the inspector back.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

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
    setPinned(null);
    setSelected(null);
    setHover(null);
    setError(null);
    setRefusal(null);
    setHeld(null);
    feel("tap");
    if (action.type === "charge" && action.card) {
      const ms = pace === "slow" ? Math.round(950 * 2.4) : 950;
      setGain((g) => ({ key: (g?.key ?? 0) + 1, ms }));
      if (gainTimer.current) clearTimeout(gainTimer.current);
      gainTimer.current = setTimeout(() => setGain(null), ms);
    }
    startTransition(async () => {
      const r = await server.act(gameId, action);
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
  const focusCard = drag?.id ?? selected ?? (sheet ? sheet.id : null) ?? (refusal ? refusal.card : null);
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
    setRefusal({ card: id, text: refusalLine(why, { name: card?.name ?? "That card", reaching: reaching(id), side: view.you, inHand }) ?? "Not now." });
  };

  const chargesOf = (id: string) => (taps.byCard[id] ?? []).filter((i) => legal[i].action.type === "charge");
  const inHand = (id: string) => !!view.you.hand?.some((c) => c.id === id);
  /** The engine is asking you to charge, and this hand card has a legal `charge`. */
  const chargeGesture = (id: string) => view.prompt.kind === "charge" && view.prompt.player === view.you.player && playable && !busy && inHand(id) && chargesOf(id).length > 0;

  const tapCard = (id: string) => {
    if (!playable || busy) return;
    if (isTargeting) {
      const idx = targetsOf(selected!)?.[id];
      if (idx != null) return send(legal[idx].action);
      select(null);
      return;
    }
    // The Charge phase (rd-04): a touch tap charges, a mouse waits for its
    // double-click (`doubleTapCard`). Both are read from the engine's prompt and
    // `legal`; a keyboard Enter, a hold and a drag are not one.
    if (chargeGesture(id)) {
      const p = press.current;
      if (p.detail === 0 || sheet) {
        // The keyboard cannot double-click: it keeps the sheet, below.
      } else if (p.type === "mouse") return;
      else if (p.held < 450) {
        const list = chargesOf(id);
        if (list.length === 1) return send(legal[list[0]].action);
      } else return;
    }
    const options = taps.byCard[id];
    const why = whyOf(id);
    if (!options?.length) {
      if (!why?.length) return;
      // Below lg a card on the table that cannot act opens its review, with the
      // reason in the chip row (rd-06). A hand card keeps today's refusal — the
      // shake, the prompt-bar sentence and the missing-energy chips — and its
      // second tap opens the review; a wide board keeps the refusal throughout.
      const card = cardOf(id);
      const inHand = !!view.you.hand?.some((c) => c.id === id);
      if (!wide && card && !inHand) {
        feel("illegal");
        setSheet(card);
      } else refuse(id, why);
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

  /** A mouse double-click on a hand card in the Charge phase charges it. */
  const doubleTapCard = (id: string) => {
    if (!chargeGesture(id) || press.current.type !== "mouse" || sheet) return;
    const list = chargesOf(id);
    if (list.length === 1) return send(legal[list[0]].action);
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

  const hoverOf = (c: CardView) => (box: DOMRect | null) => {
    // Wide: the docked inspector takes the card and keeps it when the pointer
    // leaves, so there is no floating preview to chase. A pin wins over hover.
    if (wide) {
      if (box && !pinned) setInspected(c.id);
      return;
    }
    setHover(box ? { card: c, box } : null);
  };
  /** Right-click and long press: the sheet, or on a wide board a pin on the inspector. */
  const inspect = (c: CardView) => (wide ? setPinned(c.id) : setSheet(c));
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

  // Whose move the board states is the turn pill's and the prompt's business,
  // both read off the live snapshot (`docs/arena-hud-spec.md` §2.1): there is
  // deliberately no second opinion about it on this screen.

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
    // A card from the hand into the Battle Area is a reveal; any other arrival pops in.
    if (beat.t === "move" && beat.card === id && beat.from === "hand" && beat.to === "battle") return "reveal";
    if ((beat.t === "token" && beat.card === id) || (beat.t === "move" && beat.card === id)) return "arrive";
    if (beat.t === "effect" && beat.card === id) return "surge";
    if (beat.t === "effectEnded" && beat.card === id) return "settle";
    return null;
  };
  const hurting = beat?.t === "damage" ? beat.player : null;
  /** The damage on screen, for the explosion, the life pip and the shake (rd-07). */
  const damageNow = beat?.t === "damage" ? beat : null;
  const hitOf = (p: PlayerId) => (damageNow && damageNow.player === p ? { n: damageNow.n, amount: damageNow.amount, critical: damageNow.critical } : null);

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
    return { ...p, onTap: p.onTap ?? (() => inspect(c)) };
  };

  // --- Drag from the hand (rd-03) ---------------------------------------------
  //
  // Legality is the engine's: a drop sends an action that is already in
  // `legal`, or says why there is none. Nothing here evaluates a rule.
  const playsOf = (id: string) => (taps.byCard[id] ?? []).filter((i) => legal[i].action.type === "play");
  const rejectedFor1 = (id: string, type: "play" | "charge") => rejected.find((r) => cardIdOf(r.action) === id && r.action.type === type)?.why ?? [];
  const draggable = (id: string) => playable && !busy && yourTurn && !isTargeting && !searchOpen && !sheet && inHand(id) && (playsOf(id).length > 0 || chargesOf(id).length > 0 || !!whyOf(id)?.length);

  /** Which of your zones is under the pointer: the anchors' rectangles, a little generous. */
  const zoneAt = (x: number, y: number): "battle" | "energy" | null => {
    const host = boardRef.current;
    if (!host) return null;
    const inside = (zone: string, pad: number) => {
      const el = host.querySelector(`[data-arena-zone="${CSS.escape(zone)}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    };
    if (inside(`${view.you.player}:energy`, 10)) return "energy";
    if (inside(`${view.you.player}:battle`, 24)) return "battle";
    return null;
  };

  /**
   * Near the top of the screen the page scrolls up under the card. On a desktop
   * the hand sits below the fold from the Battle Area, and a drag that could
   * not reach it would be a drag only a tall window could use. Only upward: the
   * hand is always the lowest thing on the board, so every drop is above it.
   */
  const stopEdgeScroll = () => {
    if (edgeRaf.current != null) cancelAnimationFrame(edgeRaf.current);
    edgeRaf.current = null;
  };
  const startEdgeScroll = () => {
    if (edgeRaf.current != null) return;
    const edge = 80;
    const tick = () => {
      const { x, y } = pointerAt.current;
      if (y < edge && window.scrollY > 0) {
        window.scrollBy(0, -Math.ceil(((edge - y) / edge) * 22));
        // The page moved under a pointer that did not: what it is over changed.
        const over = zoneAt(x, y);
        setDrag((d) => (d && !d.back && d.over !== over ? { ...d, over } : d));
      }
      edgeRaf.current = requestAnimationFrame(tick);
    };
    edgeRaf.current = requestAnimationFrame(tick);
  };

  /** The ghost flies home over 440 ms; the card shakes when it lands. */
  const snapBack = (id: string, say: string | null) => {
    stopEdgeScroll();
    const src = boardRef.current?.querySelector(`[data-arena-card="${CSS.escape(id)}"]`)?.getBoundingClientRect();
    setDrag((d) => (d ? { ...d, back: true, over: null, ...(src ? { x: src.left + src.width / 2, y: src.top + src.height * 0.64 } : null) } : d));
    feel("illegal");
    if (say) setRefusal({ card: id, text: say });
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      setDrag(null);
      setShaking(id);
    }, 440);
  };

  const dropCard = (id: string, zone: "battle" | "energy" | null) => {
    const card = cardOf(id);
    if (zone) {
      const list = zone === "battle" ? playsOf(id) : chargesOf(id);
      if (list.length === 1) {
        stopEdgeScroll();
        setDrag(null);
        return send(legal[list[0]].action);
      }
      if (list.length > 1 && card) {
        // Several ways to do it (a choice of payment): the sheet lists them.
        stopEdgeScroll();
        setDrag(null);
        setSheet(card);
        return;
      }
      const type = zone === "battle" ? "play" : "charge";
      const why = rejectedFor1(id, type).length ? rejectedFor1(id, type) : (whyOf(id) ?? []);
      const line = refusalLine(why, { name: card?.name ?? "That card", reaching: type, side: view.you, inHand: true });
      return snapBack(id, line ?? "Not now.");
    }
    snapBack(id, null);
  };

  const dragFor = (id: string): React.HTMLAttributes<HTMLDivElement> | null => {
    if (!playable || !yourTurn) return null;
    return {
      // A native image drag would cancel the pointer stream on a mouse.
      onDragStart: (e) => e.preventDefault(),
      onPointerDown: (e) => {
        Object.assign(press.current, { type: e.pointerType, at: e.timeStamp, held: 0, detail: 0 });
        if (e.pointerType === "mouse" && e.button !== 0) return;
        dragRef.current = draggable(id) ? { id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, on: false } : null;
      },
      onPointerMove: (e) => {
        const d = dragRef.current;
        if (!d || d.id !== id || d.pid !== e.pointerId) return;
        if (!d.on) {
          // Under 8 px it is still a tap or a long press, and both keep working.
          if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
          d.on = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* a pointer that is already gone */
          }
          setHover(null);
          startEdgeScroll();
        }
        pointerAt.current = { x: e.clientX, y: e.clientY };
        setDrag({ id, x: e.clientX, y: e.clientY, over: zoneAt(e.clientX, e.clientY), back: false });
      },
      onPointerUp: (e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (!d || !d.on || d.id !== id) return;
        dragEndedAt.current = Date.now();
        dropCard(id, zoneAt(e.clientX, e.clientY));
      },
      onPointerCancel: () => {
        const d = dragRef.current;
        dragRef.current = null;
        if (!d || !d.on) return;
        dragEndedAt.current = Date.now();
        snapBack(id, null);
      },
      // The click that ends a drag must not be read as a tap.
      onClickCapture: (e) => {
        press.current.detail = e.detail;
        press.current.held = e.timeStamp - press.current.at;
        if (Date.now() - dragEndedAt.current < 350) {
          e.stopPropagation();
          e.preventDefault();
        }
        // The second click of a mouse double-click is the charge's, not a tap
        // that could open the sheet over the card it is charging.
        else if (e.detail >= 2 && press.current.type === "mouse" && chargeGesture(id)) e.stopPropagation();
      },
    };
  };

  // What the zones say while a card is in the air.
  const dragCard = drag ? cardOf(drag.id) : null;
  const dragPlays = drag ? playsOf(drag.id) : [];
  const dragCharges = drag ? chargesOf(drag.id) : [];
  const dragPrice = dragPlays.length && dragCard ? (legal[dragPlays[0]].cost?.energy ?? Number(dragCard.cost)) : NaN;
  const whyWords = (why: Requirement[], fallback: string) => {
    const short = why.find((w) => w.kind === "energy");
    if (short && short.kind === "energy") return `${short.need - short.have} energy short`;
    const first = why[0];
    if (!first) return fallback;
    return first.kind === "oncePerTurn" ? "Already charged" : pill(first);
  };
  const battleWhy = drag ? (rejectedFor1(drag.id, "play").length ? rejectedFor1(drag.id, "play") : (whyOf(drag.id) ?? [])) : [];
  const battleDrop: DropState | null =
    drag && !drag.back
      ? {
          ok: dragPlays.length > 0,
          hot: drag.over === "battle",
          say: dragPlays.length > 0 || drag.over === "battle" || battleWhy.some((w) => w.kind === "energy"),
          label: dragPlays.length > 0 ? (dragPrice > 0 ? `Drop to play · −${dragPrice} energy` : "Drop to play") : whyWords(battleWhy, "Can't play now"),
        }
      : null;
  const energyDrop: DropState | null =
    drag && !drag.back
      ? {
          ok: dragCharges.length > 0,
          hot: drag.over === "energy",
          // Not said through every play: "Already charged" only when the pointer is over it.
          say: dragCharges.length > 0 || drag.over === "energy",
          label: dragCharges.length > 0 ? "Drop to charge · +1 energy" : whyWords(rejectedFor1(drag.id, "charge").length ? rejectedFor1(drag.id, "charge") : [{ kind: "oncePerTurn", what: "charge" }], "Can't charge now"),
        }
      : null;
  const willRest = drag && !drag.back && dragPlays.length > 0 && dragPrice > 0 ? dragPrice : 0;
  useEffect(
    () => () => {
      if (gainTimer.current) clearTimeout(gainTimer.current);
      if (snapTimer.current) clearTimeout(snapTimer.current);
      if (edgeRaf.current != null) cancelAnimationFrame(edgeRaf.current);
    },
    [],
  );

  const cardProps = (c: CardView) => ({
    card: c,
    state: stateOf(c.id),
    suppressed: playback.suppressed.has(c.id),
    nudge: nudging && !!taps.byCard[c.id]?.length,
    moment: momentOf(c.id),
    onTap: taps.byCard[c.id]?.length || whyOf(c.id)?.length || isTargeting ? () => tapCard(c.id) : wide ? undefined : () => inspect(c),
    onDoubleTap: chargeGesture(c.id) ? () => doubleTapCard(c.id) : undefined,
    onInspect: () => inspect(c),
    onHover: hoverOf(c),
    outlined: rowHover === c.id,
  });

  // --- The docked inspector's content ----------------------------------------
  // Never an empty box (#444): the last card hovered while it is still on the
  // table, else the first card of your hand, else a leader.
  const fallbackId = view.you.hand?.[0]?.id ?? view.you.leader?.id ?? view.them.leader?.id ?? null;
  const inspectId = pinned ?? (inspected && cardOf(inspected) ? inspected : null) ?? fallbackId;
  const inspectCard = inspectId ? cardOf(inspectId) : null;
  const locate = (id: string) => {
    for (const side of [view.you, view.them]) {
      const zones: [string, (CardView | null | undefined)[]][] = [
        ["leader", [side.leader]],
        ["unison", [side.unison]],
        ["battle area", side.battle],
        ["combo area", side.combo],
        ["energy area", side.energy],
        ["hand", side.hand ?? []],
        ["life", side.lifeFaceUp],
        ["Z-Deck", side.zDeckFaceUp],
        ["drop", [side.dropTop]],
        ["search", side.choices ?? []],
      ];
      for (const [zone, cards] of zones) if (cards.some((c) => c?.id === id)) return { side, zone };
    }
    return null;
  };
  const whereOf = (id: string) => {
    const at = locate(id);
    return at ? `${at.side === view.you ? "Your" : `${at.side.name}'s`} ${at.zone}` : null;
  };
  const inspectAt = inspectCard && inspectId ? locate(inspectId) : null;
  const inspectWhere = inspectId ? whereOf(inspectId) : null;
  const rejectedFor = (id: string) => (playable && !busy ? rejected.filter((r) => cardIdOf(r.action) === id) : []);
  const inspectRejected = inspectId ? rejectedFor(inspectId) : [];
  /**
   * The chips for one card: its state, and what it can do. The phone review
   * also says *why* a card cannot act (`reason`) — the desktop inspector has
   * the refusal rows and leaves the chip row to state.
   */
  const chipsFor = (id: string, reason = false): InspectorChip[] => {
    const card = cardOf(id);
    const at = locate(id);
    const chips: InspectorChip[] = [];
    if (!card || !at) return chips;
    if (["leader", "unison", "battle area", "energy area"].includes(at.zone)) chips.push({ label: card.mode === "rest" ? "Rested" : "Standing", tone: "plain" });
    if (playable && !busy && targetsOf(id)) chips.push({ label: "Can attack", tone: "good" });
    if (isTargeting && targetsOf(selected!)?.[id] != null) chips.push({ label: "Valid target", tone: "good" });
    const why = rejectedFor(id).flatMap((r) => r.why);
    const short = why.find((w) => w.kind === "energy");
    if (short) chips.push({ label: pill(short).replace("short", "energy short"), tone: "bad" });
    if (reason) {
      const other = why.find((w) => w.kind !== "energy");
      if (other) chips.push({ label: pill(other), tone: "bad" });
      else if (at.side !== view.you && !chips.some((c) => c.tone === "good")) chips.push({ label: `${at.side.name}'s card`, tone: "plain" });
    }
    return chips;
  };
  const inspectChips = inspectId ? chipsFor(inspectId) : [];
  const inspectMoves: SheetMove[] = [];
  if (inspectId && playable && !busy) {
    if (isTargeting) {
      const at = targetsOf(selected!)?.[inspectId];
      if (at != null) inspectMoves.push({ index: at, legal: legal[at], label: "Attack it" });
    } else inspectMoves.push(...movesFor(inspectId));
  }
  /**
   * The run the open sheet steps through (rd-06): everything in play, the
   * opponent's leader first, or your hand when the card is in it. A card in
   * neither (an energy, a life card) is reviewed alone.
   */
  const inPlayRun = [view.them, view.you].flatMap((side) => [side.leader, side.unison, ...side.battle].filter((c): c is CardView => !!c).map((card) => ({ card, yours: side === view.you })));
  const handRun = (view.you.hand ?? []).map((card) => ({ card, yours: true }));
  const sequence = sheet ? (inPlayRun.some((i) => i.card.id === sheet.id) ? { label: "In play", items: inPlayRun } : handRun.some((i) => i.card.id === sheet.id) ? { label: "Your hand", items: handRun } : null) : null;
  const sheetAt = sheet ? locate(sheet.id) : null;
  const inPlaySides: InPlaySide[] = [view.them, view.you].map((side) => {
    const word = (c: CardView) => (c.mode === "rest" ? "rested" : "standing");
    const rows: InPlaySide["rows"] = [];
    if (side.leader) rows.push({ card: side.leader, note: `Leader · ${side.life} life · ${word(side.leader)}` });
    if (side.unison) rows.push({ card: side.unison, note: `Unison · ${word(side.unison)}` });
    for (const c of side.battle) rows.push({ card: c, note: c.mode === "rest" ? "Rested" : "Standing" });
    return { name: side.name, rows, battleCount: side.battle.length, battlePower: side.battle.reduce((n, c) => n + (c.power ?? 0), 0) };
  });

  return (
    <AdminContext.Provider value={admin}>
    <LayoutGroup>
      <div
        ref={boardRef}
        // Below sm the board runs to the screen's edges (the page keeps a
        // 0.5 rem gutter for everything else), so its edge line is flush.
        // From lg the board is the redesign's desktop grid (#444, `globals.css`
        // `.arena-board`): a full-width bar over the MATCH column, the field
        // with the hand and the prompt under it, and the inspector, sized to
        // the viewport so the hand and the field are on screen together.
        className="arena arena-board relative mx-auto flex w-full max-w-7xl flex-col max-sm:-mx-2 max-sm:min-h-[calc(100dvh-1rem)] max-sm:w-[calc(100%+1rem)]"
        data-skin={skin}
        style={{ ...turnStyle, ...fxVars(pace) }}
      >
        {/* Speed lines under an attack — a skin's moment, driven by the beat on
            screen like every other; it draws nothing on the night table. */}
        {beat && (beat.t === "attack" || beat.t === "clash") && <div key={beat.n} className="arena-speedlines pointer-events-none absolute inset-0 z-20" aria-hidden />}
        {/* A card revealed from the hand: a brief flash over the whole board (rd-07).
            */}
        {beat?.t === "move" && beat.from === "hand" && beat.to === "battle" && (
          <div key={beat.n} className="arena-fx-flash absolute inset-0 z-[35]" aria-hidden />
        )}
        {/* The edge: a thin line in the acting side's colour, switching with the banner. */}
        <div className="arena-edge" aria-hidden />
        <TurnBanner call={turnCall} view={view} lighting={lighting} ms={turnBannerMs(pace)} holdUntilTap={pace === "step"} />
        <StepBanner step={step} hold={!!turnCall || playback.turnAhead} />
        {/* A skill fired inside a staged battle is said on the card that fired
            it, so the banner would be the same sentence twice over the fight. */}
        <SkillSpotlight spotlight={shape && beat?.t === "skill" && beat.inBattle ? null : beatSpotlight} />
        {/* Everything in the flow but the docked inspector: one column of its own,
            so the inspector can run the full height of it, hand included. */}
        {/* From lg it is `display: contents`: its children are placed in the grid's areas. */}
        <div className="flex min-w-0 flex-1 flex-col lg:contents">
          {/* The top bar, one row (`docs/arena-redesign/` frame 01): whose turn
              it is, then speed, review, the admin shield and the menu. It sticks
              to the top of a phone's screen so the turn is never scrolled away. */}
          <div className="arena-topbar sticky top-0 z-30 flex h-[52px] min-w-0 items-center gap-1.5 pl-2.5 pr-0.5 sm:rounded-t-[14px] lg:h-[60px] lg:gap-4 lg:pl-3 lg:pr-2 lg:[grid-area:top]">
            <span className="arena-title arena-num hidden text-[19px] leading-none lg:inline">Arena</span>
            <TurnPill view={view} />
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <SpeedButton />
              <button
                type="button"
                onClick={() => view.them.leader && setSheet(view.them.leader)}
                disabled={!view.them.leader}
                className="arena-iconbtn tap flex h-11 w-11 items-center justify-center disabled:opacity-40 lg:hidden"
                aria-label="Review cards in play"
              >
                <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              {/* From lg: the battle log, the inspector's second tab. */}
              <button
                type="button"
                onClick={() => setDeskTab((t) => (t === "log" ? "play" : "log"))}
                className="arena-iconbtn tap hidden h-11 w-11 items-center justify-center lg:flex"
                aria-label="Battle log"
                aria-pressed={deskTab === "log"}
              >
                <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="M5 6h14M5 11h14M5 16h9" />
                </svg>
              </button>
              {/* Admins only, and rendered only for them: the shield that opens the drawer (#350). */}
              {admin && <AdminShield onOpen={() => setAdminOpen(true)} />}
              <button type="button" onClick={() => setMoreOpen(true)} className="arena-iconbtn tap flex h-11 w-11 items-center justify-center" aria-label="Open arena settings and counts">
                <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            </div>
          </div>
          {/* The phase words under the bar; from lg they are the left column's list. */}
          <PhaseChips view={view} className="arena-phases-row h-8 shrink-0 overflow-hidden px-2 lg:hidden" />

          {/* The shake is on this block and not on the board: a transform on the
              board would become the containing block of the takeover and the
              drag ghost, which are `fixed`. Nothing fixed is inside this one. */}
          <div className={`flex min-w-0 flex-1 flex-col lg:min-h-0 lg:[grid-area:field] ${damageNow ? (damageNow.n % 2 ? "arena-fx-shake-a" : "arena-fx-shake-b") : ""}`}>

            {/* The field: their strip, their row with their leader first, the
                lane, your row, your strip. Open sky — no panel round it. */}
            {/* The field is also what a takeover covers and what the verdict slams
                over; the hand and the prompt are outside it and stay usable. */}
            <section className={`arena-stage relative flex min-w-0 flex-1 flex-col pt-1.5 lg:min-h-0 lg:pb-1.5 ${takeoverOn ? "min-h-[440px] lg:min-h-0" : ""}`} aria-label="Battle Areas">
              <PlayerStrip side={view.them} them cardProps={cardProps} hit={hitOf(view.them.player)} narrator={narrator} className="mx-2" />
              {/* Dimmed and blurred under the band, never hidden: the position
                being fought over stays legible while the fight resolves. */}
              <div className={`flex min-w-0 flex-1 flex-col ${bandOn ? (asksForBoard ? "arena-behind-soft" : "arena-behind") : ""}`}>
                <BattleRow
                  side={view.them}
                  cards={view.them.battle.filter((c) => !lifted.has(c.id))}
                  cardProps={cardProps}
                  zone="p2:battle"
                  label={`${view.them.name}'s Battle Area`}
                  active={!acting}
                  lifted={lifted}
                  hurt={hurting === view.them.player}
                  hit={hitOf(view.them.player)}
                />
                <Lane view={view} cardProps={cardProps} staged={!!shape} narration={held && beat?.t === "clash" && playback.playing ? { ...held, text: "Clash!" } : (held ?? story.at(-1) ?? null)} onLog={() => (wide ? setDeskTab((t) => (t === "log" ? "play" : "log")) : setLogOpen((x) => !x))} logOpen={logOpen}>
                  {logOpen && (
                    <div className="arena-logpop absolute inset-x-2 top-1 z-30 rounded-xl p-3 lg:hidden" role="dialog" aria-label="Battle log">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-space-300">Battle log</span>
                        <button type="button" onClick={() => setLogOpen(false)} className="arena-iconbtn tap -my-2 -mr-2 flex h-11 w-11 items-center justify-center" aria-label="Close battle log">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </div>
                      <ol className="max-h-56 space-y-0.5 overflow-y-auto text-xs leading-relaxed text-space-200">
                        <StoryList story={story} />
                      </ol>
                    </div>
                  )}
                </Lane>
                <BattleRow
                  side={view.you}
                  cards={view.you.battle.filter((c) => !lifted.has(c.id))}
                  cardProps={cardProps}
                  zone="p1:battle"
                  label="Your Battle Area"
                  active={acting}
                  drop={battleDrop}
                  lifted={lifted}
                  hurt={hurting === view.you.player}
                  hit={hitOf(view.you.player)}
                />
              </div>
              {bandOn && shape && <DuelBand shape={shape} cardProps={stagedProps} beat={beat} progress={playback.playing ? { index: playback.index, total: playback.total } : null} />}
              <PlayerStrip
                side={view.you}
                cardProps={cardProps}
                hit={hitOf(view.you.player)}
                narrator={narrator}
                energyChips={energyChips}
                drop={energyDrop}
                willRest={willRest}
                gain={gain}
                className="mx-2"
              />
              {takeoverOn && (
                <Takeover
                  shape={shape}
                  cardProps={stagedProps}
                  beat={beat}
                  progress={playback.playing ? { index: playback.index, total: playback.total } : null}
                  note={asksForHand ? "Tap hand cards to combo" : null}
                  yourPick={asksForHand}
                  desk={wide}
                />
              )}
              {/* Who won the fight, named. Outside the stagings on purpose: it must
                  appear on all three, and a battle that has already closed by the
                  time the beats arrive has no staging left to carry it. */}
              <BattleVerdict beat={beat} sideOf={sideOf} leaders={[view.you.leader?.id, view.them.leader?.id]} />
            </section>
          </div>

          {/* The fan, and the moves that have no card, in the grid's hand row. */}
          <div className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:justify-end lg:[grid-area:hand]">
          {playable && !playback.playing && !isTargeting && (modal || bare.length > 3) && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2 sm:gap-2">
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

          <Hand cards={view.you.hand ?? []} cardProps={cardProps} dragId={drag?.id ?? null} dragFor={dragFor} chargeable={chargeGesture} />
          </div>

          {/* The prompt bar: one line and its buttons, the last thing on the
            board. A takeover covers the field only, so the bar stays where it
            is and stays usable while the fight is up. */}
          <div className="sticky bottom-0 z-30 lg:static lg:[grid-area:bar]">
            <PromptPanel
              view={view}
              playable={playable}
              yourTurn={yourTurn}
              waitingOnServer={waitingOnServer}
              busy={busy}
              playing={playback.playing}
              refusalText={refusal?.text ?? null}
              error={error}
              pace={pace}
              playingMine={!!(beat && actorOf(beat) === view.you.player)}
              playingIndex={playback.index}
              moves={moveCount}
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
        </div>

        {/* The left column: who is in the match, the phase list, a tip. */}
        <MatchColumn view={view} versus={live.game.mode === "versus"} className="hidden lg:flex lg:[grid-area:left]" />

        <div className="hidden lg:block lg:min-h-0 lg:[grid-area:side]">
          <InspectorColumn
            tab={deskTab}
            onTab={setDeskTab}
            inspector={
              <DockedInspector
                card={inspectCard}
                where={inspectWhere}
                chips={inspectChips}
                stats={
                  inspectCard && (
                    <StatTiles
                      card={inspectCard}
                      leader={inspectAt?.zone === "leader" ? { life: inspectAt.side.life, energy: `${inspectAt.side.activeEnergy}/${inspectAt.side.energy.length}` } : null}
                    />
                  )
                }
                actions={inspectCard && <ActionRows card={inspectCard} side={view.you} moves={inspectMoves} rejected={inspectRejected} onPick={pickMove} narrator={narrator} docked />}
                pinned={!!pinned}
                onUnpin={() => setPinned(null)}
                narrator={narrator}
                battle={inspectId ? shareOf(inspectId) : null}
              />
            }
            inPlay={
              <InPlayList
                sides={inPlaySides}
                inspected={inspectId}
                onReview={(id) => {
                  setRowHover(id);
                  if (id && !pinned) setInspected(id);
                }}
                onPin={setPinned}
              />
            }
            story={story}
          />
        </div>

        {view.battle && !shape && <AttackBeam from={view.battle.attacker} to={view.battle.guard} hostRef={boardRef} />}

        {beatNow?.t === "markers" && beatNow.from && (
          <MarkerFlight beat={{ ...beatNow, from: beatNow.from }} hostRef={boardRef} art={beats?.art ?? {}} ownerOfTo={ownerOf(beatNow.card) ?? view.turnPlayer} ms={msFor(beatNow, pace)} />
        )}

        {moreOpen && (
          <Sheet title="Board controls" onClose={() => setMoreOpen(false)}>
            {/* The game page's own links — back, give up, the debug view — live
                here now that the board has the screen (the page passes them). */}
            {menu && <MenuSection title="Game">{menu}</MenuSection>}
            {/* From lg the log is the right column's second tab. */}
            <div className="lg:hidden">
              <MenuSection title="Log">
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setLogOpen(true);
                  }}
                  className="tap text-[11px] uppercase tracking-widest text-ki-300 hover:text-ki-400 sm:text-xs"
                >
                  battle log
                </button>
              </MenuSection>
            </div>
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

        {admin && adminOpen && <AdminDrawer snapshot={live} debug={adminDebug} beats={beats?.list ?? []} log={log} narrator={{ viewer: view.you.player, them: view.them.name, art: beats?.art ?? {}, ownerOf }} onFlag={(note) => server.flag(gameId, note)} onClose={() => setAdminOpen(false)} />}

        {/* The ki beam and the barrier, measured between the two cards wherever they are. */}
        <ClashBeam beat={beat} hostRef={boardRef} />

        {/* The end of the game, on the board (redesign frame 10): once the last
            beat has played, never over it. */}
        {view.over && !playback.playing && !turnCall && !endDismissed && (
          <GameEnd
            over={view.over}
            you={view.you.player}
            them={view.them.name}
            turn={view.turn}
            canRematch={!live.game.archived}
            versus={live.game.mode === "versus"}
            onRematch={() => server.rematch(gameId)}
            onDismiss={() => setEndDismissed(true)}
          />
        )}

        <Ghosts ghosts={playback.ghosts} art={beats?.art ?? {}} />

        {/* The card in the air. */}
        {drag && dragCard && (
          <div
            aria-hidden
            className="arena-dragghost fixed z-[90]"
            data-over={drag.over && !drag.back ? "" : undefined}
            data-bad={drag.over && !drag.back && !(drag.over === "battle" ? dragPlays.length > 0 : dragCharges.length > 0) ? "" : undefined}
            data-back={drag.back ? "" : undefined}
            style={{ left: drag.x, top: drag.y, pointerEvents: "none" }}
          >
            <ArenaCard card={dragCard} width={66} />
          </div>
        )}

        {hover && !wide && !sheet && !searchOpen && <CardPreview card={hover.card} box={hover.box} narrator={narrator} />}

        {sheet && (
          <CardSheet
            card={cardOf(sheet.id) ?? sheet}
            side={view.you}
            narrator={narrator}
            moves={playable && !busy && !isTargeting ? movesFor(sheet.id) : []}
            rejected={rejectedFor(sheet.id)}
            onPick={pickMove}
            onClose={() => setSheet(null)}
            battle={shareOf(sheet.id)}
            sequence={sequence}
            where={whereOf(sheet.id)}
            chips={chipsFor(sheet.id, true)}
            leader={sheetAt?.zone === "leader" ? { life: sheetAt.side.life, energy: `${sheetAt.side.activeEnergy}/${sheetAt.side.energy.length}` } : null}
            onJump={(c) => setSheet(cardOf(c.id) ?? c)}
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
    </AdminContext.Provider>
  );
}
