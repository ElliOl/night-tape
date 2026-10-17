/**
 * Long-range form: an endless stream of "songs" (tape sides), each with its own key, tempo, progression,
 * title and section arrangement. Songs are planned lazily and deterministically from the seed.
 */
import type { GenerationParams, KeySpec, LayerId, MoodId, ScaleName } from '@shared/index';
import { LAYER_IDS } from '@shared/index';
import { MOODS, type MoodConfig, type ProgTemplate } from './moods';
import { chance, int, pick, stream, weightedPick, type Rng } from './rng';
import {
  bassRoot, clamp01, colourQuality, isMinorScale, mod12, voiceChord, type Chord,
} from './theory';

export type SectionName = 'Intro' | 'Groove' | 'Theme' | 'Break' | 'Outro' | 'Dawn' | 'Float' | 'Tide' | 'Dusk';

export interface SectionPlan {
  index: number;
  name: SectionName;
  /** relative to song start */
  startBar: number;
  bars: number;
  layers: Record<LayerId, boolean>;
  /** 0..1 arrangement energy (combined with the live energy control) */
  energy: number;
}

export interface ChordSlot {
  chord: Chord;
  /** relative bar (inside the song) where the chord starts */
  startBar: number;
  keys: number[];
  pad: number[];
  bass: number;
}

export interface SongPlan {
  index: number;
  title: string;
  mood: MoodId;
  startBar: number;
  lengthBars: number;
  tempo: number;
  key: KeySpec;
  progression: Chord[];
  /** bars of one pass through the progression */
  loopBars: number;
  /** voiced chords for one loop */
  slots: ChordSlot[];
  sections: SectionPlan[];
}

export const songEnd = (s: SongPlan): number => s.startBar + s.lengthBars;

// ---------------------------------------------------------------------------------------------
// titles
// ---------------------------------------------------------------------------------------------

const ADJ = [
  'faded', 'quiet', 'sleepy', 'blue', 'warm', 'soft', 'hazy', 'late', 'paper', 'velvet', 'dusty', 'slow',
  'amber', 'lonely', 'golden', 'cloudy', 'foggy', 'tiny', 'distant', 'midnight', 'secondhand', 'drowsy',
];
const NOUN = [
  'window', 'tea', 'streetlights', 'notebook', 'radiator', 'polaroids', 'raincoat', 'bus stop', 'cassette',
  'blanket', 'balcony', 'laundromat', 'paperbacks', 'houseplants', 'neon', 'puddles', 'subway', 'letters',
  'moths', 'snowfall', 'headphones', 'rooftop', 'fireflies', 'old film',
];
const PLACE = ['the 4th floor', 'the corner store', 'home', 'the last train', '3am', 'the library', 'grandma\'s', 'the city', 'dawn'];

export function songTitle(rng: Rng): string {
  switch (int(rng, 0, 4)) {
    case 0:
      return `${pick(rng, ADJ)} ${pick(rng, NOUN)}`;
    case 1:
      return `${pick(rng, NOUN)} at ${pick(rng, PLACE)}`;
    case 2:
      return `${pick(rng, NOUN)} & ${pick(rng, NOUN)}`;
    case 3:
      return `${pick(rng, ADJ)} ${pick(rng, NOUN)} (${pick(rng, ['demo', 'tape', 'b-side', 'reprise', 'loop'])})`;
    default:
      return `${pick(rng, ADJ)}, ${pick(rng, ADJ)}`;
  }
}

// ---------------------------------------------------------------------------------------------
// harmony
// ---------------------------------------------------------------------------------------------

const KEYS_RANGE = { lo: 52, hi: 76 };
const PAD_RANGE = { lo: 57, hi: 79 };

function pickScale(rng: Rng, mood: MoodConfig, template: ProgTemplate): ScaleName {
  // the key has to agree with the progression's tonic chord (major vs minor)
  const tonicMinor = template[0]![1].startsWith('m') && template[0]![1] !== 'maj7' && template[0]![1] !== 'maj9';
  const fitting = mood.scales.filter((s) => isMinorScale(s) === tonicMinor);
  if (fitting.length) return pick(rng, fitting);
  return tonicMinor ? 'dorian' : 'ionian';
}

export function buildProgression(template: ProgTemplate, tonic: number, bars: number, complexity: number): Chord[] {
  const chords: Chord[] = template.map(([off, q]) => ({ rootPc: mod12(tonic + off), quality: colourQuality(q, complexity), bars }));
  // two identical neighbours become one longer chord (keeps the loop length)
  const merged: Chord[] = [];
  for (const c of chords) {
    const last = merged[merged.length - 1];
    if (last && last.rootPc === c.rootPc && last.quality === c.quality) last.bars += c.bars;
    else merged.push({ ...c });
  }
  return merged;
}

