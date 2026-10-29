/**
 * The demo's cards: generated, no image files. Each face is three gradients
 * in two hues spread by the golden angle, a title and a catalogue number.
 * Swap `paint` for anything — an <img>, a <video>, a canvas.
 */
import type { DeckCard } from './stacked-deck';

const TITLES = [
  'Low Orbit', 'Salt Flats', 'Night Ferry', 'Paper Lanterns', 'Copper Field', 'Glasshouse',
  'Slow Signal', 'Tidewater', 'Cold Open', 'Brass Hour', 'Field Recording', 'Late Bloom',
  'Northbound', 'Quiet Engine', 'Halftone Sun', 'Chalk Line', 'Ember Hall', 'Blue Hour',
  'Open Water', 'Mineral', 'Static Garden', 'Long Weekend', 'Moth Light', 'Second Draft',
];

const GOLDEN_ANGLE = 137.508;

export function demoCards(count: number): DeckCard[] {
  return Array.from({ length: count }, (_, index) => {
    const title = TITLES[index % TITLES.length]!;
    const hue = (index * GOLDEN_ANGLE) % 360;
    const accent = (hue + 40 + (index % 3) * 25) % 360;
    const number = String(index + 1).padStart(2, '0');
    return {
      id: `card-${number}`,
      title,
      paint(face) {
        face.style.background = [
          `radial-gradient(120% 90% at ${15 + (index * 23) % 70}% 0%, oklch(0.82 0.13 ${accent}) 0%, transparent 60%)`,
          `radial-gradient(90% 120% at 100% 100%, oklch(0.45 0.16 ${hue}) 0%, transparent 70%)`,
          `linear-gradient(160deg, oklch(0.62 0.15 ${hue}), oklch(0.3 0.08 ${accent}))`,
        ].join(', ');
        const label = document.createElement('span');
        label.className = 'demo-face-label';
        label.textContent = `No. ${number}`;
        const numeral = document.createElement('span');
        numeral.className = 'demo-face-numeral';
        numeral.textContent = number;
        numeral.setAttribute('aria-hidden', 'true');
        face.append(label, numeral);
      },
    };
  });
}
