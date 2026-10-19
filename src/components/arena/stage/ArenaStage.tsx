"use client";

import Link from "next/link";
import { useImmersionPreferences } from "@/lib/arena/immersion/preferences";

import { ArenaImmersion, ImmersionSettings } from "../immersion/ArenaImmersion";

import { GamePlanPanel } from "./GamePlanPanel";

import { LayoutGroup, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ArenaSession } from "../session/contract";

import type { Action, LegalAction, PlayerId, Requirement } from "@/lib/arena/types";
import type { NumberedBeat } from "@/lib/arena/beats";
import { feel } from "@/lib/arena/feel";
import type { Snapshot } from "@/lib/arena/snapshot";
import { planMoves, type GameplanPreview, type PlanMove } from "@/lib/arena/gameplan-types";
import type { AttackPreview, CardView, ChoicePreview } from "@/lib/arena/view";
import { useWakeLock } from "@/lib/arena/wake";
import { isStructuralRequirement } from "../ability-panel-model";
import { ArenaCard, type CardState } from "../ArenaCard";
import { CardImage } from "@/components/CardImage";
import { FeelToggle } from "../FeelToggle";
import { PaceToggle } from "../PaceToggle";
import { SkinToggle } from "../SkinToggle";
import { usePace } from "@/lib/arena/pace";
import { PhaseChips, TurnBanner, TurnPill } from "./TurnPresence";
import { withShortOpponent } from "./opponent-name";
import { useBoardFit, useCompactSqueeze, useFieldFit } from "./use-board-fit";
import type { TurnCall } from "./useBeatPlayer";
import { colourOf, DEFAULT_LIGHTING, turnVars, type TurnLighting } from "@/lib/arena/lighting";
import type { ArenaSkin } from "@/lib/arena/skin";
import { ReportBug } from "../ReportBug";
import { narrate } from "@/lib/arena/narration";
import { foldStory, type StoryLine } from "@/lib/arena/story";
import type { AdminDebug } from "@/lib/arena/admin-debug";
import { AdminContext } from "../admin-context";
import { AdminDrawer, AdminShield } from "./AdminDrawer";
import { missingEnergyChips, pill, priceOf } from "@/lib/arena/wording";
import {
  ActionRows,
  SkillActions,
  AttackBeam,
  CardPreview,
  CardSheet,
  DockedInspector,
  InspectorColumn,
  type CardPager,
  SearchSheet,
  Sheet,
  SkillSpotlight,
  StatTiles,
  StepBanner,
  cardsOnTable,
  isGhostAction,
  refusalLine,
  type InspectorChip,
  type SheetMove,
} from "../shared";
import { battleShape, BattleVerdict, ClashBeam, firedInBattle } from "./BattleParts";
import { DuelBand } from "./DuelBand";
import { Ghosts } from "./Ghosts";
import { Hand } from "./Hand";
import phoneStyles from "./phone-board.module.css";
import type { DropState } from "./StageZones";
import { MarkerFlight } from "./MarkerFlight";
import { fxVars, msFor, phaseBanner, stepBannerMs, turnBannerMs } from "./motion";
import { StagingToggle } from "../StagingToggle";
import { DEFAULT_STAGING, type ArenaStaging } from "@/lib/arena/staging";
import type { Moment } from "./StageCard";
import { Takeover } from "./Takeover";
import { GameEnd } from "./GameEnd";
import { useBeatPlayer } from "./useBeatPlayer";
import { useLiveGame } from "./useLiveGame";
import { useIdle } from "./useIdle";
import { CenterPrompt } from "./CenterPrompt";
import { PromptPanel } from "./PromptPanel";
import { stakesSummary } from "./stakes-model";
import { feedbackFromBeats, useFeedbackCues } from "./useFeedbackCues";
import { FeedbackOverlay } from "./FeedbackOverlay";
import { StoryList } from "../shared-display";
import { BattleRow, cardIdOf, Lane, MenuSection, PlayerStrip, ReferenceCounts } from "./StageZones";
import { SkipChip, SpeedButton } from "./SpeedButton";
import { QuietNotice } from "./QuietNotice";
import { FightSpotlight, PlaySpotlight } from "./FocusMoments";
import { skillCardYields } from "@/lib/arena/immersion/skills";
import { quietSkills } from "./quiet-skills";

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
/**
 * Whether the board is wide enough for its three columns, game status, field and card (Tailwind `lg`,
 * landscape tablets and up; owner, 19 Oct 2026).
 * Behaviour only — the column itself is shown by CSS, so there is nothing to
 * mismatch on hydration. False on the server, which has no pointer to hover.
 */
const WIDE = "(min-width: 1024px)";
/** Moves whose price the player settles before sending them (`settlePayment`). */
const PAYABLE = new Set<Action["type"]>(["play", "playUnison", "playZ", "activate", "combo", "counter"]);
type PaymentOption = NonNullable<LegalAction["paymentPreview"]>["options"][number];

