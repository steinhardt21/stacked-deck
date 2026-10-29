# Stacked Deck

**[Live demo →](https://steinhardt21.github.io/stacked-deck/)**

A deck of cards in depth, laid over the page. Press **Deal**: the cards come up from below one at a time and the front card lands last. The deck opens at its **middle**, so the first scroll can go either way. Turn it with the wheel or trackpad, a vertical swipe or the arrow keys. A soft synthetic tick marks every card. Press the front card to choose it.

- **No runtime dependencies.** Vanilla TypeScript and CSS, about 3.5 KB of JS and 2.3 KB of CSS gzipped, demo included.
- **Motion in CSS.** The script writes one attribute per card (`data-depth`), only where it changes. Place, size, fade and blur are CSS transitions on a spring written as a `linear()` easing, so a turn stays on the compositor.
- **Sound without files.** Each tick is 25 ms of filtered noise made with Web Audio. The `AudioContext` is created on the press that opens the deck. On iOS the tick mixes with the visitor's music instead of pausing it, and the silent switch mutes it. A mute toggle is remembered per browser.
- **Accessible.** A native modal `<dialog>` (focus trap, Escape, inert page). Only the front card is focusable. Arrows, Home and End turn the deck, and the arrows follow the reading direction in right-to-left layouts. Reduced-motion users get a cross-fade with no deal and no travel.

## Run it

```sh
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # type-checks, then builds to dist/
```

## Use it

```ts
import { createStackedDeck, type DeckCard } from './src/stacked-deck';

const cards: DeckCard[] = photos.map((photo) => ({
  id: photo.id,
  title: photo.caption,
  // Called once, when the card first comes near the front.
  paint(face) {
    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = '';
    face.append(img);
  },
}));

const deck = createStackedDeck({
  onChoose(card) {
    location.href = `/photos/${card.id}`;
  },
  soundLevel: 0.45, // 0–1
  labels: { deck: 'Photos', close: 'Close', sound: 'Sound', hint: '…' },
});

button.addEventListener('click', () => deck.open(cards, button));
```

`open()` must be called from a click or key handler, because browsers start audio only after a user gesture. `close()` and `destroy()` do what they say.

## How it works

| Depth | Where the card is |
|---|---|
| `-1` | Turned: it grows by one step, drops and fades with a 1.5px blur |
| `0` | The front card, full size |
| `1`–`3` | Behind, each 7.5% smaller and 28px higher |
| `4` | Parked behind the third card, invisible, held still |

A turn changes the depth of at most six cards, however long the deck is. Cards further away stay at `-1` or `4` and are not restyled. Faces are painted only when a card comes within reach of the front.

**The deal.** While `data-dealing` is on the deck, cards at depth 0–3 start below the viewport (`@starting-style`) with delays of 120, 200, 280 and 360 ms, the front card last. The attribute comes off at the first turn, so a turn during the deal moves the cards from wherever they are. If nobody turns, it comes off once the deal has landed, so removing it never costs a frame.

**The spring.** Stiffness 320, damping 26, mass 0.6, sampled into `linear()`. It settles within 0.1% in about 320 ms with no visible overshoot. The formula is in `stacked-deck.css` for anyone who wants to tune it.

**Wheel and swipe.** Travel builds up and every 48 px turns one card, so trackpad momentum flows naturally. The page under the deck never scrolls. The tick plays at most once every 45 ms, so a fast flick doesn't turn into a buzz.

## Files

```
src/stacked-deck.ts    the deck: DOM, state, input
src/stacked-deck.css   all of its motion
src/tick.ts            the synthetic tick and the mute
src/demo-cards.ts      generated card faces for the demo
src/main.ts, demo.css  the demo page
```

## Credits

The idea of a stack of cards in depth that you scroll through comes from Rauno Freiberg's *Time Machine* prototype on [Devouring Details](https://devouringdetails.com). This project is an independent implementation with its own code, values and behaviour (deal, middle start, sound, captured wheel, no framework). None of the original's code, images or fonts are included.

## License

MIT
