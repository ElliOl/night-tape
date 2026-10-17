# Night Tape

An endless procedural lo-fi / ambient generator that runs in the browser. It plays a never-ending "tape" of songs, each
with its own title, key, tempo, jazz chord progression and arrangement. Everything is composed live from a seed and
synthesized with Tone.js; nothing is sampled.

Sister project of [Ghost Frequency](../ghost-frequency) (same engine architecture). The look and the vinyl / wow / crush
ideas come from [LO-BOX mk1](../lofi-box).

## Run

```bash
npm install
npm run dev        # http://localhost:5174 - press play
npm test           # theory, engine and persistence tests
npm run build      # static build in dist/ (relative paths, host anywhere)
```

Keys: `Space` play / pause, `N` new tape (new random seed).

## What you can control

| Panel    | Controls |
|----------|----------|
| Station  | Late Night Study (boom-bap, minor 9ths), Rainy Window (slow, rolled chords), Sunday Morning (major 7ths), Ambient Drift (beatless). A new station takes over once the current song wraps up (within a few bars). |
| Groove   | Energy, Jazz (chord colour + melody density), Drift (bar-to-bar variation), Swing, Tempo (auto per song or fixed) |
| Tape     | Warmth (tape low-pass), Wow (wow & flutter), Crush (bit-crush blend), Space (reverb) |
| Ambience | Vinyl crackle, Rain, Hiss |
| Mixer    | Keys, Pad, Bass, Lead, Drums, Room (ambience) + master, with mutes |
| Cassette | Seed (reproducible tapes), tracklist, 32-bar WAV export |

Settings persist in `localStorage`.

## Architecture

```text
src/shared/           versioned event format (EventBatch, NoteEvent, ...) + params. No runtime deps.
src/composition/      pure TS music logic, deterministic per seed (no Tone / DOM)
  theory.ts           jazz chord qualities, voicings with voice leading
  moods.ts            station definitions: progression pools, tempo, groove vocabulary
  form.ts             endless song plans: key, tempo, progression, title, sections
  automation.ts       filter sweeps, reverb swells, tape-fade between songs
  layers/             keys (comping, pushes), bass, melody (motifs), pad, drums (swung boom-bap)
src/engine/           LocalEngine (composer), Conductor (4-bar look-ahead loop), WAV export
src/audio/            Tone.js renderer: scheduler, instruments, fx, tape master, offline render
src/ui/               React UI (scene canvas, cassette deck, knobs, mixer)
src/services/         zustand store, persistence, controller seam
```

Flow: `LocalEngine` renders one bar at a time with the *current* controls -> `EventBatch` (beats) -> `Conductor` keeps
~4 bars ahead of the audio clock -> `ToneRenderer` schedules on the audio clock.

Audio chain: instruments -> channel strips (fader, mute, sends) -> reverb + tape echo -> tape master
(bit-crush blend -> wow -> flutter -> saturation -> warmth low-pass -> glue compressor -> limiter).

`window.nightTape` exposes the conductor, renderer and store in the dev console.
