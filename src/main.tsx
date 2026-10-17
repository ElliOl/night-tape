import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from './services/store';
import { loadLast, startPersistence } from './services/persist';
import { setController } from './services/controller';
import { startModulator } from './services/modulator';
import { setVisualizerSource } from './ui/visualizerSource';
import { createRenderer } from './audio/toneRenderer';
import { Conductor } from './engine/conductor';
import { LocalEngine } from './engine/localEngine';
import { App } from './ui/App';
import './styles/global.css';

// Restore last-used settings (validated + clamped) before anything subscribes to the store.
const last = loadLast();
if (last) useStore.getState().replaceAll(last.params, last.mixer, last.tape, last.chaos, last.filterMode);

const persistence = startPersistence(useStore);
window.addEventListener('pagehide', () => persistence.flush());

// composer -> Conductor -> Tone.js renderer. The UI only sees the controller + store.
const renderer = createRenderer();
const conductor = new Conductor(renderer, () => new LocalEngine());
setController(conductor);
startModulator();
setVisualizerSource({ getSpectrum: () => renderer.getSpectrum(), getLevel: () => renderer.getLevel() });
// dev-console helpers
Object.assign(window as unknown as Record<string, unknown>, { nightTape: { conductor, renderer, store: useStore } });

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
