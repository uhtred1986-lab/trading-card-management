/**
 * Planned testing recipes and checklists for /arena/testing (#827).
 *
 * Public catalog/printed-text planning data, not game rules or completed decks.
 * Existing component proofs stay in evidence notes: they do not pass an entire
 * recipe/scenario. Persistence starts planned and owns progress and actual-deck
 * links separately; no live deck IDs, quantities, outcomes or spend are seeded.
 * Keep these explicit IDs stable when changing names or descriptions so saved
 * progress remains attached. World Peace uses the reviewed cost <= 3 erratum.
 */
import type { TestingDeckSeed, TestingScenarioSeed } from "./types";
export type { TestingDeckSeed, TestingScenarioSeed } from "./types";

export const TESTING_DECK_CATALOG: TestingDeckSeed[] = [
  {
    "id": "bt1-001-champa-evolve",
    "release": "BT1",
    "name": "Champa — Evolve",
    "leaderId": "BT1-001",
    "leaderName": "Champa",
    "category": "booster",
    "mechanics": [
      "Evolve"
    ],
    "supportCardIds": [
      "BT1-004"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt1-056-son-goku-revenge",
    "release": "BT1",
    "name": "Son Goku — Revenge",
    "leaderId": "BT1-056",
    "leaderName": "Son Goku",
    "category": "booster",
    "mechanics": [
      "Revenge"
    ],
    "supportCardIds": [
      "BT1-066"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt2-001-vegito-union-potara",
    "release": "BT2",
    "name": "Vegito — Union-Potara",
    "leaderId": "BT2-001",
    "leaderName": "Vegito",
    "category": "booster",
    "mechanics": [
      "Union-Potara"
    ],
    "supportCardIds": [
      "BT2-012"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt2-035-trunks-evolve",
    "release": "BT2",
    "name": "Trunks — Evolve",
    "leaderId": "BT2-035",
    "leaderName": "Trunks",
    "category": "booster",
    "mechanics": [
      "Evolve"
    ],
    "supportCardIds": [
      "BT2-042"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt3-082-bardock-great-ape-cleanup",
    "release": "BT3",
    "name": "Bardock — Great Ape cleanup",
    "leaderId": "BT3-082",
    "leaderName": "Bardock",
    "category": "booster",
    "mechanics": [
      "Blocker",
      "combo-end Evolve"
    ],
    "supportCardIds": [
      "BT3-098",
      "BT3-096"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Open combo-end/evolution follow-up",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt3-108-trunks-over-realm-return",
    "release": "BT3",
    "name": "Trunks — Over Realm return",
    "leaderId": "BT3-108",
    "leaderName": "Trunks",
    "category": "booster",
    "mechanics": [
      "Over Realm 3",
      "Battle/deck→Warp self Auto"
    ],
    "supportCardIds": [
      "BT3-112"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Historical scenario only: app catalog checked 15 October 2026 marks BT3-112 banned. See the separate prepared legal Over Realm control; it does not cover this banned card’s return ability.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt4-001-son-goku-union-potara",
    "release": "BT4",
    "name": "Son Goku — Union-Potara",
    "leaderId": "BT4-001",
    "leaderName": "Son Goku",
    "category": "booster",
    "mechanics": [
      "Union-Potara"
    ],
    "supportCardIds": [
      "BT4-019"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt4-072-son-goku-swap-2",
    "release": "BT4",
    "name": "Son Goku — Swap 2",
    "leaderId": "BT4-072",
    "leaderName": "Son Goku",
    "category": "booster",
    "mechanics": [
      "Swap 2"
    ],
    "supportCardIds": [
      "BT4-073"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt5-002-pilaf-wish-desire",
    "release": "BT5",
    "name": "Pilaf — Wish / Desire",
    "leaderId": "BT5-002",
    "leaderName": "Pilaf",
    "category": "booster",
    "mechanics": [
      "Wish",
      "Dragon Ball",
      "all-area Desire"
    ],
    "supportCardIds": [
      "BT5-024",
      "BT5-119"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Reviewed identity/World Peace regressions World Peace (BT5-119) uses the official energy-cost limit of 3 or less, independent of current energy; the older catalog sentence is stale.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt5-105-black-masked-saiyan-warp-pressure",
    "release": "BT5",
    "name": "Black Masked Saiyan — Warp pressure",
    "leaderId": "BT5-105",
    "leaderName": "Black Masked Saiyan",
    "category": "booster",
    "mechanics": [
      "Burst 3",
      "Critical"
    ],
    "supportCardIds": [
      "BT5-111"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Distinct Black Saiyan archetype",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt6-001-gogeta-br-fusion",
    "release": "BT6",
    "name": "Gogeta — Br fusion",
    "leaderId": "BT6-001",
    "leaderName": "Son Goku and Vegeta",
    "category": "booster",
    "mechanics": [
      "Union-Fusion"
    ],
    "supportCardIds": [
      "BT6-012"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Fusion prerequisites and payment control",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt6-053-paragus-broly-recovery",
    "release": "BT6",
    "name": "Paragus — Broly recovery",
    "leaderId": "BT6-053",
    "leaderName": "Paragus",
    "category": "booster",
    "mechanics": [
      "Optional exact two-card payment",
      "KO/removed Auto"
    ],
    "supportCardIds": [
      "BT6-062"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "New full-or-decline payment regression",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt7-025-son-goku-vegeta-ex-evolve",
    "release": "BT7",
    "name": "Son Goku & Vegeta — EX-Evolve",
    "leaderId": "BT7-025",
    "leaderName": "Son Goku & Vegeta",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT7-039"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt7-075-caulifla-kale-blocker-revenge",
    "release": "BT7",
    "name": "Caulifla & Kale — Blocker; Revenge",
    "leaderId": "BT7-075",
    "leaderName": "Caulifla & Kale",
    "category": "booster",
    "mechanics": [
      "Blocker",
      "Revenge"
    ],
    "supportCardIds": [
      "BT7-081"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt8-024-android-21-critical",
    "release": "BT8",
    "name": "Android 21 — Critical",
    "leaderId": "BT8-024",
    "leaderName": "Android 21",
    "category": "booster",
    "mechanics": [
      "Critical"
    ],
    "supportCardIds": [
      "BT8-038"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt8-067-super-baby-1-union-absorb",
    "release": "BT8",
    "name": "Super Baby 1 — Union-Absorb",
    "leaderId": "BT8-067",
    "leaderName": "Super Baby 1",
    "category": "booster",
    "mechanics": [
      "Union-Absorb"
    ],
    "supportCardIds": [
      "BT8-083"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt9-002-cooler-blocker",
    "release": "BT9",
    "name": "Cooler — Blocker",
    "leaderId": "BT9-002",
    "leaderName": "Cooler",
    "category": "booster",
    "mechanics": [
      "Blocker"
    ],
    "supportCardIds": [
      "BT9-006"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt9-053-jiren-deflect",
    "release": "BT9",
    "name": "Jiren — Deflect",
    "leaderId": "BT9-053",
    "leaderName": "Jiren",
    "category": "booster",
    "mechanics": [
      "Deflect"
    ],
    "supportCardIds": [
      "BT9-060"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt10-002-pilaf-triple-attack",
    "release": "BT10",
    "name": "Pilaf — Triple Attack",
    "leaderId": "BT10-002",
    "leaderName": "Pilaf",
    "category": "booster",
    "mechanics": [
      "Triple Attack"
    ],
    "supportCardIds": [
      "BT10-025"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt10-060-son-goku-barrier-deflect",
    "release": "BT10",
    "name": "Son Goku — Barrier; Deflect",
    "leaderId": "BT10-060",
    "leaderName": "Son Goku",
    "category": "booster",
    "mechanics": [
      "Barrier",
      "Deflect"
    ],
    "supportCardIds": [
      "BT10-066"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt11-001-gogeta-union-fusion",
    "release": "BT11",
    "name": "Gogeta — Union-Fusion",
    "leaderId": "BT11-001",
    "leaderName": "Gogeta",
    "category": "booster",
    "mechanics": [
      "Union-Fusion"
    ],
    "supportCardIds": [
      "BT11-013"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt11-092-garlic-jr-ex-evolve",
    "release": "BT11",
    "name": "Garlic Jr. — EX-Evolve",
    "leaderId": "BT11-092",
    "leaderName": "Garlic Jr.",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT11-104"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt12-002-king-piccolo-ex-evolve",
    "release": "BT12",
    "name": "King Piccolo — EX-Evolve",
    "leaderId": "BT12-002",
    "leaderName": "King Piccolo",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT12-018"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt12-056-turles-unique-critical",
    "release": "BT12",
    "name": "Turles — Unique; Critical",
    "leaderId": "BT12-056",
    "leaderName": "Turles",
    "category": "booster",
    "mechanics": [
      "Unique",
      "Critical"
    ],
    "supportCardIds": [
      "BT12-068"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt13-032-boujack-double-strike-dual-attack",
    "release": "BT13",
    "name": "Boujack — Double Strike; Dual Attack",
    "leaderId": "BT13-032",
    "leaderName": "Boujack",
    "category": "booster",
    "mechanics": [
      "Double Strike",
      "Dual Attack"
    ],
    "supportCardIds": [
      "BT13-046"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities. BT13-046 has an unresolved EX-Evolve price printed as ? in the saved catalog; these targets are its printed Double Strike/Dual Attack, not a verified evolution price.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt13-061-king-cold-dual-attack",
    "release": "BT13",
    "name": "King Cold — Dual Attack",
    "leaderId": "BT13-061",
    "leaderName": "King Cold",
    "category": "booster",
    "mechanics": [
      "Dual Attack"
    ],
    "supportCardIds": [
      "BT13-077"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt14-002-jiren-ex-evolve",
    "release": "BT14",
    "name": "Jiren — EX-Evolve",
    "leaderId": "BT14-002",
    "leaderName": "Jiren",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT14-014"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt14-062-majin-buu-union-absorb",
    "release": "BT14",
    "name": "Majin Buu — Union-Absorb",
    "leaderId": "BT14-062",
    "leaderName": "Majin Buu",
    "category": "booster",
    "mechanics": [
      "Union-Absorb"
    ],
    "supportCardIds": [
      "BT14-079"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt15-031-cabba-union-potara",
    "release": "BT15",
    "name": "Cabba — Union-Potara",
    "leaderId": "BT15-031",
    "leaderName": "Cabba",
    "category": "booster",
    "mechanics": [
      "Union-Potara"
    ],
    "supportCardIds": [
      "BT15-047"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt15-061-son-goku-ex-evolve",
    "release": "BT15",
    "name": "Son Goku — EX-Evolve",
    "leaderId": "BT15-061",
    "leaderName": "Son Goku",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT15-066"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt16-001-son-goku-empower",
    "release": "BT16",
    "name": "Son Goku — Empower",
    "leaderId": "BT16-001",
    "leaderName": "Son Goku",
    "category": "booster",
    "mechanics": [
      "Empower"
    ],
    "supportCardIds": [
      "BT16-003"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt16-071-trunks-ex-evolve",
    "release": "BT16",
    "name": "Trunks — EX-Evolve",
    "leaderId": "BT16-071",
    "leaderName": "Trunks",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT16-075"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt17-002-dr-myuu-general-rilldo-union-absorb",
    "release": "BT17",
    "name": "Dr. Myuu & General Rilldo — Union-Absorb",
    "leaderId": "BT17-002",
    "leaderName": "Dr. Myuu & General Rilldo",
    "category": "booster",
    "mechanics": [
      "Union-Absorb"
    ],
    "supportCardIds": [
      "BT17-019"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt17-032-gamma-1-gamma-2-empower",
    "release": "BT17",
    "name": "Gamma 1 & Gamma 2 — Empower",
    "leaderId": "BT17-032",
    "leaderName": "Gamma 1 & Gamma 2",
    "category": "booster",
    "mechanics": [
      "Empower"
    ],
    "supportCardIds": [
      "BT17-034"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt18-001-son-goku-vegeta-union-fusion",
    "release": "BT18",
    "name": "Son Goku & Vegeta — Union-Fusion",
    "leaderId": "BT18-001",
    "leaderName": "Son Goku & Vegeta",
    "category": "booster",
    "mechanics": [
      "Union-Fusion"
    ],
    "supportCardIds": [
      "BT18-019"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt18-089-bardock-s-crew-revenge-blocker",
    "release": "BT18",
    "name": "Bardock's Crew — Revenge; Blocker",
    "leaderId": "BT18-089",
    "leaderName": "Bardock's Crew",
    "category": "booster",
    "mechanics": [
      "Revenge",
      "Blocker"
    ],
    "supportCardIds": [
      "BT18-107"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt19-035-son-goten-trunks-union-fusion",
    "release": "BT19",
    "name": "Son Goten & Trunks — Union-Fusion",
    "leaderId": "BT19-035",
    "leaderName": "Son Goten & Trunks",
    "category": "booster",
    "mechanics": [
      "Union-Fusion"
    ],
    "supportCardIds": [
      "BT19-060"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt19-101-piccolo-swap-8",
    "release": "BT19",
    "name": "Piccolo — Swap 8",
    "leaderId": "BT19-101",
    "leaderName": "Piccolo",
    "category": "booster",
    "mechanics": [
      "Swap 8"
    ],
    "supportCardIds": [
      "BT19-128"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt20-023-android-18-double-strike",
    "release": "BT20",
    "name": "Android 18 — Double Strike",
    "leaderId": "BT20-023",
    "leaderName": "Android 18",
    "category": "booster",
    "mechanics": [
      "Double Strike"
    ],
    "supportCardIds": [
      "BT20-041"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt20-085-majin-buu-z-stack-2",
    "release": "BT20",
    "name": "Majin Buu — Z-Stack 2",
    "leaderId": "BT20-085",
    "leaderName": "Majin Buu",
    "category": "booster",
    "mechanics": [
      "Z-Stack 2"
    ],
    "supportCardIds": [
      "BT20-090"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt21-067-son-gohan-z-awaken-double-strike",
    "release": "BT21",
    "name": "Son Gohan — Z-Awaken; Double Strike",
    "leaderId": "BT21-067",
    "leaderName": "Son Gohan",
    "category": "booster",
    "mechanics": [
      "Z-Awaken",
      "Double Strike"
    ],
    "supportCardIds": [
      "BT21-069"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt21-101-frieza-swap-8",
    "release": "BT21",
    "name": "Frieza — Swap 8",
    "leaderId": "BT21-101",
    "leaderName": "Frieza",
    "category": "booster",
    "mechanics": [
      "Swap 8"
    ],
    "supportCardIds": [
      "BT21-111"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt22-001-son-gohan-ex-evolve",
    "release": "BT22",
    "name": "Son Gohan — EX-Evolve",
    "leaderId": "BT22-001",
    "leaderName": "Son Gohan",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT22-010"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt22-055-broly-paragus-unique",
    "release": "BT22",
    "name": "Broly & Paragus — Unique",
    "leaderId": "BT22-055",
    "leaderName": "Broly & Paragus",
    "category": "booster",
    "mechanics": [
      "Unique"
    ],
    "supportCardIds": [
      "BT22-058"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt23-002-android-17-android-18-z-stack",
    "release": "BT23",
    "name": "Android 17 & Android 18 — Z-Stack",
    "leaderId": "BT23-002",
    "leaderName": "Android 17 & Android 18",
    "category": "booster",
    "mechanics": [
      "Z-Stack"
    ],
    "supportCardIds": [
      "BT23-006"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt23-072-zamasu-goku-black-union-potara",
    "release": "BT23",
    "name": "Zamasu & Goku Black — Union-Potara",
    "leaderId": "BT23-072",
    "leaderName": "Zamasu & Goku Black",
    "category": "booster",
    "mechanics": [
      "Union-Potara"
    ],
    "supportCardIds": [
      "BT23-084"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt24-001-vegeta-dual-attack",
    "release": "BT24",
    "name": "Vegeta — Dual Attack",
    "leaderId": "BT24-001",
    "leaderName": "Vegeta",
    "category": "booster",
    "mechanics": [
      "Dual Attack"
    ],
    "supportCardIds": [
      "BT24-014"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt24-026-hirudegarn-blocker",
    "release": "BT24",
    "name": "Hirudegarn — Blocker",
    "leaderId": "BT24-026",
    "leaderName": "Hirudegarn",
    "category": "booster",
    "mechanics": [
      "Blocker"
    ],
    "supportCardIds": [
      "BT24-045"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt25-002-king-piccolo-ex-evolve",
    "release": "BT25",
    "name": "King Piccolo — EX-Evolve",
    "leaderId": "BT25-002",
    "leaderName": "King Piccolo",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT25-020"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt25-036-gotenks-union-fusion",
    "release": "BT25",
    "name": "Gotenks — Union-Fusion",
    "leaderId": "BT25-036",
    "leaderName": "Gotenks",
    "category": "booster",
    "mechanics": [
      "Union-Fusion"
    ],
    "supportCardIds": [
      "BT25-058"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt26-031-gogeta-union-fusion",
    "release": "BT26",
    "name": "Gogeta — Union-Fusion",
    "leaderId": "BT26-031",
    "leaderName": "Gogeta",
    "category": "booster",
    "mechanics": [
      "Union-Fusion"
    ],
    "supportCardIds": [
      "BT26-044"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt26-091-cell-ex-evolve-critical",
    "release": "BT26",
    "name": "Cell — EX-Evolve; Critical",
    "leaderId": "BT26-091",
    "leaderName": "Cell",
    "category": "booster",
    "mechanics": [
      "EX-Evolve",
      "Critical"
    ],
    "supportCardIds": [
      "BT26-109"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt27-092-mechikabura-multiple-attacks",
    "release": "BT27",
    "name": "Mechikabura — multiple attacks",
    "leaderId": "BT27-092",
    "leaderName": "Mechikabura",
    "category": "booster",
    "mechanics": [
      "Triple Attack",
      "Deflect"
    ],
    "supportCardIds": [
      "BT27-093"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Recent native-keyword fuzz failure",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt27-045-piccolo-namekian-revival",
    "release": "BT27",
    "name": "Piccolo — Namekian revival",
    "leaderId": "BT27-045",
    "leaderName": "Piccolo",
    "category": "booster",
    "mechanics": [
      "Revive Blue/Green",
      "Energy-Exhaust"
    ],
    "supportCardIds": [
      "BT27-129"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Auto keyword price/order control",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt28-079-vegito-union-potara",
    "release": "BT28",
    "name": "Vegito — Union-Potara",
    "leaderId": "BT28-079",
    "leaderName": "Vegito",
    "category": "booster",
    "mechanics": [
      "Union-Potara"
    ],
    "supportCardIds": [
      "BT28-097"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt28-056-tien-shinhan-dual-attack",
    "release": "BT28",
    "name": "Tien Shinhan — Dual Attack",
    "leaderId": "BT28-056",
    "leaderName": "Tien Shinhan",
    "category": "booster",
    "mechanics": [
      "Dual Attack"
    ],
    "supportCardIds": [
      "BT28-063"
    ],
    "firstWave": false,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Candidate testing shell; check full printed requirements and ingredients before final quantities.",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt29-029-cooler-squadron-return-loop",
    "release": "BT29",
    "name": "Cooler — Squadron return loop",
    "leaderId": "BT29-029",
    "leaderName": "Cooler",
    "category": "booster",
    "mechanics": [
      "Swap 5",
      "Battle→hand watcher"
    ],
    "supportCardIds": [
      "BT29-037"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Open qualified-watcher follow-up",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt29-057-vegeta-saiyan-evolution",
    "release": "BT29",
    "name": "Vegeta — Saiyan evolution",
    "leaderId": "BT29-057",
    "leaderName": "Vegeta",
    "category": "booster",
    "mechanics": [
      "EX-Evolve"
    ],
    "supportCardIds": [
      "BT29-064"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Printed leader-name condition matches awakened leader",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt30-082-brianne-maiden-stack-play",
    "release": "BT30",
    "name": "Brianne — Maiden stack play",
    "leaderId": "BT30-082",
    "leaderName": "Brianne De Chateau",
    "category": "booster",
    "mechanics": [
      "Play onto",
      "card name in skill text"
    ],
    "supportCardIds": [
      "BT30-084"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Existing stack-integrity/crash regression",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt30-001-super-saiyans-united-red-attacks",
    "release": "BT30",
    "name": "Super Saiyans United — red attacks",
    "leaderId": "BT30-001",
    "leaderName": "Son Goku, Vegeta, & Trunks",
    "category": "booster",
    "mechanics": [
      "Dual Attack"
    ],
    "supportCardIds": [
      "BT30-004"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Same-release comparison deck",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt31-001-gogeta-widened-fusion",
    "release": "BT31",
    "name": "Gogeta — widened fusion",
    "leaderId": "BT31-001",
    "leaderName": "Son Goku & Vegeta",
    "category": "booster",
    "mechanics": [
      "Union-Fusion",
      "Revenge"
    ],
    "supportCardIds": [
      "BT31-014"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "Leader-back fusion permission and native Revenge",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "bt31-116-white-cell-reveal-evolve",
    "release": "BT31",
    "name": "White Cell — reveal/evolve",
    "leaderId": "BT31-116",
    "leaderName": "Cell",
    "category": "booster",
    "mechanics": [
      "EX-Evolve",
      "Dual Attack",
      "Revealed/Hidden energy"
    ],
    "supportCardIds": [
      "BT31-129"
    ],
    "firstWave": true,
    "description": "Proposed recipe. Final quantities, legality, printed inputs and current stored-rule qualification are pending.",
    "notes": "White-card costs and visibility paths",
    "source": "docs/arena-proposed-decks.md#release-inventory-and-full-main-booster-proposal"
  },
  {
    "id": "sd5-01-crimson-saiyan-starter-control",
    "release": "SD5",
    "name": "Crimson Saiyan starter control",
    "leaderId": "SD5-01",
    "leaderName": "Golden Great Ape Son Goku",
    "category": "starter_control",
    "mechanics": [
      "Swap 8",
      "Barrier",
      "Double Strike"
    ],
    "supportCardIds": [
      "SD5-03"
    ],
    "firstWave": true,
    "description": "Existing audited starter list is a reusable baseline. Mapping every ability and new comparison evidence remain planned.",
    "notes": "Existing audited starter, full printed list source available",
    "source": "docs/arena-offline-deck-audit.md; scripts/arena-deck-audit.mts"
  },
  {
    "id": "sd15-01-pride-of-the-saiyans-starter-control",
    "release": "SD15",
    "name": "Pride of the Saiyans starter control",
    "leaderId": "SD15-01",
    "leaderName": "Vegeta",
    "category": "starter_control",
    "mechanics": [
      "Spirit Boost 1",
      "Dual Attack",
      "Unison markers"
    ],
    "supportCardIds": [
      "SD15-03",
      "SD15-02"
    ],
    "firstWave": true,
    "description": "Existing audited starter list is a reusable baseline. Mapping every ability and new comparison evidence remain planned.",
    "notes": "Existing audited owner-amended starter; specified costs known Owner-amended list: BT10-008 x1 and BT5-023 x3. Keep that legal amendment and the verified specified-cost inputs.",
    "source": "docs/arena-offline-deck-audit.md; scripts/arena-deck-audit.mts"
  }
];

export const TESTING_SCENARIO_CATALOG: TestingScenarioSeed[] = [
  {
    "id": "family-01-awaken",
    "name": "Awaken and alternate Awaken",
    "group": "family",
    "description": "Exact Life/board threshold; correct face, draws and energy switches; wrong threshold refuses. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-02-energy-costs",
    "name": "Energy and specified costs",
    "group": "family",
    "description": "Correct colored orbs, generic energy and alternative payments; no partial spending on failure. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-03-optional-exact",
    "name": "Optional exact-count selection",
    "group": "family",
    "description": "BT3-109 five Warp cards, BT6-062/SD8-03 two hand cards; all required cards or decline, never partial payment. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-04-bond",
    "name": "Bond",
    "group": "family",
    "description": "XD1-05 with one/two matching Universe 6 Battle Cards; Extras do not count; condition rechecked and real energy price retained. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-05-attack-revenge",
    "name": "Native multiple attacks and Revenge",
    "group": "family",
    "description": "BT27-093 Triple Attack gives exactly three attacks; BT7-081 Revenge KOs at the correct battle timing. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-06-damage-blocker",
    "name": "Strike, Critical and Blocker",
    "group": "family",
    "description": "Correct Life damage destinations/count; legal blocker timing; attacking player's resource gain differs after ordinary damage. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-07-counter-chains",
    "name": "Counter windows and chains",
    "group": "family",
    "description": "Counter: Attack/Play/Counter eligibility, paid costs, decline and nested resolution order. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-08-protection",
    "name": "Barrier, Deflect and protection",
    "group": "family",
    "description": "Target selection versus non-targeting effects; protected and unprotected windows distinguished. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-09-auto-limits",
    "name": "Auto timing and once-per-turn",
    "group": "family",
    "description": "Play/arrival/attack/KO timing; simultaneous ordering; limits shared or per-copy as printed. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-10-hidden-autos",
    "name": "Hidden-area Autos",
    "group": "family",
    "description": "Reveal only when required; decline safely; no opponent-visible hidden choices or metadata. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-11-condition-price",
    "name": "Condition versus price",
    "group": "family",
    "description": "SD13-05 stored condition metadata; true/false condition, actual price, preserved owner-authored effect. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-12-evolve",
    "name": "Evolve and EX-Evolve",
    "group": "family",
    "description": "Correct base, cost, stacked cards and evolved-into triggers; ordinary play is not Evolve. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-13-combo-end-evolve",
    "name": "Combo-end Great Ape evolution",
    "group": "family",
    "description": "BT3-098/BT3-096 from hand and Battle combos; own turn, actual Drop cleanup, then Evolve and payoff. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-14-union-materials",
    "name": "Union-Fusion and Union-Potara",
    "group": "family",
    "description": "Exact material names/power/areas; material destination, legal play and generated movement triggers. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-15-over-realm-warp",
    "name": "Over Realm and Warp movement",
    "group": "family",
    "description": "Threshold, payment, turn restriction and cleanup; BT3-112 self trigger from Battle/deck to Warp. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-16-absorb-stacks",
    "name": "Union-Absorb and under-card stacks",
    "group": "family",
    "description": "Correct targets, stack order, inherited information and removal cleanup. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-17-swap-revive",
    "name": "Swap and Revive",
    "group": "family",
    "description": "Correct returned/played cards, replacement windows and cost order; failed payment gives no play. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-18-wish-desire",
    "name": "Wish/Desire and World Peace",
    "group": "family",
    "description": "Dragon Ball condition; World Peace energy cost at most three, independent of current energy count. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-19-unison-spirit-boost",
    "name": "Unison and Spirit Boost",
    "group": "family",
    "description": "Specified cost, starting/changed markers, activation payment, battle damage and zero-marker removal. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-20-z-cards",
    "name": "Z-Energy, Z-Awaken and Z-Stack",
    "group": "family",
    "description": "Eligible combo cleanup to Z-Energy; exact Z payment, source/stack and zone transitions. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-21-aegis",
    "name": "Aegis and multicolor payments",
    "group": "family",
    "description": "Correct colors and alternate payment; costs before benefits; limited activations and failure rollback. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-22-movement-replacements",
    "name": "Replacements and original movement information",
    "group": "family",
    "description": "Cooler BT29-029 original Battle holder/color/trait; BT29-040 diverted hand return must not announce an actual hand return. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-23-grants-duration",
    "name": "Granted skills, negation and duration",
    "group": "family",
    "description": "Heroic/Villainous, gained skills and temporary traits; correct controller, expiry and interaction order. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "family-24-ai-ui-replay",
    "name": "AI decisions and UI/replay parity",
    "group": "family",
    "description": "Known lethal, avoidable loss, Life-to-hand resources, legal choices; same visible information, deterministic replay, clear browser prompts. Planned family: each actual card/face/skill still needs its own evidence mapping; a baseline proof does not pass the whole family.",
    "source": "docs/arena-deck-coverage-plan.md#small-scenario-build-list"
  },
  {
    "id": "wc-r01",
    "name": "WC-R01 — Cell deck restriction",
    "group": "white_cell_rule",
    "description": "Cell Leader plus a non-white Extra in a deck list: report the printed deck restriction in legality; deck editing stays possible under the app's “legality is a flag” rule. A white Extra passes that restriction. Evidence scope: Missing named rule-specific legality proof. Qualification must not be substituted for legality. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r02",
    "name": "WC-R02 — Front selection and back Extra recovery",
    "group": "white_cell_rule",
    "description": "Front Leader Main skill: offer only white Cell cards in deck; choose none or exactly one, move that copy to Drop, shuffle, prohibit another use that turn. Back Main/Battle recovery: only white cost-2 Extras with Main/Battle skill in Drop, choose none or one, once per turn across both windows. Evidence scope: Missing complete real-Leader front/back scenarios. Generic selection/once-per-turn evidence exists. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r03",
    "name": "WC-R03 — Awaken threshold and Life output",
    "group": "white_cell_rule",
    "description": "Awaken with life 4 and insufficient Drop qualifies; life 8 with exactly 3 eligible Drop cards qualifies; life 8 with 2 does not. Resolve draw 2 and flip; life 8 becomes 6 by adding exactly 2 Life cards to hand, while life 4 is not increased or forced to move Life “up to 6.” Non-Cell white Battle cards do not count as Cells. Evidence scope: Missing complete real-card threshold/output proof. Reading helpers have generic grouped-condition coverage. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r04",
    "name": "WC-R04 — Qualified play and current-cost capture",
    "group": "white_cell_rule",
    "description": "Back Leader trigger: white Cell/Cell Jr. at current cost ≥3 pends; wrong color/character/cost 2 does not. Freeze qualification at play before later Autos alter cost/area. A reduced payment is not automatically a reduced card cost: BT31-119's discount applies in Z-Deck; after it enters Battle its own printed cost is 3, so a paid cost of 1 alone must not disqualify the trigger. Evidence scope: Existing core / partial real support: readings-571.ts, free-extra-680.ts test shared qualifications, current-cost capture, reduced costs and later changes on synthetic subjects. Add BT31-119's actual zone-scoped discount. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r05",
    "name": "WC-R05 — Hidden price and chosen Extra activation",
    "group": "white_cell_rule",
    "description": "Qualifying play, one Revealed energy and a white cost-2 Main/Battle Extra in hand. Decline Auto: no Hidden payment/Extra use. Accept: hide exactly one Revealed energy (Rested energy is eligible); optionally select one eligible Extra, activate its chosen skill without its original skill cost, move it to Drop, preserve Extra-activation watchers. Selecting no Extra after paying does not refund the Hidden cost. Already-Hidden energy cannot pay a change-to-Hidden action. Evidence scope: Existing core: free-extra-680.ts proves payment, optional hand selection, cost waiver, move-before-activation, watcher, invalid actor/target, JSON reload/privacy. arena-free-extra-db.mts adds saved revision/idempotency/privacy. Real five-Extra integration still needed. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r06",
    "name": "WC-R06 — Regeneration and energy visibility",
    "group": "white_cell_rule",
    "description": "Invoke BT31-140 while an opponent card attacks: draw 1, choose 0–3 Hidden energy to reveal, +10000 Leader for this battle only. Own attack/Main use has no conditional Leader bonus. Each energy retains its previous Active/Rest state and restored White color is available only on Active energy. Evidence scope: Missing complete named Regeneration scenario; partial generic hidden.ts, effective-payment-colours-626.ts, battle-stakes-562.ts cover Hidden information/payment facts. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r07",
    "name": "WC-R07 — Solar Flare and removal Autos",
    "group": "white_cell_rule",
    "description": "Invoke BT31-138 with a white Cell Battle Card and an opponent keyword-bearing card: independently choose up to one own Cell return and up to one opponent keyword negation. Negate the chosen keyword, not all skills; it returns after the turn. Return-by-skill should cause the printed BT31-129/130 removal Autos where appropriate; a KO is a distinct negative control for “by a skill.” Evidence scope: Missing named Solar Flare → Cell removal integration. Separate watcher/pick/negation families exist. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r08",
    "name": "WC-R08 — Absorb, stack and granted Barrier",
    "group": "white_cell_rule",
    "description": "BT31-139: draw 1, choose a real white Cell Battle base, decline Android placement → no conditional stack play; accept one Android from Drop → put it under that base, then optionally play exactly one eligible white cost≤4 Cell from Drop on top Active. With BT31-130 underneath and a white Cell Leader, top gains Barrier; removing/invalidating the prerequisite removes that grant. Evidence scope: Missing complete Absorb/under-card Barrier scenario; partial generic stack/under-card mechanics and #542 integrity proof. It is a stack play, not an invented Evolve activation. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r09",
    "name": "WC-R09 — Ominous Android reactive stack",
    "group": "white_cell_rule",
    "description": "BT31-131 from Drop: require white Cell Leader, energy count≥2 and one Revealed energy to hide; it enters Rested. On opponent's turn only, with opponent energy≥2 and full {1} paid, its Battle skill may stack an eligible white cost-4 Cell from Drop onto it Active. Wrong turn/energy/area/cost does not qualify. Evidence scope: Missing named two-step Ominous Android scenario. Generic skill prices/play-on-top exist. Preserve source identity/counter continuation across reload. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r10",
    "name": "WC-R10 — White EX-Evolve and bounded attacks",
    "group": "white_cell_rule",
    "description": "BT31-129 EX-Evolve: at least 3 energy, actual White orb plus printed draw-1 price, correct white Cell base cost≥3; use once under Limit 1. Stack according to Evolve rules. Dual Attack's after-battle reactivation is bounded. Its attacking Auto reveals up to one energy without untapping it. On removal by skill, optionally play the exact eligible cost-4 Cell from Drop; ordinary battle KO does not satisfy that printed cause. Evidence scope: Partial: generic Evolve, Attack, price, cause and Hidden families; missing this real paid White chain and its combined follow-ups. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r11",
    "name": "WC-R11 — Cell Jr. reactive play and Z-Energy",
    "group": "white_cell_rule",
    "description": "BT31-133 on opponent's turn, white Leader, opponent energy≥2 and Hidden energy available: pay by revealing one, play from hand, choose up to one own card for +5000 this battle. Then its on-play draw precedes the required hand→Z-Energy choice (the drawn card can be chosen), skills negated for turn. Wrong turn/condition, no actual Hidden→Revealed change, or a skipped mandatory hand choice fails. Evidence scope: Missing complete real Cell Jr. reactive sequence. Generic combo/Z-Energy, mode prices and duration evidence is only partial. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-r12",
    "name": "WC-R12 — Ultimate Form end-turn reveal",
    "group": "white_cell_rule",
    "description": "BT31-128 successful play: draw 1, switch this Cell Active, optional KO, schedule all-energy Revealed for that turn's end. Before end turn energy remains as currently Hidden/Revealed; at end all becomes Revealed while each Active/Rest status persists. Repeated continuation/reload performs the delayed effect once. Separate Evolve {1} and Main {2} play prices must remain distinct. Evidence scope: Missing named Ultimate Form resource-restoration scenario; partial generic delay, mode and evolution. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#twelve-minimal-rule-scenarios"
  },
  {
    "id": "wc-a01",
    "name": "WC-A01 — Preserve Active White payment sources",
    "group": "white_cell_strategy",
    "description": "Pay the Leader's Hide-energy price using an already-Rested Revealed energy when that preserves the sole Active White payment source for a known EX-Evolve/defensive option. Compare all legal payments and remaining affordable options; don't treat Hidden/Revealed as an untap. Evidence scope: Missing White-specific benchmark. General policy color-preserving payments exist. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#seven-decision-benchmarks-strategy-not-engine-legality"
  },
  {
    "id": "wc-a02",
    "name": "WC-A02 — Choose or decline a useful Extra",
    "group": "white_cell_strategy",
    "description": "Choose/decline the optional Leader Extra activation according to a concrete opportunity: safe recovery with Regeneration, useful removal/buff with Kamehameha, or pointless cost when no useful Extra can be activated. Record hand/card gain and future legal options, not “always pay.” Evidence scope: Missing, despite rules-proof coverage of pay/decline. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#seven-decision-benchmarks-strategy-not-engine-legality"
  },
  {
    "id": "wc-a03",
    "name": "WC-A03 — Efficient defense and resource recovery",
    "group": "white_cell_strategy",
    "description": "During a threatening opponent attack, select Regeneration when its +10000 actually saves life and restoring color preserves later defense; compare Cell Jr.'s +5000 and available combos by actual card/energy expenditure. Include a battle where neither boost changes the result and conserving cards is preferable. Evidence scope: Missing White-specific; partial generic combat threshold/cheapest-defense benchmarks. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#seven-decision-benchmarks-strategy-not-engine-legality"
  },
  {
    "id": "wc-a04",
    "name": "WC-A04 — Sequence discounted Cell development",
    "group": "white_cell_strategy",
    "description": "Sequence Hidden energy → discounted BT31-119 development → Leader Extra → reveal recovery when legal and useful. Score eligible board development, triggered Extra value, Z-Energy and retained Active White sources. Include a case where paying for the chain leaves an unavoidable lethal threat and should be avoided. Evidence scope: Missing chain benchmark; qualification is not sequence evidence. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#seven-decision-benchmarks-strategy-not-engine-legality"
  },
  {
    "id": "wc-a05",
    "name": "WC-A05 — Evolution timing and protected bases",
    "group": "white_cell_strategy",
    "description": "Choose an EX-Evolve base and timing that preserves a valuable BT31-130 under-card Barrier grant and creates profitable bounded Dual Attack, versus retaining a necessary defender. Compare resulting board and battle value after the full opposing legal response fixture; never assume unseen counters absent. Evidence scope: Missing real White evolution strategy. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#seven-decision-benchmarks-strategy-not-engine-legality"
  },
  {
    "id": "wc-a06",
    "name": "WC-A06 — Recover the right cost-2 Extra",
    "group": "white_cell_strategy",
    "description": "Recover the right cost-2 Extra with the back Leader's once-per-turn Main/Battle skill: defense before lethal (Regeneration/Summon), pressure/removal on own turn (Kamehameha), or safe Cell recycling (Solar Flare). Respect timing/limit and legal concrete targets; score resulting saved life or removed threat, not merely card mana value. Evidence scope: Missing effect-aware recovery benchmark. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#seven-decision-benchmarks-strategy-not-engine-legality"
  },
  {
    "id": "wc-a07",
    "name": "WC-A07 — Combo and reactive-play opportunity cost",
    "group": "white_cell_strategy",
    "description": "Use a 0-cost/5000 combo or Cell Jr. reactive play only when it changes the battle or preserves a higher-value hand/resource plan. Include Sparking-5 Android 18 draw and cell-evolution ingredients where their opportunity cost is explicit. Score cards spent, life saved/dealt, legal follow-up development and conserved White sources. Evidence scope: Partial generic efficient-combo policy tests; missing the White-card opportunity-cost fixtures. This complete checklist item starts planned; inspected component evidence is not an exact-revision pass for the item.",
    "source": "docs/arena-white-cell-validation.md#seven-decision-benchmarks-strategy-not-engine-legality"
  },
  {
    "id": "ai-01",
    "name": "AI-01 — Proven lethal and Life-to-hand replenishment",
    "group": "strategy",
    "description": "Objective: take a legal line that wins against every response in the fixture's declared response set when such a line exists. Acceptable actions are first steps of independently replayed winning lines, including bounded multiple attacks and any required combos; a projected lethal line that fails after ordinary damage adds Life cards to the defender's hand is rejected. Variants: Dual/Triple Attack aggro, Critical pressure and a wider small-attacker board; include a non-forced lethal case where conserving resources is acceptable. Partial existing evidence: combat threshold/Strike cases and one search two-attacker lethal. The real three-attacker Life-to-hand search case remains a documented failure; no cross-deck pass. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-01"
  },
  {
    "id": "ai-02",
    "name": "AI-02 — Avoidable loss and efficient defense",
    "group": "strategy",
    "description": "Objective: survive the declared attack sequence when legal defense exists, then minimize necessary card/energy expenditure within the fixture's surviving lines. Acceptable actions may be block, counter, combo or battle activation; ties follow the real engine and a cheap defense that loses to the next attack is rejected. Variants: low-Life aggro, control with multiple counters and a development deck protecting its key base. Partial existing evidence: combat fixtures prove lethal blocking, cheapest sufficient combo and non-redundant counter in synthetic battles; missing cross-attack and real-deck defenses. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-02"
  },
  {
    "id": "ai-03",
    "name": "AI-03 — Energy, colors and future payments",
    "group": "strategy",
    "description": "Objective: choose a legal development/payment sequence that preserves the fixture's specified next-turn play or defensive payment. Acceptable actions retain the needed active colored sources without sacrificing a strictly better survival/lethal line; enumerate equivalent energy choices rather than require an arbitrary card ID. Variants: mono-color, multicolor/Energy-Exhaust and White Hidden/Revealed resources. Partial existing evidence: Main play/payment preserves a needed color in synthetic positions; missing real multicolor, White and future-turn variants. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-03"
  },
  {
    "id": "ai-04",
    "name": "AI-04 — Card advantage and combo opportunity costs",
    "group": "strategy",
    "description": "Objective: spend a card or activation only when it changes the declared battle/board outcome or enables the fixture's follow-up; preserve explicitly needed material/counter cards when an equivalent expendable card exists. Acceptable actions are cheapest sufficient outcome-equivalent lines, allowing printed draw/recovery value to change the ranking. Variants: aggro hand pressure, draw/control engines and fusion/evolution material hands. Partial existing evidence: efficient synthetic combos and least-value required discards; missing printed-effect opportunity-cost variants. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-04"
  },
  {
    "id": "ai-05",
    "name": "AI-05 — Critical versus ordinary attack order",
    "group": "strategy",
    "description": "Objective: choose an attack order that attains the fixture's proven damage/lethal result against the declared legal defenses, accounting for Critical sending Life to Drop versus ordinary damage replenishing hand. Acceptable actions include every equally effective first attack; Critical-first is not a universal rule. Variants: mixed Critical/ordinary attackers, multiple attacks and blockers/Strike damage. Partial existing evidence: combat values Critical/Double Strike; search explicitly omits Life-to-hand replenishment. Missing exact real-deck attack-order cases. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-05"
  },
  {
    "id": "ai-06",
    "name": "AI-06 — Development sequencing and curve",
    "group": "strategy",
    "description": "Objective: choose a feasible turn sequence that achieves the fixture's declared board/resource milestone while retaining required defense, instead of merely playing the highest-cost card. Acceptable actions are equivalent legal orders with the measured milestone and no avoidable survival loss. Variants: low-curve aggro, Unison/marker development and resource-dependent control; include pass/end-turn when every play is dominated. Partial existing evidence: affordable development, favorable attack, endMain and free-activation termination; missing multi-effect printed development sequences. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-06"
  },
  {
    "id": "ai-07",
    "name": "AI-07 — Fusion and evolution material planning",
    "group": "strategy",
    "description": "Objective: preserve, find or develop the printed eligible materials/base so the declared next legal Fusion/Evolve line remains available, unless immediate survival or forced lethal dominates it. Acceptable actions use exact printed names, colors, power/areas and payment requirements; compare alternative bases/materials by resulting board and retained resources. Variants: Union-Fusion, Union-Potara and Evolve/EX-Evolve. Existing rule-family evidence can establish legal ingredients but is not a strategic planning proof; named cross-deck material decisions are missing. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-07"
  },
  {
    "id": "ai-08",
    "name": "AI-08 — Removal and control target selection",
    "group": "strategy",
    "description": "Objective: remove or disable the fixture's threat that changes the declared survival/board objective, respecting targeting protection and legal effect scope. Acceptable actions include all outcome-equivalent targets or decline when removal has no benefit; raw power alone is insufficient when a smaller engine/blocker determines the result. Variants: aggro removing a blocker, control breaking an engine and protected versus unprotected targets. Partial existing evidence: optional/required synthetic picks choose higher-value targets and useful printed modes; missing effect-aware real-target comparisons. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-08"
  },
  {
    "id": "ai-09",
    "name": "AI-09 — Recursion and finite resource loops",
    "group": "strategy",
    "description": "Objective: choose an eligible recovered/replayed card that enables the fixture's declared defense/development line, with printed limits and net costs accounted for. Acceptable actions finish a beneficial bounded cycle or decline/end when repeated recovery cannot improve the objective; infinite or unproductive activation is rejected. Variants: Desire recovery, Revive/Swap and Extra/Drop recursion. Partial existing evidence: priced Auto/mode/replacement choices and Main cycle guard; missing real recursive engine value and timing benchmarks. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-09"
  },
  {
    "id": "ai-10",
    "name": "AI-10 — Optional payment and deliberate decline",
    "group": "strategy",
    "description": "Objective: pay an optional price only when its declared benefit justifies losing the resources needed for the fixture's other legal objective; otherwise decline without spending. Acceptable actions include every full-payment line with equivalent benefit and resource retention, or decline; partial exact-count payment never qualifies. Variants: optional hand/Warp prices, Life-taking choices and Hidden/Revealed energy costs. Partial existing evidence: synthetic paid Auto, optional Life pick and Offering choices; exact payment rule proofs do not establish real-card value decisions. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-10"
  },
  {
    "id": "ai-11",
    "name": "AI-11 — Robust decisions under hidden information",
    "group": "strategy",
    "description": "Objective: make the same choice for identical permitted observations/policy RNG across hidden-state permutations, while choosing within the fixture's declared public-information risk objective. Acceptable actions are predeclared safe/expected-value alternatives under an explicit response distribution; no action is rewarded for exploiting an unseen card identity. Variants: unknown combo hands, counters and unseen deck/Life order across aggro/control/material decks. Existing suites prove hidden-permutation invariance in sampled generic positions; missing archetype-specific risk decisions and calibrated distributions. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-11"
  },
  {
    "id": "ai-12",
    "name": "AI-12 — Adapt pressure, control and long-game plans",
    "group": "strategy",
    "description": "Objective: select the fixture's demonstrated short- or long-horizon plan from visible race, resources and threats: pressure when delaying loses the race, stabilize when racing loses, conserve/recur when that enables the declared later win. Acceptable actions come from reviewed finite continuations with explicit horizon and response assumptions; ambiguous choices are diagnostic, not forced failures. Variants: aggro mirror, aggro versus control and recursion/material versus resource denial. Generic affordable-play/efficient-battle proofs do not establish plan adaptation; all named cross-archetype cases are missing. This benchmark starts planned. A pass requires a named fixture, deck/rules/policy revision and reviewed evidence; one generic case never passes all decks.",
    "source": "docs/arena-strategy-validation.md#ai-12"
  }
];
