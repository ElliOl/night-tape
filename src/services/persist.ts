/**
 * Last-used settings persistence. Pure validate/clamp logic is unit-tested; storage is injected
 * (default: localStorage when available, never required).
 */
import {
  DEFAULT_CHAOS, DEFAULT_MIXER, DEFAULT_PARAMS, DEFAULT_TAPE, FILTER_MODES, LAYER_IDS, MOOD_IDS,
  type ChaosParams, type FilterMode, type GenerationParams, type MixerParams, type MoodId, type TapeParams,
} from '@shared/index';
import { TEMPO_MAX, TEMPO_MIN } from '../engine/localEngine';

export const LAST_KEY = 'night-tape:last:v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const unit = (raw: unknown, fallback: number): number => (isNum(raw) ? clamp(raw, 0, 1) : fallback);
const isMood = (v: unknown): v is MoodId => typeof v === 'string' && (MOOD_IDS as readonly string[]).includes(v);

export function sanitizeParams(raw: unknown): GenerationParams {
  const f = DEFAULT_PARAMS;
  if (!isRecord(raw)) return { ...f };
  return {
    mood: isMood(raw.mood) ? raw.mood : f.mood,
    energy: unit(raw.energy, f.energy),
    complexity: unit(raw.complexity, f.complexity),
    variation: unit(raw.variation, f.variation),
    swing: unit(raw.swing, f.swing),
    tempo: raw.tempo === null ? null : isNum(raw.tempo) ? Math.round(clamp(raw.tempo, TEMPO_MIN, TEMPO_MAX)) : f.tempo,
    seed: isNum(raw.seed) ? Math.trunc(raw.seed) >>> 0 : f.seed,
  };
}

export function sanitizeMixer(raw: unknown): MixerParams {
  const out = { ...DEFAULT_MIXER };
  if (!isRecord(raw)) return out;
  for (const id of LAYER_IDS) out[id] = unit(raw[id], DEFAULT_MIXER[id]);
  out.master = unit(raw.master, DEFAULT_MIXER.master);
  return out;
}

export function sanitizeTape(raw: unknown): TapeParams {
  const out = { ...DEFAULT_TAPE };
  if (!isRecord(raw)) return out;
  for (const k of Object.keys(DEFAULT_TAPE) as Array<keyof TapeParams>) out[k] = unit(raw[k], DEFAULT_TAPE[k]);
  return out;
}

export function sanitizeChaos(raw: unknown): ChaosParams {
  const f = DEFAULT_CHAOS;
  if (!isRecord(raw)) return { ...f };
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  return {
    amount: unit(raw.amount, f.amount),
    rate: unit(raw.rate, f.rate),
    filter: bool(raw.filter, f.filter),
    tape: bool(raw.tape, f.tape),
    groove: bool(raw.groove, f.groove),
    // older saves had an on/off switch: "off" means wildness 0
    wildness: raw.wild === false ? 0 : unit(raw.wildness, f.wildness),
  };
}

export const sanitizeFilterMode = (raw: unknown): FilterMode =>
  typeof raw === 'string' && (FILTER_MODES as readonly string[]).includes(raw) ? (raw as FilterMode) : 'lowpass';

export interface Saved {
  params: GenerationParams;
  mixer: MixerParams;
  tape: TapeParams;
  chaos: ChaosParams;
  filterMode: FilterMode;
}

export function loadLast(storage: StorageLike | null = defaultStorage()): Saved | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return null;
    return {
      params: sanitizeParams(data.params),
      mixer: sanitizeMixer(data.mixer),
      tape: sanitizeTape(data.tape),
      chaos: sanitizeChaos(data.chaos),
      filterMode: sanitizeFilterMode(data.filterMode),
    };
  } catch {
    return null;
  }
}

export function saveLast(saved: Saved, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_KEY, JSON.stringify(saved));
  } catch {
    // quota / privacy mode: persistence is best effort
  }
}

interface Subscribable<S extends Saved> {
  getState(): S;
  subscribe(fn: (s: S, prev: S) => void): () => void;
}

/** Debounced (500 ms) persistence of params/mixer/tape. Returns flush() for pagehide. */
export function startPersistence<S extends Saved>(store: Subscribable<S>, storage: StorageLike | null = defaultStorage()): { flush(): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = (): void => {
    timer = null;
    const s = store.getState();
    saveLast({ params: s.params, mixer: s.mixer, tape: s.tape, chaos: s.chaos, filterMode: s.filterMode }, storage);
  };
  const unsub = store.subscribe((s, prev) => {
    if (s.params === prev.params && s.mixer === prev.mixer && s.tape === prev.tape && s.chaos === prev.chaos && s.filterMode === prev.filterMode) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, 500);
  });
  return {
    flush: () => {
      if (timer) {
        clearTimeout(timer);
        write();
      }
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      unsub();
    },
  };
}
