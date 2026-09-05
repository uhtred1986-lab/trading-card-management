/**
 * What Claude is allowed to see.
 *
 * Hidden information is engineered, not prompted around: this builds the
 * snapshot from the engine's state and simply never reads the areas the rules
 * call secret (3-1-3). Claude gets its own hand and decklist, everything
 * public about both boards, and counts for the rest. It cannot see your hand,
 * your life cards, your deck order, or your decklist — the strings are not in
 * the request at all, so no instruction can leak them.
 *
 * The text form is deliberately terse: it is sent on every decision, so every
 * word is paid for.
 */
import { areaOf, comboPowerOf, compileCardCached, describeScript, face, keywordsInForce, powerOf, skillsOf, type CardDef, type EngineContext, type GameState, type LegalAction, type PlayerId } from "../engine";
import { def } from "../engine/state";
import { other } from "../engine";

const money = (n: number) => n.toLocaleString("en");

function cardLine(ctx: EngineContext, s: GameState, id: string, withText: boolean): string {
  const inst = s.cards[id];
  if (inst.hidden) return "face-down card";
  const d = def(ctx, s, id);
  const f = face(ctx, s, id);
  const bits: string[] = [`${f.name} (${d.id})`];
  if (areaOf(s, id) === "battle" || areaOf(s, id) === "leader" || areaOf(s, id) === "unison") {
    bits.push(`${money(powerOf(ctx, s, id))} power`, inst.mode);
  } else if (f.power != null) {
    bits.push(`${money(f.power)} power`);
  }
  if (d.energyCost != null) bits.push(`cost ${d.energyCost}`);
  if (d.comboCost != null && d.comboPower != null) bits.push(`combo +${money(comboPowerOf(ctx, s, id))} for ${d.comboCost}`);
  if (inst.markers) bits.push(`${inst.markers} markers`);
  const kw = keywordsInForce(ctx, s, id).map((k) => k.name);
  if (kw.length) bits.push(`[${kw.join("][")}]`);
  let line = bits.join(", ");
  // Full text only for cards that can act: in play, or in Claude's own hand.
  if (withText && f.skill) line += `\n    text: ${f.skill.replace(/<br\s*\/?>/gi, " / ").replace(/\s+/g, " ").slice(0, 300)}`;
  return line;
}

function energyLine(ctx: EngineContext, s: GameState, p: PlayerId): string {
  const ps = s.players[p];
  const byColour = new Map<string, { active: number; rest: number }>();
  for (const id of ps.energy) {
    const key = def(ctx, s, id).colors.join("/") || "Colourless";
    const e = byColour.get(key) ?? { active: 0, rest: 0 };
    if (s.cards[id].mode === "active") e.active++;
    else e.rest++;
    byColour.set(key, e);
  }
  const parts = [...byColour.entries()].map(([c, e]) => `${c} ${e.active} active${e.rest ? ` + ${e.rest} rested` : ""}`);
  if (ps.energyMarkers) parts.push(`${ps.energyMarkers} energy marker(s)`);
  return parts.join(", ") || "none";
}

function sideText(ctx: EngineContext, s: GameState, p: PlayerId, own: boolean): string {
  const ps = s.players[p];
  const lines: string[] = [];
  lines.push(`${own ? "YOU" : "OPPONENT"} (${ps.name})`);
  lines.push(`  life ${ps.life.length}, deck ${ps.deck.length}, hand ${ps.hand.length}, drop ${ps.drop.length}${ps.warp.length ? `, warp ${ps.warp.length}` : ""}`);
  if (ps.zDeck.length || ps.zEnergy.length) lines.push(`  Z-Deck ${ps.zDeck.length}, Z-Energy ${ps.zEnergy.length}`);
  lines.push(`  energy: ${energyLine(ctx, s, p)}`);
  if (ps.leader) lines.push(`  leader: ${cardLine(ctx, s, ps.leader, true)}`);
  if (ps.unison) lines.push(`  unison: ${cardLine(ctx, s, ps.unison, true)}`);
  lines.push(`  battle area: ${ps.battle.length ? ps.battle.map((id) => cardLine(ctx, s, id, true)).join("\n    · ") : "empty"}`);
  if (ps.combo.length) lines.push(`  combo area: ${ps.combo.map((id) => cardLine(ctx, s, id, false)).join("; ")}`);
  // Only Claude's own hand is ever described (3-3-3). Its text is left out
  // because the cached decklist above already carries it, keyed by card number.
  if (own) lines.push(`  your hand:\n    · ${ps.hand.map((id) => cardLine(ctx, s, id, false)).join("\n    · ") || "empty"}`);
  if (ps.drop.length) lines.push(`  top of drop: ${cardLine(ctx, s, ps.drop[0], false)}`);
  // 3-9-2-1: a life card a skill turned face up is open to both players, so it
  // is one of the few things either life area may say. The face-down ones stay
  // a number, on both sides.
  const faceUp = (area: string[]) => area.filter((id) => s.cards[id].faceUp);
  if (faceUp(ps.life).length) lines.push(`  face-up in life: ${faceUp(ps.life).map((id) => cardLine(ctx, s, id, true)).join("; ")}`);
  if (faceUp(ps.zDeck).length) lines.push(`  face-up in Z-Deck: ${faceUp(ps.zDeck).map((id) => cardLine(ctx, s, id, true)).join("; ")}`);
  return lines.join("\n");
}

