import { freshDeck, shuffle } from "./cards.js";
import { rngFrom } from "./rng.js";
import { handTitle, scoreCards } from "./eval.js";

const STREET_NEXT = {
  preflop: "flop",
  flop: "turn",
  turn: "river",
};

function actionLabel(name, action) {
  switch (action.type) {
    case "fold":
      return `${name} folds`;
    case "check":
      return `${name} checks`;
    case "call":
      return `${name} calls ${action.put}`;
    case "bet":
      return `${name} bets ${action.put}`;
    case "raise":
      return `${name} raises to ${action.total}`;
    case "allin":
      return `${name} all-in ${action.total}`;
    default:
      return `${name} waits`;
  }
}

function matchAction(legal, action) {
  if (!action) return null;
  return (
    legal.find((a) => a.type === action.type && a.total === action.total && a.put === action.put) ||
    legal.find((a) => a.type === action.type && a.total === action.total) ||
    legal.find((a) => a.type === action.type && a.put === action.put) ||
    null
  );
}

export class PokerEngine {
  constructor(opts = {}) {
    this.sb = opts.sb ?? 10;
    this.bb = opts.bb ?? 20;
    this.startStack = opts.startStack ?? 2000;
    this.rng = rngFrom(opts.rng ?? opts.seed ?? Date.now());
    this.players = [
      { name: opts.nameA ?? "AI A", stack: this.startStack },
      { name: opts.nameB ?? "AI B", stack: this.startStack },
    ];
    this.initialButton = opts.button ?? 0;
    this.button = this.initialButton;
    this.street = "idle";
    this.pot = 0;
    this.board = [];
    this.hand = null;
    this.deck = [];
    this.di = 0;
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.toAct = 0;
    this.profit = [0, 0];
    this.sessionWins = [0, 0];
    this.sessions = 0;
    this.handsPlayed = 0;
    this.result = null;
    this.stackSnap = [this.startStack, this.startStack];
    this.paying = false;
  }

  reset() {
    this.players[0].stack = this.startStack;
    this.players[1].stack = this.startStack;
    this.button = this.initialButton;
    this.street = "idle";
    this.pot = 0;
    this.board = [];
    this.hand = null;
    this.profit = [0, 0];
    this.sessionWins = [0, 0];
    this.sessions = 0;
    this.handsPlayed = 0;
    this.result = null;
  }

  draw() {
    return this.deck[this.di++];
  }

  burn() {
    this.di++;
  }

  totalPot() {
    const extra = this.hand ? this.hand[0].streetBet + this.hand[1].streetBet : 0;
    return this.pot + extra;
  }

  toCall(seat) {
    if (!this.hand) return 0;
    return Math.max(0, this.currentBet - this.hand[seat].streetBet);
  }

  chipSum() {
    let sum = this.players[0].stack + this.players[1].stack + this.pot;
    if (this.hand) sum += this.hand[0].streetBet + this.hand[1].streetBet;
    return sum;
  }

  startHand() {
    if (this.players.some((p) => p.stack <= 0)) {
      this.players[0].stack = this.startStack;
      this.players[1].stack = this.startStack;
    }
    if (this.handsPlayed > 0) this.button ^= 1;
    this.stackSnap = [this.players[0].stack, this.players[1].stack];
    this.deck = shuffle(freshDeck(), this.rng);
    this.di = 0;
    this.board = [];
    this.pot = 0;
    this.street = "preflop";
    this.result = null;
    this.paying = false;
    this.hand = [0, 1].map(() => ({
      hole: [],
      streetBet: 0,
      folded: false,
      allIn: false,
      toAct: true,
      canRaise: true,
      hasActed: false,
    }));
    this.hand[0].hole = [this.draw()];
    this.hand[1].hole = [this.draw()];
    this.hand[0].hole.push(this.draw());
    this.hand[1].hole.push(this.draw());

    this.postBlind(this.button, this.sb);
    this.postBlind(1 - this.button, this.bb);
    this.currentBet = Math.max(this.hand[0].streetBet, this.hand[1].streetBet);
    this.minRaise = this.bb;
    this.toAct = this.button;
    this.openAction();
  }

