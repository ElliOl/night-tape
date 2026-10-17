import { create } from 'zustand';
import { useStore } from '../services/store';
import { tryGetController } from '../services/controller';

export interface Notice {
  kind: 'info' | 'error';
  text: string;
  id: number;
}

interface UiState {
  notice: Notice | null;
  notify(kind: Notice['kind'], text: string): void;
  dismiss(): void;
}

let counter = 0;

export const useUiState = create<UiState>((set) => ({
  notice: null,
  notify: (kind, text) => set({ notice: { kind, text, id: ++counter } }),
  dismiss: () => set({ notice: null }),
}));

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function togglePlayback(): Promise<void> {
  const c = tryGetController();
  if (!c) return;
  try {
    if (useStore.getState().playing) c.pause();
    else await c.play();
  } catch (e) {
    useUiState.getState().notify('error', `Playback failed: ${errorMessage(e)}`);
  }
}

export const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff) >>> 0;

/** New seed = a whole new tape (fades out, restarts the composition). */
export async function nextTape(): Promise<void> {
  const c = tryGetController();
  if (!c) return;
  try {
    await c.regenerate(randomSeed());
  } catch (e) {
    useUiState.getState().notify('error', `Could not start a new tape: ${errorMessage(e)}`);
  }
}
