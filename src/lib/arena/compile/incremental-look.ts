import type { Skill } from "../types";
import type { Script } from "../vm/script";

// R527: exact complete reviewed Auto lines only. Generic optional-look and
// top-or-bottom parsers retain their existing behavior pending source review.
const GOHAN = "[Auto] When you play this card, look at up to 7 cards from the top of your deck. Choose up to 1 <Krillin> among them and add it to your hand. Then, shuffle your deck.";
const TRUNKS = "[Auto] When you play this card using [Over Realm], look at up to 2 cards from the top of your deck. Choose up to 1 of them and add it to your hand. Then, place the remaining cards on the top or bottom of your deck in any order.";
const BABIDI = "[Auto] When you play this card, look at up to 3 cards from the top of your deck. Choose up to 1 <Majin Buu> among them and add it to your hand. Then, shuffle your deck.";
const CHEELAI = "[auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 ≪Power Wish≫ card to your hand, then shuffle your deck.";
export function reviewedIncrementalLook(skill: Skill, script: Script): Script {
    const text = skill.raw.replace(/\s+/g, " ").trim();
    if (skill.kind !== "auto" || script.unsupported.length || (text !== GOHAN && text !== TRUNKS && text !== BABIDI && text !== CHEELAI)) return script;
    const [look, choose, move, tail] = script.ops;
    if (script.ops.length !== 4 || look.op !== "look" || choose.op !== "choose" || move.op !== "moveTo") return script;
    if (text === GOHAN || text === BABIDI || text === CHEELAI) return tail.op === "shuffle" ? { ...script, ops: [{ ...look, upTo: true }, choose, move, tail] } : script;
    if (tail.op !== "chooseMode" || tail.modes.length !== 2 || !tail.modes.every(m => m.ops.length === 1 && m.ops[0].op === "moveTo" && m.ops[0].to === "deck")) return script;
    return { ...script, ops: [{ ...look, upTo: true }, choose, move, { ...tail, modes: tail.modes.map(mode => {
        const op = mode.ops[0];
        if (op.op !== "moveTo") return mode;
        return { ...mode, ops: [{ op: "arrange" as const, target: op.target, position: op.position }] };
    }) }] };
}
