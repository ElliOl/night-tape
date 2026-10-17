/**
 * The wild cat's decisions. Pure logic (no timers, no audio): given the bar that just started, what the conductor has
 * already composed for the next ~2 bars, and the chaos LFO's state + derivative, decide what the cat does next.
 *
 * Nothing here is dice-rolled: the cat acts when the attractor "lurches" (a large derivative), and *what* it does is
 * read from the direction of that lurch and from where we are in the arrangement, so its moves land musically:
 *  - drop:     drums (and maybe bass) out for the bar before a new section, back on its downbeat
 *  - breathe:  keys (or bass / pad) out for a phrase-sized moment
 *  - stop:     one bar of stop-time drums in a solo
 *  - acid:     2-4 bars of 303-style filter squelch, at most once per song, from a 4-bar boundary
 *  - station:  after a few songs, a new station, decided as the current song reaches its outro
 */
import type { LayerId, MoodId } from '@shared/index';
import { MOOD_IDS } from '@shared/index';

export interface BarInfo {
  /** absolute bar that just started */
  bar: number;
  sectionName: string;
  songIndex: number;
  mood: MoodId;
  /** section starts already composed (beats are absolute) */
  upcoming: ReadonlyArray<{ beat: number; name: string; songIndex: number }>;
  /** chaos LFO state and derivative (each roughly -1..1) */
  state: readonly [number, number, number];
  deriv: readonly [number, number, number];
  /** wildness 0..1: 1 = follows every swing of the LFO, lower = only big ones, less often */
  amount: number;
}

export type WildPlan =
  | { kind: 'mute'; layers: LayerId[]; fromBeat: number; toBeat: number; reason: 'drop' | 'breathe' | 'stop' }
  | { kind: 'acid'; fromBeat: number; bars: number; accents: boolean[]; intensity: number }
  | { kind: 'station'; mood: MoodId; atBeat: number };

const GROOVY = new Set(['Groove', 'Theme', 'Solo', 'Tide', 'Float', 'Bridge']);
const FINAL = new Set(['Outro', 'Dusk']);

export class WildBrain {
  private lastActionBar = -1000;
  private lastSong = -1;
  private songsSinceStation = 0;
  private stationAfter = 3;
  private stationDoneForSong = -1;
  private acidSong = -1;
  /** the layer of the last breathe/stop mute: the cat does not repeat itself */
  private lastMute: LayerId | null = null;

  reset(): void {
    this.lastMute = null;
    this.lastActionBar = -1000;
    this.lastSong = -1;
    this.songsSinceStation = 0;
    this.stationAfter = 3;
    this.stationDoneForSong = -1;
    this.acidSong = -1;
  }

  /** How many songs the cat lets play before it changes station (2..5), read from the attractor. */
  static stationDelay(state: readonly number[]): number {
    return 2 + Math.min(3, Math.floor(((state[2]! + 1) / 2) * 4));
  }

