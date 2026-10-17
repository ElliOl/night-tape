import { describe, expect, it } from 'vitest';
import {
  chordLabel, chordPcs, colourQuality, keyLabel, melodyPcsOver, mod12, nearestInSet, progressionPcs, scaleConflicts, SCALES,
  voiceChord, voiceLeadingCost,
} from './theory';

describe('theory', () => {
  it('labels chords and keys with flat spellings', () => {
    expect(chordLabel({ rootPc: 2, quality: 'm9' })).toBe('Dm9');
    expect(chordLabel({ rootPc: 10, quality: '7' })).toBe('Bb7');
    expect(keyLabel({ tonic: 3, scale: 'aeolian' })).toBe('Eb minor');
    expect(keyLabel({ tonic: 7, scale: 'dorian' })).toBe('G dorian');
  });

  it('simplifies or enriches chord colour with complexity', () => {
    expect(colourQuality('m9', 0)).toBe('m');
    expect(colourQuality('maj9', 0)).toBe('maj');
    expect(colourQuality('m11', 0.1)).toBe('m7');
    expect(colourQuality('m9', 0.3)).toBe('m7');
    expect(colourQuality('m9', 0.5)).toBe('m9');
    expect(colourQuality('maj7', 0.75)).toBe('maj9');
    expect(colourQuality('maj7', 1)).toBe('maj13');
    expect(colourQuality('7', 1)).toBe('13');
  });

  it('voices rootless chords inside the range using only chord tones', () => {
    const c = { rootPc: 2, quality: 'm9' as const };
    const v = voiceChord(c, null, { lo: 52, hi: 76, rootless: true, maxVoices: 4 });
    expect(v.length).toBe(4);
    for (const m of v) {
      expect(m).toBeGreaterThanOrEqual(52);
      expect(m).toBeLessThanOrEqual(76);
      expect(chordPcs(c)).toContain(mod12(m));
    }
    expect(v).not.toContain(50); // no root D
    expect([...v].sort((a, b) => a - b)).toEqual(v);
  });

  it('prefers smooth voice leading', () => {
    const a = voiceChord({ rootPc: 2, quality: 'm9' }, null, { lo: 52, hi: 76, rootless: true, maxVoices: 4 });
    const b = voiceChord({ rootPc: 7, quality: '13' }, a, { lo: 52, hi: 76, rootless: true, maxVoices: 4 });
    expect(voiceLeadingCost(a, b)).toBeLessThanOrEqual(8);
  });

  it('voices every style inside a sensible range with chord tones only', () => {
    const styles = ['close', 'spread', 'shell', 'quartal', 'cluster'] as const;
    const chords = [
      { rootPc: 2, quality: 'm9' as const },
      { rootPc: 7, quality: '13' as const },
      { rootPc: 0, quality: 'maj9' as const },
      { rootPc: 11, quality: 'm7b5' as const },
    ];
    for (const style of styles) {
      let prev: number[] | null = null;
      for (const c of chords) {
        const v = voiceChord(c, prev, { lo: 50, hi: 77, style, rootless: true, maxVoices: 4 });
        expect(v.length).toBeGreaterThanOrEqual(3);
        for (const m of v) {
          expect(m).toBeGreaterThanOrEqual(43);
          expect(m).toBeLessThanOrEqual(80);
          // quartal stacks may add the 11th / 6th as colour; everything else stays inside the chord
          if (style !== 'quartal') expect(chordPcs(c)).toContain(mod12(m));
        }
        prev = v;
      }
    }
  });

  it('finds the nearest pitch in a set', () => {
    expect(nearestInSet(61, [0, 4, 7])).toBe(60);
    expect(nearestInSet(66, [7])).toBe(67);
  });

  it('defines the modes with the right intervals', () => {
    expect(SCALES.ionian).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(SCALES.dorian).toEqual([0, 2, 3, 5, 7, 9, 10]);
    expect(SCALES.aeolian).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(SCALES.lydian).toEqual([0, 2, 4, 6, 7, 9, 11]);
    expect(SCALES.mixolydian).toEqual([0, 2, 4, 5, 7, 9, 10]);
  });

  it('scores how well a mode fits a progression', () => {
    // i - IV13 is dorian (natural 6), i - bVI is aeolian (flat 6)
    const iIV = progressionPcs([[0, 'm9'], [5, '13']]);
    expect(scaleConflicts('dorian', iIV)).toBeLessThan(scaleConflicts('aeolian', iIV));
    const ibVI = progressionPcs([[0, 'm9'], [8, 'maj7']]);
    expect(scaleConflicts('aeolian', ibVI)).toBeLessThan(scaleConflicts('dorian', ibVI));
    // a maj7 tonic is not mixolydian
    const Imaj7 = progressionPcs([[0, 'maj7'], [2, 'm9']]);
    expect(scaleConflicts('ionian', Imaj7)).toBeLessThan(scaleConflicts('mixolydian', Imaj7));
  });

  it('keeps melody notes off avoid notes and follows borrowed chords', () => {
    const cMajor = { tonic: 0, scale: 'ionian' } as const;
    // borrowed iv (Fm7): Ab replaces A
    const overFm = melodyPcsOver(cMajor, { rootPc: 5, quality: 'm7' });
    expect(overFm).toContain(8);
    expect(overFm).not.toContain(9);
    // G7: C (a half step above B) is the avoid note
    expect(melodyPcsOver(cMajor, { rootPc: 7, quality: '7' })).not.toContain(0);
    // a plain diatonic chord keeps the whole melody scale
    expect(melodyPcsOver(cMajor, { rootPc: 0, quality: 'maj7' }).sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 9, 11]);
    // C minor, G7b9: the leading tone B joins, Bb and C step aside
    const overV = melodyPcsOver({ tonic: 0, scale: 'aeolian' }, { rootPc: 7, quality: '7b9' });
    expect(overV).toContain(11);
    expect(overV).not.toContain(10);
    expect(overV).not.toContain(0);
  });
});
