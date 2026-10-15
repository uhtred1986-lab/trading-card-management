"use client";
import { useEffect, useState, type CSSProperties } from "react";
import type { SkillMoment } from "@/lib/arena/immersion/skills";
import styles from "./SkillBanner.module.css";

export function SkillBanner({ moment, durationMs, reducedMotion, onSkip }: { moment: SkillMoment | null; durationMs: number; reducedMotion: boolean; onSkip: () => void }) {
  return moment ? <SkillBeat key={moment.key} moment={moment} durationMs={durationMs} reducedMotion={reducedMotion} onSkip={onSkip} /> : null;
}
function SkillBeat({ moment, durationMs, reducedMotion, onSkip }: { moment: SkillMoment; durationMs: number; reducedMotion: boolean; onSkip: () => void }) {
  const [finished, setFinished] = useState(false);
  const duration = Number.isFinite(durationMs) ? Math.max(1, Math.min(1100, durationMs)) : 850;
  useEffect(() => { const timer = window.setTimeout(() => setFinished(true), duration); return () => window.clearTimeout(timer); }, [duration]);
  if (finished) return null;
  // The event adapter supplies a face only when the viewer may see it.
  const movement = moment.from && moment.to;
  return <div className={`${styles.overlay} ${styles[moment.style]} ${reducedMotion ? styles.reduced : ""}`} style={{ "--duration": `${duration}ms` } as CSSProperties} data-skill-banner={moment.style}>
    <div className={styles.stage}>
      <div className={styles.aura} aria-hidden="true" />
      <strong className={styles.title}>{moment.title}</strong>
      <div className={styles.path} aria-hidden="true">
        {movement && <><span className={styles.source}>{moment.detail.split(" → ")[0]}</span><span className={styles.destination}>{moment.detail.split(" → ")[1]}</span><span className={styles.rail} /></>}
        <div className={`${styles.card} ${movement ? styles.moving : moment.flip ? styles.flipping : styles.resolving}`}>{moment.face?.imageUrl ? <span className={styles.face} style={{ backgroundImage: `url(${JSON.stringify(moment.face.imageUrl)})` }} /> : <span>✦</span>}</div>
      </div>
      <span className={styles.receipt} role="status">{moment.side && `${moment.side} · `}{moment.face && `${moment.face.name} · `}{moment.detail}</span>
    </div>
    <button type="button" className={styles.skip} onClick={() => { setFinished(true); onSkip(); }}>Skip effect</button>
  </div>;
}
