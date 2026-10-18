import { describe, expect, it } from 'vitest';
import { crumbRate } from './crumbSources';

describe('crumb sources', () => {
  it('only settings turned up high shed crumbs, more the higher they are', () => {
    expect(crumbRate(0.5, false)).toBe(0);
    expect(crumbRate(0.7, false)).toBe(0);
    expect(crumbRate(0.85, false)).toBeGreaterThan(0);
    expect(crumbRate(1, false)).toBeGreaterThan(crumbRate(0.85, false));
  });

  it('the Tape panel sheds three times as much', () => {
    expect(crumbRate(0.9, true)).toBeCloseTo(crumbRate(0.9, false) * 3);
  });
});
