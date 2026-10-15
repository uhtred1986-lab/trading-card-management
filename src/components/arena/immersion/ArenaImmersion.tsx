"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { NumberedBeat, BeatArt } from "@/lib/arena/beats";
import type { CardView } from "@/lib/arena/view";
import type { PlayerId } from "@/lib/arena/types";
import { combatMoment, soundCue } from "@/lib/arena/immersion/events";
import { arenaAudio } from "@/lib/arena/immersion/audio";
import { useImmersionPreferences, setImmersionPreferences } from "@/lib/arena/immersion/preferences";
import { CombatBanner } from "./CombatBanner";
import { SoundControls } from "./SoundControls";

function watchVisibility(notify: () => void) { document.addEventListener("visibilitychange", notify); return () => document.removeEventListener("visibilitychange", notify); }
export function ImmersionSettings() {
  const prefs = useImmersionPreferences();
  return <div className="space-y-3"><button type="button" className="tap min-h-11 text-sm" aria-pressed={prefs.banners} onClick={() => setImmersionPreferences({ banners: !prefs.banners })}>Combat banners: {prefs.banners ? "on" : "off"}</button><SoundControls enabled={prefs.sound} volume={prefs.volume} onEnabled={sound => setImmersionPreferences({ sound })} onVolume={volume => setImmersionPreferences({ volume })} /></div>;
}
export function ArenaImmersion({ gameId, beat, cardOf, art, viewer, reducedMotion, durationMs, suppressed, onSkip }: {
  gameId: number; beat: NumberedBeat | null; cardOf: (id: string) => CardView | null; art: Record<string, BeatArt>; viewer: PlayerId; reducedMotion: boolean; durationMs: number; suppressed: boolean; onSkip: () => void;
}) {
  const prefs = useImmersionPreferences();
  const visible = useSyncExternalStore(watchVisibility, () => !document.hidden, () => true);
  const seen = useRef("");
  const key = beat ? `${gameId}:${beat.n}` : "";
  const cue = soundCue(beat, viewer);
  useEffect(() => {
    // Mark even muted/suppressed events as consumed: enabling sound never replays history.
    if (!key || key === seen.current) return;
    seen.current = key;
    if (prefs.sound && visible && !suppressed && cue) arenaAudio.play(cue);
  }, [key, cue, prefs.sound, visible, suppressed]);
  useEffect(() => { arenaAudio.setVolume(prefs.volume); }, [prefs.volume]);
  useEffect(() => { if (!prefs.sound || !visible || suppressed || !beat) arenaAudio.stop(); }, [prefs.sound, visible, suppressed, beat]);
  useEffect(() => {
    // Persisted opt-in still needs a gesture after a reload; never autoplay an AudioContext.
    if (!prefs.sound) return;
    const unlock = () => { void arenaAudio.unlock(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [prefs.sound]);
  useEffect(() => () => arenaAudio.stop(), [gameId]);
  const moment = combatMoment(gameId, beat, cardOf, art);
  // Keep the keyed beat mounted while obscured, so restoring visibility cannot replay it.
  return <div style={{ display: prefs.banners && visible && !suppressed ? "contents" : "none" }}><CombatBanner moment={moment} durationMs={durationMs} reducedMotion={reducedMotion} onSkip={() => { arenaAudio.stop(); onSkip(); }} /></div>;
}
