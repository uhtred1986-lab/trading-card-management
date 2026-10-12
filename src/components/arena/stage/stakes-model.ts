import type { BattleView, SideView } from '@/lib/arena/view';

/** Counts public card colours; a multi-colour card appears in each colour count. */
export function energyCounts(side: SideView, resting: readonly string[] = [], basis: "payment" | "effective" = "payment") {
  const spent = new Set(resting);
  const colors = new Map<string, { ready: number; total: number }>();
  for (const card of side.energy) {
    const row = side.energyColors?.find((row) => row.card === card.id);
    const effective = (basis === "effective" ? row?.colors : row?.paymentColors) ?? card.colors;
    for (const color of effective.length ? effective : ['Colourless / hidden']) {
      const row = colors.get(color) ?? { ready: 0, total: 0 };
      row.total++;
      if (card.mode === 'active' && !spent.has(card.id)) row.ready++;
      colors.set(color, row);
    }
  }
  return [...colors].map(([color, count]) => ({color, ...count}));
}
export function energySummary(side: SideView, resting: readonly string[] = [], basis: "payment" | "effective" = "payment") {
  const colors = energyCounts(side, resting, basis);
  return colors.length ? `${side.energyColors ? basis === "payment" ? 'Payment colours: ' : 'Effective colours: ' : ''}${colors.map(c => `${c.color} ${c.ready}/${c.total}`).join(' · ')}${side.energyColors ? '' : ' (printed colours; payment projection unavailable)'}` : 'No energy';
}
export function stakesSummary(battle: BattleView) {
  const s = battle.stakes;
  if (!s) return 'Battle consequences unavailable in this view.';
  const comparison = s.tied ? 'Tied — attacker wins ties.' : s.hit ? 'Attack ahead.' : 'Defense ahead — attack held.';
  if (!s.hit) return comparison;
  const consequence = s.target === 'leader'
    ? `${s.lifeDamage} life to ${s.critical ? 'Drop (Critical)' : 'hand'}${s.strikeDamage === 2 ? ' (Double Strike)' : s.strikeDamage > 2 ? ` (Strike ${s.strikeDamage})` : ''}.${s.potentialLethal ? ` Potential game-ending hit${s.victoryStrike ? ' (Victory Strike)' : ''}.` : ''}`
    : s.target === 'unison' ? `${s.markerLoss} Unison markers lost.`
      : s.koPrevented ? 'Battle KO prevented by a public rule.' : 'Defender faces battle KO.';
  return `${comparison} ${consequence}`;
}