type ArenaDecklist = {
  name: string;
  cards: { cardId: string; name: string; count: number; imageUrl: string | null }[];
};

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
  session,
  snapshot,
  skin = "night",
  staging = DEFAULT_STAGING,
  lighting = DEFAULT_LIGHTING,
  announceTurn = false,
  admin = false,
  adminDebug = null,
  menu = null,
  decklists,
  onTutorialState,
  onExit,
}: {
  /**
   * The transport (#648): snapshots in, actions out, connection status, and the
   * capabilities it has. The board imports no server action and no router —
   * the game page passes the online session (`OnlineArenaStage`), the fixture
   * preview (`/arena/preview`, dev-only) passes stubs, and a local worker will
   * pass its own.
   */
  session: ArenaSession;
  /** Practice host observes readiness; board controls and animation retain priority. */
  onTutorialState?: (state: { busy: boolean; reviewOpen: boolean; targeting: boolean }) => void;
  snapshot: Snapshot;
  skin?: ArenaSkin;
  staging?: ArenaStaging;
  lighting?: TurnLighting;
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
   * The game page's static links (back to the Arena and, for an admin, the
   * debug view), drawn in the menu sheet's Game section.
   */
  menu?: React.ReactNode;
  /** A local host can save/close its session before leaving the board. */
  onExit?: () => void;
  /** Decklists supplied by the host only when that host is allowed to show them. */
  decklists?: Partial<Record<PlayerId, ArenaDecklist>>;
}) {
  const immersionPrefs = useImmersionPreferences();
  const [pending, startTransition] = useTransition();
  const [advancing, setAdvancing] = useState(false);
  const [advanceFailed, setAdvanceFailed] = useState(false);
  const [abandonPending, startAbandon] = useTransition();
  const [abandonError, setAbandonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * A payment waiting on the player (`settlePayment`): `marker` when only an energy marker completes the
   * price, `colour` when the energy cards could pay in ways that leave different colours ready.
   */
  const [payAsk, setPayAsk] = useState<{ kind: "marker" | "colour"; action: Action; card: string | null; options: PaymentOption[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** The hand card whose browse preview is open on a phone; in the Charge phase the dock offers to charge it. */
  const [peekedId, setPeekedId] = useState<string | null>(null);
  const [attackPick, setAttackPick] = useState<{ action: number; attacker: string; target: string } | null>(null);
  /** The card whose action sheet is open — from a tap, a long press or a right-click. */
  const [sheet, setSheet] = useState<CardView | null>(null);
  const [paymentHighlight, setPaymentHighlight] = useState<{ card: string; ids: string[] } | null>(null);
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
  const wide = useWide();
  const [logOpen, setLogOpen] = useState(false);
  /** A combo tapped and sent but not yet drawn by the engine: the fight and the hand show it at once. */
  const [pendingCombo, setPendingCombo] = useState<{ id: string; name: string; plus: number; rev: number } | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  /** The narration log (#350): what `NarrationRibbon` said, kept, oldest first. */
  const [story, setStory] = useState<StoryLine[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);
  /** The end screen was put away to look at the final board. */
  const [endDismissed, setEndDismissed] = useState(false);
  const asked = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  useBoardFit(boardRef);
  /**
   * The no-target notices the player has acknowledged (#783), by beat number, and the last beat the
   * board had already seen when it mounted: a reload tells nothing again.
   */
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<number>>(() => new Set());
  const [noticeMark] = useState(() => snapshot.beats?.list.at(-1)?.n ?? 0);
  /** An advance asked for while a notice stood: it goes when the notice is acknowledged. */
  const advanceHeld = useRef(false);
  const noticeUp = useRef(false);
  /** Bumped to ask for the computer's advance on the next commit (after your move, or an OK). */
  const [advanceAsk, setAdvanceAsk] = useState(0);

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
  const liveGame = useLiveGame(session, snapshot, pending || advancing || pollWhile || (snapshot.game.mode === "versus" && snapshot.game.status === "playing"));
  const live = liveGame.snapshot;
  const showConnectionIssue = liveGame.connection !== "connected" && liveGame.connection !== "paused";
  const { legal, taps, beats } = live;
  const view = useMemo(() => withShortOpponent(live.view, live.game.mode), [live.view, live.game.mode]);
  // Desktop: the field's cards fill the two Battle Areas (`useFieldFit`).
  useFieldFit(boardRef, wide, Math.max(view.you.battle.length + (view.you.unison ? 1 : 0), view.them.battle.length + (view.them.unison ? 1 : 0)));
  const [planOpen, setPlanOpen] = useState(false);
  const [planRevision, setPlanRevision] = useState(live.game.revision);
  const [planFirst, setPlanFirst] = useState<Action | null>(null);
  const [planAttempt, setPlanAttempt] = useState<Action[]>([]);
  const [plan, setPlan] = useState<GameplanPreview | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planPending, startPlan] = useTransition();
  const planRequest = useRef(0);
  const liveRevision = useRef(live.game.revision);
  useEffect(() => { liveRevision.current = live.game.revision; }, [live.game.revision]);
  const planCurrent = planRevision === live.game.revision;
  const planChoices = planMoves(legal, view.you.player);
  const requestPlan = (actions: Action[]) => {
    if (!session.preview) return;
    const revision = live.game.revision;
    setPlanRevision(revision);
    const request = ++planRequest.current;
    setPlanAttempt(actions);
    setPlan(null);
    setPlanError(null);
    startPlan(async () => {
      try {
        const result = await session.preview!(actions, revision);
        if (request !== planRequest.current || liveRevision.current !== revision) return;
        setPlanError(result.error);
        setPlan(result.preview);
        if (result.error) session.refresh();
      } catch {
        if (request !== planRequest.current || liveRevision.current !== revision) return;
        setPlan(null);
        setPlanError("Could not check the plan. Try again.");
      }
    });
  };
  const selectPlanFirst = (move: PlanMove) => {
    setPlanFirst(move.action);
    requestPlan([move.action]);
  };

  const giveUp = () => {
    if (!session.abandon) return;
    setAbandonError(null);
    const basedOn = live.game.revision;
    const requestId = crypto.randomUUID();
    startAbandon(async () => {
      const result = await session.abandon!(basedOn, requestId);
      if (result.error) {
        setAbandonError(result.error);
        // A stale rejection means a concurrent write won. Refresh the server
        // render while keeping the rejection visible in this client shell.
        session.refresh();
      }
    });
  };

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

  const launchAdvance = useCallback(() => {
    // A notice is a stop (#783): the computer's next move waits for the player's OK.
    if (noticeUp.current) {
      advanceHeld.current = true;
      return;
    }
    if (asked.current) return;
    asked.current = true;
    setAdvanceFailed(false);
    setError(null);
    if (!session.advance) {
      asked.current = false;
      return;
    }
    setAdvancing(true);
    void session.advance()
      .then((result) => {
        if (result.error) {
          setError(result.error);
          setAdvanceFailed(true);
        }
      })
      .catch(() => {
        setError("The opponent could not be reached. Retry to resume the saved turn.");
        setAdvanceFailed(true);
      })
      .finally(() => setAdvancing(false));
  }, [session]);

  // Reduced motion is not a second code path: it simply never queues anything,
  // which is the same state the board reaches the instant you press Skip.
  const still = useReducedMotion();
  const pace = usePace();

  // The fight, worked out once (`BattleParts`) and drawn by whichever staging
  // is chosen. `inplace` is the original board and lifts nothing.
  // On by default: the fight is staged on a phone too (owner, 17 Oct 2026). The settings sheet still offers the compact board.
  const [phoneCinema, setPhoneCinema] = useState(true);
  const effectiveStaging = !wide && !phoneCinema ? "inplace" : staging;
  useCompactSqueeze(boardRef, !wide);
  const staged = effectiveStaging !== "inplace" && !!view.battle;
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
  const takeoverOn = !!shape && effectiveStaging === "takeover" && !asksForBoard;
  // Only until the engine answers: a new revision, or a refusal, and the real chain takes over.
  const incoming = pendingCombo && pendingCombo.rev === live.game.revision && !error && pendingCombo.plus > 0 ? pendingCombo : null;
  const bandOn = !!shape && !takeoverOn;

  useWakeLock(playable && !live.over);

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

  /**
   * A skill that found no target (#783), as a notice dismissed manually or after four seconds. `pendingQuiet` is
   * any not yet acknowledged — it holds the computer's next advance at once; `notice` is the one
   * the story has reached, which is what is on screen (and what pauses the story).
   */
  const quiet = quietSkills(beats?.list ?? [], beats?.art ?? {}, view.prompt.kind);
  const pendingQuiet = quiet.find((q) => q.n > noticeMark && !acknowledged.has(q.n)) ?? null;
  const notice = pendingQuiet && (!playback.playing || (beatNow != null && beatNow.n >= pendingQuiet.n)) ? pendingQuiet : null;
  useLayoutEffect(() => {
    noticeUp.current = admin && !!pendingQuiet;
  }, [pendingQuiet, admin]);
  const acknowledge = (n: number) => {
    setAcknowledged((prev) => new Set(prev).add(n));
    noticeUp.current = admin && quiet.some((q) => q.n > noticeMark && q.n !== n && !acknowledged.has(q.n));
    if (advanceHeld.current && !noticeUp.current) {
      advanceHeld.current = false;
      asked.current = false;
      setAdvanceAsk((k) => k + 1);
    }
  };

  // The narration log takes each beat as it is told, not as it arrives, so
  // reading it back never spoils a move the board has yet to play.
  const told = beats && playback.playing && beatNow ? { ...beats, list: beats.list.filter((b) => b.n <= beatNow.n) } : beats;
  const folded = foldStory(story, told, { viewer: view.you.player, them: view.them.name, art: beats?.art ?? {}, ownerOf }, view.turn, actorOf);
  if (folded !== story) setStory(folded);

  // Only for arriving at a game that is already mid-turn — a normal move runs
  // the opponent's reply inside `act` itself.
  useEffect(() => {
    if (!serverDecides || asked.current || pendingQuiet) return;
    launchAdvance();
  }, [serverDecides, launchAdvance, pendingQuiet]);
  // The advance after your own move, asked for on the commit that drew the move's result — so a
  // no-target notice in that result holds it (#783) instead of racing it.
  useEffect(() => {
    if (!advanceAsk || asked.current) return;
    launchAdvance();
  }, [advanceAsk, launchAdvance]);

  /**
   * Reading a card stops the fight (`docs/arena-battle-staging-spec.md`
   * decision 6). A battle that runs on behind an open card is the reason the
   * inspector exists at all. It re-runs when playback starts, so a queue that
   * arrives while a card is open is held too rather than playing underneath it.
   */
  const { pause, resume } = playback;
  useEffect(() => {
    if (sheet || notice) pause();
    else resume();
  }, [sheet, notice, playback.playing, pause, resume]);

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
    if (!id) setAttackPick(null);
    setRefusal(null);
  };

  /**
   * Energy markers are a one-off (owner, 19 Oct 2026): a price the energy cards can pay is paid with them,
   * and one that needs a marker is asked first. Which colours to rest is asked only when it matters: when
   * the ways the energy cards could pay leave different colours ready. The engine asks whenever the ways to
   * pay differ (3-8-2), so the answer goes with the move as its `pay` (the cards to rest; markers make up the rest).
   */
  const settlePayment = (action: Action): Action | "ask" => {
    if (!PAYABLE.has(action.type) || (action as { pay?: string[] }).pay !== undefined) return action;
    const key = JSON.stringify(action);
    const options = (legal.find((l) => l.action === action) ?? legal.find((l) => JSON.stringify(l.action) === key))?.paymentPreview?.options ?? [];
    if (!options.length) return action;
    const energyOnly = options.filter((o) => o.markers === 0);
    if (!energyOnly.length) {
      setPayAsk({ kind: "marker", action, card: cardIdOf(action), options });
      return "ask";
    }
    // One option per set of colours rested: two Reds are the same answer, a Red or a Blue is not.
    const byColours = new Map<string, PaymentOption>();
    for (const o of energyOnly) {
      const colours = o.energyRest.map((id) => energyColoursOf(id).join("/")).sort().join("+");
      if (!byColours.has(colours)) byColours.set(colours, o);
    }
    if (byColours.size > 1) {
      setPayAsk({ kind: "colour", action, card: cardIdOf(action), options: [...byColours.values()] });
      return "ask";
    }
    return options.length === 1 ? action : ({ ...action, pay: energyOnly[0].energyRest } as Action);
  };
  const energyColoursOf = (id: string): string[] => view.you.energyColors?.find((e) => e.card === id)?.colors ?? cardOf(id)?.colors ?? [];
  /** The colours still ready once these cards are rested, for the colour question. */
  const readyAfter = (rest: string[]): string[] => view.you.energy.filter((c) => c.mode === "active" && !rest.includes(c.id)).flatMap((c) => energyColoursOf(c.id).slice(0, 1));

  const send = (action: Action, settled = false) => {
    if (notice && admin) return;
    if (!settled) {
      const paid = settlePayment(action);
      if (paid === "ask") return;
      action = paid;
    }
    setPayAsk(null);
    setSheet(null);
    setPinned(null);
    setSelected(null);
    setAttackPick(null);
    setHover(null);
    setError(null);
    setAdvanceFailed(false);
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
      const r = await session.act(action, live.game.revision, crypto.randomUUID());
      if (r.error) {
        setError(r.error);
        feel("illegal");
      } else {
        // `act` has committed the human action. Start the separate AI request
        // without holding the action transition open, so the board acknowledges
        // the move before the opponent finishes thinking. It goes on the next
        // commit, which has drawn the move's result (and any notice in it).
        asked.current = false;
        setAdvanceAsk((n) => n + 1);
      }
    });
  };

  const targetsOf = (id: string) => taps.attackTargets[id];
  const isTargeting = selected != null && !!targetsOf(selected);
  // While the story of the last turn is still being told, the board is a
  // picture rather than a control surface.
  const busy = pending || advancing || playback.playing;

  /** A card as the board currently draws it, wherever it sits. */
  const cardOf = (id: string): CardView | null => {
    for (const side of [view.you, view.them]) {
      for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, ...side.energy, ...(side.hand ?? []), ...side.lifeFaceUp, ...side.zDeckFaceUp, ...(side.choices ?? []), ...Object.values(side.inspectableZones ?? {}).flat(), side.dropTop]) {
        if (c?.id === id) return c;
      }
    }
    return null;
  };
  const whyOf = (id: string): Requirement[] | undefined => taps.whyByCard?.[id];
  const targetReasonOf = (id: string) => rejected.find((item) => item.action.type === "attack" && item.action.attacker === selected && item.action.target === id)?.why.find((why) => why.kind === "target");
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
      out.push({ index: i, legal: l, choicePreview: choicePreviewOf(i) });
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
      if (idx != null) {
        const action = legal[idx].action;
        if (action.type === "attack") {
          // Choosing a legal target declares the attack. The engine still owns
          // every counter, block, combo and payment window that follows.
          return send(action);
        }
      }
      const targetWhy = targetReasonOf(id);
      if (targetWhy?.kind === "target") {
        feel("illegal");
        setRefusal({ card: id, text: targetWhy.reason });
        return;
      }
      select(null);
      return;
    }
    // The phone Charge phase is a staged choice: select for the dock, then
    // explicitly commit there. Tapping a second card changes the selection;
    // tapping the selected card opens its review.
    if (chargeGesture(id)) {
      if (!wide && selected === id) {
        const card = cardOf(id);
        if (card) setSheet(card);
        return;
      }
      if (!wide) { select(id); return; }
      const p = press.current;
      if (p.detail === 0 || sheet) { /* keyboard review stays available below */ }
      else if (p.type === "mouse") return;
      else if (p.held < 450) return;
    }
    // From 1024 px a click (or a tablet's tap) also pins the card in the card column, so what it does
    // and what it says are on show while the move goes ahead.
    if (wide) setPinned(id);
    const options = taps.byCard[id];
    const why = whyOf(id);
    // A combo window asks for exactly one thing from the hand, and the hint says "tap a glowing card":
    // one tap adds it. The card lifts and the fight's total counts it at once (`pendingCombo`) rather
    // than opening a review and waiting for a second confirm.
    if (view.prompt.kind === "combo" && inHand(id)) {
      const combos = (options ?? []).filter((i) => legal[i].action.type === "combo");
      // One tap adds it only when the combo is all the card can do: a card that also has an
      // [Activate] to offer opens its sheet, which lists both (#1008).
      if (combos.length === 1 && options?.length === 1) {
        const card = cardOf(id);
        setPendingCombo({ id, name: card?.name ?? "", plus: card?.comboPower ?? 0, rev: live.game.revision });
        return send(legal[combos[0]].action);
      }
    }
    // On a phone, touching a hand card always opens its review. The action
    // button inside that review is the deliberate commit; drags still work.
    if (!wide && inHand(id)) {
      const card = cardOf(id);
      if (card) setSheet(card);
      return;
    }
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
    // A ready card goes straight to legal targets. Its other skills and full
    // rules remain available through the inspect gesture and card review.
    const targets = targetsOf(id);
    // On a phone a card with an attack AND another legal move (a leader's [Awaken], a Battle Card's
    // [Activate: Main]) opens its sheet, which lists both: selecting would start the attack pick and
    // leave the other move out of reach (#1008). Attacking alone stays one tap.
    const attackOnly = options.every((i) => legal[i].action.type === "attack");
    if (targets && Object.keys(targets).length > 0 && (wide || attackOnly)) return select(id);
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
      setAttackPick(null);
      select(cardIdOf(m.legal.action)!);
      return;
    }
    send(m.legal.action);
  };

  const stateOf = (id: string): CardState => {
    if (attackPick?.target === id) return "selected";
    if (isTargeting) return targetsOf(selected!)?.[id] != null ? "legal" : selected === id ? "selected" : "dim";
    if (selected === id) return "selected";
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
  useEffect(() => {
    onTutorialState?.({ busy, reviewOpen: !!sheet || !!attackPick || searchOpen || moreOpen, targeting: isTargeting });
  }, [busy, sheet, attackPick, searchOpen, moreOpen, isTargeting, onTutorialState]);

  const chooseNone = taps.bare.find((i) => legal[i].action.type === "choose" && (legal[i].action as { cards: string[] }).cards.length === 0) ?? null;
  // A hidden-zone search only exposes the prompt's own candidates. Rejected
  // choose diagnostics span the whole board and are not cards looked at.
  // The bar's buttons. While a search is on, "Choose none" lives in the sheet
  // and the bar keeps one button that reopens it, so the question has room.
  const bare = taps.bare.filter((i) => !(searching && i === chooseNone)).map((i) => ({ i, l: legal[i] })).sort((a, b) => Number(isGhostAction(a.l.action)) - Number(isGhostAction(b.l.action)));
  const inlineBare = !playback.playing && !isTargeting && playable && !modal
    ? bare.length > 3 ? [...bare.slice(0, 2), bare[bare.length - 1]] : bare
    : modal && !playback.playing && playable ? bare : [];
  const overflowBare = bare.filter(({ i }) => !inlineBare.some((item) => item.i === i));
  const primaryBare = inlineBare.findIndex(({ l }) => !isGhostAction(l.action));
  const yourTurn = view.prompt.player === view.you.player;
  const attacksRemaining = new Set(legal.flatMap((item) => item.action.type === "attack" ? [item.action.attacker] : [])).size;
  // The card to offer a charge for: the selected one, else the one open in the hand preview.
  const chargeCandidate = view.prompt.kind !== "charge" ? null
    : selected && chargesOf(selected).length > 0 ? selected
    : peekedId && chargeGesture(peekedId) ? peekedId : null;
  const selectedChargeIndex = chargeCandidate ? chargesOf(chargeCandidate)[0] : undefined;
  const selectedChargeCard = selectedChargeIndex == null ? null : cardOf(chargeCandidate!);
  const chargePassIndex = taps.bare.find((i) => legal[i].action.type === "charge" && legal[i].action.card == null);
  const chargeSelection = !wide && selectedChargeCard && selectedChargeIndex != null ? {
    card: selectedChargeCard,
    action: legal[selectedChargeIndex].action,
    passAction: chargePassIndex == null ? null : legal[chargePassIndex].action,
    ready: view.you.activeEnergy,
    total: view.you.energy.length,
  } : null;
  // The Main Phase twin of the charge dock: the hand card open in the browse preview, offered with each
  // legal way to play it. The engine still asks for any payment choice after the tap.
  const playCandidate = !wide && view.prompt.kind === "main" && yourTurn && playable && !busy && !isTargeting && !sheet && peekedId && inHand(peekedId) ? peekedId : null;
  const playCard = playCandidate ? cardOf(playCandidate) : null;
  const playOptions = playCard ? (taps.byCard[playCandidate!] ?? []).filter((i) => legal[i].action.type === "play").map((i) => ({ action: legal[i].action, label: legal[i].label, cost: legal[i].cost?.energy ?? (Number.isFinite(Number(playCard.cost)) ? Number(playCard.cost) : null) })) : [];
  const playSelection = playCard && playOptions.length > 0 ? { card: playCard, options: playOptions, ready: view.you.activeEnergy } : null;
  // A "choose a card" question (discard to the Drop, add to hand, …) answered from the hand: the card open in
  // the browse preview is offered with the engine's own `choose` action for it.
  const pickCandidate = !wide && view.prompt.kind === "chooseCards" && yourTurn && playable && !busy && !sheet && peekedId && inHand(peekedId) ? peekedId : null;
  const pickIndex = pickCandidate ? (taps.byCard[pickCandidate] ?? []).find((i) => legal[i].action.type === "choose") : undefined;
  const pickCard = pickCandidate && pickIndex != null ? cardOf(pickCandidate) : null;
  const pickSelection = pickCard && pickIndex != null ? { card: pickCard, action: legal[pickIndex].action, question: view.prompt.question } : null;
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
  const passiveFeedback = useFeedbackCues(live.beats, !!still);
  const feedback = still ? passiveFeedback : feedbackFromBeats(beat ? [beat] : []);
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

  // The skill banner is bound to the beat on screen, so each ability
  // in a turn gets its moment in the story's order — the row's `spotlight`
  // only ever names the last one.
  const beatSpotlight =
    beat?.t === "skill" || beat?.t === "autoDeclared"
      ? {
          seq: beat.n,
          cardId: beats?.art[beat.card]?.cardId ?? "",
          name: beats?.art[beat.card]?.name ?? "",
          label: beat.t === "autoDeclared" ? `Declared · ${beat.label}` : beat.reveal ? `Activated · ${beat.label}` : beat.label,
          text: beat.text,
          unread: beat.t === "skill" && beat.unread,
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
  const choicePreviewOf = (index: number): ChoicePreview | undefined => live.choicePreviews?.find((preview) => preview.action === index);
  const attackPreviewOf = (index: number): AttackPreview | undefined => live.attackPreviews?.find((preview) => preview.action === index);
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
        if (!wide) {
          if (zone === "energy") { select(id); return; }
          if (card && choicePreviewOf(list[0])?.state !== undefined && choicePreviewOf(list[0])?.state !== "notEvaluated") { setSheet(card); return; }
        }
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
          // A sideways phone swipe belongs to the scrollable hand. Vertical
          // gestures still use the existing server-offered play/charge drag.
          if (!wide && Math.abs(e.clientX - d.sx) > Math.abs(e.clientY - d.sy) && Math.abs(e.clientX - d.sx) >= 8) {
            dragRef.current = null;
            return;
          }
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
  const defaultPayment = sheet ? movesFor(sheet.id).find((move) => move.legal.paymentPreview?.state === "known")?.legal.paymentPreview
    : drag && !drag.back && dragPlays.length ? legal[dragPlays[0]].paymentPreview : undefined;
  const restingIds = sheet && paymentHighlight?.card === sheet.id ? paymentHighlight.ids
    : defaultPayment?.state === "known" ? defaultPayment.options[0]?.energyRest ?? [] : [];
  const willRest = restingIds.filter((id) => view.you.energy.some((card) => card.id === id && card.mode === "active")).length;
  useEffect(
    () => () => {
      if (gainTimer.current) clearTimeout(gainTimer.current);
      if (snapTimer.current) clearTimeout(snapTimer.current);
      if (edgeRaf.current != null) cancelAnimationFrame(edgeRaf.current);
    },
    [],
  );

  const cardProps = (c: CardView) => ({
    // The card pinned in the card column, outlined where it sits.
    outlined: wide && pinned === c.id,
    layoutMotion: wide && !still,
    feedback: feedback.cards[c.id] ?? null,
    card: c,
    state: stateOf(c.id),
    suppressed: playback.suppressed.has(c.id),
    nudge: nudging && !!taps.byCard[c.id]?.length,
    moment: momentOf(c.id),
    onTap: taps.byCard[c.id]?.length || whyOf(c.id)?.length || isTargeting ? () => tapCard(c.id) : wide ? () => setPinned(c.id) : () => inspect(c),
    onDoubleTap: chargeGesture(c.id) ? () => doubleTapCard(c.id) : undefined,
    onInspect: () => inspect(c),
    onHover: hoverOf(c),
  });

  type HandActionStatus = "playable" | "targets" | "noTarget" | "skill" | "unaffordable" | "counter" | "charge";
  const handStatus = (id: string): HandActionStatus | null => {
    const indices = taps.byCard[id] ?? [];
    const actions = indices.map((i) => legal[i].action);
    if (view.prompt.kind === "combo" && actions.some((a) => a.type === "combo")) return "playable";
    if (actions.some((a) => a.type === "counter" || a.type === "block") || rejected.some((r) => cardIdOf(r.action) === id && r.action.type === "counter") || cardOf(id)?.abilities?.some((ability) => ability.category === "counter")) return "counter";
    const play = indices.find((i) => legal[i].action.type === "play");
    if (play != null) {
      const preview = choicePreviewOf(play);
      if (preview?.state === "empty") return "noTarget";
      if (preview?.state === "available" && (preview.candidates?.length ?? 0) > 0) return "targets";
      return "playable";
    }
    if (actions.some((a) => a.type === "charge")) return "charge";
    const activate = indices.find((i) => legal[i].action.type === "activate");
    if (activate != null) {
      const preview = choicePreviewOf(activate);
      if (preview?.state === "empty") return "noTarget";
      if (preview?.state === "available" && (preview.candidates?.length ?? 0) > 0) return "targets";
      return "skill";
    }
    const failed = rejected.filter((r) => cardIdOf(r.action) === id);
    if (failed.some((r) => (r.action.type === "play" || r.action.type === "activate") && r.why.some((w) => w.kind === "energy" || w.kind === "energyColour"))) return "unaffordable";
    if (failed.some((r) => r.action.type === "activate")) return "skill";
    return null;
  };
  /** The player's answer to the payment question: the move goes with that payment, already settled. */
  const payWith = (option: number) => {
    if (payAsk) send({ ...payAsk.action, pay: payAsk.options[option].energyRest } as Action, true);
  };
  /** What a hand chip does when tapped: the move its words name, or the card's review when it needs a closer look. */
  const runHandAction = (id: string) => {
    if (busy) return;
    const indices = taps.byCard[id] ?? [];
    const of = (type: Action["type"]) => indices.find((i) => legal[i].action.type === type);
    const combo = view.prompt.kind === "combo" ? of("combo") : undefined;
    if (combo != null) return send(legal[combo].action);
    const play = of("play");
    if (play != null) return choicePreviewOf(play)?.state === "empty" ? reviewCard(id) : send(legal[play].action);
    const charge = of("charge");
    if (charge != null) return send(legal[charge].action);
    reviewCard(id);
  };
  const reviewCard = (id: string) => {
    const card = cardOf(id);
    if (card) inspect(card);
  };
  const handAction = (id: string): string | null => {
    const indices = taps.byCard[id] ?? [];
    if (view.prompt.kind === "combo") {
      if (!indices.some((i) => legal[i].action.type === "combo")) return null;
      const power = cardOf(id)?.comboPower;
      return power == null ? "Combo" : `+${power / 1000}k`;
    }
    const play = indices.find((i) => legal[i].action.type === "play");
    if (play != null) {
      const preview = choicePreviewOf(play);
      if (preview?.state === "empty") return "⚠ Play · skill idle";
      if (preview?.state === "available" && (preview.candidates?.length ?? 0) > 0) return `▲ Play · ${preview.candidates!.length} targets`;
      return "▲ Play";
    }
    if (indices.some((i) => legal[i].action.type === "charge")) return "⚡ Charge";
    const activate = indices.find((i) => legal[i].action.type === "activate");
    if (activate != null) {
      const preview = choicePreviewOf(activate);
      if (preview?.state === "empty") return "⚠ Skill idle";
      if (preview?.state === "available" && (preview.candidates?.length ?? 0) > 0) return `▲ Skill · ${preview.candidates!.length} targets`;
      return "Skill";
    }
    const failed = rejected.find((r) => cardIdOf(r.action) === id && r.action.type === "play");
    const need = failed?.why.find((w) => w.kind === "energy" || w.kind === "energyColour");
    if (need?.kind === "energy") return `Play · ${need.need} ⚡`;
    if (need?.kind === "energyColour") return `Play · ${need.need} ${need.colour} ⚡`;
    const card = cardOf(id);
    if (card?.abilities?.some((ability) => ability.category === "counter") || rejected.some((r) => cardIdOf(r.action) === id && r.action.type === "counter")) return "Counter";
    return null;
  };

  // --- The docked inspector's content ----------------------------------------
  // Never an empty box (#444): the last card hovered while it is still on the
  // table, else the first card of your hand, else a leader.
  const fallbackId = view.you.hand?.[0]?.id ?? view.you.leader?.id ?? view.them.leader?.id ?? null;
  const inspectId = pinned ?? (inspected && cardOf(inspected) ? inspected : null) ?? fallbackId;
  const inspectCard = wide && inspectId ? cardOf(inspectId) : null;
  function locate(id: string) {
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
        ["Drop", side.inspectableZones?.drop ?? []],
        ["Warp", side.inspectableZones?.warp ?? []],
        ["Z-Energy", side.inspectableZones?.zEnergy ?? []],
        ["Z-Deck", side.inspectableZones?.zDeck ?? []],
        ["search", side.choices ?? []],
      ];
      for (const [zone, cards] of zones) if (cards.some((c) => c?.id === id)) return { side, zone };
    }
    return null;
  }
  const attackConfirmation = (() => {
    if (!attackPick) return null;
    const action = legal[attackPick.action]?.action;
    const attacker = cardOf(attackPick.attacker);
    const target = cardOf(attackPick.target);
    if (action?.type !== "attack" || !attacker || !target || action.attacker !== attacker.id || action.target !== target.id) return null;
    const place = (id: string) => {
      const at = locate(id);
      const area = at?.zone === "leader" ? "Leader" : at?.zone === "unison" ? "Unison" : "Battle Card";
      return `${at?.side === view.you ? "Your" : `${at?.side.name ?? "Other player"}'s`} ${area}`;
    };
    const preview = attackPreviewOf(attackPick.action);
    const battle = preview?.state === "known" ? preview.battle : undefined;
    let result: string | null = null;
    if (battle?.stakes) {
      const stakes = battle.stakes;
      const winner = stakes.tied ? "Tie → attacker wins ties" : stakes.hit ? "Attacker wins" : "Attack held";
      const at = locate(target.id);
      if (stakes.hit && stakes.target === "leader" && at) {
        const after = Math.max(0, at.side.life - stakes.lifeDamage);
        result = `${winner} · ${at.side.name} takes ${stakes.lifeDamage} life · life ${at.side.life} → ${after}`;
      } else result = `${winner} · ${stakesSummary(battle)}`;
    }
    return { attacker, target, attackerRole: place(attacker.id), targetRole: place(target.id), preview, result };
  })();
  const targetLabel = (card: CardView): string | null => {
    if (!isTargeting || wide) return null;
    if (attackConfirmation) return null;
    if (targetsOf(selected!)?.[card.id] != null) return locate(card.id)?.zone === "leader" ? "Tap to attack" : card.mode === "rest" ? "Rested · tap" : "Tap to attack";
    const reason = targetReasonOf(card.id);
    if (!reason || reason.kind !== "target") return null;
    if (/active|standing|rested/i.test(reason.reason)) return "✕ Active";
    return `✕ ${reason.reason}`;
  };
  const defending = !!view.battle && view.turnPlayer !== view.you.player;
  const attackSummary = attackConfirmation ? (
    <div className="arena-attack-summary w-full max-w-sm rounded-xl border border-space-600 bg-space-900/90 p-2 text-xs leading-snug text-space-100" data-attack-summary>
      {[view.them, view.you].map((side) => {
        const attacks = locate(attackConfirmation.attacker.id)?.side.player === side.player;
        const card = attacks ? attackConfirmation.attacker : attackConfirmation.target;
        const role = attacks ? attackConfirmation.attackerRole : attackConfirmation.targetRole;
        const battle = attackConfirmation.preview?.battle;
        return <p key={side.player} className="flex items-start gap-2 py-0.5">
          <span className="min-w-0 flex-1 break-words"><b>{card.name}</b><span className="block text-[10px]">{role} · {attacks ? "ATTACKER" : "TARGET"}</span></span>
          {attackConfirmation.preview?.state === "known" && battle && <b className="shrink-0 font-mono tabular-nums">{(attacks ? battle.attackPower : battle.guardPower).toLocaleString("en")}</b>}
        </p>;
      })}
      <p className="mt-1 break-words" data-attack-stakes>{attackConfirmation.preview?.state === "known" ? `If nothing else changes: ${attackConfirmation.result}` : attackConfirmation.preview?.reason ?? "A skill must resolve before this result can be shown."}</p>
    </div>
  ) : null;
  const responseType = view.prompt.kind === "counter" ? "counter" : view.prompt.kind === "blocker" ? "block" : null;
  const defendOptions = responseType && defending ? [
    ...legal.flatMap((offer, index) => {
      const action = offer.action;
      if (action.type !== responseType || !("card" in action) || !action.card) return [];
      const card = cardOf(action.card);
      if (!card) return [];
      const projected = live.blockPreviews?.find((entry) => entry.action === index);
      const b = projected?.state === "known" ? projected.battle : null;
      // A card with two ways to answer (a Counter also payable "by adding 1 from your life") is listed
      // twice, each under its engine label, so the rows can be told apart.
      const ways = legal.filter((entry) => entry.action.type === responseType && "card" in entry.action && entry.action.card === action.card).length;
      return [{ card, action, label: ways > 1 ? offer.label : card.name, detail: card.text,
        cost: priceOf(action, card, offer.label, offer.cost), reason: null,
        impact: responseType === "block" ? b?.stakes ? `${b.guardPower.toLocaleString("en")} vs ${b.attackPower.toLocaleString("en")}: ${stakesSummary(b)} You lose ${b.stakes.lifeDamage} life.` : projected?.reason ?? "The exact outcome needs the next battle snapshot." : null }];
    }),
    ...rejected.flatMap((offer) => {
      const action = offer.action;
      if (action.type !== responseType || !("card" in action) || !action.card || legal.some((entry) => entry.action.type === responseType && "card" in entry.action && entry.action.card === action.card)) return [];
      const card = cardOf(action.card);
      if (!card) return [];
      return [{ card, action: null, label: card.name, detail: card.text, cost: null,
        reason: refusalLine(offer.why, { name: card.name, reaching: responseType, side: view.you, inHand: inHand(card.id) }) ?? "Unavailable now", impact: null }];
    }),
  ] : [];
  const whereOf = (id: string) => {
    const at = locate(id);
    return at ? `${at.side === view.you ? "Your" : `${at.side.name}'s`} ${at.zone}` : null;
  };
  const inspectAt = inspectCard && inspectId ? locate(inspectId) : null;
  const inspectWhere = wide && inspectId ? whereOf(inspectId) : null;
  const rejectedFor = (id: string) => (playable && !busy ? rejected.filter((r) => cardIdOf(r.action) === id) : []);
  const inspectRejected = wide && inspectId ? rejectedFor(inspectId) : [];
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
    const previews = live.choicePreviews ?? [];
    for (const preview of previews) {
      const action = legal[preview.action]?.action;
      if (action?.type !== "activate" || action.card !== id || preview.state === "notEvaluated") continue;
      if (preview.state === "available") chips.push({ label: `${preview.candidates?.length ?? 0} valid target${preview.candidates?.length === 1 ? "" : "s"}`, tone: "good" });
      else chips.push({ label: "Skill idle", tone: "plain" });
    }
    for (const index of taps.byCard[id] ?? []) {
      const move = legal[index];
      if (move.action.type === "activate" && move.cost) chips.push({ label: `${move.cost.energy} energy skill`, tone: "plain" });
    }
    const allWhy = rejectedFor(id).flatMap((r) => r.why);
    const why = card.abilities?.length ? allWhy.filter((item) => !isStructuralRequirement(item)) : allWhy;
    const short = inHand(id) ? why.find((w) => w.kind === "energy") : undefined;
    if (short) chips.push({ label: `Play cost · ${pill(short).replace("short", "energy short")}`, tone: "bad" });
    if (reason) {
      const other = why.find((w) => w.kind !== "energy");
      if (other) chips.push({ label: pill(other), tone: "bad" });
      else if (at.side !== view.you && !chips.some((c) => c.tone === "good")) chips.push({ label: `${at.side.name}'s card`, tone: "plain" });
    }
    return chips;
  };
  const inspectChips = wide && inspectId ? chipsFor(inspectId) : [];
  const inspectMoves: SheetMove[] = [];
  if (wide && inspectId && playable && !busy) {
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
  const inPlayRun = sheet ? [view.them, view.you].flatMap((side) => [side.leader, side.unison, ...side.battle].filter((c): c is CardView => !!c).map((card) => ({ card, yours: side === view.you }))) : [];
  const handRun = sheet ? (view.you.hand ?? []).map((card) => ({ card, yours: true, status: handStatus(card.id),
    playable: (taps.byCard[card.id] ?? []).some((i) => legal[i].action.type === "play" || legal[i].action.type === "activate"),
    counter: card.abilities?.some((ability) => ability.category === "counter") || handStatus(card.id) === "counter",
  })) : [];
  const zoneNames: Record<string, string> = { drop: "Drop", warp: "Warp", zEnergy: "Z-Energy", zDeck: "Z-Deck" };
  const zoneRuns = sheet ? [view.you, view.them].flatMap((side) => Object.entries(side.inspectableZones ?? {}).map(([zone, cards]) => ({ label: `${side.name} · ${zoneNames[zone] ?? zone}`, items: cards.map((card) => ({ card, yours: side === view.you })) }))) : [];
  const sequence = sheet ? (inPlayRun.some((i) => i.card.id === sheet.id) ? { label: "In play", items: inPlayRun } : handRun.some((i) => i.card.id === sheet.id) ? { label: "Your hand", items: handRun } : zoneRuns.find((run) => run.items.some((i) => i.card.id === sheet.id)) ?? null) : null;
  const sheetAt = sheet ? locate(sheet.id) : null;

  // The card column pages through the group the card on show belongs to (owner, 19 Oct 2026).
  const pagerGroups: { label: string; cards: CardView[] }[] = [
    { label: "Your hand", cards: view.you.hand ?? [] },
    { label: "Your cards in play", cards: [view.you.leader, ...view.you.battle, view.you.unison].filter((c): c is CardView => !!c) },
    { label: `${view.them.name}'s cards in play`, cards: [view.them.leader, ...view.them.battle, view.them.unison].filter((c): c is CardView => !!c) },
  ];
  const pagerGroup = wide && inspectId ? pagerGroups.find((g) => g.cards.some((c) => c.id === inspectId)) : undefined;
  const cardPager: CardPager | null = pagerGroup && inspectId
    ? { label: pagerGroup.label, cards: pagerGroup.cards, index: pagerGroup.cards.findIndex((c) => c.id === inspectId), onGo: (id) => setPinned(id) }
    : null;

  // The players' strips: across the field on a phone, stacked in the status column from 1024 px.
  const themStrip = (
    <PlayerStrip side={view.them} them cardProps={cardProps} hit={hitOf(view.them.player)} lifeCue={feedback.life[view.them.player]} narrator={narrator} onOpenInspection={wide ? undefined : () => setZonesOpen(true)} className={wide ? "" : "mx-2"} />
  );
  const youStrip = (
    <PlayerStrip
      lifeCue={feedback.life[view.you.player]}
      side={view.you}
      cardProps={cardProps}
      onOpenInspection={wide ? undefined : () => setZonesOpen(true)}
      hit={hitOf(view.you.player)}
      narrator={narrator}
      energyChips={energyChips}
      drop={energyDrop}
      willRest={willRest}
      restingIds={restingIds}
      gain={gain}
      className={wide ? "" : "mx-2"}
    />
  );

  return (
    <AdminContext.Provider value={admin}>
    <LayoutGroup>
      <div
        ref={boardRef}
        // Below sm the board runs to the screen's edges (the page keeps a
        // 0.5 rem gutter for everything else), so its edge line is flush.
        // From lg the board has one match strip over the field and hand. On
        // desktop the decision sits beside the hand and card review stays right.
        className={`${phoneStyles.board} arena arena-board relative mx-auto flex w-full max-w-7xl flex-col max-sm:-mx-2 max-lg:min-h-[calc(100dvh-1rem)] max-sm:w-[calc(100%+1rem)]`}
        data-skin={skin}
        data-phone-cinema={phoneCinema}
        data-response-window={defending ? view.prompt.kind : undefined}
        style={{ ...turnStyle, ...fxVars(pace) }}
      >
        {/* Speed lines under an attack — a skin's moment, driven by the beat on
            screen like every other; it draws nothing on the night table. */}
        {beat && (beat.t === "attack" || beat.t === "clash") && <div key={beat.n} className="arena-speedlines pointer-events-none absolute inset-0 z-20" aria-hidden />}
        {/* A card revealed from the hand: a brief flash over the whole board (rd-07).
            */}
        {beat?.t === "move" && beat.from === "hand" && beat.to === "battle" && beat.owner === view.you.player && (
          <div key={beat.n} className="arena-fx-flash absolute inset-0 z-[35]" aria-hidden />
        )}
        {/* The edge: a thin line in the acting side's colour, switching with the banner. */}
        <div className="arena-edge" aria-hidden />
        <div className={phoneStyles.scrollRail} aria-hidden />
        <TurnBanner call={turnCall} view={view} lighting={lighting} ms={turnBannerMs(pace)} holdUntilTap={pace === "step"} />
        <StepBanner step={step} hold={!!turnCall || playback.turnAhead} ms={stepBannerMs(pace)} playing={playback.playing} cue={beatNow?.t === "phase" && phaseBanner(beatNow) ? { n: beatNow.n, key: phaseBanner(beatNow)! } : null} />
        {/* A skill fired inside a staged battle is said on the card that fired
            it, so the banner would be the same sentence twice over the fight. */}
        {/* A secret declaration is scoped to the current masked beat. Unmount
            its spotlight when that beat or its art disappears, so a queued
            animation cannot retain the card after concealment. */}
        {beat && (beat.t === "autoDeclared" || (beat.t === "skill" && beat.reveal))
          ? beats?.art[beat.card] && <SkillSpotlight key={`secret-${beat.n}`} spotlight={beatSpotlight} />
          : <SkillSpotlight spotlight={(shape && beat?.t === "skill" && beat.inBattle) || skillCardYields(beat) ? null : beatSpotlight} />}
        {/* Everything in the flow but the docked inspector: one column of its own,
            so the inspector can run the full height of it, hand included. */}
        {/* From lg it is `display: contents`: its children are placed in the grid's areas. */}
        <div className="flex min-w-0 flex-1 flex-col lg:contents">
          {/* One desktop match strip: turn and phase are said here, while the
              board's two resource strips show life and energy at their zones.
              It sticks
              to the top of a phone's screen so the turn is never scrolled away. */}
          <div className={`arena-topbar sticky top-0 z-30 flex ${showConnectionIssue ? "h-[96px] flex-wrap content-start sm:h-[52px] sm:flex-nowrap sm:content-center lg:h-auto" : "h-[52px] sm:h-[52px] lg:h-auto"} min-w-0 items-center gap-1.5 pl-2.5 pr-0.5 sm:rounded-t-[14px] lg:min-h-[60px] lg:flex-wrap lg:gap-x-4 lg:gap-y-1 lg:px-3 lg:py-1 lg:[grid-area:top]`}>
            {onExit ? <button type="button" onClick={onExit} className="tap min-h-11 px-1 text-xs font-semibold text-space-100">Exit</button> : <Link href="/arena" className="tap inline-flex min-h-11 items-center px-1 text-xs font-semibold text-space-100">Exit</Link>}
            <TurnPill view={view} />
            {playback.playing && <SkipChip onSkip={playback.skip} />}
            <PhaseChips view={view} cue={feedback.phase} className="arena-match-phases hidden min-w-0 border-0 lg:flex" />
            {showConnectionIssue && (
              <div className="order-last flex min-w-0 basis-full justify-center sm:order-none sm:basis-auto sm:justify-start">
                <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-950/45 px-2 py-0.5 text-[11px] leading-none text-amber-100 sm:gap-2 sm:px-2.5 sm:py-1 sm:text-xs" role="status" aria-live="polite" data-arena-connection={liveGame.connection}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
                  <span className="shrink-0">{liveGame.connection === "offline" ? "Offline" : "Reconnecting…"}</span>
                  <button type="button" onClick={liveGame.retry} className="min-h-11 min-w-[44px] shrink-0 rounded px-1 py-1 font-semibold text-white underline decoration-white/60 underline-offset-2 hover:text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200" aria-label="Retry arena connection">
                    Retry
                  </button>
                </div>
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <span className="hidden lg:contents"><SpeedButton /></span>
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
              {/* Below lg the battle log opens over the lane; from lg it is always in the status column. */}
              <button
                type="button"
                onClick={() => setLogOpen((open) => !open)}
                className="arena-iconbtn tap flex h-11 w-11 items-center justify-center lg:hidden"
                aria-label="Battle log"
                aria-pressed={logOpen}
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
          <div className="h-[30px] shrink-0 lg:hidden" data-phase-step={view.battle ? 3 : view.phase === "charge" ? 1 : view.phase === "main" || view.phase === "mainEnd" ? 2 : view.phase === "end" ? 4 : 0}>
            <PhaseChips view={view} cue={feedback.phase} className="arena-phases-row h-full overflow-hidden px-2" />
          </div>

          {/* The shake is on this block and not on the board: a transform on the
              board would become the containing block of the takeover and the
              drag ghost, which are `fixed`. Nothing fixed is inside this one. */}
          <div className={`flex min-w-0 flex-1 flex-col lg:min-h-0 lg:[grid-area:field] ${damageNow ? (damageNow.n % 2 ? "arena-fx-shake-a" : "arena-fx-shake-b") : ""}`}>

            {/* The field: their strip, their row with their leader first, the
                lane, your row, your strip. Open sky — no panel round it. */}
            {/* The field is also what a takeover covers and what the verdict slams
                over; the hand and the prompt are outside it and stay usable. */}
            <section data-takeover={takeoverOn ? "" : undefined} className={`arena-stage relative flex min-w-0 flex-1 flex-col pt-1.5 lg:min-h-0 lg:pb-1.5 ${takeoverOn ? "min-h-[250px] lg:min-h-0" : ""}`} aria-label="Battle Areas">
              {!wide && themStrip}
              {/* Dimmed and blurred under the band, never hidden: the position
                being fought over stays legible while the fight resolves. */}
              <div className={`flex min-w-0 flex-1 flex-col ${bandOn ? (asksForBoard ? "arena-behind-soft" : "arena-behind") : ""}`}>
                <BattleRow
                  side={view.them}
                  cards={view.them.battle.filter((c) => !lifted.has(c.id))}
                  cardProps={cardProps}
                  zone="p2:battle"
                  them
                  label={`${view.them.name}'s Battle Area`}
                  active={!acting}
                  lifted={lifted}
                  compactLifted={!wide && bandOn && asksForHand}
                  hurt={hurting === view.them.player}
                  hit={hitOf(view.them.player)}
                  targetLabel={targetLabel}
                  attackRole={attackPick ? { attacker: attackPick.attacker, target: attackPick.target } : null}
                />
                <Lane view={view} cardProps={cardProps} staged={!!shape} narration={held && beat?.t === "clash" && playback.playing ? { ...held, text: "Clash!" } : (playback.playing ? held : null)} onLog={() => setLogOpen((x) => !x)} logOpen={logOpen} summary={attackSummary}>
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
                  compactLifted={!wide && bandOn && asksForHand}
                  hurt={hurting === view.you.player}
                  hit={hitOf(view.you.player)}
                  targetLabel={targetLabel}
                  attackRole={attackPick ? { attacker: attackPick.attacker, target: attackPick.target } : null}
                />
              </div>
              {bandOn && shape && <DuelBand shape={shape} cardProps={stagedProps} beat={beat} progress={playback.playing ? { index: playback.index, total: playback.total } : null} />}
              {!wide && youStrip}
              {takeoverOn && (
                <Takeover
                  shape={shape}
                  cardProps={stagedProps}
                  beat={beat}
                  progress={playback.playing ? { index: playback.index, total: playback.total } : null}
                  note={asksForHand ? "Tap hand cards to combo" : null}
                  yourPick={asksForHand}
                  incoming={incoming}
                  desk={wide}
                />
              )}
              {/* Who won the fight, named. Outside the stagings on purpose: it must
                  appear on all three, and a battle that has already closed by the
                  time the beats arrive has no staging left to carry it. */}
              <BattleVerdict beat={immersionPrefs.banners ? null : beat} sideOf={sideOf} leaders={[view.you.leader?.id, view.them.leader?.id]} unisons={[view.you.unison?.id, view.them.unison?.id]} viewer={view.you.player} />
            </section>
          </div>

          {/* The fan, and the moves that have no card, in the grid's hand row. */}
          <div className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:justify-end lg:[grid-area:hand]">
          {playable && !playback.playing && !isTargeting && overflowBare.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2 sm:gap-2">
              {overflowBare.map(({ i, l }) => (
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

          {!wide && defending && (view.prompt.kind === "counter" || view.prompt.kind === "blocker") && <p className="arena-hand-folded px-3 py-1 text-xs text-space-200">Your hand · not needed for this answer</p>}
          {!(!wide && (isTargeting || (defending && (view.prompt.kind === "counter" || view.prompt.kind === "blocker")))) && <Hand sendingId={incoming?.id ?? null} onPeek={setPeekedId} browseEnabled={!isTargeting && !busy && view.prompt.kind !== "combo"} cards={view.you.hand ?? []} cardProps={cardProps} dragId={drag?.id ?? null} dragFor={dragFor} chargeable={chargeGesture} handStatus={handStatus} handAction={handAction} onHandAction={runHandAction} defending={view.prompt.kind === "counter" || view.prompt.kind === "blocker" || view.prompt.kind === "combo"} onZones={() => setZonesOpen(true)} decisionHint={!wide && bandOn && asksForHand && view.prompt.kind === "combo" ? "Tap a glowing card to combo" : undefined} />}
          </div>

          {/* On a phone this is only the decision, sticky under the hand. From 1024 px it is the status
              column: both players, the battle log, and the decision at its foot. */}
          <div className="arena-context lg:min-h-0">
          {wide && (
            <div data-arena-status aria-label="Game status">
              <div className="p-2">{themStrip}</div>
              <section className="arena-statuslog flex min-h-0 flex-1 flex-col px-3 pb-1" aria-label="Battle log">
                <h3 className="py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-space-300">Battle log</h3>
                <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain text-xs leading-relaxed text-space-200">
                  <StoryList story={story} />
                </ol>
              </section>
              <div className="p-2">{youStrip}</div>
            </div>
          )}
          {payAsk && (
            <CenterPrompt label={payAsk.kind === "marker" ? "Use an energy marker?" : "Which energy do you rest?"}>
              <div className="arena-bar space-y-2 p-4" data-pay-ask={payAsk.kind}>
                <p className="text-base font-bold text-space-50">{payAsk.kind === "marker" ? "Use your energy marker?" : `Which energy pays for ${payAsk.card ? cardOf(payAsk.card)?.name ?? "this card" : "this move"}?`}</p>
                <p className="text-sm text-space-200">{payAsk.kind === "marker"
                  ? <>Your ready energy can’t pay for {payAsk.card ? cardOf(payAsk.card)?.name ?? "this card" : "this move"} on its own. An energy marker is spent once and doesn’t come back.</>
                  : "The colours you keep ready decide what you can still play this turn."}</p>
                {payAsk.options.map((o, i) => {
                  const colours = o.energyRest.map((id) => energyColoursOf(id)[0] ?? "energy");
                  const markers = `${o.markers} energy marker${o.markers === 1 ? "" : "s"}`;
                  const left = readyAfter(o.energyRest);
                  return <button key={i} type="button" disabled={busy} onClick={() => payWith(i)} className={`arena-btn tap block min-h-12 w-full rounded-xl px-4 py-2 text-left text-base font-bold disabled:opacity-50 ${i === 0 ? "bg-ki-500 text-space-950 hover:bg-ki-400" : "border border-space-600 bg-space-800 text-space-50"}`} data-pay-option={i}>
                    {payAsk.kind === "marker" ? (colours.length ? `Rest ${colours.join(", ")} + ${markers}` : `Spend ${markers}`) : `Rest ${colours.join(", ")}`}
                    <span className="block text-xs font-normal">{left.length ? `Keeps ready: ${left.join(", ")}` : "No energy left ready"}</span>
                  </button>;
                })}
                <button type="button" onClick={() => setPayAsk(null)} className="arena-btn tap block min-h-11 w-full rounded-xl border border-space-600 bg-space-800 px-4 text-sm font-semibold text-space-50" data-pay-cancel>{payAsk.kind === "marker" ? "Keep the marker" : "Cancel"}</button>
              </div>
            </CenterPrompt>
          )}
          <div data-arena-dock className={`${phoneStyles.dock} sticky bottom-0 z-30 lg:static lg:z-auto lg:shrink-0`}>
            <PromptPanel
              view={view}
              decision={live.decision}
              handDecision={!wide && view.prompt.kind === "combo"}
              overOutcome={live.over}
              playable={playable}
              yourTurn={yourTurn}
              waitingOnServer={waitingOnServer}
              busy={busy}
              playing={playback.playing}
              refusalText={refusal?.text ?? null}
              error={error}
              onRetry={playable && advanceFailed ? () => {
                asked.current = false;
                launchAdvance();
              } : undefined}
              pace={pace}
              playingMine={!!(beat && actorOf(beat) === view.you.player)}
              playingIndex={playback.index}
              moves={moveCount}
              playingTotal={playback.total}
              yourPlayer={view.you.player}
              isTargeting={isTargeting}
              onCancelTargeting={() => select(null)}
              attackConfirmation={attackConfirmation}
              onConfirmAttack={() => { if (attackPick && legal[attackPick.action]?.action.type === "attack") send(legal[attackPick.action].action); }}
              searching={searching}
              searchOpen={searchOpen}
              choicesCount={choices.length}
              onReopenSearch={() => setClosedSearch(null)}
              inlineBare={chargeSelection ? [] : inlineBare}
              attacksRemaining={attacksRemaining}
              defendOptions={defendOptions}
              primaryBare={primaryBare}
              onSend={send}
              chargeSelection={chargeSelection}
              playSelection={playSelection}
              pickSelection={pickSelection}
              onNext={playback.next}
            />
          </div>
          </div>
          {/* The card column: the hovered or pinned card, paged through its group. */}
          {wide && <div className="arena-cardcol">
          <InspectorColumn
            pager={cardPager}
            inspector={
              <DockedInspector
                card={inspectCard}
                where={inspectWhere}
                chips={inspectChips}
                stats={
                  inspectCard && (
                    <StatTiles
                      stacked
                      card={inspectCard}
                      leader={inspectAt?.zone === "leader" ? { life: inspectAt.side.life, energy: `${inspectAt.side.activeEnergy}/${inspectAt.side.energy.length}` } : null}
                    />
                  )
                }
                basicActions={inspectCard && inspectMoves.some((move) => move.legal.action.type === "charge" || move.legal.action.type === "attack") && <div className="space-y-2" data-review-basic-actions><ActionRows card={inspectCard} side={view.you} moves={inspectMoves.filter((move) => move.legal.action.type === "charge" || move.legal.action.type === "attack")} rejected={[]} onPick={pickMove} narrator={narrator} docked basicOnly /></div>}
                actions={inspectCard && <ActionRows card={inspectCard} side={view.you} moves={inspectMoves.filter((move) => move.legal.action.type !== "charge" && move.legal.action.type !== "attack")} rejected={inspectRejected} onPick={pickMove} narrator={narrator} docked skillsInline />}
                skillActions={(key) => {
                  const line = inspectCard?.abilities?.find((l) => `${l.origin}:${l.skillIndex}:${l.category}` === key);
                  return inspectCard && line ? <SkillActions card={inspectCard} side={view.you} line={line} moves={inspectMoves} onPick={pickMove} narrator={narrator} /> : null;
                }}
                pinned={!!pinned}
                onUnpin={() => setPinned(null)}
                narrator={narrator}
                battle={inspectId ? shareOf(inspectId) : null}
              />
            }
          />
          </div>}
        </div>

        {view.battle && !shape && <AttackBeam from={view.battle.attacker} to={view.battle.guard} hostRef={boardRef} />}
        {attackPick && <AttackBeam from={attackPick.attacker} to={attackPick.target} hostRef={boardRef} />}

        {beatNow?.t === "markers" && beatNow.from && (
          <MarkerFlight beat={{ ...beatNow, from: beatNow.from }} hostRef={boardRef} art={beats?.art ?? {}} ownerOfTo={ownerOf(beatNow.card) ?? view.turnPlayer} ms={msFor(beatNow, pace)} />
        )}

        {zonesOpen && (
          <Sheet title="Deck and public zones" onClose={() => setZonesOpen(false)}>
          {[view.you, view.them].map((side) => {
            const decklist = decklists?.[side.player];
            return (
              <section key={side.player} className="space-y-3" aria-label={`${side.name} zones`}>
                <h3 className="font-bold text-space-50">{side.name}</h3>
                <div data-inspect-zone={`${side.player}:deck`}>
                  <h4 className="text-sm font-semibold text-space-100">Deck · {side.deck} remaining</h4>
                  {decklist ? (
                    <>
                      <p className="text-xs text-space-300">{decklist.name} · {decklist.cards.reduce((total, card) => total + card.count, 0)} cards</p>
                      <ul className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
                        {decklist.cards.map((card) => (
                          <li key={card.cardId} className="flex min-w-0 items-center gap-2 rounded border border-space-700 bg-space-900/60 p-1.5">
                            <CardImage src={card.imageUrl} alt={card.name} sizes="40px" className="h-12 w-[34px] shrink-0" />
                            <span className="min-w-0 text-xs leading-tight text-space-100">
                              <span className="block truncate">{card.name}</span>
                              <span className="text-space-400">{card.cardId} · {card.count}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : <p className="text-xs text-space-300">Decklist unavailable in this view.</p>}
                </div>
                {([
                  ["Unison", side.unison ? 1 : 0, side.unison ? [side.unison] : []],
                  ["Z-Deck", side.zDeck, side.inspectableZones?.zDeck ?? side.zDeckFaceUp],
                  ["Z-Energy", side.zEnergy, side.inspectableZones?.zEnergy ?? []],
                  ["Drop", side.drop, side.inspectableZones?.drop ?? (side.dropTop ? [side.dropTop] : [])],
                  ["Warp", side.warp, side.inspectableZones?.warp ?? []],
                ] as [string, number, CardView[]][]).map(([zone, count, cards]) => (
                  <div key={zone} data-inspect-zone={`${side.player}:${zone}`}>
                    <h4 className="text-sm font-semibold text-space-100">{zone} · {count}</h4>
                    {count > cards.length && <p className="text-xs text-space-300">{count - cards.length} card faces unavailable in this view.</p>}
                    {count === 0 && <p className="text-xs text-space-400">Empty</p>}
                    <div className="flex flex-wrap gap-2 pt-1">{cards.map((card) => <ArenaCard key={card.id} card={card} width={68} onTap={() => { setZonesOpen(false); setSheet(card); }} />)}</div>
                  </div>
                ))}
              </section>
            );
          })}
          </Sheet>
        )}

        {planCurrent && planOpen && session.capabilities.plan && playable && yourTurn && view.prompt.kind === "main" && (
          <Sheet title="Move preview" onClose={() => setPlanOpen(false)}>
            <GamePlanPanel
              planChoices={planChoices}
              planFirst={planCurrent ? planFirst : null}
              plan={planCurrent ? plan : null}
              planError={planCurrent ? planError : null}
              planPending={planCurrent && planPending}
              onPlanFirst={selectPlanFirst}
              onPlanSecond={(move) => planCurrent && planFirst && requestPlan([planFirst, move.action])}
              onPlanRetry={() => { if (planCurrent && planAttempt.length) requestPlan(planAttempt); }}
              onPlanClear={() => { planRequest.current++; setPlan(null); setPlanFirst(null); setPlanAttempt([]); setPlanError(null); }}
            />
          </Sheet>
        )}

        {moreOpen && (
          <Sheet title="Board controls" onClose={() => setMoreOpen(false)}>
            {/* The game page's links live here; give-up reads this live snapshot. */}
            {(menu || session.capabilities.abandon) && (
              <MenuSection title="Game">
                {menu}
                {session.capabilities.abandon && live.game.status === "playing" && (
                  <div className="mt-2 space-y-1">
                    <button
                      type="button"
                      onClick={giveUp}
                      disabled={abandonPending}
                      className="tap text-space-400 hover:text-loss disabled:opacity-50"
                    >
                      {abandonPending ? "Giving up…" : "give up"}
                    </button>
                    {abandonError && <p role="alert" className="text-xs text-loss">{abandonError}</p>}
                  </div>
                )}
              </MenuSection>
            )}
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
            {session.capabilities.plan && playable && yourTurn && view.prompt.kind === "main" && !busy && !waitingOnServer && planChoices.length > 0 && <MenuSection title="Optional practice tool">
              <button type="button" data-plan-open className="tap min-h-11 text-left text-sm text-ki-300" onClick={() => { setMoreOpen(false); setPlanRevision(live.game.revision); setPlanOpen(true); }}>Try moves without playing</button>
              <p className="text-xs text-space-300">Preview energy costs for moves you choose. Your game stays as it is.</p>
            </MenuSection>}
            <MenuSection title="Feel">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-widest text-space-300 sm:text-xs">
                <FeelToggle />
                <PaceToggle />
              </div>
            </MenuSection>
            <MenuSection title="Combat effects"><ImmersionSettings /></MenuSection>
            <MenuSection title="Board">
              <button type="button" className="tap min-h-11 rounded border border-space-600 px-3 text-sm lg:hidden" aria-pressed={phoneCinema} onClick={() => setPhoneCinema(!phoneCinema)}>{phoneCinema ? "Use compact phone board" : "Enable cinematic battle staging"}</button>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-widest text-space-300 sm:text-xs">
                {session.chooseStaging && <StagingToggle staging={staging} onChoose={session.chooseStaging} />}
                {session.chooseSkin && <SkinToggle skin={skin} onChoose={session.chooseSkin} />}
              </div>
            </MenuSection>
            <MenuSection title="Reference">
              <div className="space-y-2">
                {/* Below lg the hand's toolbar is gone (#783): the public zones open from here. */}
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setZonesOpen(true);
                  }}
                  className="tap min-h-11 rounded border border-space-600 px-3 text-sm lg:hidden"
                  aria-label="Inspect public zones"
                >
                  Zones: Drop, Warp, Z-Deck, Z-Energy
                </button>
                <ReferenceCounts side={view.you} />
                <ReferenceCounts side={view.them} />
              </div>
            </MenuSection>
            {session.reportBug && (
              <MenuSection title="Help">
                <div className="text-[11px] text-space-300 sm:text-xs">
                  <ReportBug cards={cardsOnTable(view)} onReport={session.reportBug} />
                </div>
              </MenuSection>
            )}
          </Sheet>
        )}

        {admin && adminOpen && <AdminDrawer snapshot={live} debug={adminDebug} beats={beats?.list ?? []} narrator={{ viewer: view.you.player, them: view.them.name, art: beats?.art ?? {}, ownerOf }} onFlag={async (note) => (session.flag ? session.flag(note) : { error: "flagging is not available here", flag: null, created: false })} onClose={() => setAdminOpen(false)} />}

        {/* The ki beam and the barrier, measured between the two cards wherever they are. */}
        <ArenaImmersion gameId={session.gameId} beat={beat} events={beats} cardOf={cardOf} art={beats?.art ?? {}} viewer={view.you.player} reducedMotion={!!still} durationMs={beat ? msFor(beat, pace) : 460} board={[view.you.leader, view.them.leader, view.you.unison, view.them.unison, ...view.you.battle, ...view.them.battle]} suppressed={!!sheet || moreOpen || (!!notice && admin) || !!turnCall} onSkip={() => { /* Only the optional effect is dismissed; narration continues. */ }} />
        <ClashBeam beat={beat} hostRef={boardRef} />
        <FeedbackOverlay cues={feedback} art={beats?.art ?? {}} hostRef={boardRef} />
        {/* The opponent playing a card, and a fight no staging is drawing: a dimmed board, the cards large. */}
        <PlaySpotlight beat={playback.playing ? beat : null} art={beats?.art ?? {}} viewer={view.you.player} ms={beat ? msFor(beat, pace) : 900} />
        {!shape && <FightSpotlight beat={playback.playing ? beat : null} art={beats?.art ?? {}} sideOf={sideOf} ms={beat ? msFor(beat, pace) : 900} />}

        {/* The end of the game, on the board (redesign frame 10): once the last
            beat has played, never over it. */}
        {live.over && !playback.playing && !turnCall && !endDismissed && (
          <GameEnd
            over={live.over}
            you={view.you.player}
            them={view.them.name}
            turn={view.turn}
            canRematch={session.capabilities.rematch}
            versus={live.game.mode === "versus"}
            onRematch={() => session.rematch!()}
            onDismiss={() => setEndDismissed(true)}
          />
        )}

        {/* The opponent's own think time, before its beats arrive: said at the top, not only in the prompt bar below the fold. */}
        {waitingOnServer && !playback.playing && !live.over && !turnCall && !notice && (
          <div className="pointer-events-none fixed inset-x-0 top-[3.75rem] z-30 flex justify-center px-2" data-opponent-thinking>
            <span role="status" className="arena-notice inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold text-space-50">
              <span className="arena-pulse h-2 w-2 shrink-0 animate-pulse rounded-full bg-ki-400" aria-hidden />
              {view.them.name} is thinking…
            </span>
          </div>
        )}
        {notice && <QuietNotice key={notice.n} quiet={notice} viewer={view.you.player} them={view.them.name} onOk={() => acknowledge(notice.n)} />}

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

        {sheet && cardOf(sheet.id) && (
          <CardSheet
            card={cardOf(sheet.id)!}
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
            reviewMode={isTargeting ? "targeting" : sheetAt?.side === view.them ? "opponent" : "own"}
            resolveCard={cardOf}
            onPreviewPayment={(ids) => setPaymentHighlight({ card: sheet.id, ids })}
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
