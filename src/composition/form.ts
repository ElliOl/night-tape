/**
 * Long-range form: an endless stream of "songs" (tape sides), each with its own key, tempo, progression, bridge,
 * title, sound palette, groove family and section arrangement. Songs are planned lazily and deterministically from
 * the seed. Chord colour (the "jazz" control) is applied live: voicings are computed per colour level on demand.
 */
import type { GenerationParams, KeySpec, LayerId, MoodId, ScaleName, SoundPalette } from '@shared/index';
import { LAYER_IDS } from '@shared/index';
import {
  MOODS, type BassStyle, type CompStyle, type DrumFamily, type MoodConfig, type ProgStep, type ProgTemplate, type Soloist,
  type Weights,
} from './moods';
import { chance, int, pick, shuffle, stream, weightedPick, type Rng } from './rng';
import {
  bassRoot, colourQuality, colourSteps, isMinorScale, mod12, progressionPcs, scaleConflicts, voiceChord, type Chord, type ChordQuality,
  type VoicingStyle,
} from './theory';

export type SectionName =
  | 'Intro' | 'Groove' | 'Theme' | 'Bridge' | 'Solo' | 'Break' | 'Outro'
  | 'Drop' | 'Hook'
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
  /** added to the live swing control: a two-step sits straighter, a Dilla groove drunker */
  swingOffset: number;
  /** scales the station's melody density: some songs are hook-heavy, some leave the lead mostly silent */
  melodyAmount: number;
  /** arrangement template the sections were built from (see ARRANGEMENTS) */
  arrangement: Arrangement;
  /** how chords are struck: all notes at once, lightly staggered or clearly rolled (guitar always strums) */
  touch: KeysTouch;
  /** 0..1: how long chords ring (held through the gaps, pedal-like, longer keys decay); also palette.keysRing */
  ring: number;
}

export type KeysTouch = 'block' | 'light' | 'rolled';

/** Chance per station that a song lets its chords ring out. */
const RING_CHANCE: Record<MoodId, number> = { study: 0.3, rainy: 0.5, sunday: 0.25, drift: 0.7 };

export type Arrangement = 'classic' | 'beattape' | 'aaba' | 'sketch' | 'jam' | 'coldopen' | 'ambient';

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
  /** the station progression this song was built from (before per-song reharmonisation) */
  baseTemplate: ProgTemplate;
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

