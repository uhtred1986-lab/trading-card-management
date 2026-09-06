package arena

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Does the Kotlin still understand what the server sends?
 *
 * This is the whole of tier 0 (`docs/arena-android-spec.md` §10), and it is
 * the check most worth having before any UI exists: a shape change on the
 * server is invisible on the web, and would show up on a phone as a board
 * that will not load.
 *
 * The fixtures are not copies. They are the files `npm test` regenerates and
 * compares on the server side, read straight out of the repository — a copied
 * fixture is a fixture that can quietly go stale.
 */
class ContractTest {

    /** Handed over by the build (see `build.gradle.kts`), never guessed at. */
    private val fixtureDir = File(System.getProperty("arena.fixtures") ?: fail("arena.fixtures was not set by the build"))

    private val fixtures: List<File> =
        fixtureDir
            .listFiles { f -> f.extension == "json" }
            ?.sortedBy { it.name }
            ?: fail("no fixtures in $fixtureDir — run `npm run contract:emit` at the repository root")

    /** What the app ships with: tolerant of a server that has grown a field. */
    private val lenient = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    /**
     * What CI uses: refuses a field it has never seen. Not a bug when it
     * fails — a tripwire, so somebody looks at the new field and decides
     * whether the app wants it.
     */
    private val strict = Json {
        ignoreUnknownKeys = false
        explicitNulls = false
    }

    @Test
    fun `every fixture decodes with nothing left over`() {
        assertTrue(fixtures.isNotEmpty(), "expected fixtures in contract/fixtures")
        for (file in fixtures) {
            val snapshot = strict.decodeFromString<Snapshot>(file.readText())
            assertEquals(1, snapshot.contract, "${file.name}: contract version")
        }
    }

    @Test
    fun `decoding is lossless`() {
        for (file in fixtures) {
            val once = lenient.decodeFromString<Snapshot>(file.readText())
            val twice = lenient.decodeFromString<Snapshot>(lenient.encodeToString(Snapshot.serializer(), once))
            assertEquals(once, twice, "${file.name}: re-encoding changed the snapshot")
        }
    }

    /**
     * Contract §7: adding a field is not a version bump, so an app built
     * before it must keep working against a server that has it.
     */
    @Test
    fun `an older app survives a newer server`() {
        val file = fixtures.first()
        val grown = JsonObject(
            lenient.parseToJsonElement(file.readText()).let { it as JsonObject } +
                ("somethingTheServerAddedLater" to JsonPrimitive(42)),
        )
        val text = lenient.encodeToString(JsonObject.serializer(), grown)

        lenient.decodeFromString<Snapshot>(text) // the shipped app: fine
        assertFailsWith<Exception>("strict decoding should trip on an unknown field") {
            strict.decodeFromString<Snapshot>(text)
        }
    }

    /**
     * The beat stream is the part a client animates, so its invariants are
     * worth asserting on this side too rather than trusting the server's.
     */
    @Test
    fun `beats are numbered, ordered, and carry a face for every card they name`() {
        for (file in fixtures) {
            val beats = lenient.decodeFromString<Snapshot>(file.readText()).beats ?: continue
            var last = 0
            for (beat in beats.list) {
                assertTrue(beat.n > last, "${file.name}: beat numbers must climb (${beat.n} after $last)")
                last = beat.n
                for (card in beat.cards()) {
                    assertTrue(beats.art.containsKey(card), "${file.name}: ${beat::class.simpleName} names $card with no face")
                }
            }
            if (beats.list.isNotEmpty()) assertEquals(last, beats.seq, "${file.name}: seq is not the highest beat")
        }
    }

    /**
     * A KO'd card is gone from the board by the time anything draws it, so the
     * beat has to say whose side it left from. Worth pinning to the fixture
     * that has one, because getting it wrong flies a ghost across the table.
     */
    @Test
    fun `the ko fixture says whose card died`() {
        val file = fixtures.firstOrNull { it.name == "ko.json" } ?: return
        val beats = lenient.decodeFromString<Snapshot>(file.readText()).beats ?: fail("ko.json has no beats")
        val ko = beats.list.filterIsInstance<Beat.Ko>().firstOrNull() ?: fail("ko.json has no ko beat")
        assertEquals("p2", ko.owner, "the card KO'd in this fixture is the opponent's")
        assertTrue(beats.art.containsKey(ko.card), "a KO'd card must bring its own face")
    }

