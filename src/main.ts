import './demo.css';
import { demoCards } from './demo-cards';
import { createStackedDeck } from './stacked-deck';

const CARD_COUNT = 48;
const cards = demoCards(CARD_COUNT);

// The table behind the deck: every card, small.
const table = document.querySelector<HTMLElement>('[data-table]')!;
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
  table.append(tile);
}

const status = document.querySelector<HTMLElement>('[data-status]')!;
const dealButton = document.querySelector<HTMLButtonElement>('[data-deal]')!;

const deck = createStackedDeck({
  onChoose(card) {
    status.textContent = `You chose “${card.title}”.`;
    const tile = document.getElementById(card.id);
    if (!tile) return;
    table.querySelector('[data-chosen]')?.removeAttribute('data-chosen');
    tile.dataset.chosen = '';
    tile.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  },
});

dealButton.addEventListener('click', () => {
  // A fresh shuffle every time (Fisher–Yates).
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  deck.open(shuffled, dealButton);
});
