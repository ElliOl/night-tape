/**
 * Long-range form: an endless stream of "songs" (tape sides), each with its own key, tempo, progression, bridge,
 * title, sound palette, groove family and section arrangement. Songs are planned lazily and deterministically from
 * the seed. Chord colour (the "jazz" control) is applied live: voicings are computed per colour level on demand.
 */
import type { GenerationParams, KeySpec, LayerId, MoodId, ScaleName, SoundPalette } from '@shared/index';
import { LAYER_IDS } from '@shared/index';
import {
  MOODS, type BassStyle, type CompStyle, type DrumFamily, type MoodConfig, type ProgTemplate, type Soloist, type Weights,
} from './moods';
import { chance, int, pick, shuffle, stream, weightedPick, type Rng } from './rng';
import { bassRoot, colourQuality, colourSteps, isMinorScale, mod12, voiceChord, type Chord, type VoicingStyle } from './theory';

export type SectionName =
  | 'Intro' | 'Groove' | 'Theme' | 'Bridge' | 'Solo' | 'Break' | 'Outro'
  | 'Dawn' | 'Float' | 'Tide' | 'Dusk';

export type Harmony = 'main' | 'bridge';

export interface SectionPlan {
  index: number;
  name: SectionName;
  /** relative to song start */
  startBar: number;
  bars: number;
  layers: Record<LayerId, boolean>;
  /** 0..1 arrangement energy (combined with the live energy control) */
  energy: number;
  harmony: Harmony;
}

export interface ChordSlot {
  chord: Chord;
  /** bar inside the harmony loop where the chord starts */
  startBar: number;
  keys: number[];
  pad: number[];
  bass: number;
}

/** Everything about how a song sounds and is played (fixed per song). */
export interface SongStyle {
  palette: SoundPalette;
  voicing: VoicingStyle;
  comps: CompStyle[];
  basses: BassStyle[];
  drumFamily: DrumFamily;
  /** 0..1: how far behind the beat backbeats and comping sit */
  laziness: number;
  soloist: Soloist;
  /** melody register shift in semitones */
  melodyOctave: number;
  /** keys register shift in semitones (music box and bells sit up high) */
  keysShift: number;
  /** pad re-strikes on every half bar instead of holding */
  padPulse: boolean;
}

interface HarmonyLoop {
  slots: ChordSlot[];
  loopBars: number;
}

