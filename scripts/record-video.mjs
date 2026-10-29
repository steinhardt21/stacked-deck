#!/usr/bin/env node
/**
 * Records the demo as a video with sound — for a post, a README, a talk.
 *
 *   pnpm build && node scripts/record-video.mjs            → recordings/stacked-deck-dealer.mp4
 *   node scripts/record-video.mjs --set=tick --out=x.mp4   → another sound set, another file
 *
 * Never a screen recording: the page runs on a VIRTUAL clock that moves only
 * when a frame is taken. requestAnimationFrame, performance.now, Date.now,
 * timers and every CSS transition read it, so each frame is exactly 1/60 s
 * after the last however long the photograph takes — no dropped frame, 2×
 * density, and the same take every time (Math.random is seeded too, so the
 * deal comes out in the same order).
 *
 * A headless browser records no audio, so the soundtrack is REBUILT: the
 * script knows the virtual time of every open, turn and choice (it caused
 * them), and ffmpeg lays the set's recordings on those exact times — the same
 * takes, in the same round-robin order, with the same ±4% pitch jitter the
 * page would use. Sync is to the frame by construction.
 *
 * Needs Google Chrome and ffmpeg on the machine.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const SET = args.set ?? 'dealer';
const OUT = path.resolve(ROOT, args.out ?? `recordings/stacked-deck-${SET}.mp4`);
const FRAMES = path.join(ROOT, 'recordings', `.frames-${SET}`);

const FPS = 60;
const VIEWPORT = { width: 540, height: 675 }; // 4:5 — at 2× → 1080 × 1350
const SCALE = 2;
const VOLUME = 0.45;
const PITCH_JITTER = 0.04;

/** The sets' files, as `src/main.ts` defines them (the tick has no file and is not rebuilt here). */
const SETS = {
  dealer: { open: 'card-fan-1', turn: ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-5', 'card-slide-6', 'card-slide-7'], choose: 'card-place-2' },
  table: { open: 'cards-pack-open-2', turn: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'], choose: 'card-shove-1' },
  flick: { open: 'card-shuffle', openSeconds: 0.8, turn: ['card-shove-1', 'card-shove-2', 'card-shove-3', 'card-shove-4'], choose: 'card-place-4' },
};
if (!SETS[SET]) throw new Error(`--set must be one of ${Object.keys(SETS).join(', ')}`);
if (!existsSync(path.join(DIST, 'index.html'))) throw new Error('Run `pnpm build` first.');

/**
 * The take, in virtual seconds. Something answers every 0.3–0.7 s; the camera
 * never moves; it ends where it began, so it loops.
 *   { at, to: 'deal' | 'front' | 'close' | [x, y], over }   the hand glides
 *   { at, click: true }                                      press where the hand is
 *   { at, wheel: ±1 }                                        one card down (+) or up (−)
 */
const TAKE = [
  { at: 0.1, to: 'deal', over: 0.55 },
  { at: 0.75, click: true }, // Deal: the fan, the cards come up
  { at: 1.45, to: 'front', over: 0.35 },
  ...[1.95, 2.3, 2.62, 2.92, 3.2].map((at) => ({ at, wheel: 1 })),
  ...[3.65, 4.0, 4.32].map((at) => ({ at, wheel: -1 })),
  ...[4.8, 4.93, 5.06, 5.19, 5.32, 5.45, 5.58].map((at) => ({ at, wheel: 1 })), // a flick
  { at: 6.55, click: true }, // choose the front card
  { at: 6.95, to: 'deal', over: 0.45 },
  { at: 7.55, click: true }, // deal again
  { at: 8.25, to: 'front', over: 0.3 },
  ...[8.65, 8.95, 9.25, 9.55].map((at) => ({ at, wheel: 1 })),
  { at: 9.95, to: 'close', over: 0.35 },
  { at: 10.4, click: true },
  { at: 10.6, to: 'start', over: 0.5 },
  { at: 10.65, clearStatus: true }, // the last frame is the first: the post loops without a jump
];
const DURATION = 11.2;
const START = [430, 610];

// ── The virtual clock (runs in the page before any of its scripts) ─────────
function installClock() {
  const epoch = Date.now();
  let now = 0;
  let nextId = 1;
  let frames = new Map();
  const timers = new Map();
  performance.now = () => now;
  Date.now = () => epoch + now;
  let seed = 0x5eed1e;
  Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  window.requestAnimationFrame = (fn) => (frames.set(nextId, fn), nextId++);
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const addTimer = (fn, ms, args, every) => (timers.set(nextId, { fn, at: now + Math.max(0, Number(ms) || 0), args, every }), nextId++);
  window.setTimeout = (fn, ms, ...args) => addTimer(fn, ms, args, null);
  window.setInterval = (fn, ms, ...args) => addTimer(fn, ms, args, Math.max(1, Number(ms) || 0));
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  const runTimers = (target) => {
    for (;;) {
      let due;
      for (const [id, t] of timers) if (t.at <= target && (!due || t.at < due[1].at)) due = [id, t];
      if (!due) return;
      const [id, t] = due;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every;
      else timers.delete(id);
      if (typeof t.fn === 'function') t.fn(...t.args);
    }
  };
  // Every CSS transition/animation is paused and its time set by hand.
  const pinned = new WeakMap();
  const pinAnimations = () => {
    for (const a of document.getAnimations()) {
      let pin = pinned.get(a);
      if (pin?.done) continue;
      if (!pin) {
        pin = { from: now, at: a.currentTime ?? 0 };
        pinned.set(a, pin);
        a.pause();
      }
      const time = pin.at + (now - pin.from);
      const end = a.effect?.getComputedTiming().endTime ?? Infinity;
      if (time >= end) {
        pin.done = true;
        a.finish();
      } else a.currentTime = time;
    }
  };
  window.__clock = {
    advance(ms) {
      const target = now + ms;
      runTimers(target);
      now = target;
      const due = frames;
      frames = new Map();
      for (const fn of due.values()) fn(now);
      pinAnimations();
    },
  };
  // The drawn hand: a headless browser paints no cursor.
  addEventListener('DOMContentLoaded', () => {
    const hand = document.createElement('div');
    hand.id = '__hand';
    hand.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.3-4.1 2.8 6.4 2.9-1.2-2.8-6.3h6z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(hand.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
      transformOrigin: '5px 2.5px', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.4))',
    });
    // Above a modal dialog's top layer too.
    hand.popover = 'manual';
    Object.assign(hand.style, { margin: '0', padding: '0', border: '0', background: 'none', overflow: 'visible', inset: 'auto' });
    document.body.append(hand);
    hand.showPopover();
  });
}

