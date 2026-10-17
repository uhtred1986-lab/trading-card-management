"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { CombatMoment } from "@/lib/arena/immersion/types";
import styles from "./CombatBanner.module.css";

export interface CombatBannerProps {
  moment: CombatMoment | null;
  reducedMotion?: boolean;
  /** Presentation pace only; capped at 1100ms and never awaited by gameplay. */
  durationMs?: number;
  onSkip: () => void;
}

/** The same public presentation beat is used for Leader and Battle Card combat. */
export function CombatBanner({ moment, reducedMotion = false, durationMs, onSkip }: CombatBannerProps) {
  return moment ? <CombatBeat key={moment.key} moment={moment} reducedMotion={reducedMotion} durationMs={durationMs} onSkip={onSkip} /> : null;
}

/** Sheets already decoded in this tab: a banner whose hero is warm shows it on its first frame, not after a load. */
const warmSheets = new Set<string>();
export function warmSheet(url: string) {
  if (warmSheets.has(url) || typeof Image === "undefined") return;
  const image = new Image();
  image.onload = () => { if (image.naturalWidth === image.naturalHeight * 3) warmSheets.add(url); };
  image.src = url;
}

/** What the banner shouts when the beat carries no exact receipt of its own. */
const WORD: Record<CombatMoment["outcome"], string> = { attack: "ATTACK", block: "BLOCK", hit: "HIT!", repelled: "BLOCKED!", negated: "NEGATED" };

function CombatBeat({ moment, reducedMotion, durationMs, onSkip }: CombatBannerProps & { moment: CombatMoment; reducedMotion: boolean }) {
  const [finished, setFinished] = useState(false);
  const [loadedSheet, setLoadedSheet] = useState<string | null>(() => (moment.character?.sheet && warmSheets.has(moment.character.sheet) ? moment.character.sheet : null));
  const defaultDuration = moment.outcome === "attack" ? 460 : 1100;
  const duration = durationMs !== undefined && Number.isFinite(durationMs) ? Math.max(1, Math.min(1100, durationMs)) : defaultDuration;
  const sheet = moment.character?.sheet;

  useEffect(() => {
    const timer = window.setTimeout(() => setFinished(true), duration);
    return () => window.clearTimeout(timer);
  }, [duration]);

  useEffect(() => {
    if (!sheet) return;
    let active = true;
    const image = new Image();
    image.onload = () => { if (active && image.naturalWidth === image.naturalHeight * 3) { warmSheets.add(sheet); setLoadedSheet(sheet); } };
    image.src = sheet;
    return () => { active = false; image.onload = null; };
  }, [sheet]);

  if (finished) return null;
  // A repel/negate never borrows the damage pose, even if its caller supplies it.
  const character = loadedSheet === sheet && moment.outcome !== "repelled" && moment.outcome !== "negated" ? moment.character : null;
  const pose = moment.outcome === "attack" ? "attack" : moment.outcome === "hit" ? "hit" : "guard";
  // These silhouettes cross nominal thirds; use the reviewed prototype crops.
  const frame: CSSProperties = pose === "attack"
    ? { backgroundSize: "238.095% 100%", backgroundPosition: "0% 0%", clipPath: "polygon(0 0,100% 0,100% 64%,81% 64%,81% 100%,0 100%)" }
    : pose === "guard"
      ? { backgroundSize: "294.118% 100%", backgroundPosition: "54.545% 0%", clipPath: "polygon(18% 0,100% 0,100% 100%,0 100%,0 60%,18% 60%)" }
      : { backgroundSize: "322.581% 100%", backgroundPosition: "100% 0%", clipPath: "none" };
  const style = { "--beat-duration": `${duration}ms` } as CSSProperties;

  return (
    <div className={`${styles.overlay} ${moment.outcome === "hit" || moment.outcome === "repelled" || moment.outcome === "negated" ? styles.impact : ""} ${reducedMotion ? styles.reduced : ""}`} style={style} data-combat-banner={moment.outcome}>
      <div className={`${styles.banner} ${styles[moment.outcome]} ${!character ? styles.neutral : ""}`}>
        <div className={styles.speedfield} aria-hidden="true" />
        <div className={styles.farfield} aria-hidden="true" />
        <div className={styles.energy} aria-hidden="true" />
        {character && <div className={`${styles.figure} ${styles[pose]}`} aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(character.sheet)})`, ...frame }} />}
        {character && <span className={styles.name}>{character.name}</span>}
        <span className={styles.word} role="status">{moment.caption ?? WORD[moment.outcome]}</span>
        <div className={styles.track} aria-hidden="true"><div /></div>
      </div>
      <button type="button" className={styles.skip} onClick={() => { setFinished(true); onSkip(); }}>Skip</button>
    </div>
  );
}

export default CombatBanner;