export const TITLE_ADJ = [
  'faded', 'quiet', 'sleepy', 'blue', 'warm', 'soft', 'hazy', 'late', 'paper', 'velvet', 'dusty', 'slow',
  'amber', 'lonely', 'golden', 'cloudy', 'foggy', 'tiny', 'distant', 'midnight', 'secondhand', 'drowsy',
  'mellow', 'hushed', 'dim', 'pale', 'gentle', 'woolen', 'rainy', 'misty', 'lazy', 'honey', 'cozy', 'muted',
  'little', 'borrowed', 'forgotten', 'half-asleep', 'sunlit', 'moonlit', 'grainy', 'worn', 'crooked', 'faraway',
  'lukewarm', 'peach', 'lavender', 'indigo', 'sepia', 'cobalt', 'mint', 'rusty', 'cotton', 'glassy', 'starry',
  'wistful', 'patient', 'unhurried', 'tender', 'lost', 'blurry', 'washed-out', 'overcast', 'drizzly', 'snowy',
  'humid', 'early', 'sunday', 'weekday', 'after-hours', 'off-key', 'analog', 'homemade', 'quiet-ish', 'small',
  'yellowed', 'dog-eared', 'second-floor', 'old', 'new', 'cold', 'leftover', 'rewound', 'pastel', 'nocturnal',
];
export const TITLE_NOUN = [
  'window', 'tea', 'streetlights', 'notebook', 'radiator', 'polaroids', 'raincoat', 'bus stop', 'cassette',
  'blanket', 'balcony', 'laundromat', 'paperbacks', 'houseplants', 'neon', 'puddles', 'subway', 'letters',
  'moths', 'snowfall', 'headphones', 'rooftop', 'fireflies', 'old film',
  'coffee', 'matcha', 'ramen', 'vending machine', 'cat nap', 'tram', 'crosswalk', 'umbrella', 'sweater',
  'postcards', 'sketchbook', 'piano bench', 'record player', 'lamp', 'kettle', 'fog', 'drizzle', 'clouds',
  'moonlight', 'satellites', 'paper cranes', 'cherry blossoms', 'autumn leaves', 'pinecones', 'snow globe',
  'film camera', 'walkman', 'vhs', 'answering machine', 'payphone', 'night bus', 'ferry', 'lighthouse',
  'alleyway', 'fire escape', 'bookshop', 'diner', 'arcade', 'train window', 'station bench', 'rain gutter',
  'goldfish', 'sunflowers', 'mixtape', 'daydreams', 'naps', 'bedroom', 'hallway', 'attic', 'garden',
  'stargazing', 'homework', 'library card', 'pencil shavings', 'mittens', 'scarf', 'cocoa', 'pancakes',
  'orange peel', 'lemon cake', 'thunder', 'porch light', 'ceiling fan', 'sidewalk chalk', 'bicycle',
  'skyline', 'convenience store', 'late bus', 'radio static', 'loose change', 'origami', 'mailbox', 'snooze button',
];
const TITLE_PLACE = [
  'the 4th floor', 'the corner store', 'home', 'the last train', '3am', 'the library', 'grandma\'s', 'the city', 'dawn',
  'the laundromat', 'the window seat', 'the back porch', 'the rooftop', 'the night market', 'the old apartment',
  'platform 2', 'the beach in winter', 'the coffee shop', 'the end of the line', 'the attic', 'midnight', 'dusk',
  'the bus depot', 'the river', 'the arcade', 'the 24h diner', 'aunt may\'s', 'the observatory', 'the record shop',
  'the park', 'the harbour', 'room 204', 'the hallway', 'the suburbs', 'nowhere in particular',
];
const TITLE_TIME = [
  '2am', '3am', '4:44', '5am', '11:11', '1:17 am', 'half past three', 'sunday morning', 'monday', 'late october',
  'early march', 'last summer', 'new year\'s eve', 'rainy season', 'first snow', 'golden hour', 'blue hour',
  'after school', 'before dawn', 'the weekend', 'tuesday night', 'end of august',
];
const TITLE_VERB = [
  'waiting for', 'thinking about', 'dreaming of', 'walking to', 'missing', 'looking for', 'drawing', 'remembering',
  'listening to', 'falling for', 'writing to', 'counting', 'chasing', 'saving', 'humming to', 'watching',
];
const TITLE_SINGLE = [
  'drift', 'nostalgia', 'lull', 'hush', 'reverie', 'solace', 'haze', 'linger', 'daydream', 'rewind', 'ember',
  'mellow', 'afterglow', 'murmur', 'stillness', 'warmth', 'undertow', 'slumber', 'idle', 'pastel', 'retrograde',
  'kōhī', 'yūgure', 'komorebi', 'natsukashii', 'ame', 'saudade', 'hygge', 'fernweh', 'petrichor', 'sonder',
];
const TITLE_TAG = ['demo', 'tape', 'b-side', 'reprise', 'loop', 'interlude', 'sketch', 'flip', 'edit', 'v2', 'take 3', 'voice memo', 'unfinished', 'outro', 'rough mix'];
const TITLE_FEAT = ['w/ rain', 'w/ the cat', 'w/ friends', 'feat. the radiator', 'w/ no one', 'w/ you'];

/** Weighted title patterns; lofi titles are lowercase, short and a little wistful. */
const TITLE_PATTERNS: ReadonlyArray<readonly [(rng: Rng) => string, number]> = [
  [(r) => `${pick(r, TITLE_ADJ)} ${pick(r, TITLE_NOUN)}`, 6],
  [(r) => `${pick(r, TITLE_NOUN)} at ${pick(r, TITLE_PLACE)}`, 3],
  [(r) => `${pick(r, TITLE_NOUN)} & ${pick(r, TITLE_NOUN)}`, 2],
  [(r) => `${pick(r, TITLE_ADJ)} ${pick(r, TITLE_NOUN)} (${pick(r, TITLE_TAG)})`, 2],
  [(r) => `${pick(r, TITLE_ADJ)}, ${pick(r, TITLE_ADJ)}`, 1],
  [(r) => `${pick(r, TITLE_VERB)} ${pick(r, TITLE_NOUN)}`, 3],
  [(r) => `${pick(r, TITLE_TIME)} ${pick(r, TITLE_NOUN)}`, 2],
  [(r) => `${pick(r, TITLE_NOUN)}, ${pick(r, TITLE_TIME)}`, 2],
  [(r) => `${pick(r, TITLE_SINGLE)}`, 1],
  [(r) => `${pick(r, TITLE_SINGLE)} (${pick(r, TITLE_TAG)})`, 1],
  [(r) => `${pick(r, TITLE_NOUN)} ${pick(r, TITLE_FEAT)}`, 1],
  [(r) => `${pick(r, TITLE_ADJ)} ${pick(r, TITLE_NOUN)} in ${pick(r, TITLE_TIME)}`, 1],
  [(r) => `the ${pick(r, TITLE_NOUN)} ${pick(r, ['song', 'tape', 'loop', 'waltz', 'lullaby', 'theme'])}`, 1],
  [(r) => `${pick(r, TITLE_NOUN)} pt. ${int(r, 2, 4)}`, 1],
];