// ── Serving dist/ ────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(DIST) || !existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ── The take ─────────────────────────────────────────────────────────────────
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE, reducedMotion: 'no-preference' });
await page.addInitScript((set) => localStorage.setItem('stacked-deck:sound-set', set), SET);
await page.addInitScript(installClock);
await page.goto(origin + '/', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
// The poster frame: only the title and the table, the deck's cards larger
// (a phone's feed), everything centred and still.
await page.addStyleTag({
  content: `
    .demo-section:not(:has(.demo-felt)), .demo-footer, .demo-eyebrow { display: none !important; }
    .demo { min-height: 100svh; align-content: center; gap: 28px; padding-block: 24px; }
    .demo-header { text-align: center; justify-items: center; }
    .demo-section h2 { display: none; }
    .demo-felt { min-height: 300px; }
    :root { --sd-card-width: 320px; --sd-card-height: 448px; }
  `,
});

const target = (name) =>
  page.evaluate((name) => {
    if (name === 'start') return null;
    const selector = { deal: '[data-deal]', front: '.sd-card:not([inert]) .sd-face', close: '[data-sd-close]' }[name];
    const box = document.querySelector(selector).getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height * (name === 'front' ? 0.55 : 0.5)];
  }, name);
const front = () => page.evaluate(() => [...document.querySelectorAll('.sd-card')].findIndex((card) => !card.inert));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

let hand = [...START];
let glide = null; // { from, to, start, over }
let pressUntil = -1;
const sounds = []; // { at, name, seconds? }
const set = SETS[SET];
let nextTurn = 0;
const queue = [...TAKE];
const totalFrames = Math.round(DURATION * FPS);

