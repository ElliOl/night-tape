/**
 * The mouse that lives on the floor at the bottom of the page. It is out and about: it potters along the floor, stops
 * to sniff, sits by its hole for a bit. When a cat comes down to the floor and closes in, it bolts for its hole, faster
 * than any cat can run, hopping over the cat's paws if the cat is in the way, and hides. From the dark of the hole only
 * its eyes show, blinking and glancing at the cat. A few seconds after the cat has left the floor it creeps back out.
 * It can never be caught.
 *
 * Its life on the floor:
 *  - crumbs:       settings turned up high shed crumbs (crumbSources.ts) that fall down the page to the floor; the
 *                  mouse trots over and eats them where they land
 *  - decorations:  it sets up decorations along the floor and the skirting board (a Christmas tree, fairy lights,
 *                  bunting, a candle, a surfboard, a pumpkin, a snowman, flowers, a picture, a lamp), fetched from its hole
 *                  and carried in its mouth, and now and then takes one down again
 *  - cheese:       it finds a wedge of cheese and nibbles it down to nothing
 *  - dance:        a little jig
 * It does all this while no awake cat is on its level (the cat asleep, up on another level, or away). An awake cat
 * that walks into a decoration knocks it over; the mouse later stands it back up or takes it away.
 *
 * A cat asleep on its level does not scare it at all: the mouse gets bold, sniffs round the cat, hops over it, and now
 * and then gets up to mischief with the music (update() reports it; the overlay decides what that does).
 *
 * Positions on the floor are px from the floor's left edge, read live from `.floor__ground` and `.floor__hole`, so
 * scrolling and resizing are fine. Everything is drawn on the wild cat's overlay canvas. Everything it says is
 * Japanese (speech.ts).
 */
import { SAY } from './speech';

type MouseState = 'potter' | 'sniff' | 'flee' | 'hidden';

export type DecoKind = 'tree' | 'lights' | 'bunting' | 'candle' | 'surfboard' | 'pumpkin' | 'snowman' | 'flowers' | 'picture' | 'lamp';
const DECO_KINDS: DecoKind[] = ['tree', 'lights', 'bunting', 'candle', 'surfboard', 'pumpkin', 'snowman', 'flowers', 'picture', 'lamp'];
/** width on the floor (px), for spacing them out */
const DECO_W: Record<DecoKind, number> = {
  tree: 30, lights: 60, bunting: 50, candle: 10, surfboard: 16, pumpkin: 16, snowman: 16, flowers: 16, picture: 16, lamp: 14,
};
const MAX_DECOS = 6;

interface Deco {
  kind: DecoKind;
  x: number;
  knocked: boolean;
}

type Job =
  | { kind: 'decorate'; deco: DecoKind; x: number; phase: 'fetch' | 'place'; until: number }
  | { kind: 'undecorate'; deco: Deco; phase: 'go' | 'home'; until: number }
  | { kind: 'standup'; deco: Deco; until: number }
  | { kind: 'cheese'; until: number }
  | { kind: 'dance'; until: number };

/** something the overlay should show or do */
export interface MouseEvent {
  /** speech bubble */
  say?: string;
  /** mischief with the music (only while a cat sleeps on its level) */
  mischief?: boolean;
}

/** cats closer than this (px, along the floor) make it bolt */
const SCARE_PX = 240;
/** comes back out once no cat has been on the floor for this long (ms) */
const ALL_CLEAR_MS = 2500;
const POTTER = 70;
/** busy (on a project, after crumbs, or round a sleeping cat) */
const BUSY = 95;
/** faster than the cat's run (460 px/s) and its dash (650 px/s) */
const FLEE = 760;
const MARGIN = 14;
const MAX_CRUMBS = 40;
const CRUMB_G = 900;
const CRUMB_MAX_V = 650;