export function songTitle(rng: Rng): string {
  return weightedPick(rng, TITLE_PATTERNS)(rng);
}

// ---------------------------------------------------------------------------------------------
// style
// ---------------------------------------------------------------------------------------------

const wpick = <T extends string>(rng: Rng, w: Weights<T>): T => weightedPick(rng, w);

/** Pick from `w`, re-drawing a few times while it repeats `avoid` (consecutive songs should sound different). */
function wpickNot<T extends string>(rng: Rng, w: Weights<T>, avoid: T | undefined): T {
  let out = wpick(rng, w);
  for (let i = 0; i < 4 && avoid !== undefined && out === avoid; i++) out = wpick(rng, w);
  return out;
}

/** Per-family swing feel [lo, hi] added to the live swing control. */
const FAMILY_SWING: Record<DrumFamily, readonly [number, number]> = {
  boombap: [-0.1, 0.15],
  halftime: [0, 0.2],
  dilla: [0.2, 0.35],
  chopbreak: [0, 0.2],
  brushes: [0.1, 0.25],
  bossa: [-0.35, -0.2],
  twostep: [-0.25, -0.1],
  sparse: [-0.1, 0.1],
  whisper: [-0.1, 0.1],
};

export function pickStyle(rng: Rng, mood: MoodConfig, prev?: SongStyle): SongStyle {
  const style = pickStyleBase(rng, mood, prev);
  const k = style.palette.keys;
  style.keysShift = k === 'musicbox' || k === 'celeste' ? 12 : (k === 'vibes' || k === 'felt') && chance(rng, 0.3) ? 12 : 0;
  const [sLo, sHi] = FAMILY_SWING[style.drumFamily];
  style.swingOffset = sLo + rng.next() * (sHi - sLo);
  style.melodyAmount = weightedPick(rng, [[0.55, 1], [1, 3], [1.35, 1]] as const);
  style.ring = chance(rng, RING_CHANCE[mood.id]) ? 0.55 + rng.next() * 0.45 : rng.next() * 0.3;
  // ringing songs lean on block chords (pedalled stabs), dry songs on a light stagger
  style.touch = weightedPick(rng, (style.ring > 0.5 ? [['block', 4], ['light', 2], ['rolled', 2]] : [['block', 3], ['light', 4], ['rolled', 2]]) as Weights<KeysTouch>);
  style.palette.keysRing = style.ring;
  return style;
}

