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
)

@Serializable
data class Tappable(
    /** Card instance id → indices into `legal`. */
    val byCard: Map<String, List<Int>>,
    val bare: List<Int>,
    /** Attacker id → (target id → index into `legal`). */
    val attackTargets: Map<String, Map<String, Int>>,
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
    /** True when a skill of this card has to be put to the referee. */
    val referee: Boolean,
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

    @Serializable
    @SerialName("skill")
    data class Skill(override val n: Int, val card: String, val label: String, val text: String, val unread: Boolean) : Beat()

    @Serializable
    @SerialName("say")
    data class Say(override val n: Int, val text: String) : Beat()

    @Serializable
    @SerialName("over")
    data class Over(override val n: Int, val winner: String? = null, val reason: String) : Beat()
}
