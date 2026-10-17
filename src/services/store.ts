import { create } from 'zustand';
import {
  DEFAULT_MIXER, DEFAULT_PARAMS, DEFAULT_TAPE,
  type GenerationParams, type LayerId, type MixerParams, type TapeParams,
} from '@shared/index';

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
}

export interface HistoryEntry {
  index: number;
  title: string;
  keyLabel: string;
}

export interface AppState {
  params: GenerationParams;
  mixer: MixerParams;
  tape: TapeParams;
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
  setMuted(layer: LayerId, muted: boolean): void;
  replaceAll(params: GenerationParams, mixer: MixerParams, tape: TapeParams): void;
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
};

export const useStore = create<AppState>((set) => ({
  params: { ...DEFAULT_PARAMS },
  mixer: { ...DEFAULT_MIXER },
  tape: { ...DEFAULT_TAPE },
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
  setMuted: (layer, muted) => set((s) => ({ muted: { ...s.muted, [layer]: muted } })),
  replaceAll: (params, mixer, tape) => set({ params: { ...params }, mixer: { ...mixer }, tape: { ...tape } }),
  setAudioReady: (audioReady) => set({ audioReady }),
  setPlaying: (playing) => set({ playing }),
  setBusy: (busy) => set({ busy }),
  setExporting: (exporting) => set({ exporting }),
  setNow: (n) => set((s) => ({ now: { ...s.now, ...n } })),
  pushHistory: (e) =>
    set((s) => (s.history[0]?.index === e.index && s.history[0]?.title === e.title ? s : { history: [e, ...s.history].slice(0, 6) })),
  clearHistory: () => set({ history: [] }),
}));
