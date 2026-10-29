import './demo.css';
import { playingCards } from './playing-cards';
import { createSampleSound, createTickSound, setVolume, wakeAudio, type DeckSound } from './sounds';
import { createStackedDeck } from './stacked-deck';

const sound = (name: string) => `${import.meta.env.BASE_URL}sounds/${name}.mp3`;

// ── Sound sets ──────────────────────────────────────────────────────────────

interface SoundSet {
  id: string;
  name: string;
  tag: string;
  note: string;
  make(varyPitch: boolean): DeckSound;
}

const SOUND_SETS: readonly SoundSet[] = [
  {
    id: 'tick',
    name: 'Tick',
    tag: 'No files',
    note: '25 ms of filtered noise made in the browser on every turn, and a lower one to choose. The open is silent.',
    make: (vary) => createTickSound({ pitchJitter: vary ? 0.05 : 0 }),
  },
  {
    id: 'dealer',
    name: 'Dealer',
    tag: 'Recorded',
    note: 'A card sliding off the shoe on every turn, a fan of cards as the deck opens, a card laid down to choose.',
    make: (vary) =>
      createSampleSound({
        open: sound('card-fan-1'),
        turn: ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-5', 'card-slide-6', 'card-slide-7'].map(sound),
        choose: sound('card-place-2'),
        pitchJitter: vary ? 0.04 : 0,
      }),
  },
  {
    id: 'table',
    name: 'Table',
    tag: 'Recorded',
    note: 'A card slapped on the felt on every turn: more punch. The deck opens with its pack.',
    make: (vary) =>
      createSampleSound({
        open: sound('cards-pack-open-2'),
        turn: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'].map(sound),
        choose: sound('card-shove-1'),
        pitchJitter: vary ? 0.04 : 0,
      }),
  },
  {
    id: 'flick',
    name: 'Flick',
    tag: 'Recorded',
    note: 'A card pushed across on every turn. The deck opens with a short shuffle.',
    make: (vary) =>
      createSampleSound({
        open: sound('card-shuffle'),
        openSeconds: 0.8,
        turn: ['card-shove-1', 'card-shove-2', 'card-shove-3', 'card-shove-4'].map(sound),
        choose: sound('card-place-4'),
        pitchJitter: vary ? 0.04 : 0,
      }),
  },
];

const SET_STORAGE_KEY = 'stacked-deck:sound-set';

function remembered(): SoundSet {
  try {
    const id = localStorage.getItem(SET_STORAGE_KEY);
    return SOUND_SETS.find((set) => set.id === id) ?? SOUND_SETS[0]!;
  } catch {
    return SOUND_SETS[0]!;
  }
}

let chosenSet = remembered();
const varyInput = document.querySelector<HTMLInputElement>('#vary')!;
let currentSound = chosenSet.make(varyInput.checked);

// ── The deck ────────────────────────────────────────────────────────────────

const cards = playingCards();
const grid = document.querySelector<HTMLElement>('[data-grid]')!;
const status = document.querySelector<HTMLElement>('[data-status]')!;
const dealButton = document.querySelector<HTMLButtonElement>('[data-deal]')!;

for (const card of cards) {
  const tile = document.createElement('div');
  tile.className = 'demo-tile';
  tile.id = card.id;
  const face = document.createElement('span');
  face.className = 'demo-tile-face';
  card.paint(face);
  const title = document.createElement('span');
  title.className = 'demo-tile-title';
  title.textContent = card.title;
  tile.append(face, title);
  grid.append(tile);
}

const deck = createStackedDeck({
  sound: currentSound,
  labels: { deck: 'Deck of playing cards' },
  onChoose(card) {
    status.textContent = `You chose the ${card.title}.`;
    grid.querySelector('[data-chosen]')?.removeAttribute('data-chosen');
    const tile = document.getElementById(card.id);
    if (tile) tile.dataset.chosen = '';
  },
});

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// Decode the set's files as the button is reached for, so the open sound is ready on the press.
dealButton.addEventListener('pointerenter', () => currentSound.prepare());
dealButton.addEventListener('focus', () => currentSound.prepare());
dealButton.addEventListener('click', () => deck.open(shuffled(cards), dealButton));

// ── Sound picker and controls ───────────────────────────────────────────────

const setsElement = document.querySelector<HTMLElement>('[data-sets]')!;
const setButtons = SOUND_SETS.map((set) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'demo-set';
  button.setAttribute('role', 'radio');
  button.innerHTML = '<span class="demo-set-tag"></span><b></b><span class="demo-set-note"></span>';
  button.querySelector('.demo-set-tag')!.textContent = set.tag;
  button.querySelector('b')!.textContent = set.name;
  button.querySelector('.demo-set-note')!.textContent = set.note;
  button.addEventListener('click', () => choose(set, true));
  setsElement.append(button);
  return button;
});

function choose(set: SoundSet, preview: boolean) {
  chosenSet = set;
  currentSound = set.make(varyInput.checked);
  deck.setSound(currentSound);
  setButtons.forEach((button, index) => button.setAttribute('aria-checked', String(SOUND_SETS[index] === set)));
  try {
    localStorage.setItem(SET_STORAGE_KEY, set.id);
  } catch {
    // not remembered
  }
  if (preview) {
    wakeAudio();
    // A turn, as soon as its file can have been decoded.
    window.setTimeout(() => currentSound.turn(), set.id === 'tick' ? 0 : 60);
  }
}
choose(chosenSet, false);

