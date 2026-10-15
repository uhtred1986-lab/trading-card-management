/** #827: minimal positions using unchanged printed cards from prepared recipes.
 * These are tactical scenarios, not complete/legal recipe qualifications. */
import type { CardDef, PlayerId } from "../../src/lib/arena/types";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle } from "../../src/lib/arena/replay-core";
import { applyMove, legalMoves, type PinnedMatch } from "../../src/lib/arena/browser";
import { mainPhaseMatch, stage, type Layout } from "./arena-policy-main-fixture";

export const TACTICAL_REVISION = "a827000000000000000000000000000000000827";
export const TACTICAL_SEED = 827;

// Public app catalog, read-only snapshot 2026-10-15. Exact source text, power,
// payment and combo fields are retained, including skills unrelated to the case.
export const TACTICAL_CARDS: CardDef[] = [
  {
    "id": "BT31-116",
    "name": "Cell",
    "type": "LEADER",
    "colors": [
      "White"
    ],
    "energyCost": null,
    "zEnergyCost": null,
    "power": 10000,
    "comboCost": null,
    "comboPower": null,
    "skill": "[permanent] You can't include non-white Extra in your deck.\n[br]\n[activate: main] [once per turn] Place up to 1 white <Cell> card from your deck into its owner's Drop, then shuffle your deck.\n[br]\n[awaken] When your life is at 4 or less, or you have a total of 3 or more white <Cell> cards and Extras in your Drop: Draw 2 cards, then add cards from your life to your hand until you have 6 life left.",
    "characters": [
      "Cell"
    ],
    "traits": [
      "Android"
    ],
    "back": {
      "name": "Cell, Perfect Power",
      "power": 15000,
      "skill": "[auto] Switch 1 of your energy to Hidden Mode: When your <Cell> or <Cell Jr.> card -- both white and with an energy cost of 3 or more -- is played, activate an [activate: main/battle] skill of up to 1 mono-white Extra with an energy cost of 2 in your hand.\n[br]\n[activate: main/battle] [once per turn] Add up to 1 white Extra with an [activate: main/battle] skill and an energy cost of 2 from your Drop to your hand."
    }
  },
  {
    "id": "BT31-129",
    "name": "Cell, Perfect Form",
    "type": "BATTLE",
    "colors": [
      "White"
    ],
    "energyCost": 6,
    "zEnergyCost": null,
    "power": 25000,
    "comboCost": 0,
    "comboPower": 5000,
    "skill": "[Deflect][Dual Attack]<br>[EX-Evolve][Limit 1](White), if you have 3 or more energy and you draw 1 card: White &lt;Cell&gt; card with an energy cost of 3 or more.<br>[Auto] When this card attacks, switch up to 1 of your energy to Revealed Mode.<br>[Auto] When this card is removed from your Battle Area by a skill, play up to 1 white &lt;Cell&gt; card with an energy cost of 4 from your Drop.",
    "characters": [
      "Cell"
    ],
    "traits": [
      "Android"
    ],
    "back": null
  },
  {
    "id": "BT31-132",
    "name": "Cell, Ominous Larva",
    "type": "BATTLE",
    "colors": [
      "White"
    ],
    "energyCost": 1,
    "zEnergyCost": null,
    "power": 4000,
    "comboCost": 0,
    "comboPower": 5000,
    "skill": "[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 white 《Android》 card to your hand, then shuffle your deck.<br>[Activate: Main][Limit 1] If your Leader is a white &lt;Cell&gt; card, and you remove this card in your Drop from the game and discard 1 card from your hand: Add up to 1 white Extra with an[Activate: Main/Battle] skill from your Drop to your hand.",
    "characters": [
      "Cell"
    ],
    "traits": [
      "Android"
    ],
    "back": null
  },
  {
    "id": "BT31-142",
    "name": "Cell's Kamehameha",
    "type": "EXTRA",
    "colors": [
      "White"
    ],
    "energyCost": 2,
    "zEnergyCost": null,
    "power": null,
    "comboCost": null,
    "comboPower": null,
    "skill": "[Activate: Main/Battle] Draw 1 card, then choose up to 1 of your white Battle Cards and it gets +10000 power for the turn. Additionally, if it's your turn, choose up to 1 of your opponent's Battle Cards and place it into its owner's Drop.",
    "characters": [],
    "traits": [],
    "back": null
  },
  {
    "id": "SD5-01",
    "name": "Golden Great Ape Son Goku",
    "type": "LEADER",
    "colors": [
      "Yellow"
    ],
    "energyCost": null,
    "zEnergyCost": null,
    "power": 10000,
    "comboCost": null,
    "comboPower": null,
    "skill": "[Auto] When this card attacks a Leader Card, draw 1 card.<br>[Awaken] When your life is at 4 or less: You may choose up to 2 of your energy, switch them to Active Mode, and flip this card over.",
    "characters": [
      "Son Goku: GT"
    ],
    "traits": [
      "Saiyan",
      "Goku's Lineage"
    ],
    "back": {
      "name": "Long Odds SS4 Son Goku",
      "power": 15000,
      "skill": "[Auto] When this card attacks, draw 1 card.<br>[Permanent] When your life is less than or equal to your opponent's life, this card gains +5000 power and [Critical] (When this card inflicts damage to your opponent's life, they place that many cards in their Drop Area instead of their hand) during your turn."
    }
  },
  {
    "id": "SD5-03",
    "name": "SSB Son Goku, at the Apex",
    "type": "BATTLE",
    "colors": [
      "Yellow"
    ],
    "energyCost": 5,
    "zEnergyCost": null,
    "power": 25000,
    "comboCost": 1,
    "comboPower": 10000,
    "skill": "[swap 8] {y}{y}{y}{y}: ≪Goku's Lineage≫ with an energy cost of 8. (Play the specified card from your hand, then return this card to your hand)<br>[barrier] (This card can't be chosen by the skills of your opponent's cards)<br>[double strike] (This card inflicts 2 damage instead of 1 when attacking)<br>[auto] When you play this card, if your Leader Card is ≪Goku's Lineage≫, choose up to 1 of your opponent's Battle Cards and KO it.",
    "characters": [
      "Son Goku"
    ],
    "traits": [
      "Goku's Lineage"
    ],
    "back": null
  },
  {
    "id": "SD5-04",
    "name": "Reborn Might SS4 Son Goku",
    "type": "BATTLE",
    "colors": [
      "Yellow"
    ],
    "energyCost": 5,
    "zEnergyCost": null,
    "power": 25000,
    "comboCost": 0,
    "comboPower": 5000,
    "skill": "[swap 8] {y}{y}{y}{y}: <<Goku's Lineage>> with an energy cost of 8. (Play the specified card from your hand, then return this card to your hand)<br>[activate: main] [once per turn] Choose 1 card from your life and add it to your hand: Switch this card to Active Mode, and if you have 2 or less life, this card gains [triple strike] (This card inflicts 3 damage instead of 1 when attacking) for the duration of the turn.",
    "characters": [
      "Son Goku: GT"
    ],
    "traits": [
      "Goku's Lineage"
    ],
    "back": null
  },
  {
    "id": "BT4-078",
    "name": "Dependable Dynasty Son Goku",
    "type": "BATTLE",
    "colors": [
      "Yellow"
    ],
    "energyCost": 2,
    "zEnergyCost": null,
    "power": 15000,
    "comboCost": 0,
    "comboPower": 5000,
    "skill": "[swap 3] {y}{y}: ≪Goku's Lineage≫ with an energy cost of 3. (Play the specified card from your hand, then return this card to your hand)",
    "characters": [
      "Son Goku"
    ],
    "traits": [
      "Goku's Lineage"
    ],
    "back": null
  },
  {
    "id": "SD15-01",
    "name": "Vegeta",
    "type": "LEADER",
    "colors": [
      "Red"
    ],
    "energyCost": null,
    "zEnergyCost": null,
    "power": 10000,
    "comboCost": null,
    "comboPower": null,
    "skill": "[Auto] When this card attacks, draw 1 card, then it gets +5000 power for the turn.<br>[Awaken] When your life is at 4 or less or you have a red Unison Card with a specified cost of 2 in play: You may switch up to 2 of your energy to Active Mode, add cards from your life to your hand until you have 5 life left, choose up to 1 of your red Unison Cards with {Cabba} in its name and add a marker to it, then flip this card over.",
    "characters": [
      "Vegeta"
    ],
    "traits": [
      "Saiyan",
      "Universe 7"
    ],
    "back": {
      "name": "SSB Vegeta, Spirit Boost Elite",
      "power": 15000,
      "skill": "[Auto] When this card attacks, draw 1 card, then choose up to 1 of your red Unison Cards with a specified cost of 2 and no keyword skills, and it gains [Double Strike] for the turn.<br>[Auto][Once per turn][Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When your opponent attacks your red Unison Card with a specified cost of 2, negate the attack, then choose up to 1 of your Unison Cards and it gets +6000 power for the turn."
    }
  },
  {
    "id": "SD15-03",
    "name": "Son Goku, Spirit Boost Warrior",
    "type": "BATTLE",
    "colors": [
      "Red"
    ],
    "energyCost": 4,
    "zEnergyCost": null,
    "power": 20000,
    "comboCost": 0,
    "comboPower": 5000,
    "skill": "[Deflect][Double Strike][Dual Attack]<br>[Permanent] If this card is in Rest Mode and you have a red Unison Card with a specified cost of 2 in play, this card and your red Leader Card get +1000 power.<br>[Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) [Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When this card is placed in your Drop Area from your Battle Area by an opponent's skill or KO'd, play this card from your Drop Area.",
    "characters": [
      "Son Goku"
    ],
    "traits": [
      "Saiyan",
      "Universe 7"
    ],
    "back": null
  }
];

