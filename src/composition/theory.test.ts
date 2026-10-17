import { describe, expect, it } from 'vitest';
import { chordLabel, chordPcs, colourQuality, keyLabel, mod12, nearestInSet, voiceChord, voiceLeadingCost } from './theory';

describe('theory', () => {
  it('labels chords and keys with flat spellings', () => {
    expect(chordLabel({ rootPc: 2, quality: 'm9' })).toBe('Dm9');
    expect(chordLabel({ rootPc: 10, quality: '7' })).toBe('Bb7');
    expect(keyLabel({ tonic: 3, scale: 'aeolian' })).toBe('Eb minor');
    expect(keyLabel({ tonic: 7, scale: 'dorian' })).toBe('G dorian');
  });

  it('simplifies or enriches chord colour with complexity', () => {
    expect(colourQuality('m11', 0.1)).toBe('m7');
    expect(colourQuality('m9', 0.3)).toBe('m7');
    expect(colourQuality('m9', 0.5)).toBe('m9');
    expect(colourQuality('maj7', 0.9)).toBe('maj9');
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

  it('finds the nearest pitch in a set', () => {
    expect(nearestInSet(61, [0, 4, 7])).toBe(60);
    expect(nearestInSet(66, [7])).toBe(67);
  });
});
