/*
 * The Kotlin side of `docs/arena-client-contract.md`.
 *
 * A plain JVM module: no Android plugin, no SDK, no emulator. All it does is
 * decode the snapshots the server actually emits and prove it understood them
 * — which is the single check most worth having before any UI exists, because
 * it is the one that breaks silently and at a distance.
 */
plugins {
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(21)
}

// Where the server's golden fixtures live, resolved once. Explicitly rather
// than with `../..` from the test: a relative path would depend on the test
// JVM's working directory, which Gradle is entitled to change.
// `rootProject.projectDir` is `android/`, so its parent is the repository.
val fixtures = rootProject.projectDir.parentFile.resolve("contract/fixtures")

tasks.test {
    useJUnitPlatform()

    systemProperty("arena.fixtures", fixtures.absolutePath)

    // Declared as an input, or Gradle calls the tests up to date when only the
    // fixtures changed — which is precisely the moment they need to run. The
    // whole point of this module is to notice that the server's shape moved.
    inputs
        .dir(fixtures)
        .withPropertyName("arenaFixtures")
        .withPathSensitivity(PathSensitivity.RELATIVE)

    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
