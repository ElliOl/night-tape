/**
 * The cat under gamepad control: a tiny platformer on top of the page. Panels and controls (knobs, faders, buttons)
 * are platforms the cat can stand on; it walks, jumps (with a double jump to climb between panels), drops through
 * platforms, and paws at whatever it stands on: buttons get pressed, faders and knobs get turned.
 *
 * Positions are kept in page coordinates (viewport + scroll), so the page can scroll under the cat; the page follows
 * the cat when it nears the top or bottom of the window.
 *
 * Standard gamepad mapping (any USB pad or stick the browser exposes):
 *   left stick / d-pad left-right  walk (further = faster)
 *   A (0)                          jump, again in the air for a double jump
 *   down (stick or d-pad)          drop through the platform the cat stands on (never through the floor)
 *   B (1) / X (2)                  paw: press the button / toggle the mute under the cat
 *   right stick up-down, LB / RB (4 / 5), or Y (3) + stick up-down   turn the knob / fader under the cat
 *   Select / Start (8 / 9)         sleep: the cat curls up right where it stands / wakes up (same as the Z key);
 *                                  cheap pads number Select differently, so both buttons do it. While it sleeps,
 *                                  nothing else on the pad wakes it.
 *
 * A hard landing (a big drop or a double-jump stomp) shakes the level it lands on, with a chance of changing the music
 * (see catQuake).
 *
 * Cats are their own creatures: the moment the input stops, the cat does what it wants. For its first 20 s alone it is
 * lazy (sits, ambles about, the odd hop, careful not to walk off an edge); then it roams the page on its own (picks a
 * spot, climbs or drops to it, sits a while, moves on), and after a minute of that it walks home to its usual life.
 * The page only follows the cat while you are steering it, and only your landings can change the music.
 */
import type { CatPose } from './cat';
import { catLanded } from './catQuake';
import { SAY } from './speech';
import { CROSSBAR_ROW, SILL_ROW, sceneRows } from './sceneGeometry';

const GRAVITY = 1900;
const JUMP_V = 760;
const WALK = 300;
const RUN = 460;
const DEAD = 0.22;
/** input counts as stopped after this long (s): from then on the cat lazes about on its own */
const LET_GO = 0.25;
/** this long (s) without input and the cat stops lazing and roams the page */
const ROAM_AFTER = 20;
/** this long (s) without input and the cat heads home to its usual life */
const HOME_AFTER = 80;

/** what the cat can stand on: panel tops and controls */
const PLATFORM_SEL = '.main .panel, .main .hero, .main .scene, .main .knob, .main .fader__input, .main button, .main svg.cassette, .floor__ground';

/** fader handle height (px, see .fader__input::-webkit-slider-thumb) and its half-width */
const THUMB_H = 12;
const THUMB_HALF_W = 12;


interface Platform {
  /** identity of this edge: the element for its top border, a per-element key for its bottom border */
  id: object;
  el: Element;
  left: number;
  right: number;
  /** page y of the top edge */
  top: number;
  control: 'knob' | 'fader' | 'button' | null;
}

export interface PlayerFrame {
  /** viewport coordinates of the cat's feet */
  x: number;
  y: number;
  pose: CatPose;
  facing: number;
  walk: number;
  label?: string;
}

export interface PadInput {
  x: number;
  y: number;
  /** turn the control under the cat: +1 up, -1 down, 0 none */
  turn: number;
  jump: boolean;
  paw: boolean;
  home: boolean;
  /** Select: toggle the cat's nap (does not count as picking the cat up) */
  sleep: boolean;
  any: boolean;
}

const pressed = (gp: Gamepad, i: number): boolean => !!gp.buttons[i]?.pressed;
const axis = (gp: Gamepad, i: number): number => {
  const v = gp.axes[i] ?? 0;
  return Math.abs(v) < DEAD ? 0 : v;
};

