"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { NumberedBeat, BeatArt, Beats } from "@/lib/arena/beats";
import type { CardView } from "@/lib/arena/view";
import type { PlayerId } from "@/lib/arena/types";
import { combatMoment, soundCue } from "@/lib/arena/immersion/events";
import { arenaAudio } from "@/lib/arena/immersion/audio";
import { useImmersionPreferences, setImmersionPreferences } from "@/lib/arena/immersion/preferences";
import { CombatBanner, warmSheet } from "./CombatBanner";
import { resolveCharacter } from "@/lib/arena/immersion/characters";
import { bannerOwnsMoment, skillMoment } from "@/lib/arena/immersion/skills";
import { SkillBanner } from "./SkillBanner";
import { SoundControls } from "./SoundControls";

function watchVisibility(notify: () => void) { document.addEventListener("visibilitychange", notify); return () => document.removeEventListener("visibilitychange", notify); }
export function ImmersionSettings() {
  const prefs = useImmersionPreferences();
  return <div className="space-y-3"><button type="button" className="tap min-h-11 text-sm" aria-pressed={prefs.banners} onClick={() => setImmersionPreferences({ banners: !prefs.banners })}>Combat banners: {prefs.banners ? "on" : "off"}</button><SoundControls enabled={prefs.sound} volume={prefs.volume} onEnabled={sound => setImmersionPreferences({ sound })} onVolume={volume => setImmersionPreferences({ volume })} /></div>;
}
export function ArenaImmersion({ gameId, beat, events, cardOf, art, viewer, reducedMotion, durationMs, suppressed, onSkip, board = [] }: {
  /** The cards in play: their hero sheets are fetched ahead, so the first attack already shows its hero. */
  board?: (CardView | null | undefined)[];
  gameId: number; beat: NumberedBeat | null; events?: Beats | null; cardOf: (id: string) => CardView | null; art: Record<string, BeatArt>; viewer: PlayerId; reducedMotion: boolean; durationMs: number; suppressed: boolean; onSkip: () => void;
}) {
  const prefs = useImmersionPreferences();
  const warmKey = board.map((c) => (c && !c.hidden ? `${c.cardId}:${c.flipped}` : "")).join("|");
  useEffect(() => {
    if (!prefs.banners) return;
    for (const c of board) {
      const hero = c && !c.hidden ? resolveCharacter(c.cardId, c.name, c.flipped) : null;
      if (hero) warmSheet(hero.sheet);
    }
    // The key stands for the board's cards; the array itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmKey, prefs.banners]);
  const visible = useSyncExternalStore(watchVisibility, () => !document.hidden, () => true);
  const seen = useRef("");
  const observed = useRef({ gameId, seq: events?.seq ?? 0, initialized: !!events });
  useEffect(() => {
    const previous = observed.current;
    const sameGame = previous.gameId === gameId;
    observed.current = { gameId, seq: events?.seq ?? (sameGame ? previous.seq : 0), initialized: !!events || (sameGame && previous.initialized) };
    if (!reducedMotion || !events || !sameGame || !previous.initialized || events.seq <= previous.seq) return;
    // Motion-free playback queues no visual beats. Consume only newly arriving audio,
    // coalescing catch-up to one cue rather than replaying an entire reconnect history.
    const cue = events.list.filter(event => event.n > previous.seq).map(event => soundCue(event, viewer)).filter(cue => cue !== null).at(-1);
    if (cue && prefs.sound && visible && !suppressed) arenaAudio.play(cue);
  }, [events, gameId, reducedMotion, viewer, prefs.sound, visible, suppressed]);
  const key = beat ? `${gameId}:${beat.n}` : "";
  const cue = soundCue(beat, viewer);
  useEffect(() => {
    // Mark even muted/suppressed events as consumed: enabling sound never replays history.
    if (!key || key === seen.current) return;
    seen.current = key;
    if (prefs.sound && visible && !suppressed && cue) arenaAudio.play(cue);
  }, [key, cue, prefs.sound, visible, suppressed]);
  useEffect(() => { arenaAudio.setVolume(prefs.volume); }, [prefs.volume]);
  useEffect(() => { if (!prefs.sound || !visible || suppressed || (!beat && !reducedMotion)) arenaAudio.stop(); }, [prefs.sound, visible, suppressed, beat, reducedMotion]);
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
  const rawSkill = skillMoment(gameId, beat, { cardOf, art, viewer });
  const skill = bannerOwnsMoment(rawSkill, beat) ? rawSkill : null;
  // Keep the keyed beat mounted while obscured, so restoring visibility cannot replay it.
  return <div style={{ display: prefs.banners && visible && !suppressed ? "contents" : "none" }}><CombatBanner moment={moment} durationMs={durationMs} reducedMotion={reducedMotion} onSkip={() => { arenaAudio.stop(); onSkip(); }} /><SkillBanner moment={skill} durationMs={durationMs} reducedMotion={reducedMotion} onSkip={() => { arenaAudio.stop(); onSkip(); }} /></div>;
}
