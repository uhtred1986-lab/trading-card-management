package arena

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.ExperimentalSerializationApi

/**
 * One board, as the server sends it. `docs/arena-client-contract.md` §3.
 *
 * Hand-written rather than generated, and kept honest by the round-trip tests
 * against the JSON files in `contract/fixtures` — the same files `npm test` regenerates
 * and compares on the server side. A field renamed on one side fails a build
 * on the other, which is the entire point.
 */
@Serializable
data class Snapshot(
    val contract: Int,
    val game: GameInfo,
    val view: BoardView,
    val legal: List<LegalAction>,
    val taps: Tappable,
    /**
     * The moves the asked player might reach for that are not in `legal`,
     * each with its reasons (`docs/arena-workflow-spec.md`). Absent when the
     * viewer is not the one being asked, and when there is nothing to say.
     */
    val rejected: List<RejectedAction>? = null,
    val beats: Beats? = null,
    val spotlight: Spotlight? = null,
    val log: List<String>,
    /** "you" | "opponent" | "referee", or null once the game is over. */
    val waiting: String? = null,
    val spend: Spend,
    val over: Outcome? = null,
)

@Serializable
data class GameInfo(
    val id: Int,
    val mode: String,
    val status: String,
    val turn: Int,
    val p1Name: String,
    val p2Name: String,
)

/**
 * A move the engine will accept.
 *
 * `action` is deliberately left as opaque JSON. A client picks a move by its
 * **index** in this list and never describes one (contract §5), so there is no
 * reason to model the `Action` union here — and every reason not to, since
 * mirroring it would be a second definition of the rules' vocabulary in a
 * second language.
 */
@Serializable
data class LegalAction(
    val label: String,
    val action: JsonElement,
    /** What the move costs, for the row it sits on; set for skill activations and counters. */
    val cost: ActionCost? = null,
)

@Serializable
data class ActionCost(
    val energy: Int,
    val orbs: Map<String, Int>? = null,
    val markers: Int? = null,
    /** The price in words, as the row shows it. */
    val describe: String,
)

/**
 * A move the player was reaching for and every reason it is not on the menu.
 * `action` is opaque for the same reason `LegalAction`'s is: a client shows
 * the move it cannot make and never sends it.
 */
@Serializable
data class RejectedAction(
    val label: String,
    val action: JsonElement,
    /** Most decisive first. Never empty. */
    val why: List<Requirement>,
)

/**
 * Why a move is not on the menu — a closed vocabulary the client puts into
 * words, so the wording lives on the phone and a translation is a
 * translation rather than a fork. `Other` is the engine's pressure valve.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
sealed class Requirement {
    /** Costs `need`; `have` counts active energy plus energy markers. */
    @Serializable
    @SerialName("energy")
    data class Energy(val need: Int, val have: Int) : Requirement()

    @Serializable
    @SerialName("energyColour")
    data class EnergyColour(val colour: String, val need: Int, val have: Int) : Requirement()

    /** The card is resting; `locked` when a rule keeps it from standing up at its next Charge Phase. */
    @Serializable
    @SerialName("mode")
    data class Mode(val card: String, val mode: String, val locked: Boolean? = null) : Requirement()

    /** `window` is when it *would* be allowed: "main", "battle", "defense", "nextTurn". */
    @Serializable
    @SerialName("timing")
    data class Timing(val window: String) : Requirement()

    /** Already done this turn: "charge", "skill", "Over Realm", …; `limit` is the printed [Limit X] when that is the rule. */
    @Serializable
    @SerialName("oncePerTurn")
    data class OncePerTurn(val what: String, val limit: Int? = null) : Requirement()

    /** `area` is where the card would have to be. */
    @Serializable
    @SerialName("zone")
    data class Zone(val card: String, val area: String) : Requirement()

    @Serializable
    @SerialName("cardType")
    data class CardType(val card: String, val needs: String) : Requirement()

    @Serializable
    @SerialName("target")
    data class Target(val reason: String) : Requirement()

    /** `by` names the card whose rule it is; `until` is how long it holds — a duration, or "permanent". */
    @Serializable
    @SerialName("forbidden")
    data class Forbidden(val by: String? = null, val until: String? = null) : Requirement()

    @Serializable
    @SerialName("unread")
    data class Unread(val card: String) : Requirement()

    /** A printed condition that does not hold yet. */
    @Serializable
    @SerialName("condition")
    data class Condition(val text: String) : Requirement()

    @Serializable
    @SerialName("other")
    data class Other(val detail: String) : Requirement()
}