// Arrow keys move between the radios, as a radio group should.
setsElement.addEventListener('keydown', (event) => {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const at = (SOUND_SETS.indexOf(chosenSet) + step + SOUND_SETS.length) % SOUND_SETS.length;
  choose(SOUND_SETS[at]!, true);
  setButtons[at]!.focus();
});

const volumeInput = document.querySelector<HTMLInputElement>('#volume')!;
const volumeValue = document.querySelector<HTMLOutputElement>('#volume-value')!;
volumeInput.addEventListener('input', () => {
  setVolume(Number(volumeInput.value));
  volumeValue.value = Number(volumeInput.value).toFixed(2);
});
setVolume(Number(volumeInput.value));
varyInput.addEventListener('change', () => choose(chosenSet, false));

// ── Every take ──────────────────────────────────────────────────────────────

const TAKES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Slide', ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-5', 'card-slide-6', 'card-slide-7']],
  ['Place', ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4']],
  ['Shove', ['card-shove-1', 'card-shove-2', 'card-shove-3', 'card-shove-4']],
  ['Fan, pack and shuffle', ['card-fan-1', 'cards-pack-open-2', 'card-shuffle']],
];

const takesElement = document.querySelector<HTMLElement>('[data-takes]')!;
const takePlayers = new Map<string, DeckSound>();
for (const [group, names] of TAKES) {
  const block = document.createElement('div');
  block.className = 'demo-take-group';
  const heading = document.createElement('h3');
  heading.textContent = group;
  const row = document.createElement('div');
  row.className = 'demo-take-row';
  for (const name of names) {
    const player = createSampleSound({ open: sound(name), turn: [] });
    takePlayers.set(name, player);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'demo-take';
    button.textContent = name;
    button.addEventListener('click', () => {
      wakeAudio();
      player.open();
    });
    row.append(button);
  }
  block.append(heading, row);
  takesElement.append(block);
}
takesElement.addEventListener('pointerenter', () => takePlayers.forEach((player) => player.prepare()), { once: true });
takesElement.addEventListener('focusin', () => takePlayers.forEach((player) => player.prepare()), { once: true });

// ── The fan's loudness, to scale ────────────────────────────────────────────

/** RMS of card-fan-1 in dB, one value per 10 ms (measured with ffmpeg, 2026-10-29). */
const FAN_DB = [
  -46.3, -46.1, -41.3, -33.6, -41.5, -40.0, -33.0, -40.1, -44.7, -38.4, -32.6, -44.9, -49.7, -45.9, -44.2, -29.7, -26.1,
  -27.5, -29.7, -26.4, -24.2, -21.8, -30.2, -22.5, -32.0, -40.6, -27.5, -21.6, -29.1, -22.9, -29.9, -24.1, -24.7, -28.0,
  -23.9, -23.7, -22.6, -38.5, -24.3, -24.8, -21.5, -25.4, -23.7, -20.0, -38.4, -23.2, -14.5, -14.1, -13.2, -14.1, -13.9,
  -15.1, -15.1, -30.7, -39.3, -42.9, -26.5, -16.8, -12.5, -28.2, -35.6, -40.4, -41.3, -41.2, -41.2, -44.5, -41.0, -43.1,
  -42.0, -44.9, -45.5, -47.3,
];
const LANDINGS: ReadonlyArray<readonly [number, string]> = [
  [330, 'card 3'],
  [400, 'card 2'],
  [470, 'card 1'],
  [545, 'front'],
];

const canvas = document.querySelector<HTMLCanvasElement>('[data-wave]')!;
function drawWave() {
  const ratio = devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const g = canvas.getContext('2d')!;
  g.scale(ratio, ratio);
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(name).trim();
  const [ink, dim, line, accent] = [color('--ink'), color('--ink-dim'), color('--line'), color('--accent')];

  const pad = { left: 44, right: 10, top: 26, bottom: 26 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const msMax = 720;
  const x = (ms: number) => pad.left + (ms / msMax) * plotWidth;
  const y = (db: number) => pad.top + plotHeight * (Math.min(0, Math.max(-60, db)) / -60);

  g.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textBaseline = 'middle';
  for (const db of [0, -20, -40, -60]) {
    g.strokeStyle = line;
    g.beginPath();
    g.moveTo(pad.left, y(db));
    g.lineTo(width - pad.right, y(db));
    g.stroke();
    g.fillStyle = dim;
    g.textAlign = 'right';
    g.fillText(`${db} dB`, pad.left - 6, y(db));
  }
  g.textAlign = 'center';
  for (let ms = 0; ms <= 700; ms += 100) g.fillText(`${ms} ms`, x(ms), height - 10);

  const barWidth = plotWidth / (msMax / 10) - 1;
  FAN_DB.forEach((db, i) => {
    const ms = i * 10;
    const peak = ms >= 460 && ms < 530;
    const riffle = ms >= 150 && ms < 460;
    g.fillStyle = peak ? accent : riffle ? ink : dim;
    g.globalAlpha = peak ? 1 : riffle ? 0.75 : 0.45;
    g.fillRect(x(ms), y(db), barWidth, y(-60) - y(db));
  });
  g.globalAlpha = 1;

  for (const [ms, label] of LANDINGS) {
    g.strokeStyle = accent;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x(ms), pad.top - 4);
    g.lineTo(x(ms), y(-60));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = accent;
    g.fillText(label, x(ms), pad.top - 13);
  }
}
drawWave();
new ResizeObserver(drawWave).observe(canvas);
