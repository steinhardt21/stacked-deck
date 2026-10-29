/**
 * Stacked Deck — a deck of cards in depth over the page.
 *
 * The script only decides WHICH card is in front. Every card carries
 * `data-depth`: its distance from the front card, held between -1 (already
 * turned) and 4 (beyond the visible pile). The stylesheet turns each depth into
 * a place, a size, an opacity and a blur, and animates between them with a
 * spring written as a CSS `linear()` easing — so a turn is a handful of
 * attribute writes and the browser's compositor does the rest.
 *
 *   - Opens at the MIDDLE card, so the very first gesture can go either way.
 *   - Deals the visible cards up from below one at a time, the front card last.
 *   - Turns by wheel or trackpad (captured, never scrolling the page), by a
 *     vertical swipe, or by the arrow keys; Home and End jump to either end.
 *   - Ticks on every turn (a synthetic sound, see `tick.ts`), with a mute
 *     toggle remembered per browser.
 */
import './stacked-deck.css';
import { createTicker } from './tick';

export interface DeckCard {
  id: string;
  title: string;
  /** Paints the card's face. Called once, when the card first comes near the front. */
  paint(face: HTMLElement): void;
}

export interface DeckLabels {
  deck: string;
  hint: string;
  close: string;
  sound: string;
}

export interface StackedDeckOptions {
  /** The front card was chosen (click, tap or Enter). The deck has already closed. */
  onChoose?(card: DeckCard): void;
  labels?: Partial<DeckLabels>;
  /** Volume of the tick, 0–1. */
  soundLevel?: number;
}

export interface StackedDeck {
  /** Deals `cards` and opens the deck. Focus returns to `returnFocusTo` on close. */
  open(cards: readonly DeckCard[], returnFocusTo?: HTMLElement): void;
  close(): void;
  destroy(): void;
}

const DEFAULT_LABELS: DeckLabels = {
  deck: 'Deck of cards',
  hint: 'Scroll, swipe or use the arrow keys to turn the cards. Press the front card to choose it.',
  close: 'Close',
  sound: 'Sound',
};

/** Depth beyond which a card is parked out of sight (and never restyled on a turn). */
const PARKED_DEPTH = 4;
/** Wheel or swipe travel, in pixels, that turns one card. */
const TRAVEL_PER_CARD = 48;
/** A line-mode wheel (Firefox mouse wheels) in pixels per line. */
const PIXELS_PER_LINE = 16;
/** At most one tick per this many ms: a fast flick turns several cards a frame. */
const MIN_TICK_GAP_MS = 45;
const TURN_PITCH_HZ = 3200;
const CHOOSE_PITCH_HZ = 1400;
/** The deal's last card leaves at 360ms on a ~320ms spring; by this time all have landed. */
const DEAL_LANDED_MS = 900;
/** Longest exit fade, after which the dealt cards are removed from the page. */
const EXIT_FADE_MS = 250;