@Serializable
data class Tappable(
    /** Card instance id → indices into `legal`. */
    val byCard: Map<String, List<Int>>,
    val bare: List<Int>,
    /** Attacker id → (target id → index into `legal`). */
    val attackTargets: Map<String, Map<String, Int>>,
    /** Card instance id → why it has no move, so a tap on a dead card has an answer. */
    val whyByCard: Map<String, List<Requirement>>? = null,
)

@Serializable
data class BoardView(
    val you: SideView,
    val them: SideView,
    val turn: Int,
    val phase: String,
    val turnPlayer: String,
    val battle: BattleView? = null,
    val prompt: PromptView,
    val over: Outcome? = null,
)

@Serializable
data class SideView(
    val player: String,
    val name: String,
    val leader: CardView? = null,
    val unison: CardView? = null,
    val battle: List<CardView>,
    val combo: List<CardView>,
    val energy: List<CardView>,
    /**
     * 3-9-2-1: a life card turned face up is open to both players, and the
     * skills that read it count these — so both sides are told about them.
     */
    val lifeFaceUp: List<CardView> = emptyList(),
    val zDeckFaceUp: List<CardView> = emptyList(),
    /** Null when it is the opponent's hand: only its size is public (3-3-3). */
    val hand: List<CardView>? = null,
    val handCount: Int,
    val life: Int,
    val deck: Int,
    val drop: Int,
    val warp: Int,
    val zDeck: Int,
    val zEnergy: Int,
    val energyMarkers: Int,
    val activeEnergy: Int,
    val dropTop: CardView? = null,
    /**
     * Cards the current prompt names that no zone draws — a search of the
     * deck. Only ever on the side of the player being asked.
     */
    val choices: List<CardView>? = null,
    /** Rules in force on this player rather than on a card ("can't attack with Battle Cards"). */
    val rules: List<EffectView>? = null,
)

@Serializable
data class CardView(
    val id: String,
    val cardId: String,
    val name: String,
    val power: Int? = null,
    val colors: List<String>,
    val imageUrl: String? = null,
    val mode: String,
    val hidden: Boolean,
    val flipped: Boolean,
    val markers: Int,
    val underCount: Int,
    val isToken: Boolean,
    val cost: String? = null,
    val comboCost: Int? = null,
    val comboPower: Int? = null,
    val keywords: List<String>,
    val text: String? = null,
    /** The engine's own reading of the card's text (proposal §6). */
    val reading: String,
    /** True when a skill of this card has to be put to the referee. Never for a [Permanent]. */
    val referee: Boolean,
    /** The printed power, present only when `power` is not it. */
    val basePower: Int? = null,
    /** Every rule in force on this card right now. */
    val effects: List<EffectView>? = null,
    /** This card's own [Permanent] skills and whether each is doing anything at this moment. */
    val permanents: List<PermanentView>? = null,
)

/** One rule in force on a card or a player (`src/lib/arena/effects.ts`). */
@Serializable
data class EffectView(
    /** "power" | "comboPower" | "keyword" | "negate" | "forbid" | "permit" | "cost" | "other" */
    val kind: String,
    /** "+5000 power", "[Critical]", "can't attack", "skills negated", "costs 1 less". */
    val label: String,
    /** A duration ("turn", "battle", "nextTurn", "opponentTurn", "afterNextCharge", "game") or "permanent". */
    val until: String,
    val source: String? = null,
    val sourceName: String? = null,
    val by: String? = null,
    val keyword: String? = null,
)

/** One [Permanent] skill of a card and its state now: "on" | "off" | "inert" | "unread". */
@Serializable
data class PermanentView(
    val index: Int,
    val text: String,
    val state: String,
    val reading: String,
)

@Serializable
data class BattleView(
    val attacker: String,
    val guard: String,
    val step: String,
    val attackPower: Int,
    val guardPower: Int,
)

@Serializable
data class PromptView(
    val kind: String,
    val player: String? = null,
    val question: String,
    val hint: String? = null,
    /** How many cards a `chooseCards` prompt takes; `min` of 0 needs a "Choose none" button. */
    val min: Int? = null,
    val max: Int? = null,
    /** Where this prompt sits in a skill's chain; `count` 0 means the total is not known. */
    val step: StepView? = null,
    /** What is being paid for, from a `payCost` or `optionalCost` prompt. */
    val cost: String? = null,
)