function pickStyleBase(rng: Rng, mood: MoodConfig, prev?: SongStyle): SongStyle {
  const drumFamily = wpickNot(rng, mood.drumFamilies, prev?.drumFamily);
  let drums = wpick(rng, mood.kits);
  // some grooves only make sense on a matching kit
  if (drumFamily === 'brushes') drums = chance(rng, 0.6) ? 'brushes' : 'jazz';
  else if (drumFamily === 'bossa') drums = chance(rng, 0.5) ? 'jazz' : 'tight';
  else if (drumFamily === 'whisper') drums = 'soft';
  const melody = wpickNot(rng, mood.leadPatches, prev?.palette.melody);
  const comps = shuffle(rng, mood.comps).slice(0, Math.min(mood.comps.length, int(rng, 2, 3)));
  if (drumFamily === 'bossa' && !comps.includes('bossa')) comps[0] = 'bossa';
  return {
    palette: {
      keys: wpickNot(rng, mood.keysPatches, prev?.palette.keys),
      pad: wpick(rng, mood.padPatches),
      bass: wpick(rng, mood.bassPatches),
      melody,
      drums,
      // every song retunes its kit, so even the same kit never sounds quite the same
      drumTune: int(rng, -4, 4),
      keysColor: rng.next(),
      keysRing: 0,
    },
    voicing: wpick(rng, mood.voicings),
    comps,
    basses: shuffle(rng, drumFamily === 'brushes' ? [...mood.basses, 'walking' as BassStyle] : mood.basses).slice(0, 2),
    drumFamily,
    laziness: drumFamily === 'dilla' ? 0.7 + rng.next() * 0.3 : rng.next() * 0.6,
    soloist: wpick(rng, mood.soloists),
    // low, warm voices sit down an octave, bells and whistles up
    melodyOctave: melody === 'trumpet' || melody === 'guitar' || melody === 'sax' || melody === 'nylon'
      ? -12
      : melody === 'whistle' || melody === 'kalimba' || melody === 'pluck' ? (chance(rng, 0.5) ? 12 : 0) : 0,
    padPulse: chance(rng, mood.ambient ? 0.1 : 0.3),
    keysShift: 0,
    swingOffset: 0,
    melodyAmount: 1,
    arrangement: 'classic',
    touch: 'light',
    ring: 0,
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

const isMinorQuality = (q: ChordQuality): boolean => q === 'm' || q === 'm7' || q === 'm9' || q === 'm11';

/**
 * Is the progression in a minor key? Decided by its tonic chord (offset 0) wherever it sits in the loop; loops that
 * never touch the tonic are minor when they lean on the flat-side major chords (bIII, bVI, bVII).
 */
export function templateIsMinor(template: ProgTemplate): boolean {
  const tonic = template.find(([off]) => off === 0);
  if (tonic) return isMinorQuality(tonic[1]);
  return template.some(([off, q]) => (off === 3 || off === 8 || off === 10) && q.startsWith('maj'));
}

function pickScale(rng: Rng, mood: MoodConfig, template: ProgTemplate): ScaleName {
  // the key has to agree with the progression's tonic chord (major vs minor), and then with its notes: a IV13 in
  // minor makes it dorian, a bVI aeolian, a maj7 tonic rules out mixolydian, a #11 makes it lydian
  const tonicMinor = templateIsMinor(template);
  const rel = progressionPcs(template);
  // the tonic chord defines the key far more than a passing chord does: its clashes count triple
  const tonicRel = progressionPcs(template.filter(([off]) => off === 0));
  const cost = (s: ScaleName): number => scaleConflicts(s, rel) + 2 * scaleConflicts(s, tonicRel);
  let fitting = mood.scales.filter((s) => isMinorScale(s) === tonicMinor);
  if (!fitting.length) fitting = ALL_SCALES.filter((s) => isMinorScale(s) === tonicMinor);
  const best = Math.min(...fitting.map(cost));
  return pick(rng, fitting.filter((s) => cost(s) === best));
}

const ALL_SCALES: readonly ScaleName[] = ['ionian', 'dorian', 'aeolian', 'lydian', 'mixolydian'];

const DOMINANT = new Set<ChordQuality>(['7', '9', '13', '7b9', '7#9']);
/** A sideways step in colour (not up or down the "jazz" chain): a ninth here, an eleventh there. */
const ALT_COLOUR: Partial<Record<ChordQuality, ChordQuality>> = {
  m7: 'm9', m9: 'm11', maj7: 'maj9', maj9: '6/9', '9': '13', '7b9': '7#9',
};

/**
 * Per-song reharmonisation, so the same progression rarely sounds the same twice: tritone substitutions for
 * dominants (V7 -> bII7), recoloured chords and, sometimes, an AB loop that plays the progression twice with a
 * ii-V turnaround the second time. The tonic chord is never replaced.
 */
export function varyTemplate(rng: Rng, template: ProgTemplate, minor: boolean, allowDouble: boolean): ProgTemplate {
  let steps: ProgStep[] = template.map(([off, q]): ProgStep => {
    if (off !== 0 && DOMINANT.has(q) && chance(rng, 0.2)) return [mod12(off + 6), q === '13' ? '13' : '9'];
    const alt = ALT_COLOUR[q];
    if (alt && chance(rng, 0.15)) return [off, alt];
    return [off, q];
  });
  const endsOnTurnaround = template[2]?.[0] === 2 && template[3]?.[0] === 7;
  if (allowDouble && steps.length === 4 && !endsOnTurnaround && chance(rng, 0.3)) {
    const turnaround: ProgStep[] = minor ? [[2, 'm7b5'], [7, '7b9']] : [[2, 'm9'], [7, '13']];
    steps = [...steps, ...steps.slice(0, 2), ...turnaround];
  }
  return steps;
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

/** How likely each arrangement is per beat station (the ambient station has its own). */
const ARRANGEMENTS: Record<Exclude<MoodId, 'drift'>, Weights<Arrangement>> = {
  study: [['classic', 3], ['beattape', 3], ['aaba', 2], ['sketch', 2], ['coldopen', 2], ['jam', 1]],
  rainy: [['classic', 3], ['aaba', 2], ['beattape', 2], ['sketch', 2], ['coldopen', 1]],
  sunday: [['classic', 3], ['aaba', 3], ['jam', 2], ['beattape', 2], ['coldopen', 1], ['sketch', 1]],
};

function planBeatSections(
  rng: Rng, mood: MoodConfig, loop: number, bridgeLoop: number, energy: number, soloist: Soloist, arrangement: Arrangement,
): RawSection[] {
  const pad = (): LayerId[] => (chance(rng, mood.padInGroove) ? ['pad'] : []);
  const maybe = (p: number, l: LayerId): LayerId[] => (chance(rng, p) ? [l] : []);
  const both = Math.max(loop, bridgeLoop);
  const full: LayerId[] = ['keys', 'bass', 'drums', 'texture'];
  const soloLayers = (): LayerId[] => [...full, ...(soloist === 'lead' ? ['melody' as LayerId] : []), ...maybe(0.3, 'pad')];
  switch (arrangement) {
    case 'beattape':
      // a loop that drops in, a hook on top, the drums cut for a breakdown, then the drop again
      return [
        sec('Intro', fit(4, loop), 0.25, ['keys', 'texture', ...maybe(0.5, 'drums')]),
        sec('Drop', fit(8, loop), 0.7, [...full, ...pad()]),
        sec('Hook', fit(8, loop), 0.75, [...full, 'melody', ...pad()]),
        sec('Break', fit(chance(rng, 0.5) ? 4 : 8, loop), 0.3, ['keys', 'pad', 'texture', ...maybe(0.5, 'melody')]),
        sec('Drop', fit(8, loop), 0.8, [...full, ...maybe(0.5, 'melody'), ...pad()]),
        sec('Hook', fit(8, loop), 0.75, [...full, 'melody', ...pad()]),
        sec('Outro', fit(4, loop), 0.2, ['keys', 'texture', ...maybe(0.6, 'drums')]),
      ];
    case 'aaba':
      // song form: theme, theme again with more around it, somewhere else, home
      return [
        sec('Intro', fit(4, loop), 0.2, ['keys', 'texture', ...maybe(0.4, 'pad')]),
        sec('Theme', fit(8, loop), 0.6, [...full, 'melody', ...pad()]),
        sec('Theme', fit(8, loop), 0.7, [...full, 'melody', 'pad']),
        sec('Bridge', fit(8, both), 0.55, ['keys', 'bass', 'pad', 'texture', ...maybe(0.7, 'drums'), ...maybe(0.4, 'melody')], 'bridge'),
        sec('Theme', fit(8, loop), 0.7, [...full, 'melody', ...pad()]),
        sec('Outro', fit(4, loop), 0.2, ['keys', 'pad', 'texture']),
      ];
    case 'sketch':
      // a 90-second beat-tape idea that never outstays its welcome
      return [
        sec('Intro', fit(4, loop), 0.25, ['keys', 'texture']),
        sec('Groove', fit(8, loop), 0.55, [...full, ...pad()]),
        sec('Theme', fit(8, loop), 0.65, [...full, 'melody', ...pad()]),
        sec('Outro', fit(4, loop), 0.25, ['keys', 'texture', ...maybe(0.5, 'drums')]),
      ];
    case 'jam':
      // the band stretches out: a long solo, a breather, another chorus
      return [
        sec('Intro', fit(4, loop), 0.2, ['keys', 'texture', ...maybe(0.5, 'drums')]),
        sec('Groove', fit(8, loop), 0.55, [...full, ...pad()]),
        sec('Theme', fit(8, loop), 0.65, [...full, 'melody', ...pad()]),
        sec('Solo', fit(16, loop), 0.8, soloLayers()),
        sec('Break', fit(4, loop), 0.35, ['keys', 'bass', 'texture', ...maybe(0.5, 'pad')]),
        sec('Theme', fit(8, loop), 0.75, [...full, 'melody', ...pad()]),
        sec('Outro', fit(4, loop), 0.2, ['keys', 'pad', 'texture']),
      ];
    case 'coldopen':
      // the beat starts on its own, the sample fades in over it; ends on the drums alone
      return [
        sec('Intro', fit(4, loop), 0.4, ['drums', 'texture', ...maybe(0.5, 'bass')]),
        sec('Groove', fit(8, loop), 0.6, [...full, ...pad()]),
        sec('Theme', fit(8, loop), 0.7, [...full, 'melody', ...pad()]),
        chance(rng, 0.5)
          ? sec('Bridge', fit(8, both), 0.55, ['keys', 'bass', 'pad', 'texture', 'drums'], 'bridge')
          : sec('Break', fit(4, loop), 0.3, ['keys', 'pad', 'texture', ...maybe(0.5, 'melody')]),
        sec('Hook', fit(8, loop), 0.75, [...full, 'melody', ...pad()]),
        sec('Outro', fit(4, loop), 0.3, ['drums', 'texture', ...maybe(0.5, 'keys')]),
      ];
    default:
      return planClassicSections(rng, loop, energy, soloist, pad, maybe, both);
  }
}

function planClassicSections(
  rng: Rng, loop: number, energy: number, soloist: Soloist,
  pad: () => LayerId[], maybe: (p: number, l: LayerId) => LayerId[], both: number,
): RawSection[] {
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

/** Pick from `items`, re-drawing a few times while it repeats `avoid`. */
function pickNot<T>(rng: Rng, items: readonly T[], avoid: T | undefined): T {
  let out = pick(rng, items);
  for (let i = 0; i < 4 && avoid !== undefined && out === avoid; i++) out = pick(rng, items);
  return out;
}

/** Plan song `index`. `prev` (the song before it) is used to keep consecutive songs clearly apart. */
export function planSong(seed: number, index: number, startBar: number, params: GenerationParams, prev?: SongPlan): SongPlan {
  const mood = MOODS[params.mood];
  const rng = stream(seed, 'song', index, params.mood);
  const baseTemplate = pickNot(rng, mood.progressions, prev?.baseTemplate);
  const scale = pickScale(rng, mood, baseTemplate);
  const minor = isMinorScale(scale);
  // successive songs move by a 4th/5th or a step most of the time, like a playlist that "flows"
  const tonic = prev
    ? mod12(prev.key.tonic + weightedPick(rng, [[5, 3], [7, 3], [2, 2], [-2, 2], [3, 1], [-3, 1]] as const))
    : int(rng, 0, 11);
  const key: KeySpec = { tonic, scale };
  const chordBars = baseTemplate.length <= 2 ? Math.max(2, weightedPick(rng, mood.chordBars)) * (mood.ambient ? 2 : 1) : weightedPick(rng, mood.chordBars);
  const template = varyTemplate(stream(seed, 'reharm', index), baseTemplate, minor, chordBars === 1 && !mood.ambient);
  const bridgeTemplate = varyTemplate(stream(seed, 'reharm-bridge', index), pick(rng, mood.bridges), minor, false);
  const bridgeChordBars = bridgeTemplate.length <= 2 ? (mood.ambient ? 4 : 2) : mood.ambient ? 2 : 1;
  const [tLo, tHi] = mood.tempo;
  // a new song should feel like a new song: at least a few BPM away from the last one
  let tempo = int(rng, tLo, tHi);
  for (let i = 0; i < 6 && prev && Math.abs(tempo - prev.tempo) < 5; i++) tempo = int(rng, tLo, tHi);
  const style = pickStyle(stream(seed, 'style', index, params.mood), mood, prev?.style);
  if (!mood.ambient) {
    const arr = ARRANGEMENTS[params.mood as Exclude<MoodId, 'drift'>] ?? ARRANGEMENTS.study;
    style.arrangement = weightedPick(stream(seed, 'arrangement', index), arr);
    if (prev && style.arrangement === prev.style.arrangement) style.arrangement = weightedPick(stream(seed, 'arrangement', index, 1), arr);
  } else {
    style.arrangement = 'ambient';
  }

  const loop = templateBars(template, chordBars);
  const bridgeLoop = templateBars(bridgeTemplate, bridgeChordBars);
  const raw = mood.ambient
    ? planAmbientSections(rng, loop, bridgeLoop, params.energy)
    : planBeatSections(rng, mood, loop, bridgeLoop, params.energy, style.soloist, style.arrangement);
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
    baseTemplate,
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
      this.songs.push(planSong(this.seed, last ? last.index + 1 : 0, last ? songEnd(last) : 0, params, last));
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
