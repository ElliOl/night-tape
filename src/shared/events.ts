/**
 * Versioned music representation shared by the composer and the audio renderer.
 * Composers emit EventBatch; renderers consume it. All timing is in beats from song start (beat 0), 4/4.
 * This file must stay free of Tone.js / DOM imports.
 */

export const SCHEMA_VERSION = 1;

export type LayerId = 'keys' | 'pad' | 'bass' | 'melody' | 'drums' | 'texture';
export const LAYER_IDS: readonly LayerId[] = ['keys', 'pad', 'bass', 'melody', 'drums', 'texture'];

export type MoodId = 'study' | 'rainy' | 'sunday' | 'drift';
export const MOOD_IDS: readonly MoodId[] = ['study', 'rainy', 'sunday', 'drift'];

export type ScaleName = 'ionian' | 'dorian' | 'aeolian' | 'lydian' | 'mixolydian';

export interface KeySpec {
  /** pitch class of the tonic, 0 = C ... 11 = B */
  tonic: number;
  scale: ScaleName;
}

export interface ChordSpec {
  /** MIDI pitch of the chord root (bass register) */
  root: number;
  /** e.g. "Dm9", "Fmaj7" */
  label: string;
  /** semitone intervals above the root */
  intervals: number[];
}

/**
 * Drum layer MIDI mapping (General MIDI subset).
 * 36 kick, 37 rim, 38 snare, 39 clap, 42 closed hat, 46 open hat, 51 ride, 70 shaker.
 */
export const DRUM = { kick: 36, rim: 37, snare: 38, clap: 39, hatClosed: 42, hatOpen: 46, ride: 51, shaker: 70 } as const;

export interface NoteEvent {
  kind: 'note';
  layer: LayerId;
  /** absolute beat from song start (swing and humanisation already applied) */
  beat: number;
  durBeats: number;
  midi: number;
  /** 0..1 */
  vel: number;
}

/**
 * Normalised automation, value 0..1. The renderer maps to real units.
 *  filter.<layer>      low-pass position of the layer
 *  send.reverb         reverb send multiplier (0.5 = neutral)
 *  master.filter       master low-pass sweep (1 = open), used for song transitions
 *  layer.gain.<layer>  section-level gain (multiplied with the user fader)
 */
export type AutomationTarget =
  | 'filter.keys' | 'filter.pad' | 'filter.bass' | 'filter.melody'
  | 'send.reverb' | 'master.filter'
  | 'layer.gain.keys' | 'layer.gain.pad' | 'layer.gain.bass'
  | 'layer.gain.melody' | 'layer.gain.drums' | 'layer.gain.texture';

export interface AutomationEvent {
  kind: 'automation';
  target: AutomationTarget;
  beat: number;
  value: number;
  /** linear ramp length in beats from the previous value; 0/undefined = jump */
  rampBeats?: number;
}

// ---------------------------------------------------------------------------------------------
// sound palettes: every song picks its own instruments (ids are renderer patches)
// ---------------------------------------------------------------------------------------------

export type KeysPatchId =
  | 'rhodes' | 'wurli' | 'felt' | 'organ' | 'vibes' | 'dusty'
  | 'juno' | 'clav' | 'guitar' | 'musicbox';
export type PadPatchId = 'warm' | 'strings' | 'glass' | 'hollow' | 'tape';
export type BassPatchId = 'round' | 'upright' | 'muted' | 'square' | 'fingered';
export type LeadPatchId = 'flute' | 'kalimba' | 'vibes' | 'trumpet' | 'whistle' | 'guitar' | 'synth';
export type KitId = 'dusty' | 'brushes' | 'tight' | 'crunchy' | 'jazz' | 'soft' | 'eight08' | 'tape';

export interface SoundPalette {
  keys: KeysPatchId;
  pad: PadPatchId;
  bass: BassPatchId;
  melody: LeadPatchId;
  drums: KitId;
  /** kit tuning in semitones (every song retunes its drums) */
  drumTune: number;
  /** 0..1 per-song colour of the keys (brightness, tremolo, chorus) */
  keysColor: number;
}

/** Switches instrument patches (sent at the start of every song). */
export interface PatchEvent {
  kind: 'patch';
  beat: number;
  palette: SoundPalette;
}

/** Marks a section / chord boundary. Used for UI display. */
export interface SectionEvent {
  kind: 'section';
  beat: number;
  /** e.g. "Intro", "Groove", "Theme", "Bridge", "Solo", "Break", "Outro" */
  name: string;
  /** index of the song (a "tape side") in the infinite stream */
  songIndex: number;
  songTitle: string;
  key: KeySpec;
  chord?: ChordSpec;
  energy: number;
  /** the song's instruments */
  palette: SoundPalette;
  /** human-readable groove family, e.g. "half-time" */
  groove: string;
}

export type MusicEvent = NoteEvent | AutomationEvent | SectionEvent | PatchEvent;

/** Contiguous chunk of music covering [startBeat, endBeat). Batches are produced in order, no gaps. */
export interface EventBatch {
  version: number;
  startBeat: number;
  endBeat: number;
  /** BPM in effect from startBeat */
  tempo: number;
  timeSig: [number, number];
  events: MusicEvent[];
}