export interface SongPlan {
  index: number;
  title: string;
  mood: MoodId;
  startBar: number;
  lengthBars: number;
  tempo: number;
  key: KeySpec;
  /** uncoloured templates, voiced lazily per colour level */
  template: ProgTemplate;
  bridgeTemplate: ProgTemplate;
  chordBars: number;
  bridgeChordBars: number;
  style: SongStyle;
  sections: SectionPlan[];
  /** colour level -> voiced harmony (main / bridge) */
  _harmony: Map<string, HarmonyLoop>;
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
// style
// ---------------------------------------------------------------------------------------------

const wpick = <T extends string>(rng: Rng, w: Weights<T>): T => weightedPick(rng, w);

export function pickStyle(rng: Rng, mood: MoodConfig): SongStyle {
  const style = pickStyleBase(rng, mood);
  const k = style.palette.keys;
  style.keysShift = k === 'musicbox' ? 12 : (k === 'vibes' || k === 'felt') && chance(rng, 0.3) ? 12 : 0;
  return style;
}

function pickStyleBase(rng: Rng, mood: MoodConfig): SongStyle {
  const drumFamily = wpick(rng, mood.drumFamilies);
  let drums = wpick(rng, mood.kits);
  // some grooves only make sense on a matching kit
  if (drumFamily === 'brushes') drums = chance(rng, 0.6) ? 'brushes' : 'jazz';
  else if (drumFamily === 'bossa') drums = chance(rng, 0.5) ? 'jazz' : 'tight';
  else if (drumFamily === 'whisper') drums = 'soft';
  const melody = wpick(rng, mood.leadPatches);
  const comps = shuffle(rng, mood.comps).slice(0, Math.min(mood.comps.length, int(rng, 2, 3)));
  if (drumFamily === 'bossa' && !comps.includes('bossa')) comps[0] = 'bossa';
  return {
    palette: {
      keys: wpick(rng, mood.keysPatches),
      pad: wpick(rng, mood.padPatches),
      bass: wpick(rng, mood.bassPatches),
      melody,
      drums,
      // every song retunes its kit, so even the same kit never sounds quite the same
      drumTune: int(rng, -4, 4),
      keysColor: rng.next(),
    },
    voicing: wpick(rng, mood.voicings),
    comps,
    basses: shuffle(rng, drumFamily === 'brushes' ? [...mood.basses, 'walking' as BassStyle] : mood.basses).slice(0, 2),
    drumFamily,
    laziness: drumFamily === 'dilla' ? 0.7 + rng.next() * 0.3 : rng.next() * 0.6,
    soloist: wpick(rng, mood.soloists),
    // low, warm voices sit down an octave, bells and whistles up
    melodyOctave: melody === 'trumpet' || melody === 'guitar' ? -12 : melody === 'whistle' || melody === 'kalimba' ? (chance(rng, 0.5) ? 12 : 0) : 0,
    padPulse: chance(rng, mood.ambient ? 0.1 : 0.3),
    keysShift: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// harmony
// ---------------------------------------------------------------------------------------------

const PAD_RANGE = { lo: 57, hi: 79 };
const KEYS_RANGE: Record<VoicingStyle, { lo: number; hi: number }> = {
  close: { lo: 52, hi: 76 },
  spread: { lo: 48, hi: 77 },
  shell: { lo: 50, hi: 76 },
  quartal: { lo: 50, hi: 79 },
  cluster: { lo: 55, hi: 75 },
};

function pickScale(rng: Rng, mood: MoodConfig, template: ProgTemplate): ScaleName {
  // the key has to agree with the progression's tonic chord (major vs minor)
  const q = template[0]![1];
  const tonicMinor = q === 'm' || q.startsWith('m7') || q === 'm9' || q === 'm11';
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

export function voiceProgression(progression: Chord[], voicing: VoicingStyle = 'close'): ChordSlot[] {
  const slots: ChordSlot[] = [];
  let prevKeys: number[] | null = null;
  let prevPad: number[] | null = null;
  // voice twice and keep the second pass so the loop's first chord leads smoothly from its last
  for (let pass = 0; pass < 2; pass++) {
    let pos = 0;
    slots.length = 0;
    for (const chord of progression) {
      const keys = voiceChord(chord, prevKeys, { ...KEYS_RANGE[voicing], style: voicing, rootless: true, maxVoices: 4 });
      const pad = voiceChord(chord, prevPad, { ...PAD_RANGE, rootless: true, maxVoices: 3 });
      slots.push({ chord, startBar: pos, keys, pad, bass: bassRoot(chord.rootPc) });
      prevKeys = keys;
      prevPad = pad;
      pos += chord.bars;
    }
  }
  return slots;
}

/** Voiced harmony loop of a song at the given colour (complexity). Cached per colour level. */
export function harmonyLoop(song: SongPlan, which: Harmony, complexity: number): HarmonyLoop {
  const key = `${which}:${colourSteps(complexity)}`;
  let h = song._harmony.get(key);
  if (!h) {
    const template = which === 'bridge' ? song.bridgeTemplate : song.template;
    const bars = which === 'bridge' ? song.bridgeChordBars : song.chordBars;
    const prog = buildProgression(template, song.key.tonic, bars, complexity);
    h = { slots: voiceProgression(prog, song.style.voicing), loopBars: prog.reduce((a, c) => a + c.bars, 0) };
    song._harmony.set(key, h);
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// arrangement
// ---------------------------------------------------------------------------------------------

type LayerSet = readonly LayerId[];
type RawSection = Omit<SectionPlan, 'index' | 'startBar'>;

function layers(on: LayerSet): Record<LayerId, boolean> {
  const out = {} as Record<LayerId, boolean>;
  for (const l of LAYER_IDS) out[l] = on.includes(l);
  return out;
}

/** Round up to whole loops (at least one). */
const fit = (bars: number, loop: number): number => Math.max(loop, Math.ceil(bars / loop) * loop);

function sec(name: SectionName, bars: number, energy: number, on: LayerSet, harmony: Harmony = 'main'): RawSection {
  return { name, bars, energy, layers: layers(on), harmony };
}

function planBeatSections(rng: Rng, mood: MoodConfig, loop: number, bridgeLoop: number, energy: number, soloist: Soloist): RawSection[] {
  const pad = (): LayerId[] => (chance(rng, mood.padInGroove) ? ['pad'] : []);
  const maybe = (p: number, l: LayerId): LayerId[] => (chance(rng, p) ? [l] : []);
  const both = Math.max(loop, bridgeLoop);
  const out: RawSection[] = [];
  out.push(sec('Intro', fit(4, loop), 0.2, ['keys', 'texture', ...maybe(0.5, 'pad')]));
  out.push(sec('Groove', fit(8, loop), 0.5, ['keys', 'bass', 'drums', 'texture', ...pad()]));
  out.push(sec('Theme', fit(chance(rng, 0.5) ? 8 : 16, loop), 0.65, ['keys', 'bass', 'drums', 'melody', 'texture', ...pad()]));
  let bridge = chance(rng, 0.65);
  let solo = chance(rng, 0.55);
  if (!bridge && !solo) (chance(rng, 0.5) ? (bridge = true) : (solo = true));
  if (bridge) {
    out.push(sec('Bridge', fit(8, both), 0.6, ['keys', 'bass', 'pad', 'texture', ...maybe(0.75, 'drums'), ...maybe(0.5, 'melody')], 'bridge'));
  }
  if (solo) {
    const soloLayers: LayerId[] = ['keys', 'bass', 'drums', 'texture', ...(soloist === 'lead' ? ['melody' as LayerId] : []), ...maybe(0.3, 'pad')];
    out.push(sec('Solo', fit(chance(rng, 0.6) ? 8 : 16, loop), 0.8, soloLayers));
  }
  const breakDrums: LayerId[] = energy > 0.75 && chance(rng, 0.5) ? ['drums'] : [];
  out.push(sec('Break', fit(energy > 0.7 ? 4 : 8, loop), 0.3, ['keys', 'pad', 'texture', ...breakDrums, ...maybe(0.5, 'melody')]));
  const themeDrums: LayerId[] = energy < 0.25 && chance(rng, 0.6) ? [] : ['drums'];
  out.push(sec('Theme', fit(8, loop), 0.75, ['keys', 'bass', 'melody', 'texture', ...themeDrums, ...pad()]));
  if (energy > 0.55 || chance(rng, 0.4)) out.push(sec('Groove', fit(8, loop), 0.6, ['keys', 'bass', 'drums', 'texture', ...pad()]));
  out.push(sec('Outro', fit(4, loop), 0.2, ['keys', 'pad', 'texture', ...maybe(0.5, 'drums')]));
  return out;
}

function planAmbientSections(rng: Rng, loop: number, bridgeLoop: number, energy: number): RawSection[] {
  const drums: LayerId[] = energy > 0.4 || chance(rng, 0.3) ? ['drums'] : [];
  const out: RawSection[] = [
    sec('Dawn', fit(8, loop), 0.15, ['pad', 'keys', 'texture']),
    sec('Float', fit(16, loop), 0.4, ['pad', 'keys', 'bass', 'melody', 'texture']),
  ];
  if (chance(rng, 0.6)) out.push(sec('Bridge', fit(8, Math.max(loop, bridgeLoop)), 0.45, ['pad', 'keys', 'bass', 'texture'], 'bridge'));
  out.push(sec('Tide', fit(8, loop), 0.55, ['pad', 'keys', 'bass', 'melody', 'texture', ...drums]));
  if (chance(rng, 0.5)) out.push(sec('Solo', fit(8, loop), 0.5, ['pad', 'keys', 'bass', 'melody', 'texture']));
  out.push(sec('Float', fit(8, loop), 0.4, ['pad', 'keys', 'melody', 'texture']));
  out.push(sec('Dusk', fit(8, loop), 0.1, ['pad', 'texture', ...(chance(rng, 0.5) ? ['keys' as LayerId] : [])]));
  return out;
}

// ---------------------------------------------------------------------------------------------
// songs
// ---------------------------------------------------------------------------------------------

const templateBars = (t: ProgTemplate, chordBars: number): number => t.length * chordBars;

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
  const bridgeTemplate = pick(rng, mood.bridges);
  const bridgeChordBars = bridgeTemplate.length <= 2 ? (mood.ambient ? 4 : 2) : mood.ambient ? 2 : 1;
  const [tLo, tHi] = mood.tempo;
  const tempo = int(rng, tLo, tHi);
  const style = pickStyle(stream(seed, 'style', index, params.mood), mood);

  const loop = templateBars(template, chordBars);
  const bridgeLoop = templateBars(bridgeTemplate, bridgeChordBars);
  const raw = mood.ambient
    ? planAmbientSections(rng, loop, bridgeLoop, params.energy)
    : planBeatSections(rng, mood, loop, bridgeLoop, params.energy, style.soloist);
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
    template,
    bridgeTemplate,
    chordBars,
    bridgeChordBars,
    style,
    sections,
    _harmony: new Map(),
  };
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function sectionAt(song: SongPlan, rel: number): SectionPlan {
  let found = song.sections[0]!;
  for (const s of song.sections) if (s.startBar <= rel) found = s;
  return found;
}

export interface HarmonyPosition {
  slot: ChordSlot;
  /** bars left in the current chord, including this one */
  barsLeft: number;
  /** this bar starts a chord */
  chordStart: boolean;
}

/** Chord at a bar relative to the song start, with the given colour (live complexity). */
export function harmonyAt(song: SongPlan, rel: number, complexity = 0.5): HarmonyPosition {
  const section = sectionAt(song, rel);
  const h = harmonyLoop(song, section.harmony, complexity);
  const inLoop = mod(section.harmony === 'bridge' ? rel - section.startBar : rel, h.loopBars);
  let slot = h.slots[0]!;
  for (const s of h.slots) if (s.startBar <= inLoop) slot = s;
  const barsLeft = slot.startBar + slot.chord.bars - inLoop;
  // a section boundary always counts as a chord start (the harmony may switch)
  return { slot, barsLeft, chordStart: slot.startBar === inLoop || rel === section.startBar };
}

export function slotAt(song: SongPlan, rel: number, complexity = 0.5): ChordSlot {
  return harmonyAt(song, rel, complexity).slot;
}

/** The chord that follows the one at `rel` (stays on the current chord at the end of the song). */
export function nextSlotAt(song: SongPlan, rel: number, complexity = 0.5): ChordSlot {
  const h = harmonyAt(song, rel, complexity);
  const nextRel = rel + h.barsLeft;
  return nextRel < song.lengthBars ? slotAt(song, nextRel, complexity) : h.slot;
}

export function isChordStart(song: SongPlan, rel: number, complexity = 0.5): boolean {
  return harmonyAt(song, rel, complexity).chordStart;
}

/** Endless, lazily planned list of songs. */
export class Form {
  readonly songs: SongPlan[] = [];

  constructor(private readonly seed: number) {}

  songForBar(bar: number, params: GenerationParams): SongPlan {
    while (this.songs.length === 0 || songEnd(this.songs[this.songs.length - 1]!) <= bar) {
      const last = this.songs[this.songs.length - 1];
      this.songs.push(planSong(this.seed, last ? last.index + 1 : 0, last ? songEnd(last) : 0, params, last?.key));
      // keep memory bounded on very long sessions
      if (this.songs.length > 64) this.songs.splice(0, this.songs.length - 64);
    }
    for (let i = this.songs.length - 1; i >= 0; i--) if (this.songs[i]!.startBar <= bar) return this.songs[i]!;
    return this.songs[0]!;
  }

  /**
   * The mood changed while rendering `bar`: wrap up the song playing at `bar` within 2..5 bars (on a 4-bar boundary)
   * so the next song is planned with the new mood. Songs already planned after it are dropped.
   */
  wrapUp(bar: number): void {
    const i = this.songs.findIndex((s) => bar >= s.startBar && bar < songEnd(s));
    if (i < 0) return;
    this.songs.splice(i + 1);
    const song = this.songs[i]!;
    const rel = bar - song.startBar;
    const newLen = Math.ceil((rel + 2) / 4) * 4;
    if (newLen >= song.lengthBars) return;
    song.lengthBars = newLen;
    song.sections = song.sections.filter((s) => s.startBar < newLen);
    const last = song.sections[song.sections.length - 1]!;
    last.bars = newLen - last.startBar;
  }
}