const SPEAKER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path class="sd-sound-waves" d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/><path class="sd-sound-cross" d="m16 10 5 5m0-5-5 5"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`;

let instances = 0;

export function createStackedDeck(options: StackedDeckOptions = {}): StackedDeck {
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const ticker = createTicker({ level: options.soundLevel ?? 0.45 });
  const hintId = `stacked-deck-hint-${++instances}`;

  const dialog = document.createElement('dialog');
  dialog.className = 'sd-deck';
  dialog.setAttribute('aria-label', labels.deck);
  dialog.setAttribute('aria-describedby', hintId);
  dialog.innerHTML = `
    <p class="sd-visually-hidden" id="${hintId}"></p>
    <div class="sd-controls">
      <button type="button" class="sd-control" data-sd-sound>${SPEAKER_ICON}</button>
      <button type="button" class="sd-control" data-sd-close>${CLOSE_ICON}</button>
    </div>
    <div class="sd-pile"></div>`;
  dialog.querySelector(`#${hintId}`)!.textContent = labels.hint;
  const pile = dialog.querySelector<HTMLElement>('.sd-pile')!;
  const soundButton = dialog.querySelector<HTMLButtonElement>('[data-sd-sound]')!;
  const closeButton = dialog.querySelector<HTMLButtonElement>('[data-sd-close]')!;
  soundButton.setAttribute('aria-label', labels.sound);
  closeButton.setAttribute('aria-label', labels.close);
  document.body.append(dialog);

  let deck: readonly DeckCard[] = [];
  let elements: HTMLButtonElement[] = [];
  const painted = new WeakSet<HTMLElement>();
  let front = 0;
  let returnFocusTo: HTMLElement | undefined;
  let chosen: DeckCard | null = null;
  let dealTimer: number | undefined;
  let clearTimer: number | undefined;
  let lastTickAt = -Infinity;
  let wheelTravel = 0;
  let swipe: { pointerId: number; y: number } | null = null;

  const depthOf = (index: number) => String(Math.max(-1, Math.min(PARKED_DEPTH, index - front)));

  function cardElement(card: DeckCard, index: number): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'sd-card';
    element.style.zIndex = String(deck.length - index);
    element.dataset.depth = depthOf(index);
    element.inert = index !== front;
    const face = document.createElement('span');
    face.className = 'sd-face';
    const title = document.createElement('span');
    title.className = 'sd-title';
    title.textContent = card.title;
    element.append(face, title);
    return element;
  }

  /** Faces of the card just turned, the front one and those behind it, painted once each. */
  function paintNearFront() {
    for (let index = Math.max(0, front - 1); index <= Math.min(elements.length - 1, front + PARKED_DEPTH); index++) {
      const face = elements[index]!.firstElementChild as HTMLElement;
      if (painted.has(face)) continue;
      painted.add(face);
      deck[index]!.paint(face);
    }
  }

  function turnTo(index: number) {
    const next = Math.max(0, Math.min(elements.length - 1, index));
    if (next === front || chosen) return;
    // A turn ends the deal: cards still flying retarget from where they are.
    delete dialog.dataset.dealing;
    const focusWasOnFront = document.activeElement === elements[front];
    front = next;
    elements.forEach((element, at) => {
      const depth = depthOf(at);
      if (element.dataset.depth !== depth) element.dataset.depth = depth;
      if (element.inert !== (at !== front)) element.inert = at !== front;
    });
    paintNearFront();
    if (focusWasOnFront) elements[front]!.focus({ preventScroll: true });

    const now = performance.now();
    if (now - lastTickAt >= MIN_TICK_GAP_MS) {
      lastTickAt = now;
      ticker.tick(TURN_PITCH_HZ);
    }
  }

  function choose() {
    const card = deck[front];
    if (!card || chosen) return;
    chosen = card;
    ticker.tick(CHOOSE_PITCH_HZ);
    dialog.close();
  }

  function syncSoundButton() {
    soundButton.setAttribute('aria-pressed', String(ticker.enabled));
  }

  // ── Events ────────────────────────────────────────────────────────────────
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE ? PIXELS_PER_LINE : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    wheelTravel += delta * unit;
    const cards = Math.trunc(wheelTravel / TRAVEL_PER_CARD);
    if (!cards) return;
    wheelTravel -= cards * TRAVEL_PER_CARD;
    turnTo(front + cards);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') swipe = { pointerId: event.pointerId, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!swipe || event.pointerId !== swipe.pointerId) return;
    const cards = Math.trunc((swipe.y - event.clientY) / TRAVEL_PER_CARD);
    if (!cards) return;
    swipe.y -= cards * TRAVEL_PER_CARD;
    turnTo(front + cards);
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (swipe?.pointerId === event.pointerId) swipe = null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rtl = getComputedStyle(dialog).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let target: number | null = null;
    if (event.key === 'ArrowDown' || event.key === forward) target = front + 1;
    else if (event.key === 'ArrowUp' || event.key === backward) target = front - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = elements.length - 1;
    if (target === null) return;
    event.preventDefault();
    turnTo(target);
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    if (target === dialog) return dialog.close(); // the backdrop
    if (target.closest('[data-sd-close]')) return dialog.close();
    if (target.closest('[data-sd-sound]')) {
      ticker.setEnabled(!ticker.enabled);
      syncSoundButton();
      if (ticker.enabled) {
        ticker.wake();
        ticker.tick(CHOOSE_PITCH_HZ);
      }
      return;
    }
    if (target.closest('.sd-card') === elements[front]) choose();
  };

  const onClose = () => {
    window.clearTimeout(dealTimer);
    delete dialog.dataset.dealing;
    const picked = chosen;
    if (!picked) returnFocusTo?.focus({ preventScroll: true });
    // Keep the cards for the exit fade, then drop them.
    clearTimer = window.setTimeout(() => {
      if (dialog.open) return;
      pile.replaceChildren();
      elements = [];
    }, EXIT_FADE_MS);
    if (picked) options.onChoose?.(picked);
  };

  dialog.addEventListener('wheel', onWheel, { passive: false });
  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointermove', onPointerMove);
  dialog.addEventListener('pointerup', onPointerEnd);
  dialog.addEventListener('pointercancel', onPointerEnd);
  dialog.addEventListener('keydown', onKeyDown);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('close', onClose);

  return {
    open(cards, focusOnClose) {
      if (dialog.open || cards.length === 0) return;
      window.clearTimeout(clearTimer);
      deck = cards;
      front = Math.floor(cards.length / 2);
      chosen = null;
      wheelTravel = 0;
      returnFocusTo = focusOnClose;
      elements = cards.map(cardElement);
      pile.replaceChildren(...elements);
      paintNearFront();
      syncSoundButton();
      ticker.wake(); // inside the press that opened the deck: the activation audio needs

      dialog.dataset.dealing = '';
      dialog.showModal();
      elements[front]!.focus({ preventScroll: true });
      // Taking `data-dealing` off restyles every card once: do it while nothing moves.
      window.clearTimeout(dealTimer);
      dealTimer = window.setTimeout(() => delete dialog.dataset.dealing, DEAL_LANDED_MS);
    },

    close() {
      if (dialog.open) dialog.close();
    },

    destroy() {
      window.clearTimeout(dealTimer);
      window.clearTimeout(clearTimer);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
