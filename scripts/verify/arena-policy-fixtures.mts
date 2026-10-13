/**
 * #651: the five database-free fixtures the local-policy evaluation plays on (#641's, #644's, #646's,
 * #647's, #650's) and, on request, the four ordered matchups of the two audited Masters decks (#649), as one list — shared by `scripts/arena-policy-eval.mts` and
 * `scripts/arena-policy-browser.mts`.
 */
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_SEED } from "./arena-policy-fixture.ts";
import { mainFixtureBundle, MAIN_FIXTURE_REVISION, MAIN_FIXTURE_SEED } from "./arena-policy-main-fixture.ts";
import { combatFixtureBundle, COMBAT_FIXTURE_REVISION, COMBAT_FIXTURE_SEED } from "./arena-policy-combat-fixture.ts";
import { choicesFixtureBundle, CHOICES_FIXTURE_REVISION, CHOICES_FIXTURE_SEED } from "./arena-policy-choices-fixture.ts";
import { DECKS, deckBundle, loadSnapshot, resolveDeck, RUNTIME as AUDIT_RUNTIME } from "../arena-deck-audit.mts";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import type { PlayerId } from "../../src/lib/arena/types";

export interface Fixture {
  name: string;
  bundle: ReplayBundleRecord;
  revision: string;
  seed: number;
}

export async function loadFixtures(): Promise<Fixture[]> {
  return [
    { name: "641", bundle: await fixtureBundle(), revision: FIXTURE_REVISION, seed: FIXTURE_SEED },
    { name: "644", bundle: await policyFixtureBundle(), revision: POLICY_FIXTURE_REVISION, seed: POLICY_FIXTURE_SEED },
    { name: "646", bundle: await mainFixtureBundle(), revision: MAIN_FIXTURE_REVISION, seed: MAIN_FIXTURE_SEED },
    { name: "647", bundle: await combatFixtureBundle(), revision: COMBAT_FIXTURE_REVISION, seed: COMBAT_FIXTURE_SEED },
    { name: "650", bundle: await choicesFixtureBundle(), revision: CHOICES_FIXTURE_REVISION, seed: CHOICES_FIXTURE_SEED },
  ];
}

/** The #649 decks, every ordered matchup (AvA, AvB, BvA, BvB). Needs the catalog snapshot `arena-deck-audit.mts` reads; no database. */
export async function loadAuditFixtures(): Promise<Fixture[]> {
  const catalog = loadSnapshot().cards;
  const cards = [...new Map(DECKS.flatMap((d) => resolveDeck(d, catalog).rows.map((r) => [r.card.id, r.card] as const))).values()];
  // One bundle (both decks' cards compiled once), its decklists swapped per ordered matchup.
  const base = (await deckBundle(cards, { p1: DECKS[0], p2: DECKS[1] }, catalog)) as ReplayBundleRecord & { decks: Record<PlayerId, unknown> };
  const deckOf = { [DECKS[0].key]: base.decks.p1, [DECKS[1].key]: base.decks.p2 };
  const out: Fixture[] = [];
  for (const [i, [p1, p2]] of [[DECKS[0], DECKS[0]], [DECKS[0], DECKS[1]], [DECKS[1], DECKS[0]], [DECKS[1], DECKS[1]]].entries()) {
    out.push({ name: `${p1.key}v${p2.key}`, bundle: { ...base, decks: { p1: deckOf[p1.key], p2: deckOf[p2.key] } } as ReplayBundleRecord, revision: AUDIT_RUNTIME, seed: 649 + i });
  }
  return out;
}
