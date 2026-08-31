/* ─────────────────────────────────────────────────────────────
   equity.js — 7-Karten-Handbewertung + exakte Equity-Berechnung
   Karte = 0..51,  rank = c>>2  (0='2' … 12='A'),  suit = c&3
   Farben: 0 ♠  1 ♥  2 ♦  3 ♣
   ───────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const SUITS = ['♠','♥','♦','♣'];
  const CATS = ['High Card','Paar','Zwei Paare','Drilling','Straße',
                'Flush','Full House','Vierling','Straight Flush'];

  /* ── Hilfsstrukturen (wiederverwendet, keine Allokation im Loop) ── */
  const rc = new Int8Array(13);      // Anzahl je Rang
  const sc = new Int8Array(4);       // Anzahl je Farbe
  const sm = new Int32Array(4);      // Rang-Bitmaske je Farbe

  const WHEEL = (1 << 12) | 0b1111;  // A,5,4,3,2

  /** Höchster Rang einer Straße in `mask`, sonst -1 (3 = 5-high Wheel). */
  function straightHigh(mask) {
    for (let hi = 12; hi >= 4; hi--) {
      const need = 0b11111 << (hi - 4);
      if ((mask & need) === need) return hi;
    }
    return (mask & WHEEL) === WHEEL ? 3 : -1;
  }

  /** Die 5 höchsten gesetzten Bits als 20-Bit-Tiebreak (je 4 Bit). */
  function top5(mask) {
    let out = 0, n = 0;
    for (let r = 12; r >= 0 && n < 5; r--) {
      if (mask & (1 << r)) { out = (out << 4) | r; n++; }
    }
    return out;
  }

  const pack = (cat, tb) => cat * 0x100000 + tb;

  /**
   * Bewertet genau 7 Karten. Höherer Rückgabewert = bessere Hand.
   * @param {Int32Array|number[]} c Länge 7
   */
  function eval7(c) {
    rc.fill(0); sc.fill(0); sm[0] = sm[1] = sm[2] = sm[3] = 0;
    let mask = 0;
    for (let i = 0; i < 7; i++) {
      const card = c[i], r = card >> 2, s = card & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
    }

    /* Flush / Straight Flush */
    for (let s = 0; s < 4; s++) {
      if (sc[s] >= 5) {
        const sf = straightHigh(sm[s]);
        if (sf >= 0) return pack(8, sf);
        return pack(5, top5(sm[s]));
      }
    }

    /* Paare / Drillinge / Vierlinge sammeln (absteigend) */
    let quad = -1, trip = -1, trip2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = rc[r];
      if (n === 4) { if (quad < 0) quad = r; }
      else if (n === 3) { if (trip < 0) trip = r; else if (trip2 < 0) trip2 = r; }
      else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }

    if (quad >= 0) {
      let k = -1;
      for (let r = 12; r >= 0; r--) if (r !== quad && rc[r]) { k = r; break; }
      return pack(7, (quad << 4) | k);
    }
    if (trip >= 0 && (trip2 >= 0 || p1 >= 0)) {
      const pair = trip2 > p1 ? trip2 : p1;
      return pack(6, (trip << 4) | pair);
    }

    const st = straightHigh(mask);
    if (st >= 0) return pack(4, st);

    if (trip >= 0) {
      let tb = trip, n = 0;
      for (let r = 12; r >= 0 && n < 2; r--) if (r !== trip && rc[r]) { tb = (tb << 4) | r; n++; }
      return pack(3, tb);
    }
    if (p2 >= 0) {
      let k = -1;
      for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && rc[r]) { k = r; break; }
      return pack(2, (((p1 << 4) | p2) << 4) | k);
    }
    if (p1 >= 0) {
      let tb = p1, n = 0;
      for (let r = 12; r >= 0 && n < 3; r--) if (r !== p1 && rc[r]) { tb = (tb << 4) | r; n++; }
      return pack(1, tb);
    }
    return pack(0, top5(mask));
  }

  const category = (score) => Math.floor(score / 0x100000);
  const categoryName = (score) => CATS[category(score)];

  /* ── Karten-Utilities ───────────────────────────────────────── */
  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const cardLabel = (c) => RANKS[c >> 2] + SUITS[c & 3];

  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }

  /* ── Equity: exakte Enumeration aller Runouts, in Häppchen ──── */
  /**
   * @param {object} o  {hero:[c,c], villain:[c,c], board:[…0-5],
   *                     onProgress(frac), onDone(result)}
   * @returns {{cancel:function}}
   */
  function run(o) {
    const hero = o.hero, villain = o.villain, board = o.board || [];
    const used = new Uint8Array(52);
    [...hero, ...villain, ...board].forEach((c) => (used[c] = 1));

    const deck = [];
    for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);

    const k = 5 - board.length;
    const total = comb(deck.length, k);

    const h7 = new Int32Array(7), v7 = new Int32Array(7);
    h7[0] = hero[0]; h7[1] = hero[1];
    v7[0] = villain[0]; v7[1] = villain[1];
    for (let i = 0; i < board.length; i++) { h7[2 + i] = board[i]; v7[2 + i] = board[i]; }

    const base = 2 + board.length;
    const idx = new Int32Array(k);
    for (let i = 0; i < k; i++) idx[i] = i;

    let win = 0, tie = 0, lose = 0, done = 0, cancelled = false;
    const heroCats = new Float64Array(9); // gewichtete Verteilung der Endhände

    function step() {
      for (let i = 0; i < k; i++) { const c = deck[idx[i]]; h7[base + i] = c; v7[base + i] = c; }
      const a = eval7(h7), b = eval7(v7);
      if (a > b) win++; else if (a === b) tie++; else lose++;
      heroCats[category(a)]++;
      done++;
    }

    function advance() {
      let i = k - 1;
      while (i >= 0 && idx[i] === deck.length - k + i) i--;
      if (i < 0) return false;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
      return true;
    }

    function finish() {
      const cats = [];
      for (let i = 8; i >= 0; i--) {
        const p = heroCats[i] / done;
        if (p >= 0.001) cats.push({ name: CATS[i], pct: p });   // unter 0,1 % weglassen
      }
      cats.sort((a, b) => b.pct - a.pct);                       // häufigste zuerst
      o.onDone({
        total: done, win, tie, lose,
        heroEq: (win + tie / 2) / done,
        villEq: (lose + tie / 2) / done,
        cats,
      });
    }

    const CHUNK = 40000;
    function pump() {
      if (cancelled) return;
      let n = 0;
      do {
        step();
        n++;
        if (k === 0) { finish(); return; }        // River komplett: genau 1 Runout
        if (!advance()) { finish(); return; }
      } while (n < CHUNK);
      if (o.onProgress) o.onProgress(done / total);
      setTimeout(pump, 0);
    }

    setTimeout(pump, 0);
    return { cancel() { cancelled = true; }, total };
  }

  global.Equity = { eval7, run, comb, RANKS, SUITS, CATS, cardLabel, rankOf, suitOf, category, categoryName };
})(window);
