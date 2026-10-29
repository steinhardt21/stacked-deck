# Stacked Deck

**[Live demo →](https://steinhardt21.github.io/stacked-deck/)**

A deck of playing cards in depth, laid over the page. Press **Deal**: the cards come up from below one at a time and the front card lands last. The deck opens at its **middle**, so the first scroll can go either way. Turn it with the wheel or trackpad, a vertical swipe or the arrow keys, and press the front card to choose it. Every turn makes a sound, from four sets you can switch between while the deck is open.

- **No runtime dependencies.** Vanilla TypeScript and CSS, about 6 KB of JS and 3.5 KB of CSS gzipped, demo included.
- **Motion in CSS.** The script writes one attribute per card (`data-depth`), only where it changes. Place, size, fade and blur are CSS transitions on a spring written as a `linear()` easing, so a turn stays on the compositor.
- **Four sound sets.** *Tick* is a 25 ms burst of filtered noise made in the browser, with no file. *Dealer*, *Table* and *Flick* are real card recordings (Kenney, CC0). Recordings are decoded ahead of time, on hover, so the open sound lands with the deal. Volume and pitch variation are adjustable, and mute is remembered per browser.
- **Real cards.** A standard 52-card deck drawn with the DOM: corner indices, the traditional pip layout for 2–10, court cards and aces. Every size uses container-query units, so the same face draws at any size.
- **Accessible.** A native modal `<dialog>` (focus trap, Escape, inert page). Only the front card is focusable. Arrows, Home and End turn the deck, and the arrows follow the reading direction in right-to-left layouts. Reduced-motion users get a cross-fade with no deal and no travel. The sound sets are a keyboard-navigable radio group.

## Run it

```sh
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # type-checks, then builds to dist/
```

## Use it

```ts
import { createStackedDeck, type DeckCard } from './src/stacked-deck';
import { createSampleSound, createTickSound, setVolume } from './src/sounds';
import { playingCards } from './src/playing-cards';

const deck = createStackedDeck({
  sound: createTickSound(),                // the default
  labels: { deck: 'Deck of playing cards' },
  onChoose(card) {
    console.log(card.title);                // "Queen of Hearts"
  },
});

button.addEventListener('click', () => deck.open(playingCards(), button));

// Switch to recorded sounds at any time, even while the deck is open:
deck.setSound(
  createSampleSound({
    open: '/sounds/card-fan-1.mp3',
    turn: ['/sounds/card-slide-1.mp3', '/sounds/card-slide-2.mp3'],
    choose: '/sounds/card-place-2.mp3',
  }),
);
setVolume(0.45);
```

A card is anything you can paint:

```ts
const photos: DeckCard[] = items.map((item) => ({
  id: item.id,
  title: item.caption,
  // Called once, when the card first comes near the front.
  paint(face) {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = '';
    face.append(img);
  },
}));
```

Set the card size on the page: `:root { --sd-card-width: …; --sd-card-height: … }`. The demo uses an upright 5 : 7.

Call `open()` from a click or key handler. Browsers start audio only after a user gesture, and a wheel doesn't count.

## How it works

| Depth | Where the card is |
|---|---|
| `-1` | Turned: it grows by one step, drops and fades with a 1.5px blur |
| `0` | The front card, full size |
| `1`–`3` | Behind, each 7.5% smaller and 28px higher |
| `4` | Parked behind the third card, invisible, held still |

A turn changes the depth of at most six cards, however long the deck is. Cards further away stay at `-1` or `4` and are not restyled. Faces are painted only when a card comes within reach of the front.

**The deal.** While `data-dealing` is on the deck, cards at depth 0–3 start below the viewport (`@starting-style`) with delays of 120, 200, 280 and 360 ms, the front card last. The timing follows the loudness of the Dealer set's fan sound, as the demo's chart shows. The attribute comes off at the first turn, so a turn during the deal moves the cards from wherever they are. If nobody turns, it comes off once the deal has landed, so removing it never costs a frame.

**The spring.** Stiffness 320, damping 26, mass 0.6, sampled into `linear()`. It settles within 0.1% in about 320 ms with no visible overshoot. The formula is in `stacked-deck.css` for anyone who wants to tune it.

**Wheel and swipe.** Travel builds up and every 48 px turns one card, so trackpad momentum flows naturally. The page under the deck never scrolls. A turn plays at most one sound every 45 ms, so a fast flick doesn't turn into a buzz.

**Audio.** All sounds play through one shared `AudioContext`, created by the press that opens the deck. Recordings are decoded by an `OfflineAudioContext`, which needs no user gesture, so they are ready before the press. A recording that isn't decoded in time is skipped rather than played late. On iOS the audio session is `ambient`: sounds mix with the visitor's music and obey the silent switch.

## Files

```
src/stacked-deck.ts     the deck: DOM, state, input, mute
src/stacked-deck.css    all of its motion
src/sounds.ts           the tick, recorded sets, shared audio, volume
src/playing-cards.ts    the 52 faces (+ playing-cards.css)
src/main.ts, demo.css   the demo page
public/sounds/          17 Kenney card recordings, CC0
```

## Credits

- Card sounds: [Casino Audio](https://kenney.nl/assets/casino-audio) by Kenney, CC0, converted to mono 96 kbps mp3 with the leading silence trimmed. The licence is in `public/sounds/`.
- The idea of a stack of cards in depth that you scroll through comes from Rauno Freiberg's *Time Machine* prototype on [Devouring Details](https://devouringdetails.com). This project is an independent implementation with its own code, values and behaviour (deal, middle start, sound sets, captured wheel, no framework). None of the original's code, images or fonts are included.

## License

MIT