export class FloorMouse {
  private state: MouseState = 'sniff';
  /** px from the floor's left edge */
  private x = -1;
  private target = 0;
  private until = 0;
  private facing = -1;
  private step = 0;
  /** hop over a cat when it darts past one (or when it puts a decoration up) */
  private hop = 0;
  /** last time an awake cat was on the floor */
  private catSeenAt = -Infinity;
  /** where the nearest cat on the floor is (px from the floor's left), for the eyes to look at */
  private catX: number | null = null;
  /** next bit of mischief while a cat sleeps on its level */
  private mischiefAt = Infinity;

  // ---- its world on the floor
  /** crumbs on the floor */
  private crumbs: number[] = [];
  /** crumbs falling down the page (page coordinates) */
  private falling: Array<{ x: number; y: number; vy: number }> = [];
  private decos: Deco[] = [];
  /** a decoration in its mouth */
  private carrying: DecoKind | null = null;
  private cheese: { x: number; bites: number } | null = null;
  private job: Job | null = null;
  private nextJobAt: number;
  private eaten = 0;
  private pending: MouseEvent | null = null;

  constructor(private readonly rand: () => number = Math.random, now = 0) {
    this.nextJobAt = now + 5000 + rand() * 6000;
  }

  private geometry(): { left: number; right: number; floorY: number; holeX: number } | null {
    const ground = document.querySelector('.floor__ground');
    const hole = document.querySelector('.floor__hole');
    if (!ground || !hole) return null;
    const g = ground.getBoundingClientRect();
    const h = hole.getBoundingClientRect();
    return { left: g.left, right: g.right, floorY: g.top, holeX: h.left + h.width / 2 - g.left };
  }

  /** in its hole (only its eyes show) */
  get hidden(): boolean {
    return this.state === 'hidden';
  }

  /** for tests: what is on the floor */
  get world(): { crumbs: number; falling: number; eaten: number; decos: number; knocked: number; kinds: DecoKind[]; cheese: boolean; job: Job['kind'] | null } {
    return {
      crumbs: this.crumbs.length,
      falling: this.falling.length,
      eaten: this.eaten,
      decos: this.decos.length,
      knocked: this.decos.filter((d) => d.knocked).length,
      kinds: this.decos.map((d) => d.kind),
      cheese: !!this.cheese,
      job: this.job?.kind ?? null,
    };
  }

  /** Viewport position of the mouse's feet. */
  position(): { x: number; y: number } | null {
    const g = this.geometry();
    return g ? { x: g.left + this.x, y: g.floorY } : null;
  }

  /** A crumb shed by a setting: it falls from page point (x, y) down to the floor. */
  dropCrumb(x: number, y: number): void {
    if (this.crumbs.length + this.falling.length < MAX_CRUMBS) this.falling.push({ x, y, vy: 0 });
  }

  private say(text: string): void {
    this.pending = { ...(this.pending ?? {}), say: text };
  }

  private goTo(x: number, width: number): void {
    this.target = Math.max(MARGIN, Math.min(width - MARGIN, x));
    this.state = 'potter';
  }

  private pause(now: number, ms: number): void {
    this.state = 'sniff';
    this.until = now + ms;
  }

  /**
   * `cats`: viewport positions of cat feet on screen this frame (`asleep` cats do not scare it).
   * Returns what it wants to say or do this frame, if anything.
   */
  update(now: number, dt: number, cats: ReadonlyArray<{ x: number; y: number; asleep?: boolean }>): MouseEvent | null {
    this.pending = null;
    const g = this.geometry();
    if (!g) return null;
    const width = g.right - g.left;
    if (this.x < 0) {
      this.x = g.holeX - 18;
      this.until = now + 2000;
    }

    // ---- crumbs falling down the page land on the floor
    const sy = typeof window !== 'undefined' ? window.scrollY : 0;
    const floorPage = g.floorY + sy;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const c = this.falling[i]!;
      c.vy = Math.min(CRUMB_MAX_V, c.vy + CRUMB_G * dt);
      c.y += c.vy * dt;
      if (c.y >= floorPage) {
        this.falling.splice(i, 1);
        this.crumbs.push(Math.max(MARGIN, Math.min(width - MARGIN, c.x - g.left)));
      }
    }

