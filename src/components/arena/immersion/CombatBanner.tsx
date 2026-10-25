"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { BannerPlan } from "@/lib/arena/immersion/banner";
import type { CombatPose } from "@/lib/arena/immersion/types";
import styles from "./CombatBanner.module.css";

export interface CombatBannerProps {
  plan: BannerPlan | null;
  reducedMotion?: boolean;
  onSkip: () => void;
}

/**
 * The one character-action banner (#1105): leader and Battle Cards, phone, tablet and desktop. The
 * plan comes from the contract sequence; this only stages it and never holds playback.
 */
export function CombatBanner({ plan, reducedMotion = false, onSkip }: CombatBannerProps) {
  return plan ? <CombatBeat key={plan.key} plan={plan} reducedMotion={reducedMotion} onSkip={onSkip} /> : null;
}

/** Sheets already decoded in this tab: a banner whose hero is warm shows it on its first frame, not after a load. */
const warmSheets = new Set<string>();
export function warmSheet(url: string) {
  if (warmSheets.has(url) || typeof Image === "undefined") return;
  const image = new Image();
  image.onload = () => { if (image.naturalWidth === image.naturalHeight * 3) warmSheets.add(url); };
  image.src = url;
}

/** The reviewed prototype crops per pose (the silhouettes cross nominal thirds). Frames themselves come from the manifest. */
const FRAME: Record<CombatPose, CSSProperties> = {
  attack: { backgroundSize: "238.095% 100%", backgroundPosition: "0% 0%", clipPath: "polygon(0 0,100% 0,100% 64%,81% 64%,81% 100%,0 100%)" },
  guard: { backgroundSize: "294.118% 100%", backgroundPosition: "54.545% 0%", clipPath: "polygon(18% 0,100% 0,100% 100%,0 100%,0 60%,18% 60%)" },
  hit: { backgroundSize: "322.581% 100%", backgroundPosition: "100% 0%", clipPath: "none" },
};

function CombatBeat({ plan, reducedMotion, onSkip }: { plan: BannerPlan; reducedMotion: boolean; onSkip: () => void }) {
  const [finished, setFinished] = useState(false);
  // Reduced motion shows the static result at once: no buildup, no timed phase change.
  const [released, setReleased] = useState(reducedMotion || plan.contactMs <= 0);
  const [loadedSheet, setLoadedSheet] = useState<string | null>(() => (plan.character?.sheet && warmSheets.has(plan.character.sheet) ? plan.character.sheet : null));
  const sheet = plan.character?.sheet;

  useEffect(() => {
    // Both timers belong to this beat's key: a new beat, skip or unmount clears them.
    const done = window.setTimeout(() => setFinished(true), plan.durationMs);
    const contact = released ? 0 : window.setTimeout(() => setReleased(true), plan.contactMs);
    return () => { window.clearTimeout(done); if (contact) window.clearTimeout(contact); };
    // `released` only seeds the contact timer once per beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.durationMs, plan.contactMs]);

  useEffect(() => {
    if (!sheet) return;
    let active = true;
    const image = new Image();
    image.onload = () => { if (active && image.naturalWidth === image.naturalHeight * 3) { warmSheets.add(sheet); setLoadedSheet(sheet); } };
    image.src = sheet;
    return () => { active = false; image.onload = null; };
  }, [sheet]);

  if (finished) return null;
  // A cold, slow or failed sheet stays neutral until it has loaded; it never delays the beat.
  const character = loadedSheet === sheet ? plan.character : null;
  const pose = character ? plan.pose : null;
  const impact = plan.kind !== "attack";
  const style = {
    "--beat-duration": `${plan.durationMs}ms`,
    "--windup": `${Math.max(1, plan.windupMs)}ms`,
    "--contact": `${plan.contactMs}ms`,
    "--after-contact": `${Math.max(1, plan.durationMs - plan.contactMs)}ms`,
  } as CSSProperties;

  return (
    <div
      className={`${styles.overlay} ${impact ? styles.impact : ""} ${reducedMotion ? styles.reduced : ""}`}
      style={style}
      data-combat-banner={plan.kind}
      data-role={plan.role ?? "none"}
      data-phase={released ? "release" : "windup"}
      data-neutral={character ? undefined : plan.neutral ?? "asset-pending"}
    >
      <div className={`${styles.banner} ${styles[plan.kind]} ${!character ? styles.neutral : ""}`} data-phase={released ? "release" : "windup"}>
        <div className={styles.speedfield} aria-hidden="true" />
        <div className={styles.farfield} aria-hidden="true" />
        <div className={styles.energy} aria-hidden="true" />
        {character && pose ? (
          <div className={`${styles.figure} ${styles[pose]}`} data-pose={pose} aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(character.sheet)})`, ...FRAME[pose] }} />
        ) : (
          <div className={styles.emblem} aria-hidden="true"><span /></div>
        )}
        {released && <div className={`${styles.contact} ${styles[`contact-${plan.kind}`]}`} data-contact={plan.kind} aria-hidden="true" />}
        {character && <span className={styles.name}>{character.name}</span>}
        <span className={styles.word} role="status">{plan.label}</span>
        <div className={styles.track} aria-hidden="true"><div /></div>
      </div>
      <button type="button" className={styles.skip} onClick={() => { setFinished(true); onSkip(); }}>Skip</button>
    </div>
  );
}

export default CombatBanner;