  postBlind(seat, amount) {
    const p = this.players[seat];
    const h = this.hand[seat];
    const pay = Math.min(p.stack, amount);
    p.stack -= pay;
    h.streetBet = pay;
    if (p.stack === 0) {
      h.allIn = true;
      h.toAct = false;
    }
  }

  liveSeats() {
    const seats = [];
    if (!this.hand[0].folded) seats.push(0);
    if (!this.hand[1].folded) seats.push(1);
    return seats;
  }

  isPending(seat) {
    const h = this.hand[seat];
    return !h.folded && !h.allIn && h.toAct && this.players[seat].stack > 0;
  }

  pendingSeats() {
    const seats = [];
    if (this.isPending(0)) seats.push(0);
    if (this.isPending(1)) seats.push(1);
    return seats;
  }

  openAction() {
    if (this.street === "complete") return;
    const live = this.liveSeats();
    if (live.length <= 1) {
      if (live.length === 1) this.awardFold(live[0]);
      return;
    }
    if (!this.pendingSeats().length) {
      this.endRound();
      return;
    }
    if (!this.isPending(this.toAct)) {
      const other = 1 - this.toAct;
      if (this.isPending(other)) this.toAct = other;
      else this.endRound();
    }
  }

  legal(seat) {
    const h = this.hand[seat];
    const stack = this.players[seat].stack;
    const toCall = this.toCall(seat);
    const out = [];
    if (toCall > 0) out.push({ type: "fold", put: 0 });
    if (toCall === 0) out.push({ type: "check", put: 0 });
    else if (stack > 0) {
      const put = Math.min(toCall, stack);
      out.push({ type: "call", put, total: h.streetBet + put });
    }

    const opp = this.hand[1 - seat];
    const oppCanRespond = !opp.folded && !opp.allIn && this.players[1 - seat].stack > 0;
    if (stack > toCall && oppCanRespond && h.canRaise) {
      const maxTotal = h.streetBet + stack;
      const pot = this.totalPot();
      const seen = new Set();
      const candidates = [];
      if (this.currentBet === 0) {
        candidates.push(this.bb, Math.max(this.bb, Math.floor(pot * 0.5)), Math.max(this.bb, pot));
      } else {
        const minR = this.currentBet + this.minRaise;
        candidates.push(
          minR,
          this.currentBet + Math.max(this.minRaise, Math.floor(pot * 0.5)),
          this.currentBet + Math.max(this.minRaise, pot),
        );
      }
      for (let total of candidates) {
        total = Math.floor(total);
        if (total <= this.currentBet || total >= maxTotal || seen.has(total)) continue;
        if (this.currentBet === 0 && total < this.bb) continue;
        if (this.currentBet > 0 && total < this.currentBet + this.minRaise) continue;
        seen.add(total);
        out.push({
          type: this.currentBet === 0 ? "bet" : "raise",
          total,
          put: total - h.streetBet,
        });
      }
      if (maxTotal > this.currentBet) {
        out.push({ type: "allin", total: maxTotal, put: stack });
      }
    }
    return out;
  }

