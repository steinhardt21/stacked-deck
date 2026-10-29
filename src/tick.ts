/**
 * A tick made in the browser: 25ms of white noise with a cubic decay, through
 * a band-pass. No audio file, nothing to fetch or license.
 *
 * The AudioContext is created by `wake()`, which must run inside a user
 * activation (a click, a key press). A wheel event is not one, so the deck
 * calls `wake()` from the press that opens it, and every later tick can play.
 * On iOS Safari the audio session is set to `ambient`: the tick mixes with
 * whatever the visitor is listening to and respects the silent switch.
 */

export interface Ticker {
  /** Creates or resumes the AudioContext. Call from inside a click or key handler. */
  wake(): void;
  /** One tick. `pitch` is the band-pass centre in Hz. */
  tick(pitch: number): void;
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
}

const DURATION_SECONDS = 0.025;
const BAND_Q = 1.2;
const PITCH_JITTER = 0.05;

export function createTicker({ level = 0.45, storageKey = 'stacked-deck:muted' } = {}): Ticker {
  let audio: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let enabled = readEnabled();

  function readEnabled(): boolean {
    try {
      return localStorage.getItem(storageKey) !== '1';
    } catch {
      return true; // storage blocked (private mode): sound stays on for this visit
    }
  }

  function noiseFor(context: AudioContext): AudioBuffer {
    if (noise && noise.sampleRate === context.sampleRate) return noise;
    const frames = Math.floor(context.sampleRate * DURATION_SECONDS);
    noise = context.createBuffer(1, frames, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const fade = 1 - i / frames;
      data[i] = (Math.random() * 2 - 1) * fade * fade * fade;
    }
    return noise;
  }

  return {
    wake() {
      if (!audio) {
        if (typeof AudioContext === 'undefined') return;
        const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (session) session.type = 'ambient';
        audio = new AudioContext({ latencyHint: 'interactive' });
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    },

    tick(pitch) {
      if (!enabled || !audio || audio.state === 'closed') return;
      const source = audio.createBufferSource();
      source.buffer = noiseFor(audio);
      const band = audio.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = BAND_Q;
      band.frequency.value = pitch * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
      const gain = audio.createGain();
      gain.gain.value = level;
      source.connect(band).connect(gain).connect(audio.destination);
      source.start();
    },

    get enabled() {
      return enabled;
    },

    setEnabled(on) {
      enabled = on;
      try {
        if (on) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, '1');
      } catch {
        // not remembered; holds for this visit
      }
    },
  };
}
