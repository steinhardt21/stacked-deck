/**
 * A standard 52-card deck, drawn with the DOM — no image files. Each face has
 * the rank and suit in two opposite corners, the traditional pip layout for
 * 2–10 (pips in the lower half upside down, as printed), one large pip for an
 * ace and a framed letter for the court cards. Sizes are container-query
 * units, so a face draws itself at any size: the deck's card and the small
 * tiles on the page are the same code.
 */
import './playing-cards.css';
import type { DeckCard } from './stacked-deck';

type Suit = { name: string; symbol: string; red: boolean };

// U+FE0E asks for the text glyph, never an emoji.
const SUITS: readonly Suit[] = [
  { name: 'Spades', symbol: '♠︎', red: false },
  { name: 'Hearts', symbol: '♥︎', red: true },
  { name: 'Clubs', symbol: '♣︎', red: false },
  { name: 'Diamonds', symbol: '♦︎', red: true },
];

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
type Rank = (typeof RANKS)[number];

const RANK_NAMES: Record<Rank, string> = {
  A: 'Ace', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven',
  '8': 'Eight', '9': 'Nine', '10': 'Ten', J: 'Jack', Q: 'Queen', K: 'King',
};

/** Pip positions inside the pip field, as [x, y] in percent: x 0 | 50 | 100, y top to bottom. */
const L = 0, C = 50, R = 100;
const PIPS: Partial<Record<Rank, ReadonlyArray<readonly [number, number]>>> = {
  '2': [[C, 0], [C, 100]],
  '3': [[C, 0], [C, 50], [C, 100]],
  '4': [[L, 0], [R, 0], [L, 100], [R, 100]],
  '5': [[L, 0], [R, 0], [C, 50], [L, 100], [R, 100]],
  '6': [[L, 0], [R, 0], [L, 50], [R, 50], [L, 100], [R, 100]],
  '7': [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [L, 100], [R, 100]],
  '8': [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [C, 75], [L, 100], [R, 100]],
  '9': [[L, 0], [R, 0], [L, 33.3], [R, 33.3], [C, 50], [L, 66.7], [R, 66.7], [L, 100], [R, 100]],
  '10': [[L, 0], [R, 0], [C, 16.7], [L, 33.3], [R, 33.3], [L, 66.7], [R, 66.7], [C, 83.3], [L, 100], [R, 100]],
};

function span(className: string, text = ''): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function corner(rank: Rank, suit: Suit, position: 'top' | 'bottom'): HTMLSpanElement {
  const element = span(`pc-corner pc-corner-${position}`);
  element.append(span('pc-corner-rank', rank), span('pc-corner-suit', suit.symbol));
  return element;
}

function paintFace(face: HTMLElement, rank: Rank, suit: Suit) {
  face.classList.add('pc-face');
  face.classList.toggle('pc-red', suit.red);
  face.setAttribute('aria-hidden', 'true');
  face.append(corner(rank, suit, 'top'), corner(rank, suit, 'bottom'));

  const field = span('pc-field');
  if (rank === 'A') {
    field.append(span(`pc-ace${suit.name === 'Spades' ? ' pc-ace-spades' : ''}`, suit.symbol));
  } else if (rank === 'J' || rank === 'Q' || rank === 'K') {
    const court = span('pc-court');
    court.append(span('pc-court-suit pc-court-suit-top', suit.symbol), span('pc-court-letter', rank), span('pc-court-suit pc-court-suit-bottom', suit.symbol));
    field.append(court);
  } else {
    for (const [x, y] of PIPS[rank] ?? []) {
      const pip = span(`pc-pip${y > 50 ? ' pc-pip-flipped' : ''}`, suit.symbol);
      pip.style.left = `${x}%`;
      pip.style.top = `${y}%`;
      field.append(pip);
    }
  }
  face.append(field);
}

export function playingCards(): DeckCard[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${rank}-${suit.name}`.toLowerCase(),
      title: `${RANK_NAMES[rank]} of ${suit.name}`,
      paint: (face: HTMLElement) => paintFace(face, rank, suit),
    })),
  );
}