    // nearest awake cat on the floor, and any cat asleep on it
    let cat: number | null = null;
    let sleeper: number | null = null;
    for (const c of cats) {
      if (Math.abs(c.y - g.floorY) > 40) continue;
      const cx = c.x - g.left;
      if (c.asleep) {
        sleeper = cx;
        continue;
      }
      if (cat === null || Math.abs(cx - this.x) < Math.abs(cat - this.x)) cat = cx;
    }
    const gap = cat === null ? Infinity : Math.abs(cat - this.x);
    this.catX = cat ?? sleeper;
    if (cat !== null) this.catSeenAt = now;

    // ---- an awake cat on the floor: projects are off, and it knocks over what is in its way
    if (cat !== null) {
      if (this.job) this.dropEverything();
      for (const d of this.decos) {
        if (!d.knocked && Math.abs(cat - d.x) < DECO_W[d.kind] / 2 + 6) {
          d.knocked = true;
          this.say(SAY.knocked);
        }
      }
    }

    // ---- mischief round a sleeping cat
    if (sleeper === null || cat !== null) this.mischiefAt = Infinity;
    else if (this.mischiefAt === Infinity) this.mischiefAt = now + 4000 + this.rand() * 4000;

    // a cat on its level closing in: run for the hole
    if ((this.state === 'potter' || this.state === 'sniff') && gap < SCARE_PX) this.state = 'flee';

