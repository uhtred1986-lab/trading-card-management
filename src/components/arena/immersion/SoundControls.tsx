"use client";

import { arenaAudio } from "@/lib/arena/immersion/audio";

interface SoundControlsProps {
  enabled: boolean;
  volume: number;
  onEnabled: (enabled: boolean) => void;
  onVolume: (volume: number) => void;
}

export function SoundControls({ enabled, volume, onEnabled, onVolume }: SoundControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-space-600">
      <button
        type="button"
        aria-pressed={enabled}
        title="Optional synthesized arena sound effects"
        className="tap whitespace-nowrap uppercase tracking-widest hover:text-ki-400"
        onClick={() => {
          if (!enabled) {
            arenaAudio.setVolume(volume);
            void arenaAudio.unlock();
          } else {
            arenaAudio.stop();
          }
          onEnabled(!enabled);
        }}
      >
        Sound: {enabled ? "on" : "off"}
      </button>
      {enabled && (
        <label className="flex items-center gap-2">
          <span>Volume</span>
          <input
            aria-label="Arena sound volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            className="w-20 accent-ki-400"
            onChange={(event) => {
              const next = Number(event.target.value);
              arenaAudio.setVolume(next);
              onVolume(next);
            }}
          />
        </label>
      )}
    </div>
  );
}