/** Read the first connected gamepad into a simple input frame (null when none is connected). */
export function readPad(): PadInput | null {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = Array.from(pads).find((p): p is Gamepad => !!p && p.connected);
  if (!gp) return null;
  let x = axis(gp, 0);
  let y = axis(gp, 1);
  // many cheap USB pads report the d-pad as a "hat" axis (usually the last one): -1 = up, then clockwise in steps
  // of 2/7 to 1 = up-left; anything outside -1..1 (e.g. 3.29) = centred
  const hat = gp.mapping === 'standard' ? undefined : gp.axes[gp.axes.length - 1];
  const step = hat !== undefined && hat >= -1.05 && hat <= 1.05 ? Math.round(((hat + 1) * 7) / 2) : -1;
  // a real hat sits exactly on a step (-1 + 2k/7); a resting stick axis at 0 does not, and is ignored
  const onStep = step >= 0 && Math.abs(hat! - (-1 + (2 * step) / 7)) < 0.05;
  const hatDir = onStep ? step % 8 : -1;
  const hatRight = hatDir >= 1 && hatDir <= 3;
  const hatDown = hatDir >= 3 && hatDir <= 5;
  const hatLeft = hatDir >= 5 && hatDir <= 7;
  const hatUp = hatDir === 7 || hatDir === 0 || hatDir === 1;
  if (pressed(gp, 14) || hatLeft) x = -1;
  if (hatRight) x = 1;
  if (pressed(gp, 15)) x = 1;
  const dUp = pressed(gp, 12) || hatUp;
  const dDown = pressed(gp, 13) || hatDown;
  const rightY = axis(gp, 3);
  let turn = 0;
  // Y held: the stick / d-pad turns the control instead of moving the cat
  const yHeld = pressed(gp, 3);
  if (pressed(gp, 5) || rightY < -0.4 || (yHeld && (y < -0.4 || dUp))) turn = 1;
  else if (pressed(gp, 4) || rightY > 0.4 || (yHeld && (y > 0.4 || dDown))) turn = -1;
  if (pressed(gp, 3)) y = 0; // Y + stick turns; it should not also count as "down" for drop-through
  if (dDown && !pressed(gp, 3)) y = Math.max(y, 0.8);
  const jump = pressed(gp, 0);
  const paw = pressed(gp, 1) || pressed(gp, 2);
  // no "send home" button: the cat goes home by itself once you stop playing
  const home = false;
  const sleep = pressed(gp, 8) || pressed(gp, 9);
  const any = jump || paw || turn !== 0 || x !== 0 || Math.abs(y) > 0.5 || gp.buttons.some((b, i) => i !== 8 && i !== 9 && b.pressed);
  return { x, y, turn, jump, paw, home, sleep, any };
}

function controlOf(el: Element): Platform['control'] {
  if (el.classList.contains('knob')) return 'knob';
  if (el.classList.contains('fader__input')) return 'fader';
  if (el.tagName === 'BUTTON') return 'button';
  return null;
}

/** elements that are text, never a platform even if styled with a border */
const TEXT_TAGS = new Set(['SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'KBD', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'A', 'TEXT']);

/** Does this element draw a visible border on that side? */
function hasBorder(cs: CSSStyleDeclaration, side: 'Top' | 'Bottom'): boolean {
  const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
  if (style === 'none' || style === 'hidden' || parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) < 0.5) return false;
  const c = cs.getPropertyValue(`border-${side.toLowerCase()}-color`);
  return !(c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c));
}

interface Bordered {
  el: Element;
  top: boolean;
  bottom: boolean;
}

let borderCache: { at: number; els: Bordered[] } = { at: -Infinity, els: [] };

/** the bottom edge of an element is a platform of its own (it needs an identity apart from the top edge) */
const bottomIds = new WeakMap<Element, object>();
function bottomId(el: Element): object {
  let id = bottomIds.get(el);
  if (!id) bottomIds.set(el, (id = {}));
  return id;
}

/**
 * Every bordered box on the page (station cards, info boxes, chips, inputs, buttons, ...) is somewhere the cat can
 * stand. Reading styles is slow, so the set is refreshed once a second; positions are read live every frame.
 */
