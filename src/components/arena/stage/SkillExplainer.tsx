"use client";

import { useRef, type CSSProperties } from "react";
import type { ExplainedMoment, ExplainRole } from "@/lib/arena/explain";
import { cardImage } from "@/lib/catalog/card-image";
import { plainText } from "../shared-model";
import styles from "./SkillExplainer.module.css";

/** How long a press is held before it counts as "hold to pause" rather than a tap. */
const HOLD_MS = 320;

export interface SkillExplainerProps {
  explained: { moment: ExplainedMoment; at: number; role: ExplainRole };
  /** The beat on screen: a new one restarts the step's clock. */
  beat: number;
  /** The skill card's picture, when the viewer may see it. */
  imageUrl: string | null;
  /** How long the beat on screen is held, and how much of that is the receipt (`motion.ts`'s `EXPLAIN`). */
  ms: number;
  receiptMs: number;
  /** The story is held (a press, or a card open): the step's clock stands still with it. */
  paused: boolean;
  onNext: () => void;
  onHold: () => void;
  onRelease: () => void;
}

/**
 * The skill explainer on the board (`docs/arena-skill-explainer.md`, the owner's decisions of 13 Nov 2026): a skill
 * told as a player at a real table tells it. The callout first — the card lifted, a speech bubble from its owner's
 * side ("I use 《Swap 2》" from the opponent, "You use…" for yours) and the printed text with its trigger words
 * highlighted — then each thing it did as a numbered step while the board plays it, then the receipt.
 *
 * It only says what `explain.ts` worked out from the beats on screen; the board underneath is already in its final
 * state, so tapping on (or Skip) never changes the game. A tap goes to the next step, a press held pauses.
 */
export function SkillExplainer({ explained, beat, imageUrl, ms, receiptMs, paused, onNext, onHold, onRelease }: SkillExplainerProps) {
  const { moment, at, role } = explained;
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean }>({ timer: null, held: false });
  const down = () => {
    const p = press.current;
    p.held = false;
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      p.held = true;
      onHold();
    }, HOLD_MS);
  };
  const up = (tap: boolean) => {
    const p = press.current;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    if (p.held) {
      p.held = false;
      onRelease();
    } else if (tap) onNext();
  };
  const handlers = {
    onPointerDown: down,
    onPointerUp: () => up(true),
    onPointerCancel: () => up(false),
    onPointerLeave: () => up(false),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNext();
      }
    },
  };
  const side = moment.mine ? styles.yours : styles.theirs;
  const clock = { "--hold": `${Math.max(0, ms - (role.kind === "step" && role.receipt ? receiptMs : 0))}ms`, "--beat": `${ms}ms` } as CSSProperties;
  const state = paused ? styles.paused : "";

  if (at === 0 && role.kind === "callout") {
    return (
      <div className={`${styles.callout} ${side} ${state}`} style={clock} role="button" tabIndex={0} aria-label={`${moment.mine ? "Your" : "Opponent's"} skill: ${moment.headline}. Tap to go on, hold to pause.`} data-explainer="callout" data-explainer-moment={moment.key} {...handlers}>
        <div className={styles.card} aria-hidden>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- transient overlay; the board already loaded this art.
            <img src={cardImage(imageUrl, "medium")} alt="" />
          ) : (
            <span className={styles.back} />
          )}
        </div>
        <div className={styles.words}>
          <p className={styles.who}>
            <span className={styles.sideTag}>{moment.mine ? "You" : "Opponent"}</span>
            {moment.name && <span className={styles.name}>{moment.name}</span>}
          </p>
          <p className={styles.bubble}>{moment.mine ? moment.headline : `“${moment.headline}”`}</p>
          {(moment.trigger || moment.body) && (
            <p className={styles.text}>
              {moment.trigger && <mark className={styles.trigger}>{moment.trigger}</mark>} {plainText(moment.body)}
            </p>
          )}
          {moment.keyword && (
            <p className={styles.keyword}>
              <span className={styles.chip}>{moment.keyword.name}</span> {moment.keyword.meaning}
            </p>
          )}
          {moment.noEffect && <p className={styles.nothing}>It finds nothing to act on, so nothing happens.</p>}
          <p className={styles.hint} aria-hidden>
            {role.steps ? `${role.steps} step${role.steps === 1 ? "" : "s"} · ` : ""}tap to go on · hold to pause
          </p>
        </div>
        <span className={styles.timer} key={beat} aria-hidden />
      </div>
    );
  }

  if (role.kind !== "step") return null;
  const sentence = moment.steps[role.index - 1] ?? "";
  return (
    <div className={`${styles.line} ${moment.mine ? styles.lineTop : styles.lineBottom} ${side} ${state}`} style={clock} role="button" tabIndex={0} aria-live="polite" aria-label={`Step ${role.index} of ${role.of}: ${sentence}`} data-explainer="step" data-explainer-step={`${role.index}/${role.of}`} {...handlers}>
      <div className={styles.lineHead}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- transient overlay; the board already loaded this art.
          <img className={styles.thumb} src={cardImage(imageUrl, "thumb")} alt="" />
        ) : (
          <span className={`${styles.thumb} ${styles.back}`} />
        )}
        <span className={styles.stepOf}>
          {moment.label} · step {role.index} of {role.of}
        </span>
        <span className={styles.dots} aria-hidden>
          {Array.from({ length: role.of }, (_, i) => (
            <span key={i} className={i + 1 < role.index ? styles.dotDone : i + 1 === role.index ? styles.dotNow : styles.dot} />
          ))}
        </span>
      </div>
      <div className={styles.lineBody} key={beat}>
        <p className={`${styles.sentence} ${role.receipt && moment.receipt ? styles.leaves : ""}`}>{sentence}</p>
        {role.receipt && moment.receipt && (
          <p className={styles.receipt} role="status">
            <span aria-hidden>✓ </span>
            {moment.receipt}
          </p>
        )}
      </div>
    </div>
  );
}
