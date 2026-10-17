import { useEffect, useState } from 'react';
import { useStore } from '../services/store';
import { tryGetController } from '../services/controller';
import { Deck } from './Deck';
import { ChaosPanel, FilterPanel, GroovePanel, MixerPanel, StationPanel, TapeInfo, TapePanel } from './Panels';
import { Scene } from './Scene';
import { WildCatOverlay } from './WildCatOverlay';
import { errorMessage, nextTape, togglePlayback, useUiState } from './uiState';

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/** Space: play/pause. N: new tape. (Not while typing or with a button focused for Space.) */
function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !useStore.getState().audioReady || isTyping(e.target)) return;
      if (e.code === 'Space') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'BUTTON' || (e.target as HTMLElement | null)?.getAttribute('role') === 'slider') return;
        e.preventDefault();
        void togglePlayback();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void nextTape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Toast() {
  const notice = useUiState((s) => s.notice);
  const dismiss = useUiState((s) => s.dismiss);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, notice.kind === 'error' ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  if (!notice) return null;
  return (
    <div className={`toast toast--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} onClick={dismiss}>
      {notice.text}
    </div>
  );
}

function StartOverlay() {
  const audioReady = useStore((s) => s.audioReady);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (audioReady) return null;

  const begin = async () => {
    if (starting) return;
    setError(null);
    const c = tryGetController();
    if (!c) return setError('Audio engine is not ready yet. Try again in a moment.');
    setStarting(true);
    try {
      await c.play(); // must run inside this click
    } catch (e) {
      setError(`Could not start audio: ${errorMessage(e)}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="overlay-title">
      <div className="overlay__card">
        <div className="overlay__logo" id="overlay-title">
          NIGHT<span> TAPE</span>
        </div>
        <p className="overlay__tagline">endless lo-fi &amp; ambient, written as you listen</p>
        <button type="button" className="btn btn--play btn--big" onClick={() => void begin()} disabled={starting} autoFocus>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
          <span>{starting ? 'warming up the tape...' : 'Press play'}</span>
        </button>
        {error && <p className="overlay__error" role="alert">{error}</p>}
        <p className="overlay__hint">headphones recommended · <kbd>Space</kbd> play/pause · <kbd>N</kbd> new tape</p>
      </div>
    </div>
  );
}

export function App() {
  useHotkeys();
  return (
    <div className="app">
      <StartOverlay />
      <header className="header">
        <div>
          <div className="header__logo">NIGHT<span> TAPE</span></div>
          <div className="header__sub">lo-fi / ambient generator</div>
        </div>
        <div className="header__hint">
          <kbd>Space</kbd> play · <kbd>N</kbd> new tape
        </div>
      </header>
      <main className="main">
        <div className="hero">
          <Scene />
        </div>
        <Deck />
        <div className="grid">
          <StationPanel />
          <GroovePanel />
          <FilterPanel />
          <TapePanel />
          <ChaosPanel />
          <MixerPanel />
          <TapeInfo />
        </div>
      </main>
      <footer className="footer">every song is composed in your browser from the seed · nothing is sampled</footer>
      <WildCatOverlay />
      <Toast />
    </div>
  );
}
