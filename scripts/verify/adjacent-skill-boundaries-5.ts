/** R479: independent printed skills survive a missing catalog space. */
import assert from "node:assert/strict";
import { card } from "./harness";
import { parseSkills, skillLines } from "../../src/lib/arena/text/cards";
import { skillRecords } from "../../src/lib/arena/draft";
import { recordContractGaps, rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
const fixtures = [
  {
    "id": "BT1-043",
    "text": "[Quadruple Strike] (This card inflicts 4 damage instead of 1 when attacking)<br>[Permanent] This card's attack and skill cannot be negated.[Auto] When you play this card, if your Leader Card is &lt;Beerus&gt;, after your current turn ends, take another turn.",
    "old": {
      "cardId": "BT1-043",
      "side": "front",
      "skillIndex": 10,
      "printed": "[Permanent] This card's attack and skill cannot be negated.[Auto] When you play this card, if your Leader Card is <Beerus>, after your current turn ends, take another turn.",
      "kind": "permanent",
      "trigger": [],
      "combo": null,
      "usage": {
        "version": 1,
        "oncePerTurn": false,
        "limit": null
      },
      "validity": {
        "version": 1,
        "sparking": null
      },
      "cost": {
        "version": 1,
        "readable": true,
        "orbs": {},
        "either": [],
        "marker": null,
        "burst": null,
        "spiritBoost": null,
        "text": "",
        "condition": null,
        "program": null
      },
      "cond": null,
      "ops": [
        {
          "op": "permit",
          "what": "attackUnnegatable",
          "target": {
            "sel": {
              "special": "self"
            }
          },
          "until": "game"
        },
        {
          "op": "forbid",
          "what": "beNegated",
          "until": "game",
          "target": {
            "sel": {
              "special": "self"
            }
          }
        }
      ],
      "unread": [
        "after your current turn ends",
        "take another turn"
      ],
      "pattern": "after your current turn ends",
      "reads": "this card's attacks can't be negated, this card can't have their skills negated"
    }
  },
  {
    "id": "BT3-026",
    "text": "[Counter: Attack] Play this card and negate the attack.<br>[Permanent] If you or your opponent's Leader Card has 15000 or more power, reduce the energy cost of this card in your hand by 2.[Auto] When this card KO-s your opponent's Battle Card, switch it to Active Mode.",
    "old": null
  },
  {
    "id": "BT18-043",
    "text": "[Permanent] If there are 2 or more {Angel Halo} in your Drop, reduce the energy cost of this card in your hand by 1.<br>[Auto] When this card is played, draw 1 card, then place up to 1 blue ≪Another World Budokai≫ card from your Warp in your Drop.[Activate: Main][Limit 1] If your Leader is a blue ≪Another World Budokai≫ card, you send this card to its owner's Warp, and discard 1 {Angel Halo} from your hand: Add up to 1 blue ≪Another World Budokai≫ card with an energy cost between 3 and 7 from your Warp to your hand.",
    "old": {
      "cardId": "BT18-043",
      "side": "front",
      "skillIndex": 10,
      "printed": "[Auto] When this card is played, draw 1 card, then place up to 1 blue ≪Another World Budokai≫ card from your Warp in your Drop.[Activate: Main][Limit 1] If your Leader is a blue ≪Another World Budokai≫ card, you send this card to its owner's Warp, and discard 1 {Angel Halo} from your hand: Add up to 1 blue ≪Another World Budokai≫ card with an energy cost between 3 and 7 from your Warp to your hand.",
      "kind": "auto",
      "trigger": [
        "played"
      ],
      "combo": null,
      "usage": {
        "version": 1,
        "oncePerTurn": false,
        "limit": null
      },
      "validity": {
        "version": 1,
        "sparking": null
      },
      "cost": {
        "version": 1,
        "readable": false,
        "text": "When this card is played, draw 1 card, then place up to 1 blue ≪Another World Budokai≫ card from your Warp in your Drop.[Activate: Main][Limit 1] If your Leader is a blue ≪Another World Budokai≫ card, you send this card to its owner's Warp, and discard 1 {Angel Halo} from your hand",
        "orbs": {},
        "either": [],
        "marker": null,
        "burst": null,
        "spiritBoost": null,
        "condition": null,
        "program": null
      },
      "cond": null,
      "ops": [],
      "unread": [
        "When this card is played, draw 1 card, then place up to 1 blue ≪Another World Budokai≫ card from your Warp in your Drop.[Activate: Main][Limit 1] If your Leader is a blue ≪Another World Budokai≫ card, you send this card to its owner's Warp, and discard 1 {Angel Halo} from your hand"
      ],
      "pattern": "when this card is played, draw N card, then place up to N blue … card from your warp in your drop.[activate: main][limit N] if your leader is a blue … card, you send this card to its owner's warp, and discard N … from your hand",
      "reads": ""
    }
  }
];
let cases = 0;
for (const fixture of fixtures) {
  const separated = fixture.text.replace(/\.\[/g, ".\n[");
  assert.deepEqual(parseSkills(fixture.text), parseSkills(separated)); cases++;
  const def = card(fixture.id, {skill:fixture.text});
  const records = skillRecords(def);
  assert.equal(records.length, 3); cases++;
  assert.deepEqual(records.map(row=>row.kind), fixture.id === "BT1-043" ? ["keyword","permanent","auto"] : fixture.id === "BT3-026" ? ["counter:attack","permanent","auto"] : ["permanent","auto","activate:main"]); cases++;
  assert.ok(records.every(row=>!recordContractGaps(row).some(gap=>gap.includes("boundaries")))); cases++;
  if(fixture.id === "BT1-043") {
    assert.deepEqual(records[1].unread, []);
    assert.ok(records[2].unread.length > 0, "separate extra-turn Auto is still unsupported"); cases++;
  }
  for (const status of ["draft","confirmed","corrected","open"] as const) {
    if (!fixture.old) continue;
    const row = {...fixture.old,id:479,status,source:"compiler"} as unknown as RuleRow;
    assert.ok(recordContractGaps(row).some(gap=>gap.includes("boundaries")));
    assert.ok(rulesFromRows([row],{[fixture.id]:def})[fixture.id].bySkill[row.skillIndex].unsupported.includes("no current rule record; regenerate rules and rebuild the match")); cases++;
  }
}
for(const text of [
  "[Auto] Draw 1 card. (Reminder.[Counter: Play] is a skill.)",
  "[Permanent] This card gains [Blocker] during your turn.",
  "[Auto] Draw 1 card [Activate: Main] Draw 2 cards.",
]) {assert.equal(skillLines(text).length,1); cases++;}
for(const separator of ["", " ", "\t", "\n", "<br>"]){assert.equal(skillLines(`[Permanent] This card gets +5000 power.${separator}[Auto] When this card is played, draw 1 card.`).length,2);cases++;}
console.log(`adjacent-skill-boundaries-5: ${cases} parsing/stored-record checks passed`);