    /**
     * A move is chosen by index, never described (contract §5), so `legal`
     * only has to survive the round trip — the app never reads inside it.
     */
    @Test
    fun `legal moves keep their labels and stay opaque`() {
        for (file in fixtures) {
            val snapshot = lenient.decodeFromString<Snapshot>(file.readText())
            for ((i, move) in snapshot.legal.withIndex()) {
                assertTrue(move.label.isNotBlank(), "${file.name}: move $i has no label")
            }
            for ((card, indices) in snapshot.taps.byCard) {
                for (i in indices) {
                    assertTrue(i in snapshot.legal.indices, "${file.name}: $card points at move $i, which does not exist")
                }
            }
            for (i in snapshot.taps.bare) {
                assertTrue(i in snapshot.legal.indices, "${file.name}: a bare tap points at move $i, which does not exist")
            }
        }
    }

    /**
     * `docs/arena-workflow-spec.md`: a rejection is never a legal move, is
     * never without a reason, and `whyByCard` points only at real cards.
     */
    @Test
    fun `rejections are reasoned and disjoint from the legal moves`() {
        var any = false
        for (file in fixtures) {
            val snapshot = lenient.decodeFromString<Snapshot>(file.readText())
            val legal = snapshot.legal.map { it.action }.toSet()
            for (r in snapshot.rejected ?: emptyList()) {
                any = true
                assertTrue(r.why.isNotEmpty(), "${file.name}: \"${r.label}\" is rejected for no reason")
                assertTrue(r.action !in legal, "${file.name}: \"${r.label}\" is both legal and rejected")
            }
            val cards = (snapshot.view.you.all() + snapshot.view.them.all()).map { it.id }.toSet()
            for ((card, why) in snapshot.taps.whyByCard ?: emptyMap()) {
                assertTrue(card in cards, "${file.name}: whyByCard names $card, which is not on the board")
                assertTrue(why.isNotEmpty(), "${file.name}: whyByCard has nothing to say about $card")
            }
        }
        assertTrue(any, "at least one fixture should carry rejections")
    }

    /** The search fixture: every choice is reachable, and the other side sees none. */
    @Test
    fun `a search names its choices for the searcher only`() {
        val file = fixtures.firstOrNull { it.name == "search.json" } ?: return
        val snapshot = lenient.decodeFromString<Snapshot>(file.readText())
        val choices = snapshot.view.you.choices ?: fail("search.json has no choices")
        assertTrue(choices.isNotEmpty())
        for (c in choices) assertTrue(snapshot.taps.byCard[c.id]?.isNotEmpty() == true, "${c.id} is a choice with no move")
        assertEquals(null, snapshot.view.them.choices, "the other side is shown nothing")
        assertEquals(0, snapshot.view.prompt.min, "an optional choice says so, which is what the 'Choose none' button reads")
        assertTrue(snapshot.view.prompt.step != null, "a choice inside a skill knows its step")
    }
}

/** Every card the board draws on one side, plus the choices a prompt reveals. */
private fun SideView.all(): List<CardView> =
    listOfNotNull(leader, unison) + battle + combo + energy + (hand ?: emptyList()) + lifeFaceUp + zDeckFaceUp + listOfNotNull(dropTop) + (choices ?: emptyList())

/** Every card instance id a beat names. */
private fun Beat.cards(): List<String> = when (this) {
    is Beat.Draw -> listOfNotNull(card)
    is Beat.Move -> listOf(card)
    is Beat.Mode -> listOf(card)
    is Beat.Flip -> listOf(card)
    is Beat.Markers -> listOf(card)
    is Beat.Token -> listOf(card)
    is Beat.Ko -> listOf(card)
    is Beat.Skill -> listOf(card)
    is Beat.Attack -> listOf(attacker, target)
    is Beat.Block -> listOf(guard, by)
    is Beat.Clash -> listOf(attacker, guard)
    is Beat.Damage -> cards
    is Beat.Phase, is Beat.Negated, is Beat.Say, is Beat.Over -> emptyList()
}