/** The whole snapshot for one decision, from the point of view of `p`. */
export function stateText(ctx: EngineContext, s: GameState, p: PlayerId): string {
  const parts: string[] = [];
  parts.push(`Turn ${s.turn}, ${s.turnPlayer === p ? "your turn" : "opponent's turn"}, phase ${s.phase}.`);
  if (s.battle) {
    const atk = s.battle.attacker;
    const grd = s.battle.guard;
    const mine = s.players[p].combo.reduce((n, id) => n + comboPowerOf(ctx, s, id), 0);
    const theirs = s.players[other(p)].combo.reduce((n, id) => n + comboPowerOf(ctx, s, id), 0);
    parts.push(
      `BATTLE (${s.battle.step}): ${face(ctx, s, atk).name} [${money(powerOf(ctx, s, atk))}] attacks ${face(ctx, s, grd).name} [${money(powerOf(ctx, s, grd))}]. ` +
        `Combo power so far: yours ${money(mine)}, theirs ${money(theirs)}.`,
    );
  }
  parts.push(sideText(ctx, s, p, true));
  parts.push(sideText(ctx, s, other(p), false));
  return parts.join("\n\n");
}

/** The numbered menu. Claude answers with one of these numbers and nothing else. */
export function movesText(legal: LegalAction[]): string {
  return legal.map((l, i) => `${i}. ${l.label}`).join("\n");
}

/**
 * Claude's own decklist with the full text of every card, sent once in the
 * cached part of the system prompt. The opponent's list is not included: it is
 * not public at the table, and the rule here is that only Claude's own cards
 * plus public state may be seen.
 *
 * The text belongs here rather than in the per-turn delta for two reasons: it
 * is what Claude needs to plan past the current turn, and it is static, so it
 * is paid for once at a tenth of the price thereafter. It also carries the
 * prefix past the 4,096-token minimum that Haiku 4.5 needs before anything
 * caches at all — below that the cache silently never fills.
 */
export function decklistText(ctx: EngineContext, s: GameState, p: PlayerId): string {
  const counts = new Map<string, number>();
  for (const inst of Object.values(s.cards)) {
    if (inst.owner !== p) continue;
    counts.set(inst.cardId, (counts.get(inst.cardId) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [cardId, n] of counts) {
    const d = ctx.defs[cardId];
    if (!d) continue;
    const kw = [...new Set(skillsOf(d).map((sk) => sk.keyword?.name).filter(Boolean))];
    const head = `${n}× ${d.name} (${d.id}) — ${d.type.toLowerCase()}, ${d.colors.join("/")}, cost ${d.energyCost ?? "—"}, ${d.power ?? "—"} power${d.comboPower != null ? `, combo +${money(d.comboPower)} for ${d.comboCost}` : ""}${kw.length ? `, [${kw.join("][")}]` : ""}`;
    const text = d.skill ? `\n   ${d.skill.replace(/<br\s*\/?>/gi, "\n   ").replace(/[ \t]+/g, " ").trim()}` : "";
    lines.push(head + text + engineReading(ctx, d));
  }
  return lines.sort().join("\n");
}

/**
 * What the engine will actually do with a card, which is not always what the
 * card says. A skill the compiler could not read is ruled on by Claude when it
 * resolves, and one the engine reads differently should not be planned around
 * as printed — so both are stated here rather than left to be discovered
 * mid-game.
 */
function engineReading(ctx: EngineContext, d: CardDef): string {
  const scripts = compileCardCached(d, "front");
  const notes: string[] = [];
  for (const sk of skillsOf(d)) {
    const sc = scripts.bySkill[sk.index];
    if (!sc || !sk.effect.trim()) continue;
    if (sc.unsupported.length) notes.push(`line ${sk.index / 10 + 1}: ruled on when it resolves`);
    else if (sc.ops.length) notes.push(`line ${sk.index / 10 + 1}: ${describeScript(sc.ops)}`);
  }
  return notes.length ? `\n   engine: ${notes.join("; ")}` : "";
}
