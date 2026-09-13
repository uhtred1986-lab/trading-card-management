package arena

import kotlinx.serialization.Serializable

/**
 * The Android app's read-only decks. `docs/arena-client-contract.md` §5.1.
 *
 * Hand-written like `Snapshot.kt`, and kept honest the same way: the
 * round-trip tests in `ContractTest.kt` decode `contract/fixtures/deck-list.json`
 * and `deck-detail.json`, the same files `npm test` regenerates and compares
 * on the server side. Read-only — there is deliberately no write shape here,
 * the same way there is no endpoint for one (contract §5).
 */
@Serializable
data class DeckLeader(
    val id: String,
    val name: String,
    val imageUrl: String? = null,
    val colors: List<String>,
)

@Serializable
data class DeckSummary(
    val id: Int,
    val name: String,
    /** "dbs" | "fusion" */
    val game: String,
    val isBuilt: Boolean,
    val leader: DeckLeader? = null,
    /** "legal" | "incomplete" | "illegal" — from the server's own `legality()`, never recomputed. */
    val status: String,
    /** Whether the arena will load this deck into a game (`deckInputFor` decides it). */
    val playable: Boolean,
    /** Set whenever `playable` is false — a deck is never hidden silently, only marked why. */
    val playableReason: String? = null,
)

@Serializable
data class DeckList(
    val decks: List<DeckSummary>,
)

/** The same `"<zone>:<cardId>"` flag the web deck page highlights. */
@Serializable
data class DeckCardFlag(
    /** "illegal" | "incomplete" | "warning" */
    val severity: String,
    val label: String,
)

@Serializable
data class DeckDetailCard(
    val cardId: String,
    val name: String,
    /** "leader" | "main" | "z" | "side" */
    val zone: String,
    val quantity: Int,
    val cardType: String,
    val colors: List<String>,
    val imageUrl: String? = null,
    val energyCost: String? = null,
    val flag: DeckCardFlag? = null,
)

@Serializable
data class DeckCounts(
    val leader: Int,
    val main: Int,
    val z: Int,
    val side: Int,
)

@Serializable
data class DeckDetail(
    val id: Int,
    val name: String,
    val game: String,
    val isBuilt: Boolean,
    val leader: DeckLeader? = null,
    val status: String,
    val counts: DeckCounts,
    val cards: List<DeckDetailCard>,
    val playable: Boolean,
    val playableReason: String? = null,
)
