/**
 * The deck's sounds. A `DeckSound` is three moments — the deck opens, a card
 * turns, the front card is chosen — and two ready-made kinds:
 *
 *   - `createTickSound()`: 25ms of filtered noise, made in the browser. No
 *     file, nothing to fetch or license.
 *   - `createSampleSound()`: recorded sounds (mp3/ogg/wav URLs), fetched and
 *     decoded ahead of time by `prepare()`, each take played with a little
 *     pitch jitter so a run of turns never sounds like a loop.
 *
 * Every kind plays through ONE shared AudioContext, created by `wakeAudio()` —
 * which must run inside a user activation (a click, a key press; a wheel is
 * not one). The deck calls it from the press that opens it. On iOS Safari the
 * audio session is set to `ambient`: sounds mix with the visitor's music and
 * respect the silent switch. Muting and rate-limiting are the deck's job.
 */

export interface DeckSound {
  /** Fetch and decode anything needed. Safe to call any time, any number of times. */
  prepare(): void;
  open(): void;
  turn(): void;
  choose(): void;
}

let shared: AudioContext | null = null;
let volume = 0.45;
let decoder: BaseAudioContext | null = null;

/** Creates or resumes the shared AudioContext. Call from inside a click or key handler. */
export function wakeAudio(): void {
  if (!shared) {
    if (typeof AudioContext === 'undefined') return;
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
    shared = new AudioContext({ latencyHint: 'interactive' });
  }
  if (shared.state === 'suspended') shared.resume().catch(() => {});
}

/** Master volume for every sound, 0–1. */
export function setVolume(level: number): void {
  volume = Math.max(0, Math.min(1, level));
}

export function getVolume(): number {
  return volume;
}

function live(): AudioContext | null {
  return shared && shared.state !== 'closed' ? shared : null;
}

function jitter(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}

// ── Synthetic tick ──────────────────────────────────────────────────────────

export interface TickOptions {
  /** Band-pass centre for a turn, in Hz. */
  turnPitch?: number;
  /** Band-pass centre for a choice, in Hz: lower, a card laid down. */
  choosePitch?: number;
  /** Gain relative to the master volume (a tick is quieter than a recording). */
  gain?: number;
  /** Pitch jitter per tick, as a fraction (0.05 = ±5%). */
  pitchJitter?: number;
}

export function createTickSound({ turnPitch = 3200, choosePitch = 1400, gain = 1.6, pitchJitter = 0.05 }: TickOptions = {}): DeckSound {
  let noise: AudioBuffer | null = null;

  function tick(pitch: number) {
    const audio = live();
    if (!audio) return;
    if (!noise || noise.sampleRate !== audio.sampleRate) {
      const frames = Math.floor(audio.sampleRate * 0.025);
      noise = audio.createBuffer(1, frames, audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        const fade = 1 - i / frames;
        data[i] = (Math.random() * 2 - 1) * fade * fade * fade;
      }
    }
    const source = audio.createBufferSource();
    source.buffer = noise;
    const band = audio.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    band.frequency.value = pitch * jitter(pitchJitter);
    const level = audio.createGain();
    level.gain.value = volume * gain;
    source.connect(band).connect(level).connect(audio.destination);
    source.start();
  }

  return {
    prepare() {},
    open() {},
    turn: () => tick(turnPitch),
    choose: () => tick(choosePitch),
  };
}

// ── Recorded sounds ─────────────────────────────────────────────────────────

export interface SampleOptions {
  /** Played as the deck opens. */
  open?: string;
  /** Cut the open sound after this many seconds, with a short fade. */
  openSeconds?: number;
  /** Takes played in turn, one per turn. */
  turn: readonly string[];
  choose?: string;
  /** Pitch jitter per play, as a fraction (0.04 = ±4%). */
  pitchJitter?: number;
}

const decoded = new Map<string, Promise<AudioBuffer | null>>();

/**
 * Fetch and decode once per URL. Decoding uses an OfflineAudioContext, which
 * needs no user activation and logs no warning, so it can run on hover —
 * before the press — and the open sound is ready the moment the deck opens.
 * An AudioBuffer plays in any context.
 */
function load(url: string): Promise<AudioBuffer | null> {
  let pending = decoded.get(url);
  if (!pending) {
    decoder ??= shared ?? (typeof OfflineAudioContext === 'undefined' ? null : new OfflineAudioContext(1, 1, 44100));
    const using = decoder;
    pending = using
      ? fetch(url)
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .then((bytes) => (bytes ? using.decodeAudioData(bytes) : null))
          .catch(() => null)
      : Promise.resolve(null);
    decoded.set(url, pending);
  }
  return pending;
}

export function createSampleSound(options: SampleOptions): DeckSound {
  const { pitchJitter = 0.04 } = options;
  const urls = [options.open, options.choose, ...options.turn].filter((url): url is string => Boolean(url));
  let next = 0;

  /** Plays `url` if it is decoded within `latestMs` of being asked: any later, it would land after its card. */
  function play(url: string | undefined, latestMs: number, seconds?: number) {
    const audio = live();
    if (!url || !audio) return;
    const askedAt = performance.now();
    void load(url).then((buffer) => {
      if (!buffer || performance.now() - askedAt > latestMs) return;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = jitter(pitchJitter);
      const level = audio.createGain();
      level.gain.value = volume;
      source.connect(level).connect(audio.destination);
      source.start();
      if (seconds) {
        level.gain.setTargetAtTime(0, audio.currentTime + seconds - 0.08, 0.03);
        source.stop(audio.currentTime + seconds);
      }
    });
  }

  return {
    prepare() {
      for (const url of urls) void load(url);
    },
    open: () => play(options.open, 250, options.openSeconds),
    turn: () => play(options.turn[next++ % options.turn.length], 80),
    choose: () => play(options.choose, 80),
  };
}
