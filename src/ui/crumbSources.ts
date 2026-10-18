/**
 * Settings turned up high shed crumbs: every knob and fader above ~70% now and then drops a crumb from where it sits,
 * more often the higher it is, and the Tape panel's knobs three times as much. The crumbs fall down the page to the
 * mouse's floor. Values are read from the controls themselves (a knob's aria-valuenow, a fader's value), so every
 * control counts without a list to keep up to date.
 */

/** from this value up a control sheds crumbs */
const FROM = 0.7;
/** crumbs per second from one control at 100% (Tape panel: TAPE_BOOST times that) */
const RATE_AT_MAX = 0.08;
const TAPE_BOOST = 3;
const SCAN_MS = 400;

let lastScan = -Infinity;

/** how often (crumbs/s) a control at value v sheds a crumb */
export function crumbRate(v: number, tape: boolean): number {
  if (v <= FROM) return 0;
  const k = Math.min(1, (v - FROM) / (1 - FROM));
  return Math.pow(k, 1.5) * RATE_AT_MAX * (tape ? TAPE_BOOST : 1);
}

/**
 * Called every frame; every SCAN_MS it rolls the dice for each control. Returns the page positions (x, y = the
 * control's bottom edge) of crumbs to drop now.
 */
export function shedCrumbs(now: number, rand: () => number = Math.random): Array<{ x: number; y: number }> {
  if (now - lastScan < SCAN_MS) return [];
  const dt = Math.min(2, (now - lastScan) / 1000);
  lastScan = now;
  if (!Number.isFinite(dt)) return [];
  const out: Array<{ x: number; y: number }> = [];
  const sy = window.scrollY;
  const consider = (el: Element, v: number): void => {
    const tape = !!el.closest('.panel--tape');
    const p = crumbRate(v, tape) * dt;
    if (p <= 0 || rand() >= p) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    out.push({ x: r.left + r.width / 2 + (rand() - 0.5) * r.width * 0.5, y: r.bottom + sy });
  };
  for (const dial of document.querySelectorAll('.main .knob__dial[aria-valuenow]')) {
    consider(dial.closest('.knob') ?? dial, Number(dial.getAttribute('aria-valuenow')) / 100);
  }
  for (const f of document.querySelectorAll<HTMLInputElement>('.main .fader__input')) consider(f, Number(f.value));
  return out;
}
