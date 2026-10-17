import { create } from 'zustand';
import {
  DEFAULT_CHAOS, DEFAULT_MIXER, DEFAULT_PARAMS, DEFAULT_TAPE,
  type ChaosParams, type FilterMode, type GenerationParams, type LayerId, type MixerParams, type SoundPalette, type TapeParams,
} from '@shared/index';
import type { ModOffsets } from './effective';

/** Live read-out written by the Conductor, read by the UI. */
export interface NowPlaying {
  bar: number;
  beatInBar: number;
  keyLabel: string;
  tempo: number;
  chordLabel: string;
  sectionName: string;
  songTitle: string;
  songIndex: number;
  /** absolute bar where the current song started */
  songStartBar: number;
  palette: SoundPalette | null;
  groove: string;
}

export interface HistoryEntry {
  index: number;
  title: string;
  keyLabel: string;
  /** e.g. "Rhodes · half-time" */
  sound?: string;
}

export interface AppState {
  params: GenerationParams;
  mixer: MixerParams;
  tape: TapeParams;
  filterMode: FilterMode;
  chaos: ChaosParams;
  /** live chaos offsets per target (not persisted) */
  mod: ModOffsets;
  /** layers the wild cat has muted (not persisted; separate from the user's mutes) */
  catMuted: Partial<Record<LayerId, boolean>>;
  muted: Partial<Record<LayerId, boolean>>;
  audioReady: boolean;
  playing: boolean;
  /** regenerating */
  busy: boolean;
  exporting: boolean;
  now: NowPlaying;
  /** most recent songs first */
  history: HistoryEntry[];

  setParams(p: Partial<GenerationParams>): void;
  setMixerLevel(k: LayerId | 'master', v: number): void;
  setTape(t: Partial<TapeParams>): void;
  setFilterMode(m: FilterMode): void;
  setChaos(c: Partial<ChaosParams>): void;
  setMod(m: ModOffsets): void;
  setCatMuted(layer: LayerId, muted: boolean): void;
  clearCatMuted(): void;
  setMuted(layer: LayerId, muted: boolean): void;
  replaceAll(params: GenerationParams, mixer: MixerParams, tape: TapeParams, chaos?: ChaosParams, filterMode?: FilterMode): void;
  setAudioReady(v: boolean): void;
  setPlaying(v: boolean): void;
  setBusy(v: boolean): void;
  setExporting(v: boolean): void;
  setNow(n: Partial<NowPlaying>): void;
  pushHistory(e: HistoryEntry): void;
  clearHistory(): void;
}

export const INITIAL_NOW: NowPlaying = {
  bar: 0,
  beatInBar: 0,
  keyLabel: '-',
  tempo: 0,
  chordLabel: '-',
  sectionName: '-',
  songTitle: '',
  songIndex: -1,
  songStartBar: 0,
  palette: null,
  groove: '',
};

export const useStore = create<AppState>((set) => ({
  params: { ...DEFAULT_PARAMS },
  mixer: { ...DEFAULT_MIXER },
  tape: { ...DEFAULT_TAPE },
  filterMode: 'lowpass',
  chaos: { ...DEFAULT_CHAOS },
  mod: {},
  catMuted: {},
  muted: {},
  audioReady: false,
  playing: false,
  busy: false,
  exporting: false,
  now: { ...INITIAL_NOW },
  history: [],

  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setMixerLevel: (k, v) => set((s) => ({ mixer: { ...s.mixer, [k]: v } })),
  setTape: (t) => set((s) => ({ tape: { ...s.tape, ...t } })),
  setFilterMode: (filterMode) => set({ filterMode }),
  setChaos: (c) => set((s) => ({ chaos: { ...s.chaos, ...c } })),
  setMod: (mod) => set({ mod }),
  setCatMuted: (layer, muted) => set((s) => ({ catMuted: { ...s.catMuted, [layer]: muted } })),
  clearCatMuted: () => set({ catMuted: {} }),
  setMuted: (layer, muted) => set((s) => ({ muted: { ...s.muted, [layer]: muted } })),
  replaceAll: (params, mixer, tape, chaos, filterMode) =>
    set((s) => ({
      params: { ...params },
      mixer: { ...mixer },
      tape: { ...tape },
      chaos: chaos ? { ...chaos } : s.chaos,
      filterMode: filterMode ?? s.filterMode,
    })),
  setAudioReady: (audioReady) => set({ audioReady }),
  setPlaying: (playing) => set({ playing }),
  setBusy: (busy) => set({ busy }),
  setExporting: (exporting) => set({ exporting }),
  setNow: (n) => set((s) => ({ now: { ...s.now, ...n } })),
  pushHistory: (e) =>
    set((s) => (s.history[0]?.index === e.index && s.history[0]?.title === e.title ? s : { history: [e, ...s.history].slice(0, 6) })),
  clearHistory: () => set({ history: [] }),
}));
