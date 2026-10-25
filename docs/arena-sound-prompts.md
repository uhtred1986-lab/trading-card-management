# Arena sound prompts (#1104)

The readable export of `src/lib/arena/immersion/sound-catalog.json`: every sound cue proposed for the
character-actions milestone (#1112), with a copyable, provider-neutral generation prompt. The JSON is
the source of truth; this page repeats each entry so it can be read and copied without tooling.
`npx tsx scripts/verify/arena-immersion.mts` fails when the two disagree (every cue id and its exact
prompt must appear here).

Nothing here generates audio. There are no API calls, at runtime or otherwise; no clip has been
auditioned and every entry is `missing` until #1107 imports a CC0 file or an owner-approved generation.
Paid generation happens only when the owner asks for it in the chat.

## How a cue reaches the speaker

1. The engine's public numbered beat is turned into one **character-action sequence** by
   `actionSequence()` in `src/lib/arena/immersion/events.ts` (#1103). The sequence lists contract cues
   (`ACTION_CUE_IDS` in `types.ts`) with start/stop markers measured from the start of the beat's
   presentation.
2. A catalog entry with `trigger: "supported"` names one of those contract cues in `contractCue`.
   Several entries may share one contract cue (for `attack.release`: `attack.melee`, `attack.ki`,
   `beam.release`, `beam.sustain`); which variant plays is a character/technique choice for #1109/#1110,
   never a guess from a card name.
3. Until a file is approved, the cue plays its `fallback`: `synth:<tone>` is today's synthesized tone in
   `audio.ts`, `silent` plays nothing.

### Timing

Contract windows (`CUE_WINDOW_MS`) at full length; a shorter beat compresses them proportionally and a
longer one never stretches them, so a clip can never extend a turn or make playback wait for media:

| Contract cue | Window | Contract cue | Window |
|---|---|---|---|
| `attack.buildup` | 0–300 ms | `card.draw` | 0–300 ms |
| `attack.release` | 300–900 ms | `card.play` | 0–400 ms |
| `reaction.block` | 0–400 ms | `skill.activate` | 0–500 ms |
| `impact.hit` | 0–700 ms | `skill.swap` | 0–700 ms |
| `reaction.negate` | 0–500 ms | `skill.union` / `skill.evolve` | 0–900 ms |
| `reaction.repel` | 0–500 ms | `skill.awaken` | 0–1000 ms |
| `damage` | 0–300 ms | `turn.yours` / `turn.opponent` | 0–500 / 0–400 ms |
| `ko` | 0–800 ms | `match.victory` / `defeat` / `draw` | 0–1600 / 0–1300 / 0–1100 ms |

A cue is silenced at its `stopMs`. A one-shot whose played length does not fit its window must set
`playback.stopAtMarker` (it is cut with a short fade); loops always do. Sound-off, Skip effect, tab
hiding and the end of the beat stop everything, as before.

### Distinct moments, never inferred

An attack declaration sounds only buildup and release. `impact.hit` needs a won clash, `repel` a lost
one, `damage` a damage beat and `ko` a KO beat: a hit never implies damage or a KO. `block` follows the
actual blocker (`by`), not the original target. `negate` names no character.

### Supported vs unsupported

Unsupported cues are catalogued with a reason and are **not wired** (owner default, 25 Oct 2026 on
#1112): `dodge` (no event), `zone.drop`/`zone.warp`/`zone.return` (move beats share KO, cost and discard
moves), `energy.charge`/`energy.pay` (no distinguishable public beat), `match.start` (no beat) and the
two local UI interactions `card.focus`/`action.unavailable`, which are not public beats. `skill.union`
is supported: the engine's skill tag already routes Union (`skills.ts`).

## Data contract

Each entry in `cues`:

| Field | Meaning |
|---|---|
| `cueId` | Stable id; never renamed once an asset exists. |
| `category`, `event` | Group, and the public beat that triggers it (or why none does). |
| `contractCue`, `trigger` | The #1103 cue it sounds (`supported`), or `null` (`unsupported`). |
| `unsupportedReason` | Why an unsupported cue is not wired; `null` when supported. |
| `visualMarker` | The contract marker and the visual moment it is synchronised with. |
| `purpose`, `priority` | What the player should understand; `core` (first wave) or `later`. |
| `recipe` | The short sound recipe the prompt expands. |
| `generatedDurationSec` | Length to ask a generator for. |
| `playback` | `durationSec` played, `loop`, and `stopAtMarker` (cut at the marker stop). |
| `variations` | 2–3 alternative descriptions to generate as takes. |
| `prompt`, `exclusions` | The copyable positive prompt, and what any take must not contain. |
| `parameters` | Optional `character`/`technique` slots and how to fill them. Empty for shared base sounds. |
| `filename` | Planned file under the asset folder #1107 defines. |
| `sourcePreference` | `cc0` (Kenney and similar, per-file check), `generate` (original AI texture) or `synth`. |
| `fallback` | `synth:<tone>` or `silent` while the file is missing. |
| `availability` | `missing` → `candidate` (imported, not auditioned) → `approved` (owner-auditioned). |
| `license` | `source`, `author`, `licence`, `url`, `retrievedAt`, `sha256`, `notes`; required before `approved`. |

Shared base sounds are reused across characters: a character or technique only fills a parameter of
the same entry; it does not get a near-identical file of its own.

## Prompt templates

Effect (every cue except match stingers):

```text
Isolated original anime-style game sound effect: {recipe}. {duration} seconds. Fast clean onset; {tail}. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

`{tail}` is `clean short tail` for a one-shot and `seamless loop with no audible start or end, no
click at the loop point` for a loop.

Match stinger (the one marked exception to "no music"):

```text
Original short game stinger for a fighting card game (music permitted for this cue only): {recipe}. {duration} seconds. Fast clean onset; resolved ending with a short natural tail. Clear on phone speakers, controlled bass, no clipping. Original composition only: no melody or motif from any existing show, film or game. No speech, no background ambience, no recognizable TV/show recording.
```

To generate a variation, replace `{recipe}` with the variation's description. Fill a `character` or
`technique` parameter only from a reviewed mapping (`characters.json`, an approved technique from
#856/#1110), and only for a visible face: a hidden card never selects a variant, a prompt or a file.

## Voice

Voice is a separate asset class, tracked by #856: the exact approved technique text, an original
licensed performer or voice, and a stated language. Never claim authentic anime-actor audio, never
substitute browser TTS, and never use copyrighted clips as generation references. v1 uses the generic
effects below.

## Cues

### `card.focus`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | Local: a hand card is touched/scrubbed (no beat) |
| Why unsupported | Local UI interaction, not a public numbered beat; outside the #1103 sequence contract. Owner default, 25 Oct 2026 (#1112): catalogued, not wired. |
| Purpose | Tactile feedback while browsing the hand; rate-limited during scrubbing. |
| Priority | later |
| Generate / play | 0.15 s generated; 0.15 s played |
| Source preference | cc0 |
| File | `sfx/card-focus.ogg` (missing) |
| Fallback | silent |
| Variations | drier, shorter click; slightly airier paper lift; muted felt-table tap |

```text
Isolated original anime-style game sound effect: very soft paper lift with a tiny click. 0.15 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `card.draw`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `card.draw` |
| Event | `draw` beat |
| Visual marker | card.draw (0–300 ms at full length): draw flight |
| Purpose | A card leaves the deck for a hand; never reveals which card. |
| Priority | core |
| Generate / play | 0.25 s generated; 0.25 s played |
| Source preference | cc0 |
| File | `sfx/card-draw.ogg` (missing) |
| Fallback | synth:draw |
| Variations | shorter flick; slightly softer slide with paper grain; brighter slide with a tiny snap at the end |

```text
Isolated original anime-style game sound effect: single dry card slide off a deck. 0.25 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `card.play`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `card.play` |
| Event | `move` beat into the Battle Area |
| Visual marker | card.play (0–400 ms at full length): card landing in the Battle Area |
| Purpose | A card lands in the Battle Area. |
| Priority | core |
| Generate / play | 0.35 s generated; 0.35 s played |
| Source preference | cc0 |
| File | `sfx/card-play.ogg` (missing) |
| Fallback | synth:play |
| Variations | heavier landing, less shimmer; lighter tap with a brighter accent; landing with a short rising sparkle |

```text
Isolated original anime-style game sound effect: crisp card landing on a table with a tiny energy accent. 0.35 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `energy.charge`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | None distinguishable (see reason) |
| Why unsupported | Move beats into the Energy Area exist, but a Charge Phase charge and a skill placing a card in Energy are not distinguished by the public beat. Owner default, 25 Oct 2026 (#1112): catalogued, not wired. |
| Purpose | A card charged as energy. |
| Priority | later |
| Generate / play | 0.45 s generated; 0.45 s played |
| Source preference | generate |
| File | `sfx/energy-charge.ogg` (missing) |
| Fallback | silent |
| Variations | two quick ascending ticks; single soft glassy rise; tick with a faint electric shimmer |

```text
Isolated original anime-style game sound effect: clean upward energy tick. 0.45 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `energy.pay`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | None (cost payment has no beat) |
| Why unsupported | Paying a cost is only a `mode` rest beat, indistinguishable from resting an attacker. No payment beat exists. |
| Purpose | Energy spent to pay a cost. |
| Priority | later |
| Generate / play | 0.25 s generated; 0.25 s played |
| Source preference | generate |
| File | `sfx/energy-pay.ogg` (missing) |
| Fallback | silent |
| Variations | softer, lower tick; two-step descending tick; muted glassy fall |

```text
Isolated original anime-style game sound effect: subdued descending energy tick. 0.25 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `action.unavailable`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | Local: an unavailable action is tapped (no beat) |
| Why unsupported | Local UI interaction, not a public numbered beat; outside the #1103 sequence contract. Owner default, 25 Oct 2026 (#1112): catalogued, not wired. |
| Purpose | Gentle refusal feedback; never an alarm. |
| Priority | later |
| Generate / play | 0.25 s generated; 0.25 s played |
| Source preference | synth |
| File | `sfx/action-unavailable.ogg` (missing) |
| Fallback | silent |
| Variations | single soft thud; two muted wooden taps; low rounded double pulse |

```text
Isolated original anime-style game sound effect: soft low double tap, no alarm character. 0.25 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `attack.windup`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `attack.buildup` |
| Event | `attack` beat, attacker buildup |
| Visual marker | attack.buildup (0–300 ms at full length): attacker buildup pose |
| Purpose | The attacker gathers for a physical strike. |
| Priority | core |
| Generate / play | 0.3 s generated; 0.3 s played, cut/faded at the marker stop |
| Source preference | generate |
| File | `sfx/attack-windup.ogg` (missing) |
| Fallback | synth:attack |
| Variations | sharper cloth snap; longer inhale-like air pull without voice; lighter flick of movement |
| Parameters | `character`: Optional: physical build of the reviewed character (light/fast or heavy/powerful). Never a name or voice. |

```text
Isolated original anime-style game sound effect: fast air pull and cloth snap. 0.3 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `attack.melee`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `attack.release` |
| Event | `attack` beat, attacker release |
| Visual marker | attack.release (300–900 ms at full length): attacker release |
| Purpose | Release of a physical strike; does not imply a hit. |
| Priority | core |
| Generate / play | 0.25 s generated; 0.25 s played, cut/faded at the marker stop |
| Source preference | generate |
| File | `sfx/attack-melee.ogg` (missing) |
| Fallback | silent |
| Variations | kick swoosh, wider; fast punch whip, tighter; double air cut |
| Parameters | `character`: Optional: physical build of the reviewed character. Never a name or voice. |

```text
Isolated original anime-style game sound effect: sharp punch or kick cutting the air, no body impact. 0.25 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `attack.ki`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `attack.release` |
| Event | `attack` beat, attacker release |
| Visual marker | attack.release (300–900 ms at full length): attacker release |
| Purpose | Release of a compact energy projectile; does not imply a hit. |
| Priority | core |
| Generate / play | 0.4 s generated; 0.4 s played, cut/faded at the marker stop |
| Source preference | generate |
| File | `sfx/attack-ki.ogg` (missing) |
| Fallback | silent |
| Variations | bright, thin blast; denser, rounder blast; rapid double shot |
| Parameters | `character`: Optional: energy colour/temperament of the reviewed character (calm blue, hot gold). |

```text
Isolated original anime-style game sound effect: compact electric projectile release. 0.4 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `power.buildup`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `attack.buildup` |
| Event | `attack` beat, attacker buildup |
| Visual marker | attack.buildup (0–300 ms at full length): attacker buildup pose |
| Purpose | Charging up before an energy attack; trimmed or looped to the buildup marker. |
| Priority | core |
| Generate / play | 1.5 s generated; 1.5 s played, cut/faded at the marker stop |
| Source preference | generate |
| File | `sfx/power-buildup.ogg` (missing) |
| Fallback | synth:attack |
| Variations | faster rise, more crackle; slower, deeper rumble; brighter rise with shimmering air |
| Parameters | `character`: Optional: energy colour/temperament of the reviewed character. `technique`: Optional: approved technique name (#856/#1110) to shape the charge; generic when absent. |

```text
Isolated original anime-style game sound effect: rising charged air with crackle and a controlled low rumble. 1.5 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `power.loop`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `attack.buildup` |
| Event | `attack` beat, held buildup |
| Visual marker | attack.buildup (0–300 ms at full length): attacker buildup pose |
| Purpose | Seamless aura hum held until the buildup marker stops it. |
| Priority | later |
| Generate / play | 2 s generated; loop of 2 s played, cut/faded at the marker stop |
| Source preference | generate |
| File | `sfx/power-loop.ogg` (missing) |
| Fallback | synth:attack |
| Variations | warmer, lower hum; airier hum with faint crackle; pulsing hum |
| Parameters | `character`: Optional: energy colour/temperament of the reviewed character. |

```text
Isolated original anime-style game sound effect: seamless restrained aura hum. 2 seconds. Fast clean onset; seamless loop with no audible start or end, no click at the loop point. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `beam.release`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `attack.release` |
| Event | `attack` beat, attacker release |
| Visual marker | attack.release (300–900 ms at full length): attacker release |
| Purpose | Release of a focused energy beam; does not imply a hit. |
| Priority | core |
| Generate / play | 0.6 s generated; 0.6 s played, cut/faded at the marker stop |
| Source preference | generate |
| File | `sfx/beam-release.ogg` (missing) |
| Fallback | silent |
| Variations | narrower, higher beam; wider beam with more low end; beam with a sharper electrical snap |
| Parameters | `technique`: Optional: approved technique name (#856/#1110). Generic beam when absent; never an authentic show recording. |

```text
Original stylized energy-beam release for a fighting card game. Compressed air snaps into a brilliant electrical rush with a brief low impact. 0.6 seconds, immediate onset, clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No voice, no music, no ambience, no recognizable TV/show recording.
```

### `beam.sustain`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `attack.release` |
| Event | `attack` beat, held release |
| Visual marker | attack.release (300–900 ms at full length): attacker release |
| Purpose | Seamless beam rush held until the release marker stops it. |
| Priority | later |
| Generate / play | 2 s generated; loop of 2 s played, cut/faded at the marker stop |
| Source preference | generate |
| File | `sfx/beam-sustain.ogg` (missing) |
| Fallback | silent |
| Variations | brighter, thinner rush; deeper, wider rush; rush with slow pulsing |
| Parameters | `technique`: Optional: approved technique name (#856/#1110). |

```text
Isolated original anime-style game sound effect: seamless contained beam rush. 2 seconds. Fast clean onset; seamless loop with no audible start or end, no click at the loop point. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `impact.light`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `impact.hit` |
| Event | `clash` beat with `hit: true` |
| Visual marker | impact.hit (0–700 ms at full length): guard's hit pose (resolved clash) |
| Purpose | A resolved hit on the guard; light variant. |
| Priority | core |
| Generate / play | 0.25 s generated; 0.25 s played |
| Source preference | cc0 |
| File | `sfx/impact-light.ogg` (missing) |
| Fallback | synth:hit |
| Variations | tighter, drier thump; slightly brighter slap; thump with a tiny cloth rustle |

```text
Isolated original anime-style game sound effect: short clean body-impact thump. 0.25 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `impact.heavy`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `impact.hit` |
| Event | `clash` beat with `hit: true` |
| Visual marker | impact.hit (0–700 ms at full length): guard's hit pose (resolved clash) |
| Purpose | A resolved hit on the guard; heavy variant. |
| Priority | core |
| Generate / play | 0.55 s generated; 0.55 s played |
| Source preference | generate |
| File | `sfx/impact-heavy.ogg` (missing) |
| Fallback | synth:hit |
| Variations | less debris, more weight; rockier debris tail; deep thud with a short air burst |

```text
Isolated original anime-style game sound effect: deeper impact with a brief debris tail. 0.55 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `impact.energy`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `impact.hit` |
| Event | `clash` beat with `hit: true` |
| Visual marker | impact.hit (0–700 ms at full length): guard's hit pose (resolved clash) |
| Purpose | A resolved hit by an energy attack. |
| Priority | later |
| Generate / play | 0.6 s generated; 0.6 s played |
| Source preference | generate |
| File | `sfx/impact-energy.ogg` (missing) |
| Fallback | synth:hit |
| Variations | more crackle, less bass; rounder, warmer burst; sharp zap into a soft boom |

```text
Isolated original anime-style game sound effect: bright electric impact and a short bass hit. 0.6 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `block`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `reaction.block` |
| Event | `block` beat (actual blocker `by`) |
| Visual marker | reaction.block (0–400 ms at full length): actual blocker's guard pose |
| Purpose | The actual blocker steps in; never the original target. |
| Priority | core |
| Generate / play | 0.35 s generated; 0.35 s played |
| Source preference | generate |
| File | `sfx/block.ogg` (missing) |
| Fallback | synth:block |
| Variations | shorter ring; lower, heavier brace; brighter shield-like ring |

```text
Isolated original anime-style game sound effect: hard braced impact with a metallic-energy ring. 0.35 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `negate`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `reaction.negate` |
| Event | `negated` beat |
| Visual marker | reaction.negate (0–500 ms at full length): neutral NEGATED banner |
| Purpose | An attack is negated; no character is inferred. |
| Priority | core |
| Generate / play | 0.45 s generated; 0.45 s played |
| Source preference | generate |
| File | `sfx/negate.ogg` (missing) |
| Fallback | synth:negated |
| Variations | faster suction; softer, airier snap; deeper suction with a hollow end |

```text
Isolated original anime-style game sound effect: reversed energy suction ending in a dry snap. 0.45 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `repel`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `reaction.repel` |
| Event | `clash` beat with `hit: false` |
| Visual marker | reaction.repel (0–500 ms at full length): guard's REPELLED banner |
| Purpose | A failed clash: the attack is repelled, never a hit. |
| Priority | core |
| Generate / play | 0.4 s generated; 0.4 s played |
| Source preference | generate |
| File | `sfx/repel.ogg` (missing) |
| Fallback | synth:repelled |
| Variations | tighter bounce; wider wobble; rebound with a brighter ping |

```text
Isolated original anime-style game sound effect: elastic energy rebound with a descending tail. 0.4 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `damage`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `damage` |
| Event | `damage` beat |
| Visual marker | damage (0–300 ms at full length): life damage receipt |
| Purpose | Life damage is confirmed; separate from the hit. |
| Priority | core |
| Generate / play | 0.25 s generated; 0.25 s played |
| Source preference | synth |
| File | `sfx/damage.ogg` (missing) |
| Fallback | silent |
| Variations | single soft pulse; two quick pulses for critical damage; slightly brighter pulse |

```text
Isolated original anime-style game sound effect: restrained low confirmation pulse. 0.25 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `ko`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `ko` |
| Event | `ko` beat |
| Visual marker | ko (0–800 ms at full length): KO receipt |
| Purpose | A card is KO'd; separate from the hit and never inferred from it. |
| Priority | core |
| Generate / play | 0.7 s generated; 0.7 s played |
| Source preference | generate |
| File | `sfx/ko.ogg` (missing) |
| Fallback | silent |
| Variations | more shatter, less body; deeper collapse, softer shatter; shatter that fades into a low hum |

```text
Isolated original anime-style game sound effect: heavier collapse with an energy shatter, clearly separate from a hit. 0.7 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `dodge`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | None |
| Why unsupported | No dodge/evade event exists in the engine or the public beats; never inferred from a missed attack. |
| Purpose | A dodge, only if the engine ever reports one. |
| Priority | later |
| Generate / play | 0.3 s generated; 0.3 s played |
| Source preference | cc0 |
| File | `sfx/dodge.ogg` (missing) |
| Fallback | silent |
| Variations | shorter whip; wider pass-by; double quick pass |

```text
Isolated original anime-style game sound effect: rapid side-passing air cut. 0.3 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `skill.activate`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `skill.activate` |
| Event | `skill` beat (any other label) |
| Visual marker | skill.activate (0–500 ms at full length): skill receipt |
| Purpose | A card's skill resolves. |
| Priority | core |
| Generate / play | 0.4 s generated; 0.4 s played |
| Source preference | generate |
| File | `sfx/skill-activate.ogg` (missing) |
| Fallback | silent |
| Variations | softer bell-like pulse; brighter shimmer; short rising pulse |

```text
Isolated original anime-style game sound effect: clean bright activation pulse. 0.4 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `skill.swap`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `skill.swap` |
| Event | `skill` beat labelled Swap |
| Visual marker | skill.swap (0–700 ms at full length): Swap motif |
| Purpose | Swap: one card goes out while another comes in. |
| Priority | later |
| Generate / play | 0.6 s generated; 0.6 s played |
| Source preference | generate |
| File | `sfx/skill-swap.ogg` (missing) |
| Fallback | silent |
| Variations | faster pair; wider stereo pair; pair with a small click between |

```text
Isolated original anime-style game sound effect: paired outgoing and incoming whooshes. 0.6 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `skill.union`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `skill.union` |
| Event | `skill` beat labelled Union |
| Visual marker | skill.union (0–900 ms at full length): Union motif |
| Purpose | Union: cards combine into one. |
| Priority | later |
| Generate / play | 0.8 s generated; 0.8 s played |
| Source preference | generate |
| File | `sfx/skill-union.ogg` (missing) |
| Fallback | silent |
| Variations | tighter convergence; warmer, rounder accent; brighter accent with sparkle |

```text
Isolated original anime-style game sound effect: two converging tones with one fusion accent. 0.8 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `skill.evolve`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `skill.evolve` |
| Event | `skill` beat labelled Evolve / EX-Evolve / Xeno-Evolve |
| Visual marker | skill.evolve (0–900 ms at full length): Evolve motif |
| Purpose | Evolve: a card transforms. |
| Priority | later |
| Generate / play | 0.8 s generated; 0.8 s played |
| Source preference | generate |
| File | `sfx/skill-evolve.ogg` (missing) |
| Fallback | silent |
| Variations | faster swell; deeper, heavier swell; swell with crackling energy |

```text
Isolated original anime-style game sound effect: rising transformation swell with a short resolve. 0.8 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `leader.awaken`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `skill.awaken` |
| Event | `flip` beat or `skill` beat labelled Awaken/Wish |
| Visual marker | skill.awaken (0–1000 ms at full length): awaken/flip motif |
| Purpose | A leader awakens (card flip); leader and Battle Cards share the route. |
| Priority | later |
| Generate / play | 0.9 s generated; 0.9 s played |
| Source preference | generate |
| File | `sfx/leader-awaken.ogg` (missing) |
| Fallback | silent |
| Variations | shorter bloom; deeper, wider bloom; bloom with a bright crackling crest |
| Parameters | `character`: Optional: energy colour/temperament of the reviewed awakened face. |

```text
Isolated original anime-style game sound effect: forceful aura bloom with a clean resolve. 0.9 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `zone.drop`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | None wired (see reason) |
| Why unsupported | Move beats to/from Drop and Warp are shown as motion receipts, but KO, cost and discard moves share them; zone sounds would double the KO and payment cues. Owner default, 25 Oct 2026 (#1112): catalogued, not wired. |
| Purpose | A card falls into the Drop Area. |
| Priority | later |
| Generate / play | 0.3 s generated; 0.3 s played |
| Source preference | cc0 |
| File | `sfx/zone-drop.ogg` (missing) |
| Fallback | silent |
| Variations | softer fall; quicker flick down; fall with a tiny landing tap |

```text
Isolated original anime-style game sound effect: short downward paper and air fall. 0.3 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `zone.warp`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | None wired (see reason) |
| Why unsupported | Move beats to/from Drop and Warp are shown as motion receipts, but KO, cost and discard moves share them; zone sounds would double the KO and payment cues. Owner default, 25 Oct 2026 (#1112): catalogued, not wired. |
| Purpose | A card is sent to the Warp. |
| Priority | later |
| Generate / play | 0.55 s generated; 0.55 s played |
| Source preference | generate |
| File | `sfx/zone-warp.ogg` (missing) |
| Fallback | silent |
| Variations | shorter suction; deeper hollow release; suction with a faint shimmer |

```text
Isolated original anime-style game sound effect: compact spatial suction and hollow release. 0.55 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `zone.return`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | None wired (see reason) |
| Why unsupported | Move beats to/from Drop and Warp are shown as motion receipts, but KO, cost and discard moves share them; zone sounds would double the KO and payment cues. Owner default, 25 Oct 2026 (#1112): catalogued, not wired. |
| Purpose | A card returns to hand or deck. |
| Priority | later |
| Generate / play | 0.35 s generated; 0.35 s played |
| Source preference | cc0 |
| File | `sfx/zone-return.ogg` (missing) |
| Fallback | silent |
| Variations | softer whoosh; quicker rise; whoosh with a small paper flutter |

```text
Isolated original anime-style game sound effect: light ascending return whoosh. 0.35 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `turn.yours`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `turn.yours` |
| Event | `phase` beat `charge` for the viewer |
| Visual marker | turn.yours (0–500 ms at full length): turn chip |
| Purpose | The viewer's turn begins. |
| Priority | core |
| Generate / play | 0.4 s generated; 0.4 s played |
| Source preference | cc0 |
| File | `sfx/turn-yours.ogg` (missing) |
| Fallback | synth:turn |
| Variations | softer two-tone; brighter two-tone; three quick rising notes |

```text
Isolated original anime-style game sound effect: gentle rising two-tone cue. 0.4 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `turn.opponent`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `turn.opponent` |
| Event | `phase` beat `charge` for the opponent |
| Visual marker | turn.opponent (0–400 ms at full length): turn chip |
| Purpose | The opponent's turn begins; quieter than the viewer's. |
| Priority | core |
| Generate / play | 0.35 s generated; 0.35 s played |
| Source preference | cc0 |
| File | `sfx/turn-opponent.ogg` (missing) |
| Fallback | synth:turn |
| Variations | softer, lower; single descending tone; muted two-tone |

```text
Isolated original anime-style game sound effect: quieter descending two-tone cue. 0.35 seconds. Fast clean onset; clean short tail. Clear on phone speakers, controlled bass, no clipping. One effect only. No speech, no music, no background ambience, no recognizable TV/show recording.
```

### `match.start`

| Field | Value |
|---|---|
| Trigger | **unsupported**, not wired |
| Event | None |
| Why unsupported | `gameStart` has no public beat (vm/beats.ts drops it). |
| Purpose | The match begins. |
| Priority | later |
| Generate / play | 1 s generated; 1 s played |
| Source preference | generate |
| File | `sfx/match-start.ogg` (missing) |
| Fallback | silent |
| Variations | drum-like hit with a riser; brighter swell; punchier, shorter hit |

```text
Original short game stinger for a fighting card game (music permitted for this cue only): short energetic non-melodic stinger. 1 seconds. Fast clean onset; resolved ending with a short natural tail. Clear on phone speakers, controlled bass, no clipping. Original composition only: no melody or motif from any existing show, film or game. No speech, no background ambience, no recognizable TV/show recording.
```

### `match.victory`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `match.victory` |
| Event | `over` beat won by the viewer |
| Visual marker | match.victory (0–1600 ms at full length): result screen |
| Purpose | The viewer wins. |
| Priority | core |
| Generate / play | 1.5 s generated; 1.5 s played |
| Source preference | generate |
| File | `sfx/match-victory.ogg` (missing) |
| Fallback | synth:victory |
| Variations | brass-like and brighter; warmer, slower resolve; shorter fanfare-like hit |

```text
Original short game stinger for a fighting card game (music permitted for this cue only): warm triumphant original stinger. 1.5 seconds. Fast clean onset; resolved ending with a short natural tail. Clear on phone speakers, controlled bass, no clipping. Original composition only: no melody or motif from any existing show, film or game. No speech, no background ambience, no recognizable TV/show recording.
```

### `match.defeat`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `match.defeat` |
| Event | `over` beat won by the opponent |
| Visual marker | match.defeat (0–1300 ms at full length): result screen |
| Purpose | The viewer loses. |
| Priority | core |
| Generate / play | 1.2 s generated; 1.2 s played |
| Source preference | generate |
| File | `sfx/match-defeat.ogg` (missing) |
| Fallback | synth:defeat |
| Variations | softer and slower; lower, darker; short sigh-like descending figure, no voice |

```text
Original short game stinger for a fighting card game (music permitted for this cue only): subdued original descending stinger. 1.2 seconds. Fast clean onset; resolved ending with a short natural tail. Clear on phone speakers, controlled bass, no clipping. Original composition only: no melody or motif from any existing show, film or game. No speech, no background ambience, no recognizable TV/show recording.
```

### `match.draw`

| Field | Value |
|---|---|
| Trigger | supported → contract cue `match.draw` |
| Event | `over` beat with no winner, kind/reason draw |
| Visual marker | match.draw (0–1100 ms at full length): result screen |
| Purpose | The match ends in a draw. |
| Priority | later |
| Generate / play | 1 s generated; 1 s played |
| Source preference | generate |
| File | `sfx/match-draw.ogg` (missing) |
| Fallback | silent |
| Variations | calmer resolve; suspended chord that resolves; short neutral cadence |

```text
Original short game stinger for a fighting card game (music permitted for this cue only): neutral resolving original stinger. 1 seconds. Fast clean onset; resolved ending with a short natural tail. Clear on phone speakers, controlled bass, no clipping. Original composition only: no melody or motif from any existing show, film or game. No speech, no background ambience, no recognizable TV/show recording.
```
