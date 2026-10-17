# Night Tape

An endless procedural lo-fi / ambient generator that runs in the browser. It plays a never-ending "tape" of songs, each
with its own title, key, tempo, jazz chord progression and arrangement. Everything is composed live from a seed and
synthesized with Tone.js; nothing is sampled.


## Run

```bash
npm install
npm run dev        # http://localhost:5174 - press play
npm test           # theory, engine and persistence tests
npm run build      # static build in dist/ (relative paths, host anywhere)
```

Keys: `Space` play / pause, `N` new tape (new random seed).

## What you can control

| Panel         | Controls |
|---------------|----------|
| Station       | Late Night Study, Rainy Window, Sunday Morning, Ambient Drift. Each has its own pool of instruments, kits, groove families, voicings and progressions; every song draws a new combination. A new station takes over once the current song wraps up (within a few bars). |
| Groove (live) | Energy, Jazz (triads .. 13th chords, melody density), Drift (bar-to-bar variation), Swing (straight .. hard shuffle), Tempo (auto per song or 40-140 BPM). Changes re-compose the already-scheduled music, so they are heard within about half a beat. |
| Filter        | LP / BP / HP, Cutoff (40 Hz - 20 kHz), Resonance |
| Tape          | Warmth (tube drive + tone), Wow (wow & flutter), Crush (sample-rate + bit reduction), Space (dry .. cathedral, then full echo) |
| Ambience      | Vinyl crackle, Rain, Hiss |
| Cat           | Amount, Rate, and which groups it may move (Filter, Tape, Groove). A Lorenz attractor drifts the knobs smoothly and never repeats; it leans darker in breaks and brighter in solos. Orange dots on the knobs show where it is pushing, and a cat chases the dot. |
| Mixer         | Keys, Pad, Bass, Lead, Drums, Room (ambience) + master, with mutes |
| Cassette      | Seed (reproducible tapes), tracklist with each song's sound, 32-bar WAV export |

Songs are arranged from Intro, Groove, Theme, **Bridge** (its own progression that turns back home), **Solo** (the lead
or the keys improvise: runs, approach notes, phrase arcs), Break and Outro sections.

Each song's sound palette: keys (Rhodes, Wurlitzer, felt piano, organ, vibes, dusty upright), pad, bass, lead (flute,
kalimba, vibes, muted trumpet, whistle, jazz guitar, soft synth), drum kit (dusty, brushes, tight, crunchy SP, jazz,
soft) and groove family (boom-bap, half-time, drunk swing, brushes, bossa, two-step, sparse, whisper).

Settings persist in `localStorage`.

## Architecture

```text
src/shared/           versioned event format (EventBatch, NoteEvent, ...) + params. No runtime deps.
src/composition/      pure TS music logic, deterministic per seed (no Tone / DOM)
  theory.ts           jazz chord qualities, voicings with voice leading
  moods.ts            station definitions: progression pools, tempo, groove vocabulary
  form.ts             endless song plans: key, tempo, progression + bridge, title, sound palette, sections
  sounds.ts           patch display names
  automation.ts       filter sweeps, reverb swells, tape-fade between songs
  layers/             keys (comping, pushes, arps), bass (walking, syncopated...), melody (motifs), solo (improviser),
                      pad, drums (eight groove families)
src/engine/           LocalEngine (composer), Conductor (2-bar look-ahead loop, live re-render), WAV export
src/audio/            Tone.js renderer: scheduler, instruments, fx, tape master, offline render
src/ui/               React UI (scene canvas, cassette deck, knobs, mixer)
src/services/         zustand store, persistence, chaos LFO (Lorenz) + modulator, controller seam
```

Flow: `LocalEngine` renders one bar at a time with the *current* (chaos-modulated) controls -> `EventBatch` (beats) ->
`Conductor` keeps ~2 bars ahead of the audio clock -> `ToneRenderer` schedules on the audio clock. When a groove control
moves, the Conductor cancels everything after the next ~half beat, rewinds the engine and re-renders.

Audio chain: instruments -> channel strips (fader, mute, sends) -> reverb + tape echo -> tape master
(decimator -> wow -> flutter -> tube warmth -> saturation -> warmth tone -> master filter -> glue compressor -> limiter).
Every song starts with a `patch` event that moves each instrument to the song's patch.

`window.nightTape` exposes the conductor, renderer and store in the dev console.