function borderedElements(): Bordered[] {
  const now = performance.now();
  if (now - borderCache.at < 1000) return borderCache.els;
  const els: Bordered[] = [];
  for (const el of document.querySelectorAll('.main *, .floor *')) {
    if (TEXT_TAGS.has(el.tagName.toUpperCase()) || el.closest('svg')) continue;
    // parts of a knob (its cap): the knob as a whole is already a platform
    if (el.closest('.knob')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    const top = hasBorder(cs, 'Top');
    const bottom = hasBorder(cs, 'Bottom');
    if (top || bottom) els.push({ el, top, bottom });
  }
  borderCache = { at: now, els };
  return els;
}

function platforms(): Platform[] {
  const sy = window.scrollY;
  const out: Platform[] = [];
  const seen = new Set<Element>();
  const bordered = borderedElements();
  // bottom borders (station cards, readouts, buttons, panels from the inside, ...)
  for (const b of bordered) {
    if (!b.bottom || b.el.classList.contains('floor__ground')) continue;
    const r = b.el.getBoundingClientRect();
    if (r.width < 8 || r.height < 4) continue;
    out.push({ id: bottomId(b.el), el: b.el, left: r.left, right: r.right, top: r.bottom + sy, control: null });
  }
  const tops = [...document.querySelectorAll(PLATFORM_SEL), ...bordered.filter((b) => b.top).map((b) => b.el)];
  for (const el of tops) {
    if (seen.has(el)) continue;
    seen.add(el);
    // the fader column itself is not a platform: its handle is
    if (el.classList.contains('fader') || el.classList.contains('faders')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 4) continue;
    if (el.classList.contains('fader__input')) {
      // the handle, not the whole column: it rides up and down with the level (1 = top)
      const v = Number((el as HTMLInputElement).value);
      const cx = r.left + r.width / 2;
      const top = r.top + (1 - v) * (r.height - THUMB_H);
      out.push({ id: el, el, left: cx - THUMB_HALF_W, right: cx + THUMB_HALF_W, top: top + sy, control: 'fader' });
      continue;
    }
    if (el.classList.contains('scene')) {
      // the windowsill of the pixel scene (where the cat naps)
      const rows = sceneRows(r.height);
      const sill = Math.round(rows * SILL_ROW);
      out.push({ id: el, el, left: r.left, right: r.right, top: r.top + (sill / rows) * r.height + sy, control: null });
      // and the window's middle crossbar
      const bar = Math.round(rows * CROSSBAR_ROW);
      out.push({ id: bottomId(el), el, left: r.left, right: r.right, top: r.top + (bar / rows) * r.height + sy, control: null });
      continue;
    }
    if (el.classList.contains('cassette')) {
      // the drawn shell starts 6 units into the 300 x 190 viewBox, inset on each side
      const k = r.width / 300;
      out.push({ id: el, el, left: r.left + 10 * k, right: r.right - 10 * k, top: r.top + 6 * k + sy, control: null });
      continue;
    }
    out.push({ id: el, el, left: r.left, right: r.right, top: r.top + sy, control: controlOf(el) });
  }
  return out;
}

export class CatPlayer {
  active = false;
  private x = 0;
  /** page y of the feet */
  private y = 0;
  private vx = 0;
  private vy = 0;
  private facing = 1;
  private walkPhase = 0;
  /** the id of the platform edge the cat stands on (document.documentElement = the very bottom) */
  private ground: object | null = null;
  private jumpsLeft = 2;
  private dropUntil = 0;
  private dropFrom: object | null = null;
  private idle = 0;
  private pawUntil = 0;
  private turnAt = 0;
  private label: { text: string; until: number } | null = null;
  /** the lazy cat's own plan while nobody is steering */
  private ai = { x: 0, until: 0, jumpAt: 0 };
  /** the roaming cat's plan: where it is going, and how it is getting on */
  private trek = { goal: null as { id: object; x: number } | null, restUntil: 0, progressAt: 0, best: Infinity, pulseAt: -Infinity };
  /** Start / Select pressed (or idle long enough): hand the cat back once it is standing on something */
  private wantHome = false;
  private prev = { jump: false, paw: false, home: false, down: false };

  /** standing on something (not mid-jump) */
  get grounded(): boolean {
    return this.ground !== null;
  }

  /** Take control, starting at viewport point (x, y). */
  start(x: number, y: number, now: number, greeting: string = SAY.myTurn): void {
    this.active = true;
    this.wantHome = false;
    this.x = x;
    this.y = y + window.scrollY;
    this.vx = 0;
    this.vy = -300;
    this.ground = null;
    this.jumpsLeft = 1;
    this.idle = 0;
    this.say(greeting, now, 1400);
  }

  stop(): void {
    this.active = false;
    this.ground = null;
  }

  private say(text: string, now: number, ms = 1100): void {
    this.label = { text, until: now + ms };
  }

  /** Advance by dt seconds. Returns null when the player sends the cat home. */
  update(dt: number, input: PadInput, now: number): PlayerFrame | null {
    const edge = (k: 'jump' | 'paw' | 'home'): boolean => input[k] && !this.prev[k];
    const jumpNow = edge('jump');
    const pawNow = edge('paw');
    const homeNow = edge('home');
    const down = input.y > 0.6;
    const downNow = down && !this.prev.down;
    this.prev = { jump: input.jump, paw: input.paw, home: input.home, down };
    this.idle = input.any ? 0 : this.idle + dt;
    if (homeNow || this.idle > HOME_AFTER) this.wantHome = true;
    // never let go of it in mid-air: it walks home from a level, it does not vanish
    if (this.wantHome && this.ground) {
      this.wantHome = false;
      return null;
    }

    const plats = platforms();
    // nobody steering: the cat does what it wants
    const steering = this.idle <= LET_GO;
    if (this.idle > ROAM_AFTER) input = this.roam(now, plats);
    else if (!steering) input = this.lazy(now, plats);
    // the floor (with the mouse hole) is the lowest level: the cat never gets below it, nor past the page's sides
    const floor = plats.find((p) => p.el.classList.contains('floor__ground'));
    const pageBottom = floor ? floor.top : document.documentElement.scrollHeight - 4;
    const minX = floor ? floor.left + 10 : 12;
    const maxX = floor ? floor.right - 10 : window.innerWidth - 12;

    // ---- walking
    const target = input.x * (Math.abs(input.x) > 0.85 ? RUN : WALK);
    const accel = this.ground ? 2400 : 1100;
    this.vx += Math.max(-accel * dt, Math.min(accel * dt, target - this.vx));
    if (input.x !== 0) this.facing = input.x > 0 ? 1 : -1;

    // ---- drop through (press down) / jump
    if (downNow && this.ground && this.ground !== document.documentElement && this.ground !== floor?.id) {
      this.dropFrom = this.ground;
      this.dropUntil = now + 260;
      this.ground = null;
      this.vy = 60;
    } else if (jumpNow) {
      if (this.ground || this.jumpsLeft > 0) {
        if (!this.ground) this.jumpsLeft--;
        else this.jumpsLeft = 1;
        this.ground = null;
        this.vy = -JUMP_V;
      }
    }

    // ---- physics
    const prevY = this.y;
    this.x += this.vx * dt;
    this.x = Math.max(minX, Math.min(maxX, this.x));
    if (this.ground) {
      const g = plats.find((p) => p.id === this.ground);
      if (g && this.x >= g.left - 2 && this.x <= g.right + 2) this.y = g.top;
      else if (this.ground !== document.documentElement) this.ground = null; // walked off the edge
    }
    if (!this.ground) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.vy > 0) {
        // land on the highest platform crossed this frame
        let best: Platform | null = null;
        for (const p of plats) {
          if (this.x < p.left || this.x > p.right) continue;
          if (p.id === this.dropFrom && now < this.dropUntil) continue;
          if (prevY <= p.top + 1 && this.y >= p.top && (!best || p.top < best.top)) best = p;
        }
        if (best) {
          // a hard landing shakes the level, and maybe the music
          const said = catLanded(best.el, this.vy, Math.random, steering);
          if (said) this.say(said, now, 1400);
          this.y = best.top;
          this.vy = 0;
          this.ground = best.id;
          this.jumpsLeft = 1;
        } else if (this.y >= pageBottom) {
          this.y = pageBottom;
          this.vy = 0;
          this.ground = document.documentElement;
          this.jumpsLeft = 1;
        }
      }
    }
    if (this.ground === document.documentElement) this.y = pageBottom;
    // never below the floor (e.g. the layout changed under the cat)
    if (this.y > pageBottom) {
      this.y = pageBottom;
      this.vy = 0;
      this.ground = floor?.id ?? document.documentElement;
      this.jumpsLeft = 1;
    }

    // ---- paw at / turn the control under the cat
    const under = this.ground ? plats.find((p) => p.id === this.ground) : undefined;
    if (pawNow && under) {
      this.pawUntil = now + 380;
      this.paw(under, now);
    }
    if (input.turn !== 0 && under && (under.control === 'knob' || under.control === 'fader') && now >= this.turnAt) {
      this.turnAt = now + 70;
      this.pawUntil = now + 160;
      this.turn(under, input.turn);
    }

    // ---- keep the cat in view (only while you steer it: a roaming cat does not drag the page about)
    const vy = steering ? this.y - window.scrollY : window.innerHeight / 2;
    if (vy > window.innerHeight * 0.82) window.scrollBy(0, Math.min(40, (vy - window.innerHeight * 0.82) * 0.25));
    else if (vy < window.innerHeight * 0.2) window.scrollBy(0, Math.max(-40, (vy - window.innerHeight * 0.2) * 0.25));

    // ---- pose
    let pose: CatPose;
    if (now < this.pawUntil) pose = now < this.pawUntil - 200 ? 'windup' : 'air';
    else if (!this.ground) pose = 'air';
    else if (Math.abs(this.vx) > 20) pose = 'stalk';
    else pose = 'watch';
    if (Math.abs(this.vx) > 20) this.walkPhase += dt * (Math.abs(this.vx) / 40);

    const lbl = this.label && now < this.label.until ? this.label.text : undefined;
    return { x: this.x, y: this.y - window.scrollY, pose, facing: this.facing, walk: this.walkPhase, label: lbl };
  }

  /**
   * The cat's own idea of a good time, the first seconds after it is let go: mostly sitting, some slow ambling
   * (turning round before it walks off an edge), now and then a hop.
   */
  private lazy(now: number, plats: Platform[]): PadInput {
    const ai = this.ai;
    if (now >= ai.until) {
      const r = Math.random();
      ai.x = r < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.25);
      ai.jumpAt = r > 0.86 ? now + 150 : 0;
      ai.until = now + 1000 + Math.random() * 2000;
    }
    const g = this.ground ? plats.find((p) => p.id === this.ground) : undefined;
    if (g && ai.x !== 0) {
      const margin = 18;
      if ((ai.x > 0 && this.x > g.right - margin) || (ai.x < 0 && this.x < g.left + margin)) ai.x = -ai.x;
    }
    const jump = ai.jumpAt > 0 && now >= ai.jumpAt && now < ai.jumpAt + 120;
    return { x: ai.x, y: 0, turn: 0, jump, paw: false, home: false, sleep: false, any: false };
  }

  /**
   * Roaming: pick a spot on some level within reach (up to a double jump above, a few panels below), walk over, jump
   * (and jump again at the top of the arc) to climb, press down to drop through, sit a while once there, then pick
   * the next. Gives up on a spot it makes no progress towards for a few seconds.
   */
  private roam(now: number, plats: Platform[]): PadInput {
    const t = this.trek;
    const idleInput = (x = 0, jump = false, y = 0): PadInput => ({ x, y, turn: 0, jump, paw: false, home: false, sleep: false, any: false });
    let goal = t.goal ? plats.find((p) => p.id === t.goal!.id) : undefined;
    const arrived = goal && this.ground === goal.id && Math.abs(this.x - t.goal!.x) < 14;
    if (arrived && !t.restUntil) t.restUntil = now + 1500 + Math.random() * 3000;
    const stuck = now - t.progressAt > 4500;
    if (!goal || (t.restUntil && now >= t.restUntil) || (!t.restUntil && stuck)) {
      const options = plats.filter(
        (p) => p.id !== this.ground && p.right - p.left >= 24 && p.top > this.y - 270 && p.top < this.y + 420 && !p.el.classList.contains('floor__wall'),
      );
      goal = options.length ? options[Math.floor(Math.random() * options.length)] : plats.find((p) => p.el.classList.contains('floor__ground'));
      if (!goal) return idleInput();
      t.goal = { id: goal.id, x: goal.left + 10 + Math.random() * Math.max(0, goal.right - goal.left - 20) };
      t.restUntil = 0;
      t.progressAt = now;
      t.best = Infinity;
    }
    if (t.restUntil) return idleInput(); // sitting where it wanted to be

    const gx = t.goal!.x;
    const dx = gx - this.x;
    const dist = Math.hypot(dx, goal.top - this.y);
    if (dist < t.best - 6) {
      t.best = dist;
      t.progressAt = now;
    }
    const x = Math.abs(dx) < 8 ? 0 : Math.sign(dx) * (Math.abs(dx) > 160 ? 0.9 : 0.55);
    // jump and drop are presses: one short pulse at a time
    const canPulse = now - t.pulseAt > 260;
    let jump = false;
    let y = 0;
    if (goal.top < this.y - 8) {
      // above: jump when close underneath it, jump again near the top of the arc if still short
      if (canPulse && ((this.ground && Math.abs(dx) < 90) || (!this.ground && this.vy > -60 && this.jumpsLeft > 0 && this.y > goal.top + 20))) {
        t.pulseAt = now;
      }
      jump = now - t.pulseAt < 90;
    } else if (goal.top > this.y + 8 && this.ground && Math.abs(dx) < 30) {
      // below, right over it: drop through
      if (canPulse) t.pulseAt = now;
      y = now - t.pulseAt < 90 ? 1 : 0;
    }
    return idleInput(x, jump, y);
  }

  private paw(p: Platform, now: number): void {
    swatEl(p.el);
    if (p.control === 'button') {
      (p.el as HTMLButtonElement).click();
      const name = (p.el.getAttribute('aria-label') ?? p.el.textContent ?? '').trim().split('\n')[0]!.slice(0, 22);
      if (name) this.say(SAY.pressed, now);
    } else if (p.control === 'fader') {
      const mute = p.el.closest('.fader')?.querySelector<HTMLButtonElement>('.fader__mute:not(.fader__mute--spacer)');
      if (mute) {
        mute.click();
        this.say(SAY.swat, now);
      }
    } else if (p.control === 'knob') {
      this.say(SAY.turnHint, now);
    }
  }

  private turn(p: Platform, dir: number): void {
    if (p.control === 'knob') {
      const dial = p.el.querySelector<HTMLElement>('.knob__dial');
      dial?.dispatchEvent(new KeyboardEvent('keydown', { key: dir > 0 ? 'ArrowUp' : 'ArrowDown', bubbles: true }));
    } else if (p.control === 'fader') {
      const input = p.el as HTMLInputElement;
      const v = Math.min(1, Math.max(0, Number(input.value) + dir * 0.02));
      // React tracks the value itself: set it through the native setter so the input event is seen as a change
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

function swatEl(el: Element): void {
  el.classList.remove('cat-swat');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('cat-swat');
  setTimeout(() => el.classList.remove('cat-swat'), 500);
}
