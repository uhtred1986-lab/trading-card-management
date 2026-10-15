"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { CombatMoment } from "@/lib/arena/immersion/types";
import styles from "./CombatBanner.module.css";

export interface CombatBannerProps {
  moment: CombatMoment | null;
  reducedMotion?: boolean;
  onSkip: () => void;
}

/** The same public presentation beat is used for Leader and Battle Card combat. */
export function CombatBanner({ moment, reducedMotion = false, onSkip }: CombatBannerProps) {
  return moment ? <CombatBeat key={moment.key} moment={moment} reducedMotion={reducedMotion} onSkip={onSkip} /> : null;
}

function CombatBeat({ moment, reducedMotion, onSkip }: Required<CombatBannerProps> & { moment: CombatMoment }) {
  const [finished, setFinished] = useState(false);
  const [loadedSheet, setLoadedSheet] = useState<string | null>(null);
  const duration = moment.outcome === "attack" ? 460 : 1100;
  const sheet = moment.character?.sheet;

  useEffect(() => {
    const timer = window.setTimeout(() => setFinished(true), duration);
    return () => window.clearTimeout(timer);
  }, [duration]);

  useEffect(() => {
    if (!sheet) return;
    let active = true;
    const image = new Image();
    image.onload = () => { if (active && image.naturalWidth === image.naturalHeight * 3) setLoadedSheet(sheet); };
    image.src = sheet;
    return () => { active = false; image.onload = null; };
  }, [sheet]);

  if (finished) return null;
  // A repel/negate never borrows the damage pose, even if its caller supplies it.
  const character = loadedSheet === sheet && moment.outcome !== "repelled" && moment.outcome !== "negated" ? moment.character : null;
  const pose = moment.outcome === "attack" ? "attack" : moment.outcome === "hit" ? "hit" : "guard";
  const frame = pose === "attack" ? "0%" : pose === "guard" ? "50%" : "100%";
  const style = { "--beat-duration": `${duration}ms` } as CSSProperties;

  return (
    <div className={`${styles.overlay} ${reducedMotion ? styles.reduced : ""}`} style={style} data-combat-banner={moment.outcome}>
      <div className={`${styles.banner} ${styles[moment.outcome]}`}>
        <div className={styles.speedfield} aria-hidden="true" />
        <div className={styles.farfield} aria-hidden="true" />
        <div className={styles.energy} aria-hidden="true" />
        {character && <div className={`${styles.figure} ${styles[pose]}`} aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(character.sheet)})`, backgroundPosition: `${frame} 0` }} />}
        {character && <span className={styles.name}>{character.name}</span>}
        <span className={styles.word} role="status">{moment.outcome.toUpperCase()}</span>
        <div className={styles.track} aria-hidden="true"><div /></div>
      </div>
      <button type="button" className={styles.skip} onClick={() => { setFinished(true); onSkip(); }}>Skip effect</button>
    </div>
  );
}

export default CombatBanner;
