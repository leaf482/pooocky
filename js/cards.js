export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = ["♠", "♥", "♦", "♣"];

export function cardRank(id) {
  return id % 13;
}

export function cardSuit(id) {
  return (id / 13) | 0;
}

export function cardParts(id) {
  const rank = cardRank(id);
  const suit = cardSuit(id);
  return {
    id,
    rank,
    suit,
    rankLabel: RANK_CHARS[rank],
    suitLabel: SUIT_CHARS[suit],
    red: suit === 1 || suit === 2,
    text: RANK_CHARS[rank] + SUIT_CHARS[suit],
  };
}

export function cardText(id) {
  return RANK_CHARS[cardRank(id)] + SUIT_CHARS[cardSuit(id)];
}

export function freshDeck() {
  const deck = new Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  return deck;
}

export function shuffle(deck, rng) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
  return deck;
}