@Serializable
data class StepView(
    val index: Int,
    val count: Int,
    val label: String,
)

@Serializable
data class Spotlight(
    val seq: Int,
    val cardId: String,
    val name: String,
    val label: String,
    val text: String,
    val unread: Boolean,
    val imageUrl: String? = null,
)

@Serializable
data class Spend(
    val calls: Int,
    val input: Int,
    val output: Int,
    val cached: Int,
    val micros: Int,
)

@Serializable
data class Outcome(
    val winner: String? = null,
    val reason: String,
)

// ── the beat stream ────────────────────────────────────────────────────────

@Serializable
data class Beats(
    /** The highest `n` in `list`. Climbs for the whole life of the game. */
    val seq: Int,
    val list: List<Beat>,
    /** Keyed by instance id, for cards that have left the board by now. */
    val art: Map<String, BeatArt>,
)

@Serializable
data class BeatArt(
    val cardId: String,
    val name: String,
    val imageUrl: String? = null,
)

/**
 * What happened, in the few shapes a board can draw. Contract §4.
 *
 * The discriminator is `t`, and every beat carries `n` — beats are numbered
 * rather than counted, so a client replays exactly what it has not yet shown
 * even after the queue has been capped.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("t")
sealed class Beat {
    abstract val n: Int

    @Serializable
    @SerialName("phase")
    data class Phase(override val n: Int, val phase: String, val player: String, val turn: Int) : Beat()

    @Serializable
    @SerialName("draw")
    data class Draw(override val n: Int, val player: String, val card: String? = null) : Beat()

    @Serializable
    @SerialName("move")
    data class Move(override val n: Int, val card: String, val from: String, val to: String, val owner: String) : Beat()

    @Serializable
    @SerialName("mode")
    data class Mode(override val n: Int, val card: String, val mode: String) : Beat()

    @Serializable
    @SerialName("flip")
    data class Flip(override val n: Int, val card: String) : Beat()

    @Serializable
    @SerialName("markers")
    data class Markers(override val n: Int, val card: String, val delta: Int, val total: Int) : Beat()

    @Serializable
    @SerialName("token")
    data class Token(override val n: Int, val card: String, val owner: String) : Beat()

    @Serializable
    @SerialName("attack")
    data class Attack(override val n: Int, val attacker: String, val target: String) : Beat()

    @Serializable
    @SerialName("block")
    data class Block(override val n: Int, val guard: String, val by: String) : Beat()

    @Serializable
    @SerialName("clash")
    data class Clash(
        override val n: Int,
        val attacker: String,
        val guard: String,
        val attackPower: Int,
        val guardPower: Int,
        val hit: Boolean,
    ) : Beat()

    @Serializable
    @SerialName("damage")
    data class Damage(
        override val n: Int,
        val player: String,
        val amount: Int,
        val critical: Boolean,
        val cards: List<String>,
    ) : Beat()

    /** `owner` is null only if the card left the game entirely. */
    @Serializable
    @SerialName("ko")
    data class Ko(override val n: Int, val card: String, val owner: String? = null) : Beat()

    @Serializable
    @SerialName("negated")
    data class Negated(override val n: Int) : Beat()

    /** `owner` is whose skill resolved, so a narration can say whose ability it was. */
    @Serializable
    @SerialName("skill")
    data class Skill(override val n: Int, val card: String, val label: String, val text: String, val unread: Boolean, val owner: String) : Beat()

    /** A rule coming into force on `card`, or on `player` when it is about a player rather than a card. */
    @Serializable
    @SerialName("effect")
    data class Effect(
        override val n: Int,
        val card: String? = null,
        val player: String? = null,
        val kind: String,
        val label: String,
        val until: String,
        val source: String? = null,
        val owner: String,
    ) : Beat()

    /** The same rule reaching the end of its duration. */
    @Serializable
    @SerialName("effectEnded")
    data class EffectEnded(
        override val n: Int,
        val card: String? = null,
        val player: String? = null,
        val kind: String,
        val label: String,
        val source: String? = null,
    ) : Beat()

    @Serializable
    @SerialName("say")
    data class Say(override val n: Int, val text: String) : Beat()

    @Serializable
    @SerialName("over")
    data class Over(override val n: Int, val winner: String? = null, val reason: String) : Beat()
}
