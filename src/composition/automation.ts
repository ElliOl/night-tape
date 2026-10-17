/** Section- and song-level automation: filter sweeps, reverb swells, tape-fade transitions between songs. */
import type { AutomationEvent, AutomationTarget } from '@shared/index';
import { barStart, BEATS_PER_BAR, type BarContext } from './layers/context';

const QUIET = new Set(['Intro', 'Break', 'Outro', 'Dawn', 'Dusk']);

function auto(target: AutomationTarget, beat: number, value: number, rampBeats = 0): AutomationEvent {
  return { kind: 'automation', target, beat, value, rampBeats };
}

export function renderAutomation(ctx: BarContext): AutomationEvent[] {
  const out: AutomationEvent[] = [];
  const b = barStart(ctx);
  const sec = ctx.section;
  const secBeats = sec.bars * BEATS_PER_BAR;

  if (ctx.inSection === 0) {
    switch (sec.name) {
      case 'Intro':
      case 'Dawn':
        out.push(auto('filter.keys', b, 0.3), auto('filter.keys', b + 0.02, 0.72, secBeats));
        break;
      case 'Outro':
      case 'Dusk':
        out.push(auto('filter.keys', b, 0.72), auto('filter.keys', b + 0.02, 0.3, secBeats));
        break;
      case 'Break':
        out.push(auto('filter.keys', b, 0.5, 2));
        break;
      default:
        out.push(auto('filter.keys', b, 0.75, 4));
    }
    out.push(auto('send.reverb', b, QUIET.has(sec.name) ? 0.75 : 0.5, 4));
    out.push(auto('layer.gain.texture', b, QUIET.has(sec.name) ? 1 : 0.8, 4));
  }

  // tape-fade between songs: close the master filter over the last two bars, open it over the first two
  if (ctx.rel === 0) {
    out.push(auto('master.filter', b, 0.3), auto('master.filter', b + 0.02, 1, ctx.song.index === 0 ? 12 : 7));
  }
  if (ctx.rel === ctx.song.lengthBars - 2) {
    out.push(auto('master.filter', b, 1), auto('master.filter', b + 0.02, 0.3, 2 * BEATS_PER_BAR - 0.1));
  }
  return out;
}