  apply(seat, action) {
    if (this.street === "complete" || this.street === "idle" || !this.hand) {
      return { ignored: true, text: "", street: this.street, seat };
    }
    if (seat !== this.toAct) seat = this.toAct;
    const legal = this.legal(seat);
    let chosen =
      matchAction(legal, action) ||
      legal.find((a) => a.type === "check") ||
      legal.find((a) => a.type === "call") ||
      legal.find((a) => a.type === "fold") ||
      legal[0];
    const name = this.players[seat].name;
    if (!chosen) {
      this.endRound();
      return { seat, action: { type: "none", put: 0 }, text: `${name} continues`, street: this.street, pot: this.totalPot() };
    }

    const h = this.hand[seat];
    const p = this.players[seat];
    h.hasActed = true;

    if (chosen.type === "fold") {
      h.folded = true;
      h.toAct = false;
      this.awardFold(1 - seat);
      return { seat, action: chosen, text: actionLabel(name, chosen), street: this.street, pot: 0 };
    }

    if (chosen.type === "check") {
      h.toAct = false;
      this.advance(seat);
      return { seat, action: chosen, text: actionLabel(name, chosen), street: this.street, pot: this.potOf() };
    }

    const put = Math.min(p.stack, chosen.put);
    p.stack -= put;
    h.streetBet += put;
    if (p.stack === 0) h.allIn = true;
    h.toAct = false;

    const prevBet = this.currentBet;
    const prevMin = this.minRaise;
    if (h.streetBet > prevBet) {
      const raiseBy = h.streetBet - prevBet;
      const full = prevBet === 0 ? h.streetBet >= this.bb : raiseBy >= prevMin;
      this.currentBet = h.streetBet;
      if (full) this.minRaise = prevBet === 0 ? h.streetBet : raiseBy;
      const oh = this.hand[1 - seat];
      if (!oh.folded && !oh.allIn && this.players[1 - seat].stack > 0) {
        oh.toAct = true;
        oh.canRaise = full || !oh.hasActed;
      }
    }

    this.advance(seat);
    return { seat, action: chosen, text: actionLabel(name, chosen), street: this.street, pot: this.potOf() };
  }

  potOf() {
    return this.street === "complete" ? 0 : this.totalPot();
  }

  advance(seat) {
    if (this.street === "complete") return;
    const live = this.liveSeats();
    if (live.length <= 1) {
      if (live.length === 1) this.awardFold(live[0]);
      return;
    }
    if (!this.pendingSeats().length) {
      this.endRound();
      return;
    }
    const other = 1 - seat;
    if (this.isPending(other)) this.toAct = other;
    else if (this.isPending(seat)) this.toAct = seat;
    else this.endRound();
  }

  returnUncalled() {
    const a = this.hand[0].streetBet;
    const b = this.hand[1].streetBet;
    if (a > b) {
      this.players[0].stack += a - b;
      this.hand[0].streetBet = b;
    } else if (b > a) {
      this.players[1].stack += b - a;
      this.hand[1].streetBet = a;
    }
  }

  collectBets() {
    this.pot += this.hand[0].streetBet + this.hand[1].streetBet;
    this.hand[0].streetBet = 0;
    this.hand[1].streetBet = 0;
    this.currentBet = 0;
    this.minRaise = this.bb;
  }

  fighters() {
    const seats = [];
    for (let i = 0; i < 2; i++) {
      if (!this.hand[i].folded && this.players[i].stack > 0) seats.push(i);
    }
    return seats;
  }

  endRound() {
    if (this.street === "complete" || this.paying) return;
    this.returnUncalled();
    this.collectBets();
    const live = this.liveSeats();
    if (live.length <= 1) {
      if (live.length === 1) this.payPot(live[0], "fold");
      return;
    }
    if (this.street === "river" || this.fighters().length < 2) {
      this.showdown();
      return;
    }
    this.dealNext();
    this.openAction();
  }

  dealNext() {
    const next = STREET_NEXT[this.street];
    this.street = next;
    this.burn();
    if (next === "flop") this.board.push(this.draw(), this.draw(), this.draw());
    else this.board.push(this.draw());
    this.currentBet = 0;
    this.minRaise = this.bb;
    for (let i = 0; i < 2; i++) {
      const h = this.hand[i];
      h.streetBet = 0;
      h.canRaise = true;
      h.hasActed = false;
      h.toAct = !h.folded && !h.allIn && this.players[i].stack > 0;
    }
    this.toAct = 1 - this.button;
  }