    switch (this.state) {
      case 'flee': {
        const dir = Math.sign(g.holeX - this.x) || 1;
        if (cat !== null && Math.abs(cat - this.x) < 26 && Math.sign(cat - this.x) === dir) this.hop = 1;
        this.facing = dir;
        this.x += dir * FLEE * dt;
        this.step += dt * 42;
        if ((dir > 0 && this.x >= g.holeX) || (dir < 0 && this.x <= g.holeX)) {
          this.x = g.holeX;
          this.state = 'hidden';
        }
        break;
      }
      case 'hidden':
        this.x = g.holeX;
        if (now - this.catSeenAt > ALL_CLEAR_MS) this.goTo(g.holeX - 18, width); // creep back out
        break;
      case 'sniff': {
        if (now < this.until) break;
        if (sleeper !== null && cat === null && now >= this.mischiefAt) {
          this.pending = { ...(this.pending ?? {}), mischief: true };
          this.mischiefAt = now + 6000 + this.rand() * 8000;
          this.pause(now, 1200);
          break;
        }
        if (cat === null && this.job) {
          this.work(now, g.holeX, width);
          break;
        }
        // a crumb on the floor: go and eat it
        if (cat === null && this.crumbs.length) {
          const i = this.nearestCrumb();
          if (Math.abs(this.crumbs[i]! - this.x) < 4) {
            this.crumbs.splice(i, 1);
            this.eaten++;
            if (this.eaten % 2 === 1) this.say(SAY.nom);
            this.pause(now, 500);
          } else this.goTo(this.crumbs[i]!, width);
          break;
        }
        if (cat === null && now >= this.nextJobAt) {
          this.startJob(now, g.holeX, width);
          if (this.job) {
            this.work(now, g.holeX, width);
            break;
          }
        }
        if (sleeper !== null) {
          this.goTo(sleeper + (this.rand() < 0.5 ? -1 : 1) * (14 + this.rand() * 60), width);
        } else {
          this.goTo(this.rand() < 0.4 ? g.holeX - 18 : MARGIN + this.rand() * (width - 2 * MARGIN), width);
        }
        break;
      }
      case 'potter': {
        const dir = Math.sign(this.target - this.x);
        this.facing = dir > 0 ? 1 : -1;
        if (sleeper !== null && this.hop === 0 && Math.abs(sleeper - this.x) < 18 && Math.sign(sleeper - this.x) === dir) this.hop = 1;
        const busy = this.job !== null || sleeper !== null || this.crumbs.length > 0;
        this.x += dir * (busy ? BUSY : POTTER) * dt;
        this.step += dt * 16;
        if (Math.abs(this.target - this.x) < 2) {
          this.x = this.target;
          const atHole = Math.abs(this.x - (g.holeX - 18)) < 6;
          const going = this.job !== null || this.crumbs.length > 0;
          this.pause(now, going ? 200 : sleeper !== null ? 400 + this.rand() * 1200 : atHole ? 3000 + this.rand() * 5000 : 600 + this.rand() * 1800);
        }
        break;
      }
    }
    if (this.state !== 'hidden') this.x = Math.max(MARGIN, Math.min(width - MARGIN, this.x));
    this.hop = Math.max(0, this.hop - dt * 4);
    return this.pending;
  }

  private nearestCrumb(): number {
    let i = 0;
    for (let k = 1; k < this.crumbs.length; k++) if (Math.abs(this.crumbs[k]! - this.x) < Math.abs(this.crumbs[i]! - this.x)) i = k;
    return i;
  }

  /** a free spot on the floor for a decoration of width w, or null */
  private freeSpot(w: number, holeX: number): number | null {
    for (let tries = 0; tries < 24; tries++) {
      const x = MARGIN + 10 + w / 2 + this.rand() * Math.max(10, holeX - 50 - w - MARGIN);
      if (this.decos.every((d) => Math.abs(d.x - x) > (DECO_W[d.kind] + w) / 2 + 8)) return x;
    }
    return null;
  }

  /** Pick the next project. */
  private startJob(now: number, holeX: number, width: number): void {
    const knocked = this.decos.filter((d) => d.knocked);
    const options: Array<() => Job | null> = [];
    const decorate = (): Job | null => {
      const present = new Set(this.decos.map((d) => d.kind));
      const fresh = DECO_KINDS.filter((k) => !present.has(k));
      const pool = fresh.length ? fresh : DECO_KINDS;
      const kind = pool[Math.floor(this.rand() * pool.length)]!;
      const x = this.freeSpot(DECO_W[kind], holeX);
      return x === null ? null : { kind: 'decorate', deco: kind, x, phase: 'fetch', until: now + 60000 };
    };
    const undecorate = (): Job | null => {
      const pool = knocked.length ? knocked : this.decos;
      if (!pool.length) return null;
      return { kind: 'undecorate', deco: pool[Math.floor(this.rand() * pool.length)]!, phase: 'go', until: now + 60000 };
    };
    if (knocked.length) {
      const d = knocked[Math.floor(this.rand() * knocked.length)]!;
      const standUp = (): Job => ({ kind: 'standup', deco: d, until: now + 30000 });
      options.push(standUp, standUp, undecorate);
    }
    if (this.decos.length < MAX_DECOS) options.push(decorate, decorate, decorate);
    if (this.decos.length > 2) options.push(undecorate);
    if (this.decos.length >= MAX_DECOS) options.push(undecorate, undecorate);
    options.push(() => ({ kind: 'cheese', until: now + 60000 }), () => ({ kind: 'dance', until: now + 3200 }));
    this.job = options[Math.floor(this.rand() * options.length)]!();
    if (!this.job) return this.endJob(now);
    if (this.job.kind === 'cheese') {
      if (!this.cheese) this.cheese = { x: MARGIN + 30 + this.rand() * Math.max(40, Math.min(width * 0.6, holeX - 80)), bites: 4 };
      this.say(SAY.cheese);
    } else if (this.job.kind === 'dance') this.say(SAY.dance);
  }

  private endJob(now: number): void {
    this.job = null;
    this.nextJobAt = now + 6000 + this.rand() * 10000;
  }

  /** One step of the current project (the mouse is standing still at this.x). */
  private work(now: number, holeX: number, width: number): void {
    const job = this.job!;
    const near = (x: number): boolean => Math.abs(this.x - Math.max(MARGIN, Math.min(width - MARGIN, x))) < 4;
    const home = holeX - 18;
    if (now > job.until) return this.endJob(now);
    switch (job.kind) {
      case 'decorate': {
        if (job.phase === 'fetch') {
          if (!near(home)) return this.goTo(home, width);
          this.carrying = job.deco;
          job.phase = 'place';
          this.say(SAY.decorate);
          return this.pause(now, 400);
        }
        if (!near(job.x)) return this.goTo(job.x, width);
        this.carrying = null;
        this.decos.push({ kind: job.deco, x: job.x, knocked: false });
        this.hop = 1;
        if (job.deco === 'tree') this.say(SAY.treeDone);
        this.endJob(now);
        return this.pause(now, 1200);
      }
      case 'undecorate': {
        if (job.phase === 'go') {
          if (!this.decos.includes(job.deco)) return this.endJob(now);
          if (!near(job.deco.x)) return this.goTo(job.deco.x, width);
          this.decos = this.decos.filter((d) => d !== job.deco);
          this.carrying = job.deco.kind;
          job.phase = 'home';
          this.say(SAY.takeDown);
          return this.pause(now, 400);
        }
        if (!near(home)) return this.goTo(home, width);
        this.carrying = null;
        return this.endJob(now);
      }
      case 'standup': {
        if (!this.decos.includes(job.deco) || !job.deco.knocked) return this.endJob(now);
        if (!near(job.deco.x)) return this.goTo(job.deco.x, width);
        job.deco.knocked = false;
        this.hop = 1;
        this.say(SAY.standUp);
        this.endJob(now);
        return this.pause(now, 800);
      }
      case 'cheese': {
        if (!this.cheese) return this.endJob(now);
        const spot = this.cheese.x + 14;
        if (!near(spot)) return this.goTo(spot, width);
        this.facing = -1;
        this.cheese.bites--;
        if (this.cheese.bites <= 0) {
          this.cheese = null;
          this.say(SAY.burp);
          this.endJob(now);
          return this.pause(now, 1200);
        }
        if (this.cheese.bites % 2 === 1) this.say(SAY.nom);
        return this.pause(now, 800);
      }
      case 'dance':
        this.hop = 1;
        return this.goTo(this.x + (this.facing > 0 ? -10 : 10), width);
    }
  }

  /** an awake cat turned up: whatever it was doing, it drops (a decoration in its mouth falls where it stands) */
  private dropEverything(): void {
    if (this.carrying) this.decos.push({ kind: this.carrying, x: this.x, knocked: true });
    this.carrying = null;
    this.job = null;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const g = this.geometry();
    if (!g) return;
    const sy = window.scrollY;
    // falling crumbs, wherever they are on the page
    ctx.save();
    ctx.fillStyle = '#d8c08a';
    for (const c of this.falling) {
      const y = c.y - sy;
      if (y > -10 && y < window.innerHeight + 10) ctx.fillRect(c.x - 1.5, y - 1.5, 3, 3);
    }
    ctx.restore();
    const p = this.position();
    if (!p || p.y < -60 || p.y > window.innerHeight + 30) return;
    this.drawWorld(ctx, g.left, g.floorY, now);
    if (this.state === 'hidden') {
      this.drawEyes(ctx, p.x, p.y, now);
      return;
    }
    ctx.save();
    const lift = Math.sin(this.hop * Math.PI) * 22;
    ctx.translate(p.x, p.y - lift);
    ctx.scale(-this.facing, 1);
    const run = this.state !== 'sniff';
    const bob = run ? Math.abs(Math.sin(this.step)) * 1.2 : 0;
    const sniff = this.state === 'sniff' ? Math.sin(now / 90) * 0.6 : 0;
    // tail
    ctx.strokeStyle = '#b9a99a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(7, -3);
    ctx.quadraticCurveTo(14, -1 + Math.sin(this.step * 0.5) * 2, 18, -5);
    ctx.stroke();
    // body
    ctx.fillStyle = '#8f8478';
    ctx.beginPath();
    ctx.ellipse(1, -4 - bob, 7.5, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // head + snout (twitching while it sniffs)
    ctx.beginPath();
    ctx.ellipse(-6 + sniff, -5 - bob, 4, 3.2, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e7a0a0';
    ctx.beginPath();
    ctx.arc(-10 + sniff, -5 - bob, 1, 0, Math.PI * 2);
    ctx.fill();
    // ear
    ctx.fillStyle = '#c9b8aa';
    ctx.beginPath();
    ctx.arc(-4.5, -8.5 - bob, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // eye
    ctx.fillStyle = '#1d1713';
    ctx.fillRect(-7.5 + sniff, -6.5 - bob, 1.2, 1.2);
    // feet
    ctx.fillStyle = '#6f655b';
    const f = run ? Math.sin(this.step) * 2 : 0;
    ctx.fillRect(-4 + f, -1, 2, 1);
    ctx.fillRect(3 - f, -1, 2, 1);
    // a decoration in its mouth (small)
    if (this.carrying) {
      ctx.save();
      ctx.translate(-12 + sniff, 2 - bob);
      ctx.scale(0.35, 0.35);
      drawDeco(ctx, this.carrying, now, true);
      ctx.restore();
    }
    ctx.restore();
  }

  /** the decorations, crumbs and the cheese */
  private drawWorld(ctx: CanvasRenderingContext2D, left: number, floorY: number, now: number): void {
    ctx.save();
    for (const d of this.decos) {
      ctx.save();
      ctx.translate(left + d.x, floorY);
      if (d.knocked) {
        // tipped over on its side
        ctx.rotate(Math.round(d.x) % 2 ? Math.PI / 2 : -Math.PI / 2);
        ctx.translate(0, DECO_W[d.kind] * 0.15);
      }
      drawDeco(ctx, d.kind, now, !d.knocked);
      ctx.restore();
    }
    ctx.fillStyle = '#d8c08a';
    for (const c of this.crumbs) ctx.fillRect(left + c - 1.5, floorY - 3, 3, 3);
    if (this.cheese) {
      const s = 7 + this.cheese.bites * 3;
      const x = left + this.cheese.x;
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath();
      ctx.moveTo(x - s, floorY);
      ctx.lineTo(x + s * 0.6, floorY);
      ctx.lineTo(x + s * 0.6, floorY - s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c9a032';
      ctx.beginPath();
      ctx.arc(x, floorY - s * 0.25, Math.max(0.8, s * 0.12), 0, Math.PI * 2);
      ctx.arc(x + s * 0.35, floorY - s * 0.5, Math.max(0.6, s * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Two eyes in the dark of the hole: glancing towards the cat, blinking now and then. */
  private drawEyes(ctx: CanvasRenderingContext2D, x: number, floorY: number, now: number): void {
    const blink = now % 3400 < 140 || (now + 900) % 5300 < 120;
    const g = this.geometry();
    const look = this.catX !== null && g ? Math.max(-1.5, Math.min(1.5, (this.catX + g.left - x) / 60)) : Math.sin(now / 1300);
    ctx.save();
    ctx.translate(x + look, floorY - 9);
    ctx.fillStyle = '#f2e6b8';
    ctx.shadowColor = 'rgba(242, 230, 184, 0.7)';
    ctx.shadowBlur = 4;
    for (const ex of [-3.2, 3.2]) {
      if (blink) ctx.fillRect(ex - 1.3, 0, 2.6, 0.7);
      else {
        ctx.beginPath();
        ctx.ellipse(ex, 0, 1.3, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/** a little five-pointed star */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const BULBS = ['#ff6b6b', '#6fe39a', '#f2c94c', '#6fb8ff'];

/** One decoration, drawn with its base at (0, 0) (the floor line); `lit` = lights on / flame burning. */
function drawDeco(ctx: CanvasRenderingContext2D, kind: DecoKind, now: number, lit: boolean): void {
  const blink = (i: number): boolean => lit && Math.floor(now / 400 + i * 1.7) % 3 !== 0;
  switch (kind) {
    case 'tree': {
      const tierW = (i: number): number => 28 - i * 7;
      const base = (i: number): number => -5 - i * 9;
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(-2, -6, 4, 6);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? '#35694a' : '#3f7d4a';
        ctx.beginPath();
        ctx.moveTo(-tierW(i) / 2, base(i));
        ctx.lineTo(tierW(i) / 2, base(i));
        ctx.lineTo(0, base(i) - 13);
        ctx.closePath();
        ctx.fill();
      }
      star(ctx, 0, base(2) - 15, 5, '#f2c94c');
      for (let i = 0; i < 9; i++) {
        if (!blink(i)) continue;
        const tier = i % 3;
        ctx.fillStyle = BULBS[i % BULBS.length]!;
        ctx.fillRect((((i * 37) % 10) / 10 - 0.5) * (tierW(tier) - 10) - 1, base(tier) - 3 - ((i * 3) % 4), 2, 2);
      }
      break;
    }
    case 'lights': {
      // a string of fairy lights sagging along the skirting board
      ctx.strokeStyle = '#2a2a22';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-30, -28);
      ctx.quadraticCurveTo(-15, -20, 0, -27);
      ctx.quadraticCurveTo(15, -20, 30, -28);
      ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const x = -30 + t * 60;
        const y = -28 + Math.sin(t * Math.PI * 2) * 3 + 4;
        ctx.fillStyle = blink(i) ? BULBS[i % BULBS.length]! : '#3a352c';
        ctx.fillRect(x - 1.2, y, 2.4, 3);
      }
      break;
    }
    case 'bunting': {
      const colours = ['#e06c5a', '#f2c94c', '#6fb8ff', '#6fe39a'];
      ctx.strokeStyle = '#d8ccb2';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-25, -31);
      ctx.quadraticCurveTo(0, -24, 25, -31);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const x = -22 + i * 9;
        const y = -30 + Math.sin(((i + 0.5) / 6) * Math.PI) * 3.5;
        ctx.fillStyle = colours[i % colours.length]!;
        ctx.beginPath();
        ctx.moveTo(x - 3.5, y);
        ctx.lineTo(x + 3.5, y);
        ctx.lineTo(x, y + 7);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'candle': {
      ctx.fillStyle = '#efe4cc';
      ctx.fillRect(-2.5, -11, 5, 11);
      ctx.fillStyle = '#c9b8aa';
      ctx.fillRect(-3.5, -1, 7, 1);
      if (lit) {
        const f = Math.sin(now / 90) * 0.6;
        ctx.fillStyle = 'rgba(255, 190, 90, 0.25)';
        ctx.beginPath();
        ctx.arc(0, -15, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffcf6b';
        ctx.beginPath();
        ctx.ellipse(f, -15, 1.6, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'surfboard': {
      // a surfboard stood on its tail, leaning back against the skirting board
      ctx.save();
      ctx.rotate(0.16);
      ctx.fillStyle = '#7fd0c8';
      ctx.beginPath();
      ctx.moveTo(0, -30); // pointed nose
      ctx.quadraticCurveTo(5.5, -18, 4.5, -4);
      ctx.quadraticCurveTo(4, 0, 0, 0); // rounded tail
      ctx.quadraticCurveTo(-4, 0, -4.5, -4);
      ctx.quadraticCurveTo(-5.5, -18, 0, -30);
      ctx.closePath();
      ctx.fill();
      // stripe down the middle and a sunset band
      ctx.fillStyle = '#e06c5a';
      ctx.fillRect(-0.6, -27, 1.2, 25);
      ctx.fillStyle = '#f2c94c';
      ctx.fillRect(-4.6, -16, 9.2, 2);
      // the fin, sticking out at the back
      ctx.fillStyle = '#2f5f5a';
      ctx.beginPath();
      ctx.moveTo(4.2, -7);
      ctx.lineTo(7.5, -4.5);
      ctx.lineTo(4.4, -3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'pumpkin': {
      ctx.fillStyle = '#e07b2c';
      ctx.beginPath();
      ctx.ellipse(-3, -5, 4.5, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(3, -5, 4.5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4f7a3a';
      ctx.fillRect(-0.8, -12, 1.6, 3);
      ctx.fillStyle = lit ? (Math.floor(now / 300) % 5 ? '#ffd36b' : '#ffe9a8') : '#7a3d16';
      ctx.fillRect(-4, -7, 2, 2);
      ctx.fillRect(2, -7, 2, 2);
      ctx.fillRect(-3, -4, 6, 1.4);
      break;
    }
    case 'snowman': {
      ctx.fillStyle = '#f2efe6';
      ctx.beginPath();
      ctx.arc(0, -5, 5, 0, Math.PI * 2);
      ctx.arc(0, -13, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d1713';
      ctx.fillRect(-3.5, -17.5, 7, 1.2);
      ctx.fillRect(-2.2, -21, 4.4, 3.6);
      ctx.fillRect(-1.6, -14, 0.9, 0.9);
      ctx.fillRect(0.7, -14, 0.9, 0.9);
      ctx.fillStyle = '#e07b2c';
      ctx.fillRect(0, -12.8, 3, 1);
      break;
    }
    case 'flowers': {
      ctx.fillStyle = '#b5653c';
      ctx.beginPath();
      ctx.moveTo(-4.5, -7);
      ctx.lineTo(4.5, -7);
      ctx.lineTo(3.2, 0);
      ctx.lineTo(-3.2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4f7a3a';
      ctx.lineWidth = 1;
      const heads: Array<[number, string]> = [[-3, '#ff8fb1'], [0, '#f2c94c'], [3, '#9fb8ff']];
      for (const [hx, c] of heads) {
        ctx.beginPath();
        ctx.moveTo(hx * 0.5, -7);
        ctx.lineTo(hx, -14 + Math.abs(hx) * 0.6);
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(hx, -15 + Math.abs(hx) * 0.6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'picture': {
      // a tiny framed picture hung on the skirting board: moon over hills
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(-7, -29, 14, 11);
      ctx.fillStyle = '#23304a';
      ctx.fillRect(-5.5, -27.5, 11, 8);
      ctx.fillStyle = '#3f5a3a';
      ctx.beginPath();
      ctx.moveTo(-5.5, -19.5);
      ctx.quadraticCurveTo(-1, -24, 5.5, -21);
      ctx.lineTo(5.5, -19.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f2ecd8';
      ctx.fillRect(2, -26.5, 1.6, 1.6);
      break;
    }
    case 'lamp': {
      ctx.fillStyle = '#3a3128';
      ctx.fillRect(-3, -1.5, 6, 1.5);
      ctx.fillRect(-0.6, -16, 1.2, 15);
      if (lit) {
        ctx.fillStyle = 'rgba(255, 210, 140, 0.18)';
        ctx.beginPath();
        ctx.moveTo(-3, -16);
        ctx.lineTo(3, -16);
        ctx.lineTo(9, 0);
        ctx.lineTo(-9, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#e8c27a';
      ctx.beginPath();
      ctx.moveTo(-4, -16);
      ctx.lineTo(4, -16);
      ctx.lineTo(2.5, -21);
      ctx.lineTo(-2.5, -21);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}