export async function realTacticalBundle() {
  const defs = Object.fromEntries(TACTICAL_CARDS.map((c) => [c.id,c]));
  const compiled = rulesFromCompiler(defs);
  const scripts = Object.fromEntries(TACTICAL_CARDS.flatMap((c) => [c.id,...(c.back ? [`${c.id}#back`] : [])].map((id) => {
    if (!compiled[id]?.complete) throw new Error(`real tactical fixture ${id} unsupported: ${JSON.stringify(compiled[id]?.unsupported)}`);
    return [id,compiled[id]];
  })));
  const base = await makeReplayBundle({defs,scripts,art:Object.fromEntries(TACTICAL_CARDS.map((c) => [c.id,{front:`/art/${c.id}.png`,back:null}])),rulesetFiles:DBS_FILES,runtime:TACTICAL_REVISION});
  // Enough existing instances to stage each minimal board. Repeated support
  // quantities are fixture scaffolding, not an asserted legal 50-card deck.
  return {...base,decks:{p1:{name:"SD5 tactical seat",leader:"SD5-01",main:Array<string>(50).fill("SD5-03")},
    p2:{name:"White Cell tactical seat",leader:"BT31-116",main:Array<string>(50).fill("BT31-132")}}};
}

export const zones = (m:PinnedMatch,p:PlayerId,z:string) => (m.state.sides[p].zones as Record<string,string[]>)[z] ?? [];
export const instance = (m:PinnedMatch,p:PlayerId,z:string,cardId:string) => zones(m,p,z).find((id) => m.state.cards[id].cardId===cardId);
export function takeLegal(m:PinnedMatch,want:(action:ReturnType<typeof legalMoves>[number]["action"])=>boolean) {
  const action = legalMoves(m).find((l) => want(l.action))?.action;
  if (!action) throw new Error(`no desired legal move at ${m.state.prompt.kind}: ${JSON.stringify(legalMoves(m).map((l) => l.action))}`);
  return applyMove(m,action);
}