export function voiceProgression(progression: Chord[]): ChordSlot[] {
  const slots: ChordSlot[] = [];
  let prevKeys: number[] | null = null;
  let prevPad: number[] | null = null;
  let pos = 0;
  // voice twice and keep the second pass so the loop's first chord leads smoothly from its last
  for (let pass = 0; pass < 2; pass++) {
    pos = 0;
    slots.length = 0;
    for (const chord of progression) {
      const keys = voiceChord(chord, prevKeys, { ...KEYS_RANGE, rootless: true, maxVoices: 4 });
      const pad = voiceChord(chord, prevPad, { ...PAD_RANGE, rootless: true, maxVoices: 3 });
      slots.push({ chord, startBar: pos, keys, pad, bass: bassRoot(chord.rootPc) });
      prevKeys = keys;
      prevPad = pad;
      pos += chord.bars;
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------------------------
// arrangement
// ---------------------------------------------------------------------------------------------

type LayerSet = readonly LayerId[];

function layers(on: LayerSet): Record<LayerId, boolean> {
  const out = {} as Record<LayerId, boolean>;
  for (const l of LAYER_IDS) out[l] = on.includes(l);
  return out;
}

/** Round up to whole progression loops (at least 4 bars). */
const fit = (bars: number, loop: number): number => Math.max(loop, Math.ceil(bars / loop) * loop);

function planBeatSections(rng: Rng, mood: MoodConfig, loop: number, energy: number): Array<Omit<SectionPlan, 'index' | 'startBar'>> {
  const pad = (): LayerId[] => (chance(rng, mood.padInGroove) ? ['pad'] : []);
  const out: Array<Omit<SectionPlan, 'index' | 'startBar'>> = [];
  out.push({ name: 'Intro', bars: fit(4, loop), energy: 0.2, layers: layers(['keys', 'texture', ...(chance(rng, 0.5) ? ['pad' as LayerId] : [])]) });
  out.push({ name: 'Groove', bars: fit(8, loop), energy: 0.5, layers: layers(['keys', 'bass', 'drums', 'texture', ...pad()]) });
  out.push({ name: 'Theme', bars: fit(chance(rng, 0.5) ? 8 : 16, loop), energy: 0.65, layers: layers(['keys', 'bass', 'drums', 'melody', 'texture', ...pad()]) });
  const breakDrums: LayerId[] = energy > 0.75 && chance(rng, 0.5) ? ['drums'] : [];
  out.push({ name: 'Break', bars: fit(energy > 0.7 ? 4 : 8, loop), energy: 0.3, layers: layers(['keys', 'pad', 'texture', ...breakDrums, ...(chance(rng, 0.5) ? ['melody' as LayerId] : [])]) });
  const themeDrums: LayerId[] = energy < 0.25 && chance(rng, 0.6) ? [] : ['drums'];
  out.push({ name: 'Theme', bars: fit(8, loop), energy: 0.75, layers: layers(['keys', 'bass', 'melody', 'texture', ...themeDrums, ...pad()]) });
  if (energy > 0.55 || chance(rng, 0.4)) {
    out.push({ name: 'Groove', bars: fit(8, loop), energy: 0.6, layers: layers(['keys', 'bass', 'drums', 'texture', ...pad()]) });
  }
  out.push({ name: 'Outro', bars: fit(4, loop), energy: 0.2, layers: layers(['keys', 'pad', 'texture', ...(chance(rng, 0.5) ? ['drums' as LayerId] : [])]) });
  return out;
}

function planAmbientSections(rng: Rng, loop: number, energy: number): Array<Omit<SectionPlan, 'index' | 'startBar'>> {
  const drums: LayerId[] = energy > 0.4 || chance(rng, 0.3) ? ['drums'] : [];
  return [
    { name: 'Dawn', bars: fit(8, loop), energy: 0.15, layers: layers(['pad', 'keys', 'texture']) },
    { name: 'Float', bars: fit(16, loop), energy: 0.4, layers: layers(['pad', 'keys', 'bass', 'melody', 'texture']) },
    { name: 'Tide', bars: fit(8, loop), energy: 0.55, layers: layers(['pad', 'keys', 'bass', 'melody', 'texture', ...drums]) },
    { name: 'Float', bars: fit(8, loop), energy: 0.4, layers: layers(['pad', 'keys', 'melody', 'texture']) },
    { name: 'Dusk', bars: fit(8, loop), energy: 0.1, layers: layers(['pad', 'texture', ...(chance(rng, 0.5) ? ['keys' as LayerId] : [])]) },
  ];
}

// ---------------------------------------------------------------------------------------------
// songs
// ---------------------------------------------------------------------------------------------

export function planSong(seed: number, index: number, startBar: number, params: GenerationParams, prevKey?: KeySpec): SongPlan {
  const mood = MOODS[params.mood];
  const rng = stream(seed, 'song', index, params.mood);
  const template = pick(rng, mood.progressions);
  const scale = pickScale(rng, mood, template);
  // successive songs move by a 4th/5th or a step most of the time, like a playlist that "flows"
  const tonic = prevKey
    ? mod12(prevKey.tonic + weightedPick(rng, [[5, 3], [7, 3], [2, 2], [-2, 2], [3, 1], [0, 1]] as const))
    : int(rng, 0, 11);
  const key: KeySpec = { tonic, scale };
  const chordBars = template.length <= 2 ? Math.max(2, weightedPick(rng, mood.chordBars)) * (mood.ambient ? 2 : 1) : weightedPick(rng, mood.chordBars);
  const progression = buildProgression(template, tonic, chordBars, clamp01(params.complexity));
  const loopBars = progression.reduce((a, c) => a + c.bars, 0);
  const slots = voiceProgression(progression);
  const [tLo, tHi] = mood.tempo;
  const tempo = int(rng, tLo, tHi);

  const raw = mood.ambient ? planAmbientSections(rng, loopBars, params.energy) : planBeatSections(rng, mood, loopBars, params.energy);
  const sections: SectionPlan[] = [];
  let pos = 0;
  raw.forEach((s, i) => {
    sections.push({ ...s, index: i, startBar: pos });
    pos += s.bars;
  });

  return {
    index,
    title: songTitle(stream(seed, 'title', index)),
    mood: params.mood,
    startBar,
    lengthBars: pos,
    tempo,
    key,
    progression,
    loopBars,
    slots,
    sections,
  };
}

/** Chord slot sounding at a bar relative to the song start. */
export function slotAt(song: SongPlan, rel: number): ChordSlot {
  const inLoop = mod(rel, song.loopBars);
  let found = song.slots[0]!;
  for (const s of song.slots) if (s.startBar <= inLoop) found = s;
  return found;
}

/** The chord slot that starts right after the one at `rel` (wraps; may be the next song's harmony at song end). */
export function nextSlotAt(song: SongPlan, rel: number): ChordSlot {
  const cur = slotAt(song, rel);
  const i = song.slots.indexOf(cur);
  return song.slots[(i + 1) % song.slots.length]!;
}

/** Is `rel` the first bar of a chord? */
export function isChordStart(song: SongPlan, rel: number): boolean {
  return slotAt(song, rel).startBar === mod(rel, song.loopBars);
}

export function sectionAt(song: SongPlan, rel: number): SectionPlan {
  let found = song.sections[0]!;
  for (const s of song.sections) if (s.startBar <= rel) found = s;
  return found;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Endless, lazily planned list of songs. */
export class Form {
  readonly songs: SongPlan[] = [];

  constructor(private readonly seed: number) {}

  songForBar(bar: number, params: GenerationParams): SongPlan {
    while (this.songs.length === 0 || songEnd(this.songs[this.songs.length - 1]!) <= bar) {
      const last = this.songs[this.songs.length - 1];
      this.songs.push(planSong(this.seed, this.songs.length, last ? songEnd(last) : 0, params, last?.key));
      // keep memory bounded on very long sessions
      if (this.songs.length > 64) this.songs.splice(0, this.songs.length - 64);
    }
    for (let i = this.songs.length - 1; i >= 0; i--) if (this.songs[i]!.startBar <= bar) return this.songs[i]!;
    return this.songs[0]!;
  }

  /**
   * The mood changed while rendering `bar`: wrap up the current song within 2..5 bars (on a 4-bar boundary)
   * so the next song is planned with the new mood.
   */
  wrapUp(bar: number): void {
    const song = this.songs[this.songs.length - 1];
    if (!song || bar < song.startBar || bar >= songEnd(song)) return;
    const rel = bar - song.startBar;
    const newLen = Math.ceil((rel + 2) / 4) * 4;
    if (newLen >= song.lengthBars) return;
    song.lengthBars = newLen;
    song.sections = song.sections.filter((s) => s.startBar < newLen);
    const last = song.sections[song.sections.length - 1]!;
    last.bars = newLen - last.startBar;
  }
}
