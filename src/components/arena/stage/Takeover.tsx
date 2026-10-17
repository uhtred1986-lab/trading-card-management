"use client";

import { ClashBackdrop, Count, TriggerLine, type BattleSide, type StagingProps } from "./BattleParts";
import { StageCard } from "./StageCard";

/** The explosion's twelve shards, the same fan the leader's damage burst uses. */
const SHARDS: [number, number][] = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a, i) => [a, [74, 58, 80, 62, 78, 56, 72, 60, 82, 58, 76, 64][i]]);

/**
 * The takeover: the fight given the battle field (`docs/arena-redesign/`
 * frames 07–08, prototype `.clash`).
 *
 * It covers the field and nothing else. The hand and the prompt stay on screen
 * and tappable, which is what lets a combo be chosen from the hand while the
 * fight is up. Claude's card sits on top and yours below, as on the board
 * underneath, each beside its role, a huge power figure and the combos added
 * to it; a VS slams between them and gives way to the verdict when the clash
 * beat lands.
 *
 * Reuse, not a rebuild (`docs/arena-battle-staging-spec.md` §3.4): it takes
 * the same props as `DuelBand` and reads only `shape`, the beat and the pieces
 * in `BattleParts`. `ArenaStage` places it over the field and stands it down
 * whenever the prompt is asking for a card it would be covering.
 */
export function Takeover({ shape, cardProps, beat, note, yourPick, desk, incoming = null }: StagingProps & { note?: string | null; yourPick?: boolean; desk?: boolean; incoming?: { name: string; plus: number } | null }) {
  const { attack, defence } = shape;
  const theirs = attack.mine ? defence : attack;
  const yours = attack.mine ? attack : defence;
  const clash = beat?.t === "clash" ? beat : null;
  const name = beat?.t === "skill" ? (shape.cards.find((c) => c.id === beat.card)?.name ?? null) : null;
  // A phone size, scaled by the board's `--arena` like every card: 150 px at desk scale.
  // Large on purpose: the two fighting cards are the whole point of the screen.
  const width = desk ? 77 : 112;
  // The side that came out ahead, once the clash has landed: lit, while the other dims.
  const winner = clash ? (clash.hit ? attack : defence) : null;

  const side = (s: BattleSide, at: "top" | "bot") => {
    const attacking = s === attack;
    const role = s.mine ? (attacking ? "You attack" : "You defend") : `${s.name} ${attacking ? "attacks" : "defends"}`;
    // The guard takes the hit; the attacker is never the one that explodes.
    const struck = !!clash && clash.hit && !attacking;
    // A combo tapped and sent but not yet drawn by the engine: the figure already counts it.
    const waiting = s.mine && incoming && !clash ? incoming : null;
    return (
      <div className={`arena-clash-side ${at === "top" ? "arena-clash-top" : "arena-clash-bot"} ${winner ? (winner === s ? "arena-clash-won" : "arena-clash-lost") : ""}`}>
        <div className="relative shrink-0">
          {/* Drawn standing: the attacker is rested on the board by attacking, but
              in the fight it is the card throwing the punch. */}
          {s.main && <StageCard {...cardProps(s.main)} card={{ ...s.main, mode: "active" }} width={width} />}
          {struck && (
            <span key={clash.n} className="arena-boom arena-clash-boom" style={{ left: "50%", top: "50%" }} aria-hidden>
              <span className="arena-boom-flash" />
              <span className="arena-boom-ring" />
              {SHARDS.map(([a, d]) => (
                <i key={a} className="arena-boom-shard" style={{ "--a": `${a}deg`, "--d": `${d}px` } as React.CSSProperties} />
              ))}
            </span>
          )}
        </div>
        <div className="arena-clash-meta">
          <span className="arena-clash-role">{role}</span>
          <Count value={s.power + (waiting?.plus ?? 0)} className="arena-clash-pow arena-impact" />
          {(s.chain.length > 0 || waiting) && (
            <div className="arena-clash-combos">
              {s.chain.map((l) => (
                <button
                  key={l.card.id}
                  type="button"
                  onClick={cardProps(l.card).onInspect}
                  // Yours stay dashed while you are still choosing them; they are
                  // drawn solid once the fight is locked in.
                  className={`arena-clash-combo ${s.mine && yourPick && !clash ? "arena-clash-combo-pending" : ""}`}
                  title={l.kind === "counter" ? "a counter, in play order" : "a combo card, in play order"}
                >
                  {l.kind === "counter" && <span className="arena-clash-counter">counter</span>}+{l.contribution.toLocaleString("en")} {l.card.name}
                  {l.fired && (
                    <span className="arena-trigger-lit ml-1" title="a skill of this card fired in this battle">
                      ⚡
                    </span>
                  )}
                </button>
              ))}
              {waiting && (
                <span className="arena-clash-combo arena-clash-combo-pending" data-combo-sending>
                  +{waiting.plus.toLocaleString("en")} {waiting.name}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`arena-fight ${clash ? (clash.hit ? "arena-fight-hit" : "arena-fight-held") : ""}`} aria-label="the battle">
      <ClashBackdrop />
      {side(theirs, "top")}
      <span className={`arena-clash-vs arena-fx-vs arena-impact ${clash ? "arena-fx-vs-off" : ""}`} aria-hidden>
        VS
      </span>
      {side(yours, "bot")}
      <div className="arena-clash-note">
        {note && !clash && <span>{note}</span>}
        <TriggerLine beat={beat} name={name} />
      </div>
    </div>
  );
}
