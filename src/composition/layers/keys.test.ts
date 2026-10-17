import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type GenerationParams, type NoteEvent } from '@shared/index';
import { Form, songEnd, type SongPlan } from '../form';
import { makeContext } from './context';
import { renderKeys, sectionArticulation, type Articulation } from './keys';

const QUIET = new Set(['Intro', 'Break', 'Outro']);
const DRIVING = new Set(['Groove', 'Drop', 'Hook']);

interface SectionRender {
  song: SongPlan;
  name: string;
  melody: boolean;
  art: Articulation;
  notes: NoteEvent[];
}

/** Render the keys of every section of the first `count` songs of a tape. */
function renderSections(seed: number, count: number, params: GenerationParams = { ...DEFAULT_PARAMS, seed }): SectionRender[] {
  const form = new Form(seed);
  const cache = new Map<string, unknown>();
  const out: SectionRender[] = [];
  let bar = 0;
  for (let i = 0; i < count; i++) {
    const song = form.songForBar(bar, params);
    for (const sec of song.sections) {
      if (!sec.layers.keys || sec.name === 'Solo') continue;
      const notes: NoteEvent[] = [];
      let art: Articulation = 'comp';
      for (let b = 0; b < sec.bars; b++) {
        const ctx = makeContext(seed, song, song.startBar + sec.startBar + b, params, cache);
        art = sectionArticulation(ctx);
        notes.push(...renderKeys(ctx));
      }
      out.push({ song, name: sec.name, melody: sec.layers.melody, art, notes });
    }
    bar = songEnd(song);
  }
  return out;
}

describe('keys articulation', () => {
  const all = [1, 2, 3, 4].flatMap((seed) => renderSections(seed, 12));

  it('uses every articulation over a session', () => {
    const seen = new Set(all.map((s) => s.art));
    for (const a of ['comp', 'stab', 'ring', 'shell', 'single']) expect(seen.has(a as Articulation)).toBe(true);
  });

  it('follows what the section is doing', () => {
    const share = (set: Set<string>, arts: Articulation[]) => {
      const secs = all.filter((s) => set.has(s.name));
      return secs.filter((s) => arts.includes(s.art)).length / secs.length;
    };
    // quiet parts mostly hang or thin out; driving parts mostly comp or stab
    expect(share(QUIET, ['ring', 'single', 'shell'])).toBeGreaterThan(0.6);
    expect(share(DRIVING, ['comp', 'stab'])).toBeGreaterThan(0.6);
  });

  it('never leaves a lone keys note under the lead', () => {
    for (const s of all) if (s.melody) expect(s.art).not.toBe('single');
  });

  it('plays a returning section the same way', () => {
    for (const s of all) {
      const twin = all.find((o) => o.song === s.song && o.name === s.name && o !== s && o.melody === s.melody);
      if (twin) expect(twin.art).toBe(s.art);
    }
  });

  it('shapes the notes: single notes, short stabs, long rings', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const durs = (art: Articulation) =>
      all.filter((s) => s.art === art && s.song.style.palette.keys !== 'guitar').flatMap((s) => s.notes.map((n) => n.durBeats));
    expect(mean(durs('stab'))).toBeLessThan(0.6);
    expect(mean(durs('ring'))).toBeGreaterThan(3);
    expect(mean(durs('ring'))).toBeGreaterThan(mean(durs('comp')) * 1.5);
    // a single-note section never stacks more than one voice at a time on the downbeat
    for (const s of all.filter((x) => x.art === 'single')) {
      const onsets = new Map<number, number>();
      for (const n of s.notes) onsets.set(Math.round(n.beat * 4), (onsets.get(Math.round(n.beat * 4)) ?? 0) + 1);
      for (const c of onsets.values()) expect(c).toBe(1);
    }
  });
});
