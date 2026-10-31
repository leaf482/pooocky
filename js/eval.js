const CAT_NAMES = [
  "High card",
  "One pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
];

/** Five-card score packed in base 15. Higher is better. */
export function score5(cards) {
  const r0 = cards[0] % 13;
  const r1 = cards[1] % 13;
  const r2 = cards[2] % 13;
  const r3 = cards[3] % 13;
  const r4 = cards[4] % 13;
  const s0 = (cards[0] / 13) | 0;
  const flush =
    s0 === ((cards[1] / 13) | 0) &&
    s0 === ((cards[2] / 13) | 0) &&
    s0 === ((cards[3] / 13) | 0) &&
    s0 === ((cards[4] / 13) | 0);

  const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  cnt[r0]++;
  cnt[r1]++;
  cnt[r2]++;
  cnt[r3]++;
  cnt[r4]++;

  let uniq = 0;
  let straightHigh = -1;
  let top = -1;
  let second = -1;
  let third = -1;
  let fourth = -1;
  let fifth = -1;
  for (let r = 12; r >= 0; r--) {
    if (!cnt[r]) continue;
    uniq++;
    if (top < 0) top = r;
    else if (second < 0) second = r;
    else if (third < 0) third = r;
    else if (fourth < 0) fourth = r;
    else fifth = r;
  }
  if (uniq === 5 && top - fifth === 4) straightHigh = top;
  else if (top === 12 && second === 3 && third === 2 && fourth === 1 && fifth === 0) {
    straightHigh = 3;
  }

  let quads = -1;
  let trips = -1;
  let pairA = -1;
  let pairB = -1;
  let k0 = -1;
  let k1 = -1;
  let k2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = cnt[r];
    if (n === 4) quads = r;
    else if (n === 3) trips = r;
    else if (n === 2) {
      if (pairA < 0) pairA = r;
      else pairB = r;
    } else if (n === 1) {
      if (k0 < 0) k0 = r;
      else if (k1 < 0) k1 = r;
      else k2 = r;
    }
  }

  let cat;
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let e = 0;
  if (straightHigh >= 0 && flush) {
    cat = 8;
    a = straightHigh;
  } else if (quads >= 0) {
    cat = 7;
    a = quads;
    b = k0;
  } else if (trips >= 0 && pairA >= 0) {
    cat = 6;
    a = trips;
    b = pairA;
  } else if (flush) {
    cat = 5;
    a = top;
    b = second;
    c = third;
    d = fourth;
    e = fifth;
  } else if (straightHigh >= 0) {
    cat = 4;
    a = straightHigh;
  } else if (trips >= 0) {
    cat = 3;
    a = trips;
    b = k0;
    c = k1;
  } else if (pairB >= 0) {
    cat = 2;
    a = pairA;
    b = pairB;
    c = k0;
  } else if (pairA >= 0) {
    cat = 1;
    a = pairA;
    b = k0;
    c = k1;
    d = k2;
  } else {
    cat = 0;
    a = top;
    b = second;
    c = third;
    d = fourth;
    e = fifth;
  }

  return ((((((cat + 1) * 15 + (a + 1)) * 15 + (b + 1)) * 15 + (c + 1)) * 15 + (d + 1)) * 15 + (e + 1));
}

function bestDrop2(cards) {
  let best = -1;
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const five = [];
      for (let k = 0; k < 7; k++) {
        if (k !== i && k !== j) five.push(cards[k]);
      }
      const s = score5(five);
      if (s > best) best = s;
    }
  }
  return best;
}

export function scoreCards(cards) {
  const n = cards.length;
  if (n === 5) return score5(cards);
  if (n < 5) return -1;
  if (n === 7) return bestDrop2(cards);
  if (n === 6) {
    let best = -1;
    for (let i = 0; i < 6; i++) {
      const five = [];
      for (let j = 0; j < 6; j++) if (j !== i) five.push(cards[j]);
      const s = score5(five);
      if (s > best) best = s;
    }
    return best;
  }
  let best = -1;
  const idx = [0, 1, 2, 3, 4];
  const last = n - 1;
  while (true) {
    const s = score5([cards[idx[0]], cards[idx[1]], cards[idx[2]], cards[idx[3]], cards[idx[4]]]);
    if (s > best) best = s;
    let t = 4;
    while (t >= 0 && idx[t] === last - (4 - t)) t--;
    if (t < 0) break;
    idx[t]++;
    for (let u = t + 1; u < 5; u++) idx[u] = idx[u - 1] + 1;
  }
  return best;
}

export function unpackScore(score) {
  const parts = [0, 0, 0, 0, 0, 0];
  let x = score;
  for (let i = 5; i >= 0; i--) {
    parts[i] = (x % 15) - 1;
    x = (x / 15) | 0;
  }
  return parts;
}

export function handTitle(cards) {
  const score = scoreCards(cards);
  if (score < 0) return "—";
  const parts = unpackScore(score);
  if (parts[0] === 8 && parts[1] === 12) return "Royal flush";
  return CAT_NAMES[parts[0]] || "—";
}

export function handCategory(cards) {
  const score = scoreCards(cards);
  if (score < 0) return -1;
  return unpackScore(score)[0];
}