  dealRemaining() {
    if (this.board.length === 0) {
      this.burn();
      this.board.push(this.draw(), this.draw(), this.draw());
    }
    while (this.board.length < 5) {
      this.burn();
      this.board.push(this.draw());
    }
  }

  showdown() {
    if (this.street === "complete" || this.paying) return;
    this.dealRemaining();
    const c0 = [...this.hand[0].hole, ...this.board];
    const c1 = [...this.hand[1].hole, ...this.board];
    const s0 = scoreCards(c0);
    const s1 = scoreCards(c1);
    let winner = -1;
    if (s0 > s1) winner = 0;
    else if (s1 > s0) winner = 1;
    const title = winner === -1 ? handTitle(c0) : handTitle(winner === 0 ? c0 : c1);
    this.payPot(winner, "showdown", title, [s0, s1]);
  }

  awardFold(winner) {
    if (this.street === "complete" || this.paying) return;
    this.returnUncalled();
    this.collectBets();
    this.payPot(winner, "fold", "Fold");
  }

  payPot(winner, kind, title, scores) {
    if (this.paying || this.street === "complete") return;
    this.paying = true;
    const amount = this.pot;
    if (winner === -1) {
      const half = Math.floor(amount / 2);
      const rem = amount - half * 2;
      const oddSeat = 1 - this.button;
      this.players[0].stack += half + (oddSeat === 0 ? rem : 0);
      this.players[1].stack += half + (oddSeat === 1 ? rem : 0);
    } else {
      this.players[winner].stack += amount;
    }
    this.pot = 0;
    this.finish(kind, winner, title || (kind === "fold" ? "Fold" : "Showdown"), scores);
  }

  finish(kind, winner, title, scores) {
    const deltas = [
      this.players[0].stack - this.stackSnap[0],
      this.players[1].stack - this.stackSnap[1],
    ];
    this.profit[0] += deltas[0];
    this.profit[1] += deltas[1];
    this.handsPlayed += 1;
    let sessionWinner = null;
    const stacksBefore = [this.players[0].stack, this.players[1].stack];
    if (this.players[0].stack <= 0 || this.players[1].stack <= 0) {
      if (this.players[0].stack > this.players[1].stack) sessionWinner = 0;
      else if (this.players[1].stack > this.players[0].stack) sessionWinner = 1;
      if (sessionWinner !== null) this.sessionWins[sessionWinner] += 1;
      this.sessions += 1;
      this.players[0].stack = this.startStack;
      this.players[1].stack = this.startStack;
    }
    this.street = "complete";
    this.result = {
      kind,
      winner,
      title,
      deltas,
      scores: scores || null,
      sessionWinner,
      stacksBefore,
      holes: [this.hand[0].hole.slice(), this.hand[1].hole.slice()],
      board: this.board.slice(),
    };
  }

  buildView(seat) {
    if (!this.hand || this.street === "complete" || this.street === "idle") return null;
    const opp = 1 - seat;
    const oh = this.hand[opp];
    return {
      seat,
      street: this.street,
      hole: this.hand[seat].hole.slice(),
      board: this.board.slice(),
      pot: this.totalPot(),
      toCall: this.toCall(seat),
      bb: this.bb,
      sb: this.sb,
      minRaise: this.minRaise,
      heroStack: this.players[seat].stack,
      oppStack: this.players[opp].stack,
      heroStreet: this.hand[seat].streetBet,
      oppStreet: oh.streetBet,
      legal: this.legal(seat),
      opponentActsAfterCheck: oh.toAct && !oh.folded && !oh.allIn && this.players[opp].stack > 0,
    };
  }
}

export function streetLabel(street) {
  switch (street) {
    case "preflop":
      return "Preflop";
    case "flop":
      return "Flop";
    case "turn":
      return "Turn";
    case "river":
      return "River";
    case "complete":
      return "Showdown";
    default:
      return "Idle";
  }
}
