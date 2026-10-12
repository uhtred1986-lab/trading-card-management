/**
 * Seven cards staged from seed 7 for the board-view check in vm.ts §31.
 * Values are the public card contract reviewed against the synthetic printed
 * cards: V1 is 10,000 power, AURA grants +5,000 in the Battle Area, the timed
 * program adds another +5,000, and the first Leader shows its awakened face.
 * Full objects keep each formerly compared field (including absence of a
 * field) under assertion without running the legacy view builder.
 */
const common = {
  imageUrl: null,
  mode: "active",
  hidden: false,
  flipped: false,
  markers: 0,
  underCount: 0,
  isToken: false,
  reading: "",
  referee: false,
} as const;

const printedV1 = {
  ...common,
  cardId: "V1", name: "V1", colors: ["Red"], power: 10000,
  cost: "1", comboCost: 0, comboPower: 5000, keywords: [], text: null,
} as const;

const auraPower = { kind: "power", label: "+5,000 power", until: "permanent", source: "p1#2", sourceName: "AURA", by: "p1" } as const;

export const CARD_VIEWS_459 = {
  buffed: {
    ...printedV1, id: "p1#1", power: 20000, basePower: 10000,
    effects: [
      { ...auraPower, until: "turn" },
      auraPower,
    ],
  },
  aura: {
    ...common, id: "p1#2", cardId: "AURA", name: "AURA", power: 15000,
    colors: ["Red"], cost: "1", comboCost: 0, comboPower: 5000,
    keywords: [], text: "[Permanent] Your Battle Cards get +5000 power.",
    reading: "all Battle Cards in your Battle Area +5000 power", basePower: 10000,
    effects: [auraPower],
    permanents: [{ index: 0, text: "Your Battle Cards get +5000 power.", state: "on", reading: "all Battle Cards in your Battle Area +5000 power" }],
    abilities: [{ skillIndex: 0, kind: "permanent", category: "passive", text: "[Permanent] Your Battle Cards get +5000 power.", tags: ["Permanent"], zone: "battle", owner: "p1", controller: "p1", origin: "printed", availability: "notEvaluated", costPreview: { state: "notApplicable" }, permanentState: "on" }],
  },
  blocker: {
    ...common, id: "p1#3", cardId: "BLOCKER", name: "BLOCKER", power: 15000,
    colors: ["Red"], cost: "2", comboCost: 1, comboPower: 10000,
    keywords: ["Blocker"], text: "[Blocker]", basePower: 10000,
    effects: [auraPower],
    abilities: [{ skillIndex: 0, kind: "keyword", category: "keyword", text: "[Blocker]", tags: ["Blocker"], zone: "battle", owner: "p1", controller: "p1", origin: "printed", availability: "notEvaluated", costPreview: { state: "notApplicable" } }],
  },
  flippedLeader: {
    ...common, id: "p1#0", cardId: "L-RED", name: "L-RED awakened", power: 15000,
    colors: ["Red"], flipped: true, cost: null, comboCost: null,
    comboPower: 0, keywords: [], text: null,
  },
  theirLeader: {
    ...common, id: "p2#0", cardId: "L-BLUE", name: "L-BLUE", power: 10000,
    colors: ["Blue"], cost: null, comboCost: null,
    comboPower: 0, keywords: [], text: null,
  },
  theirBattle: {
    ...common, id: "p2#1", cardId: "V-BLUE", name: "V-BLUE", power: 10000,
    colors: ["Blue"], cost: "1", comboCost: 0,
    comboPower: 5000, keywords: [], text: null,
  },
  dropTop: { ...printedV1, id: "p1#4" },
} as const;