const empty:Layout={hand:[],energy:[],battle:[],energyMarkers:0,leaderMode:"rest"};
export interface RealTacticalCase {
  key:string; portalScenarioId:"wc-a03"|"ai-01"|"ai-10"; recipeId:string; seat:PlayerId;
  match:PinnedMatch; focus:string; attackerIds:string[]; horizonBattles:number;
}
export async function realTacticalCases() {
  const bundle=await realTacticalBundle();
  const opening=await mainPhaseMatch(bundle,TACTICAL_SEED,TACTICAL_REVISION);
  function layout(p1:Layout,p2:Layout,leaders:[string,string]):PinnedMatch {
    const m=stage(opening,{p1,p2});
    for (const [p,id] of [["p1",leaders[0]],["p2",leaders[1]]] as const) {
      m.state.cards[zones(m,p,"leader")[0]].cardId=id;
      m.state.cards[zones(m,p,"leader")[0]].flipped=false;
      // The only Life-to-hand support used by the exact continuations is a
      // paid-combo card: at zero energy it cannot answer the second attack.
      for(const card of [...zones(m,p,"life"),...zones(m,p,"deck")]) m.state.cards[card].cardId="SD5-03";
    }
    return m;
  }
  const white=layout({...empty,battle:[{cardId:"SD5-03",mode:"active"},{cardId:"SD5-03",mode:"active"}]},
    {...empty,hand:["BT31-142","BT31-132"],energy:["BT31-132","BT31-132"],battle:[{cardId:"BT31-129",mode:"rest"}]},["SD5-01","BT31-116"]);
  white.state.cards[zones(white,"p2","leader")[0]].flipped=true;
  const cell=instance(white,"p2","battle","BT31-129")!;
  const attackers=zones(white,"p1","battle");
  let whiteBattle=takeLegal(white,(a) => a.type==="attack" && a.attacker===attackers[0] && a.target===cell).match;
  // Candidate starts at the defensive Combo window, after the attacker has
  // passed. A Counter/Blocker decision cannot hide the activation/combo trade.
  for(let n=0;n<8 && !(whiteBattle.state.prompt.kind==="combo" && whiteBattle.state.prompt.player==="p2");n++)
    whiteBattle=takeLegal(whiteBattle,(a) => a.type==="pass" || a.type==="counter" && a.card===null || a.type==="block" && a.card===null).match;
  if(whiteBattle.state.prompt.kind!=="combo" || whiteBattle.state.prompt.player!=="p2") throw new Error("White fixture did not reach defensive Combo window");
  const dual=layout({...empty,battle:[{cardId:"SD15-03",mode:"active"}]},{...empty,life:4},["SD15-01","SD5-01"]);
  const restand=(life:number) => layout({...empty,life,battle:[{cardId:"SD5-04",mode:"rest"}]},{...empty,life:3},["SD5-01","SD15-01"]);
  const stand=restand(3), unsafe=restand(1);
  const cases:RealTacticalCase[]=[
    {key:"wc-a03-turn-buff-vs-combo",portalScenarioId:"wc-a03",recipeId:"bt31-116-white-cell-reveal-evolve",seat:"p2",match:whiteBattle,focus:cell,attackerIds:[...attackers],horizonBattles:2},
    {key:"ai-01-dual-attack-double-strike",portalScenarioId:"ai-01",recipeId:"sd15-01-pride-of-the-saiyans-starter-control",seat:"p1",match:dual,focus:instance(dual,"p1","battle","SD15-03")!,attackerIds:[],horizonBattles:2},
    {key:"ai-10-restand-for-triple-strike",portalScenarioId:"ai-10",recipeId:"sd5-01-crimson-saiyan-starter-control",seat:"p1",match:stand,focus:instance(stand,"p1","battle","SD5-04")!,attackerIds:[],horizonBattles:1},
    {key:"ai-10-decline-last-life-price",portalScenarioId:"ai-10",recipeId:"sd5-01-crimson-saiyan-starter-control",seat:"p1",match:unsafe,focus:instance(unsafe,"p1","battle","SD5-04")!,attackerIds:[],horizonBattles:0},
  ];
  return {bundle,cases};
}