  onBar(info: BarInfo): WildPlan | null {
    const { bar, state, deriv } = info;
    if (info.songIndex !== this.lastSong) {
      if (this.lastSong >= 0) this.songsSinceStation++;
      this.lastSong = info.songIndex;
    }
    const amount = Math.min(1, Math.max(0, info.amount));
    if (amount <= 0.01) return null;

    const lurch = Math.max(Math.abs(deriv[0]), Math.abs(deriv[1]), Math.abs(deriv[2]));
    // at full wildness the cat answers almost every lurch of the attractor (1:1); turned down it needs big ones
    const threshold = 0.1 + 0.75 * (1 - amount);
    // bars between moves: 2 when fully wild, up to 12 when tame
    const cooldown = Math.round(2 + 10 * (1 - amount));
    const rested = bar - this.lastActionBar >= cooldown;
    const next = (bar + 1) * 4; // the cat always acts from the next downbeat
    const section = info.sectionName;
    const plan = (p: WildPlan): WildPlan => {
      this.lastActionBar = bar;
      return p;
    };

    // ---- station: after a few songs, decided as the song reaches its outro (the next song is in the new style)
    if (
      FINAL.has(section) &&
      this.songsSinceStation >= this.stationAfter &&
      this.stationDoneForSong !== info.songIndex
    ) {
      const others = MOOD_IDS.filter((m) => m !== info.mood);
      const pickIdx = Math.min(others.length - 1, Math.floor(((state[0] + 1) / 2) * others.length));
      this.stationDoneForSong = info.songIndex;
      this.songsSinceStation = 0;
      // a tamer cat lets more songs play before it changes station again
      this.stationAfter = WildBrain.stationDelay(state) + Math.round((1 - amount) * 3);
      return plan({ kind: 'station', mood: others[pickIdx]!, atBeat: next });
    }
    if (!rested) return null;

    // the next section boundary we can already see (if any), so moves never smear across it
    const boundary = info.upcoming.find((u) => u.beat > next + 0.01 && u.name !== section)?.beat;
    const until = (bars: number): number => Math.min(next + bars * 4, boundary ?? Infinity);

    // ---- drop: the bar before a new section, drums out, back on the downbeat
    if (GROOVY.has(section) && boundary === next + 4 && lurch > threshold * 0.8) {
      const layers: LayerId[] = deriv[1] > 0.2 ? ['drums', 'bass'] : ['drums'];
      return plan({ kind: 'mute', layers, fromBeat: next, toBeat: boundary, reason: 'drop' });
    }

    if (lurch <= threshold) return null;
    const phraseStart = (bar + 1) % 4 === 0;

    // ---- acid: once per song, from a 4-bar boundary in a section with a groove
    if (phraseStart && (section === 'Groove' || section === 'Theme' || section === 'Solo' || section === 'Tide') &&
      this.acidSong !== info.songIndex && Math.abs(deriv[2]) >= Math.abs(deriv[0]) * 0.8) {
      this.acidSong = info.songIndex;
      const bars = amount > 0.55 && deriv[0] > 0 ? 4 : 2;
      // accent pattern read from the attractor: same lurch, same riff
      const accents = Array.from({ length: 16 }, (_, i) => Math.sin((i + 1) * (state[0] * 7 + 3.1) + state[1] * 5) > 0.35);
      accents[0] = true;
      const fit = boundary !== undefined ? Math.max(1, Math.floor((boundary - next) / 4)) : bars;
      return plan({ kind: 'acid', fromBeat: next, bars: Math.min(bars, fit), accents, intensity: 0.4 + 0.6 * amount });
    }

    // ---- breathe / stop: phrase-sized mutes chosen by the arrangement and the lurch direction
    if (!phraseStart) return null;
    type Move = [layer: LayerId, bars: number, reason: 'breathe' | 'stop'];
    // [preferred, alternative] per section; the lurch direction picks one, the alternative avoids repeating the last move
    const choose = (up: boolean, a: Move, b: Move): WildPlan | null => {
      let [layer, bars, reason] = up ? a : b;
      if (layer === this.lastMute) [layer, bars, reason] = up ? b : a;
      if (layer === this.lastMute) return null;
      const to = until(bars);
      if (to <= next) return null;
      this.lastMute = layer;
      return plan({ kind: 'mute', layers: [layer], fromBeat: next, toBeat: to, reason });
    };
    switch (section) {
      case 'Theme':
        return choose(deriv[0] > 0, ['keys', 2, 'breathe'], ['bass', 2, 'breathe']);
      case 'Groove':
        return choose(deriv[1] > 0, ['keys', 2, 'breathe'], ['bass', 1, 'breathe']);
      case 'Solo':
        return choose(deriv[2] > 0, ['drums', 1, 'stop'], ['pad', 2, 'breathe']);
      case 'Bridge':
        return choose(deriv[0] > 0, ['drums', 1, 'stop'], ['keys', 2, 'breathe']);
      case 'Float':
      case 'Tide':
        return choose(deriv[0] > 0, ['pad', 2, 'breathe'], ['keys', 2, 'breathe']);
      default:
        return null; // intros, breaks and outros are left alone
    }
  }
}