for (let frame = 0; frame < totalFrames; frame++) {
  const t = frame / FPS;
  while (queue.length && queue[0].at <= t + 1e-9) {
    const step = queue.shift();
    if (step.to) {
      const to = typeof step.to === 'string' ? (await target(step.to)) ?? START : step.to;
      glide = { from: [...hand], to, start: t, over: step.over };
    } else if (step.click) {
      const wasOpen = await page.evaluate(() => document.querySelector('.sd-deck').open);
      const onClose = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('[data-sd-close]')), hand);
      await page.mouse.click(hand[0], hand[1]);
      pressUntil = t + 0.12;
      if (!wasOpen) sounds.push({ at: t, name: set.open, seconds: set.openSeconds });
      else if (!onClose) sounds.push({ at: t, name: set.choose });
    } else if (step.clearStatus) {
      await page.evaluate(() => {
        document.querySelector('[data-status]').textContent = '';
        document.querySelector('[data-chosen]')?.removeAttribute('data-chosen');
      });
    } else if (step.wheel) {
      const before = await front();
      await page.evaluate((cards) => {
        document.querySelector('.sd-deck').dispatchEvent(new WheelEvent('wheel', { deltaY: cards * 48, bubbles: true, cancelable: true }));
      }, step.wheel);
      if ((await front()) !== before) sounds.push({ at: t, name: set.turn[nextTurn++ % set.turn.length] });
    }
  }
  if (glide) {
    const p = Math.min(1, (t - glide.start) / glide.over);
    const k = ease(p);
    hand = [glide.from[0] + (glide.to[0] - glide.from[0]) * k, glide.from[1] + (glide.to[1] - glide.from[1]) * k];
    if (p >= 1) glide = null;
  }
  await page.evaluate(
    ([x, y, pressed]) => {
      const element = document.getElementById('__hand');
      element.style.transform = `translate(${x - 5}px, ${y - 2.5}px) scale(${pressed ? 0.86 : 1})`;
      // Keep the hand above a dialog opened since the last frame.
      if (document.querySelector('.sd-deck').open && element.dataset.top !== '1') {
        element.hidePopover();
        element.showPopover();
        element.dataset.top = '1';
      }
      if (!document.querySelector('.sd-deck').open) element.dataset.top = '';
    },
    [hand[0], hand[1], t < pressUntil],
  );
  if (frame > 0) await page.evaluate((ms) => window.__clock.advance(ms), 1000 / FPS);
  await page.screenshot({ path: path.join(FRAMES, `${String(frame).padStart(5, '0')}.png`) });
  if (frame % 60 === 0) process.stdout.write(`\r${(t).toFixed(1)} s / ${DURATION} s`);
}
process.stdout.write('\n');
await browser.close();
server.close();

// ── The soundtrack, rebuilt on the take's own times ──────────────────────────
let seed = 0x5eed1e;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const inputs = [];
const chains = [];
sounds.forEach((sound, index) => {
  inputs.push('-i', path.join(DIST, 'sounds', `${sound.name}.mp3`));
  const rate = 1 + (random() * 2 - 1) * PITCH_JITTER;
  const delay = Math.round(sound.at * 1000);
  const trim = sound.seconds ? `,atrim=0:${sound.seconds},afade=t=out:st=${sound.seconds - 0.1}:d=0.1` : '';
  chains.push(`[${index + 1}:a]asetrate=44100*${rate.toFixed(4)},aresample=44100${trim},volume=${VOLUME},adelay=${delay}:all=1[s${index}]`);
});
const mix = `${chains.join(';')};${sounds.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sounds.length}:normalize=0,apad,atrim=0:${DURATION},alimiter=limit=0.95[audio]`;

await new Promise((resolve, reject) => {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-framerate', String(FPS), '-i', path.join(FRAMES, '%05d.png'),
      ...inputs,
      '-filter_complex', mix,
      '-map', '0:v', '-map', '[audio]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
      '-movflags', '+faststart', '-shortest',
      OUT,
    ],
    { stdio: 'inherit' },
  );
  ffmpeg.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
});
rmSync(FRAMES, { recursive: true, force: true });
console.log(`${path.relative(ROOT, OUT)} — ${(statSync(OUT).size / 1e6).toFixed(1)} MB, ${sounds.length} sounds: ${sounds.map((s) => `${s.at.toFixed(2)}s ${s.name}`).join(', ')}`);
