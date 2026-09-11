/* ─────────────────────────────────────────────────────────────
   app.js — Pokertracker
   ───────────────────────────────────────────────────────────── */
'use strict';

const KEY = 'pokertracker.v1';
/* Bei jeder Änderung hochzählen — wird in den Einstellungen angezeigt,
   damit sich auf dem Handy prüfen lässt, welche Fassung wirklich läuft. */
const APP_VERSION = '1.4.1';

/* Darstellung. `bar` ist die Hintergrundfarbe des Themes und landet im
   <meta name="theme-color">, damit die Systemleiste des Handys mitzieht —
   sie muss mit --bg in style.css übereinstimmen. */
const THEME_KEY = 'pokertracker.theme';
const THEMES = {
  midnight: { label: 'Midnight', note: 'Tiefblau, ruhig',    bar: '#0b0e14' },
  daylight: { label: 'Daylight', note: 'Hell, für den Tag',  bar: '#f3f5f9' },
  felt:     { label: 'Felt',     note: 'Pokertisch & Gold',  bar: '#0b1511' },
  neon:     { label: 'Neon',     note: 'Schwarz mit Cyan',   bar: '#06070c' },
};
const THEME_KEYS = Object.keys(THEMES);

const TYPES = {
  cash:   { label: 'Cash Game', short: 'CASH', em: '♠️' },
  mtt:    { label: 'Turnier',   short: 'MTT',  em: '🏆' },
  casino: { label: 'Casino',    short: 'CAS',  em: '🎰' },
};
const TYPE_KEYS = ['cash', 'mtt', 'casino'];

/* Spielertypen für die Gegner-Einschätzung. */
const P_STYLES = {
  unknown: { label: 'Unbekannt', em: '❔' },
  fish:    { label: 'Fisch',     em: '🐟' },
  nit:     { label: 'Nit',       em: '🪨' },
  tag:     { label: 'TAG',       em: '🎯' },
  lag:     { label: 'LAG',       em: '⚡' },
  maniac:  { label: 'Maniac',    em: '🔥' },
};
const P_STYLE_KEYS = Object.keys(P_STYLES);

/* ── Persistenz ─────────────────────────────────────────────── */
/** Frische Grundstruktur. Wird beim Laden und beim Backup-Import als Basis
    benutzt, damit später ergänzte Felder in alten Daten nicht fehlen. */
const blank = () => ({
  v: 2,
  sessions: [],   // {id,type,date,location,durationMin,…,notes,tags,playerIds}
  txns: [],       // {id,type,date,amount,note,kind?}   Ein-/Auszahlungen
  live: null,     // laufende Session
  tags: ['Gut gespielt', 'Tilt', 'Müde', 'Guter Tisch', 'Schwerer Tisch'],
  players: [],    // {id,name,style,loose,aggro,traits,notes:[{id,date,text,sessionId}]}
  playerTags: ['Callt zu viel', 'Foldet zu viel', '3-Bettet light', 'Bluffed oft',
    'Limpt', 'Tiltet schnell', 'Spielt Position', 'Overbets', 'Nur Premium'],
  theme: 'midnight',   // Darstellung, siehe THEMES
  setup: false,        // Start-Bankroll schon abgefragt?
  lastBackup: null,    // ISO-Datum des letzten Backups
  lastBackupCount: 0,  // Anzahl Einträge zu dem Zeitpunkt
  snoozeBackup: 0,     // Hinweis bis zu diesem Zeitstempel ausgeblendet
});

let db = blank();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    db = Object.assign(blank(), parsed);
    // Daten aus einer Fassung vor den Themes: das zuletzt gesetzte Theme
    // steht dann nur im Spiegel, nicht im Datensatz.
    if (!parsed.theme) db.theme = localStorage.getItem(THEME_KEY) || db.theme;
  } catch (e) { console.warn('Laden fehlgeschlagen', e); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Speichern fehlgeschlagen!'); console.error(e); }
}

/** Theme aufs Dokument legen. Der Spiegel in THEME_KEY ist das, was das
    Startskript in index.html liest — ohne ihn flackert der Start. */
function applyTheme(t) {
  if (!THEMES[t]) t = 'midnight';
  db.theme = t;
  document.documentElement.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[t].bar;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* nicht schlimm */ }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ── Formatierung ───────────────────────────────────────────── */
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfa = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const money = (v) => (v < 0 ? '−' : '') + nfa.format(Math.abs(v)) + ' €';
const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nfa.format(Math.abs(v)) + ' €';
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const pct = (v) => nfa.format(v * 100) + ' %';
const plural = (n, ein, viele) => `${n} ${n === 1 ? ein : viele}`;

function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}:${String(m).padStart(2, '0')} h` : `${h} h`;
}
function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60]
    .map((n) => String(n).padStart(2, '0')).join(':');
}
const dfShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' });
const dfLong = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const fmtDate = (iso) => dfShort.format(new Date(iso));

function localISO(d) {   // datetime-local braucht lokale Zeit ohne Zone
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── DOM-Helfer ─────────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ── Session-Mathematik ─────────────────────────────────────── */
function invested(s) {
  if (s.type === 'cash') return num(s.buyin);
  if (s.type === 'mtt') return (num(s.buyin) + num(s.fee)) * Math.max(1, num(s.entries) || 1);
  return 0;
}
function returned(s) {
  if (s.type === 'cash') return num(s.cashout);
  if (s.type === 'mtt') return num(s.prize);
  return 0;
}
function profit(s) {
  return s.type === 'casino' ? num(s.result) : returned(s) - invested(s);
}
const hours = (s) => num(s.durationMin) / 60;

const sessionsOf = (k) => k === 'all' ? db.sessions : db.sessions.filter((s) => s.type === k);
const txnsOf = (k) => k === 'all' ? db.txns : db.txns.filter((t) => t.type === k);

function bankroll(k) {
  return sessionsOf(k).reduce((a, s) => a + profit(s), 0)
       + txnsOf(k).reduce((a, t) => a + num(t.amount), 0);
}
const totalProfit = (k) => sessionsOf(k).reduce((a, s) => a + profit(s), 0);

/** Chronologische Bankroll-Kurve: kumulierte Summe aller Ereignisse. */
function curve(k) {
  const ev = [
    ...sessionsOf(k).map((s) => ({ d: s.date, v: profit(s), s })),
    ...txnsOf(k).map((t) => ({ d: t.date, v: num(t.amount), t })),
  ].sort((a, b) => new Date(a.d) - new Date(b.d));
  let acc = 0;
  return ev.map((e) => ({ ...e, y: (acc += e.v) }));
}

/* ── Gegner ─────────────────────────────────────────────────── */
const playerById = (id) => db.players.find((p) => p.id === id);
const sessionsWith = (pid) => db.sessions.filter((s) => (s.playerIds || []).includes(pid));
const styleOf = (p) => P_STYLES[p && p.style] || P_STYLES.unknown;

/** Legt an oder liefert den vorhandenen Spieler — Namensvergleich ohne
    Groß-/Kleinschreibung, damit "Max" und "max" nicht zweimal auftauchen. */
function findOrCreatePlayer(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const hit = db.players.find((p) => p.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit;
  const p = {
    id: uid(), name: n, style: 'unknown', loose: 3, aggro: 3,
    traits: [], notes: [], createdAt: new Date().toISOString(),
  };
  db.players.push(p);
  return p;
}

function addPlayerNote(pid, text, sessionId) {
  const p = playerById(pid); if (!p || !String(text).trim()) return;
  p.notes.push({ id: uid(), date: new Date().toISOString(), text: String(text).trim(), sessionId: sessionId || null });
  save();
}

/** Kennzahlen eines Gegners: wie oft zusammen gespielt, wie Du dabei abgeschnitten hast. */
function playerStats(pid) {
  const list = sessionsWith(pid);
  const p = list.reduce((a, s) => a + profit(s), 0);
  const h = list.reduce((a, s) => a + hours(s), 0);
  const last = list.reduce((a, s) => (!a || new Date(s.date) > new Date(a) ? s.date : a), null);
  return { n: list.length, profit: p, hours: h, last, list };
}

/* ── Navigation ─────────────────────────────────────────────── */
const TITLES = { home: 'Übersicht', sessions: 'Sessions', players: 'Gegner', stats: 'Statistik', ev: 'EV-Rechner' };
let view = 'home';

function nav(v) {
  view = v;
  $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
  $$('.tabbar button[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
  $('#viewTitle').textContent = TITLES[v];
  window.scrollTo(0, 0);
  render();
}

function render() {
  if (view === 'home') { renderHome(); }
  else if (view === 'sessions') { renderSessions(); }
  else if (view === 'players') { renderPlayers(); }
  else if (view === 'stats') { renderStats(); }
  renderLiveBar();
}

/* ── Backup-Erinnerung ──────────────────────────────────────── */
/** Liefert den Hinweistext — oder null, wenn gerade nichts ansteht.
    Absichtlich zurückhaltend: erst ab ein paar Einträgen, nach dem Wegklicken
    zwei Wochen Ruhe. Die Daten liegen nur auf dem Gerät, und wer die App
    weitergibt, kann sich nicht darauf verlassen, dass die README gelesen wird. */
function backupHint() {
  if (!db.sessions.length) return null;
  if (db.snoozeBackup && Date.now() < db.snoozeBackup) return null;

  const n = db.sessions.length + db.txns.length;
  if (!db.lastBackup) {
    return n >= 3
      ? 'Deine Daten liegen nur auf diesem Gerät. Sichere sie einmal — sonst sind sie beim Handywechsel weg.'
      : null;
  }
  const neu = n - (db.lastBackupCount || 0);
  const tage = Math.floor((Date.now() - new Date(db.lastBackup)) / 864e5);
  if (neu >= 5 || (neu > 0 && tage >= 21)) {
    return `Letztes Backup vor ${tage} Tag${tage === 1 ? '' : 'en'}, seitdem ${neu} neue${neu === 1 ? 'r Eintrag' : ' Einträge'}.`;
  }
  return null;
}

function renderBackupHint() {
  const box = $('#backupNote'); if (!box) return;
  const msg = backupHint();
  box.classList.toggle('hidden', !msg);
  if (!msg) return;
  box.innerHTML = `<div class="notice-t">${esc(msg)}</div>
    <button class="btn btn-sm" id="noteSave">Sichern</button>
    <button class="link" id="noteHide" aria-label="Ausblenden">✕</button>`;
  $('#noteSave').onclick = exportBackup;
  $('#noteHide').onclick = () => {
    db.snoozeBackup = Date.now() + 14 * 864e5;
    save(); renderBackupHint();
  };
}

/* ── Übersicht ──────────────────────────────────────────────── */
let chartKey = 'all';

function renderHome() {
  renderBackupHint();
  const total = bankroll('all');
  $('#totalBankroll').textContent = money(total);
  $('#totalBankroll').className = 'hero-value ' + cls(total);

  const p = totalProfit('all');
  const h = db.sessions.reduce((a, s) => a + hours(s), 0);
  $('#totalSub').innerHTML = db.sessions.length
    ? `${db.sessions.length} Sessions · ${nfa.format(h)} h · <span class="${cls(p)}">${signed(p)}</span> Gewinn`
    : 'Noch keine Sessions erfasst';

  $('#rollGrid').innerHTML = TYPE_KEYS.map((k) => {
    const b = bankroll(k), pr = totalProfit(k), n = sessionsOf(k).length;
    return `<button class="roll" data-roll="${k}">
      <div class="roll-name">${TYPES[k].label}</div>
      <div class="roll-val">${money(b)}</div>
      <div class="roll-delta ${cls(pr)}">${n ? signed(pr) : '—'}</div>
    </button>`;
  }).join('');

  drawChart();

  const recent = [...db.sessions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  $('#recentList').innerHTML = recent.length
    ? recent.map(rowHTML).join('')
    : '<div class="empty">Tippe auf ＋ für Deine erste Session.</div>';
}

function rowHTML(s) {
  const p = profit(s);
  return `<button class="row" data-sid="${s.id}">
    <span class="pill ${s.type}">${TYPES[s.type].short}</span>
    <span class="row-main">
      <span class="row-t">${esc(s.location || TYPES[s.type].label)}</span>
      <span class="row-s">${fmtDate(s.date)} · ${subLine(s)}</span>
    </span>
    <span class="row-v ${cls(p)}">${signed(p)}</span>
  </button>`;
}
function subLine(s) {
  const bits = [];
  if (s.type === 'cash' && s.stakes) bits.push(esc(s.stakes));
  if (s.type === 'mtt') {
    bits.push(money(num(s.buyin) + num(s.fee)));
    if (num(s.place)) bits.push(`Platz ${num(s.place)}${num(s.fieldSize) ? '/' + num(s.fieldSize) : ''}`);
  }
  if (num(s.durationMin)) bits.push(fmtDur(num(s.durationMin)));
  return bits.join(' · ') || '—';
}

/* ── Chart (SVG, ohne Bibliothek) ───────────────────────────── */
function drawChart() {
  const box = $('#chart'), pts = curve(chartKey);
  if (pts.length < 2) {
    box.innerHTML = '<div class="chart-empty">Mindestens 2 Einträge für den Verlauf</div>';
    $('#chartLegend').innerHTML = '';
    return;
  }
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const W = 320, H = 160, PAD = 6;
  // Etwas Luft nach oben/unten, damit die Kurve nicht am Rand klebt
  const margin = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
  const yLo = lo - margin, yHi = hi + margin;
  const span = (yHi - yLo) || 1;
  const x = (i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - ((v - yLo) / span) * (H - 2 * PAD);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const last = pts[pts.length - 1].y;
  const col = last >= 0 ? 'var(--up)' : 'var(--down)';
  const zero = yLo <= 0 && yHi >= 0
    ? `<line x1="${PAD}" x2="${W - PAD}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"
         stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3"/>` : '';

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    ${zero}
    <path d="${area}" fill="url(#g)"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.5" fill="${col}"/>
  </svg>`;

  $('#chartLegend').innerHTML =
    `<span>Hoch ${money(hi)}</span><span>Tief ${money(lo)}</span>
     <span>${pts.length} Einträge</span>`;
}

/* ── Sessions-Liste ─────────────────────────────────────────── */
let filterKey = 'all';

function renderSessions() {
  const list = [...sessionsOf(filterKey)].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!list.length) {
    $('#sessionList').innerHTML = '<div class="empty">Keine Sessions in dieser Kategorie.</div>';
    return;
  }
  let html = '', lastDay = '';
  for (const s of list) {
    const day = dfLong.format(new Date(s.date));
    if (day !== lastDay) { html += `<div class="day-head">${day}</div>`; lastDay = day; }
    html += rowHTML(s);
  }
  $('#sessionList').innerHTML = html;
}

/* ── Gegner-Liste ───────────────────────────────────────────── */
let playerSort = 'last';

function renderPlayers() {
  const box = $('#playerList');
  if (!db.players.length) {
    box.innerHTML = `<div class="empty">Noch keine Gegner erfasst.<br>
      Trage sie beim Anlegen einer Session ein — oder oben auf „＋ Gegner“ tippen.</div>`;
    return;
  }
  const rows = db.players.map((p) => ({ p, st: playerStats(p.id) }));
  rows.sort((a, b) =>
    playerSort === 'name'   ? a.p.name.localeCompare(b.p.name, 'de') :
    playerSort === 'profit' ? b.st.profit - a.st.profit :
                              new Date(b.st.last || 0) - new Date(a.st.last || 0));

  box.innerHTML = rows.map(({ p, st }) => {
    const bits = [styleOf(p).label];
    bits.push(st.n ? `${st.n}× zusammen` : 'noch keine Session');
    if (st.last) bits.push(fmtDate(st.last));
    if (p.notes.length) bits.push(`${p.notes.length} Notiz${p.notes.length === 1 ? '' : 'en'}`);
    return `<button class="row" data-player="${p.id}">
      <span class="pl-em">${styleOf(p).em}</span>
      <span class="row-main">
        <span class="row-t">${esc(p.name)}</span>
        <span class="row-s">${bits.join(' · ')}</span>
      </span>
      <span class="row-v ${st.n ? cls(st.profit) : ''}">${st.n ? signed(st.profit) : '—'}</span>
    </button>`;
  }).join('');
}

/* ── Gegner-Profil ──────────────────────────────────────────── */
/** Liest die Formularfelder des Profils zurück in den Spieler. */
function readPlayerForm(p) {
  const name = $('#pl_name');
  if (!name) return;
  p.name = name.value.trim() || p.name;
  const st = $('#pl_style .tag.on');
  p.style = st ? st.dataset.st : 'unknown';
  p.loose = num($('#pl_loose').value);
  p.aggro = num($('#pl_aggro').value);
  p.traits = $$('#pl_traits .tag.on').map((b) => b.dataset.tag);
}

function openPlayer(id) {
  const p = playerById(id); if (!p) return;
  const st = playerStats(id);
  const notes = [...p.notes].sort((a, b) => new Date(b.date) - new Date(a.date));

  openSheet(p.name, `
    <label>Name<input id="pl_name" value="${esc(p.name)}"></label>

    <div class="sec-title" style="margin-top:16px">Spielertyp</div>
    <div class="tagbox" id="pl_style">${P_STYLE_KEYS.map((k) =>
      `<button type="button" class="tag ${k === (p.style || 'unknown') ? 'on' : ''}" data-st="${k}">${P_STYLES[k].em} ${P_STYLES[k].label}</button>`).join('')}</div>

    <div class="sec-title" style="margin-top:16px">Einschätzung</div>
    <div class="scale"><span>Tight</span>
      <input type="range" id="pl_loose" min="1" max="5" step="1" value="${num(p.loose) || 3}"><span>Loose</span></div>
    <div class="scale"><span>Passiv</span>
      <input type="range" id="pl_aggro" min="1" max="5" step="1" value="${num(p.aggro) || 3}"><span>Aggro</span></div>

    <div class="sec-title" style="margin-top:16px">Merkmale</div>
    <div class="tagbox" id="pl_traits">${db.playerTags.map((t) =>
      `<button type="button" class="tag ${(p.traits || []).includes(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>

    <div class="divider" style="margin:18px 0"></div>
    <div class="bd" style="margin-bottom:18px">
      <div class="bd-row"><span>Zusammen gespielt</span>
        <span class="c">${st.hours ? nfa.format(st.hours) + ' h' : ''}</span>
        <span class="v">${st.n}×</span></div>
      <div class="bd-row"><span>Dein Ergebnis dabei</span>
        <span class="c">${st.hours ? signed(st.profit / st.hours) + '/h' : ''}</span>
        <span class="v ${cls(st.profit)}">${st.n ? signed(st.profit) : '—'}</span></div>
      <div class="bd-row"><span>Zuletzt gesehen</span><span class="c"></span>
        <span class="v">${st.last ? fmtDate(st.last) : '—'}</span></div>
    </div>

    <div class="sec-title">Notiz anhängen</div>
    <textarea id="pl_newNote" placeholder="Was ist Dir aufgefallen?"></textarea>
    <button class="btn btn-block" id="plAddNote" style="margin:8px 0 20px">Notiz speichern</button>

    <div class="sec-title">Verlauf (${p.notes.length})</div>
    <div class="notelist">${notes.length ? notes.map((n) => `<div class="note">
        <div class="note-h"><span>${dfLong.format(new Date(n.date))}</span>
          <button class="link" data-ndel="${n.id}">✕</button></div>
        <div class="note-t">${esc(n.text)}</div></div>`).join('')
      : '<div class="empty" style="padding:14px">Noch keine Notizen</div>'}</div>

    <button class="btn btn-danger btn-block" id="plDelete" style="margin-top:20px">Gegner löschen</button>
  `, () => {
    readPlayerForm(p); save(); closeSheet(); render(); toast('Profil gespeichert');
  });

  // Spielertyp ist einfach-, Merkmale sind mehrfach-Auswahl
  $('#pl_style').onclick = (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    $$('#pl_style .tag').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#pl_traits').onclick = (e) => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    b.classList.toggle('on');
  };

  $('#plAddNote').onclick = () => {
    const t = $('#pl_newNote').value.trim();
    if (!t) { toast('Notiz ist leer'); return; }
    readPlayerForm(p);              // offene Änderungen nicht verlieren
    addPlayerNote(p.id, t);
    openPlayer(p.id);               // Liste neu aufbauen
    toast('Notiz angehängt');
  };

  $('#plDelete').onclick = () => {
    readPlayerForm(p);
    askSheet('Gegner löschen',
      `„${p.name}“ wird mit ${plural(p.notes.length, 'Notiz', 'Notizen')} entfernt. Deine Sessions bleiben erhalten.`,
      'Löschen', () => {
        db.players = db.players.filter((x) => x.id !== p.id);
        db.sessions.forEach((s) => {
          if (s.playerIds) s.playerIds = s.playerIds.filter((x) => x !== p.id);
        });
        save(); closeSheet(); render(); toast('Gegner gelöscht');
      }, () => openPlayer(p.id), true);
  };

  $('#sheetBody').onclick = (e) => {
    const b = e.target.closest('[data-ndel]'); if (!b) return;
    readPlayerForm(p);
    p.notes = p.notes.filter((n) => n.id !== b.dataset.ndel);
    save(); openPlayer(p.id);
  };
}

/** Gegner anlegen ohne Umweg über eine Session. */
function newPlayerSheet() {
  openSheet('Neuer Gegner', `
    <label>Name<input id="np_name" placeholder="z.B. Andi vom Donnerstag" autocomplete="off"></label>
    <div class="sec-title" style="margin-top:16px">Spielertyp <span class="muted">(kannst Du später ändern)</span></div>
    <div class="tagbox" id="np_style">${P_STYLE_KEYS.map((k) =>
      `<button type="button" class="tag ${k === 'unknown' ? 'on' : ''}" data-st="${k}">${P_STYLES[k].em} ${P_STYLES[k].label}</button>`).join('')}</div>
    <div class="hint" style="margin-top:14px">Einschätzung, Merkmale und Notizen ergänzt Du
      gleich danach im Profil.</div>
  `, () => {
    const name = $('#np_name').value.trim();
    if (!name) { toast('Name fehlt'); return; }
    const bekannt = db.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const p = findOrCreatePlayer(name);
    if (!bekannt) {
      const st = $('#np_style .tag.on');
      p.style = st ? st.dataset.st : 'unknown';
    }
    save(); render();
    toast(bekannt ? `„${p.name}“ gibt es schon` : 'Gegner angelegt');
    openPlayer(p.id);          // direkt ins Profil, Notiz ist meist der nächste Schritt
  }, 'Anlegen');

  $('#np_style').onclick = (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    $$('#np_style .tag').forEach((x) => x.classList.toggle('on', x === b));
  };
  const inp = $('#np_name');
  inp.focus();
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sheetSaveFn && sheetSaveFn(); } };
}

/* ── Statistik ──────────────────────────────────────────────── */
let statKey = 'all';

function statCard(k, v, n, klass) {
  return `<div class="stat"><div class="stat-k">${k}</div>
    <div class="stat-v ${klass || ''}">${v}</div>${n ? `<div class="stat-n">${n}</div>` : ''}</div>`;
}

function renderStats() {
  const list = sessionsOf(statKey);
  const body = $('#statBody');
  if (!list.length) { body.innerHTML = '<div class="empty">Noch keine Daten für diese Auswahl.</div>'; return; }

  const p = list.reduce((a, s) => a + profit(s), 0);
  const h = list.reduce((a, s) => a + hours(s), 0);
  const wins = list.filter((s) => profit(s) > 0).length;
  const best = list.reduce((a, s) => profit(s) > profit(a) ? s : a);
  const worst = list.reduce((a, s) => profit(s) < profit(a) ? s : a);

  let cards = statCard('Gewinn', signed(p), `${list.length} Sessions`, cls(p))
    + statCard('Pro Stunde', h ? signed(p / h) : '—', `${nfa.format(h)} h gespielt`, cls(p))
    + statCard('Trefferquote', pct(wins / list.length), `${wins} von ${list.length} im Plus`)
    + statCard('Ø Session', signed(p / list.length), h ? `Ø ${fmtDur(h * 60 / list.length)}` : '', cls(p / list.length));

  if (statKey === 'cash') {
    const bbTotal = list.reduce((a, s) => a + (num(s.bb) ? hours(s) : 0), 0);
    const bbWin = list.reduce((a, s) => a + (num(s.bb) ? profit(s) / num(s.bb) : 0), 0);
    cards += statCard('BB / Stunde', bbTotal ? nfa.format(bbWin / bbTotal) : '—',
      'Big Blinds pro Stunde', cls(bbWin));
    const bi = list.reduce((a, s) => a + invested(s), 0);
    cards += statCard('Ø Buy-in', money(bi / list.length), `${money(bi)} investiert`);
  }
  if (statKey === 'mtt') {
    const inv = list.reduce((a, s) => a + invested(s), 0);
    const pr = list.reduce((a, s) => a + returned(s), 0);
    const itm = list.filter((s) => returned(s) > 0).length;
    cards += statCard('ROI', inv ? pct(p / inv) : '—', `${money(inv)} Buy-ins`, cls(p));
    cards += statCard('ITM-Quote', pct(itm / list.length), `${itm}× im Geld · ${money(pr)}`);
  }

  cards += statCard('Beste Session', signed(profit(best)), `${esc(best.location || '—')} · ${fmtDate(best.date)}`, 'up');
  cards += statCard('Schlechteste', signed(profit(worst)), `${esc(worst.location || '—')} · ${fmtDate(worst.date)}`, 'down');

  body.innerHTML = `<div class="stat-grid">${cards}</div>`
    + breakdown('Nach Ort', list, (s) => s.location || 'Ohne Ort')
    + (statKey === 'cash' ? breakdown('Nach Stakes', list, (s) => s.stakes || 'Ohne Angabe') : '')
    + (statKey === 'all' ? breakdown('Nach Bereich', list, (s) => TYPES[s.type].label) : '')
    + breakdown('Nach Tag', list, null, true);
}

function breakdown(title, list, keyFn, byTag) {
  const map = new Map();
  const add = (k, s) => {
    if (!map.has(k)) map.set(k, { n: 0, p: 0, h: 0 });
    const e = map.get(k); e.n++; e.p += profit(s); e.h += hours(s);
  };
  for (const s of list) {
    if (byTag) (s.tags || []).forEach((t) => add(t, s));
    else add(keyFn(s), s);
  }
  if (!map.size) return '';
  const rows = [...map.entries()].sort((a, b) => b[1].p - a[1].p).map(([k, e]) =>
    `<div class="bd-row"><span>${esc(k)}</span>
      <span class="c">${e.n}× · ${nfa.format(e.h)} h</span>
      <span class="v ${cls(e.p)}">${signed(e.p)}</span></div>`).join('');
  return `<div class="card" style="margin-top:14px">
    <div class="card-head"><h2>${title}</h2></div><div class="bd">${rows}</div></div>`;
}

/* ── Sheet-System ───────────────────────────────────────────── */
let sheetSaveFn = null;

function openSheet(title, html, saveFn, saveLabel) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheetBody').onclick = null;         // Handler des vorherigen Sheets verwerfen
  $('#sheetCancel').onclick = closeSheet; // ggf. überschriebenes Abbrechen zurücksetzen
  sheetSaveFn = saveFn || null;
  const btn = $('#sheetSave');
  btn.classList.toggle('hidden', !saveFn);
  btn.textContent = saveLabel || 'Sichern';
  $('#sheet').classList.remove('hidden');
  $('#scrim').classList.remove('hidden');
  $('#sheetBody').scrollTop = 0;
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#scrim').classList.add('hidden');
  sheetSaveFn = null;
}

/* ── Dialoge ────────────────────────────────────────────────────
   Ersatz für confirm() / prompt() / alert(): installierte Web-Apps
   unterdrücken die nativen Dialoge je nach Gerät kommentarlos — der
   Knopf tut dann scheinbar nichts. Diese hier sind normale Sheets und
   funktionieren überall gleich.
   `back` führt zurück zum vorherigen Sheet statt alles zuzuklappen. */

function askSheet(title, text, okLabel, onOk, back, danger) {
  openSheet(title, `
    <p class="dlg-t">${esc(text)}</p>
    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" id="dlgOk">${esc(okLabel)}</button>
    <button class="btn btn-block" id="dlgNo" style="margin-top:8px">Abbrechen</button>
  `, null);
  const zurueck = () => (back ? back() : closeSheet());
  $('#dlgOk').onclick = onOk;
  $('#dlgNo').onclick = zurueck;
  $('#sheetCancel').onclick = zurueck;
}

function infoSheet(title, text, back) {
  openSheet(title, `
    <p class="dlg-t">${esc(text)}</p>
    <button class="btn btn-primary btn-block" id="dlgOk">Verstanden</button>
  `, null);
  const zurueck = () => (back ? back() : closeSheet());
  $('#dlgOk').onclick = zurueck;
  $('#sheetCancel').onclick = zurueck;
}

/** Einzeiliger Texteingabe-Dialog. `opts`: {value, placeholder, numeric, okLabel} */
function askText(title, label, opts, onOk, back) {
  opts = opts || {};
  openSheet(title, `
    <label>${esc(label)}<input id="dlg_in" ${opts.numeric ? 'type="number" inputmode="decimal" step="any"' : 'autocomplete="off"'}
      placeholder="${esc(opts.placeholder || '')}" value="${esc(opts.value == null ? '' : opts.value)}"></label>
  `, () => onOk($('#dlg_in').value), opts.okLabel || 'Übernehmen');
  if (back) $('#sheetCancel').onclick = back;
  const inp = $('#dlg_in');
  inp.focus(); inp.select && inp.select();
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sheetSaveFn && sheetSaveFn(); } };
}

/** Mehrzeiliger Notiz-Dialog für einen Gegner. */
function askPlayerNote(pid, back) {
  const p = playerById(pid); if (!p) return;
  openSheet('Notiz zu ' + p.name, `
    <label>Beobachtung<textarea id="dlg_note" placeholder="Was ist Dir aufgefallen?"></textarea></label>
    <div class="hint" style="margin-top:8px">Wird mit Datum an das Profil angehängt — vorhandene Notizen bleiben stehen.</div>
  `, () => {
    const t = $('#dlg_note').value.trim();
    if (!t) { toast('Notiz ist leer'); return; }
    addPlayerNote(p.id, t);
    back ? back() : closeSheet();
    toast('Notiz zu ' + p.name + ' gespeichert');
  }, 'Anhängen');
  if (back) $('#sheetCancel').onclick = back;
  $('#dlg_note').focus();
}

/* ── Neue / bestehende Session ──────────────────────────────── */
function fieldsFor(type, s) {
  s = s || {};
  const v = (k, d) => (s[k] != null && s[k] !== '' ? esc(s[k]) : (d == null ? '' : d));
  if (type === 'cash') return `
    <div class="form-grid two">
      <label>Stakes<input id="f_stakes" placeholder="1/2" value="${v('stakes')}"></label>
      <label>Spieler am Tisch<input id="f_players" type="number" inputmode="numeric" placeholder="9" value="${v('players')}"></label>
      <label>Buy-in gesamt (€)<input id="f_buyin" type="number" inputmode="decimal" step="any" placeholder="200" value="${v('buyin')}"></label>
      <label>Cash-out (€)<input id="f_cashout" type="number" inputmode="decimal" step="any" placeholder="340" value="${v('cashout')}"></label>
    </div>
    <div class="hint">Buy-in = alles, was Du inkl. Nachkäufe auf den Tisch gelegt hast.</div>`;
  if (type === 'mtt') return `
    <div class="form-grid two">
      <label>Buy-in (€)<input id="f_buyin" type="number" inputmode="decimal" step="any" placeholder="100" value="${v('buyin')}"></label>
      <label>Gebühr (€)<input id="f_fee" type="number" inputmode="decimal" step="any" placeholder="10" value="${v('fee')}"></label>
      <label>Entries<input id="f_entries" type="number" inputmode="numeric" placeholder="1" value="${v('entries', 1)}"></label>
      <label>Feldgröße<input id="f_fieldSize" type="number" inputmode="numeric" placeholder="120" value="${v('fieldSize')}"></label>
      <label>Platzierung<input id="f_place" type="number" inputmode="numeric" placeholder="7" value="${v('place')}"></label>
      <label>Preisgeld (€)<input id="f_prize" type="number" inputmode="decimal" step="any" placeholder="0" value="${v('prize')}"></label>
    </div>
    <div class="hint">Entries = 1 + Re-entries. Buy-in und Gebühr werden mit den Entries multipliziert.</div>`;
  return `
    <label>Ergebnis (€)<input id="f_result" type="number" inputmode="decimal" step="any" placeholder="−20" value="${v('result')}"></label>
    <div class="hint">Gewinn positiv, Verlust negativ eintragen — z.B. <b>−20</b> für 20 € Verlust.</div>
    <label style="margin-top:12px">Spiel <span class="muted">(optional)</span><input id="f_game" placeholder="Roulette" value="${v('game')}"></label>`;
}

function tagsHTML(sel) {
  sel = sel || [];
  return `<div class="sec-title">Tags</div><div class="tagbox" id="f_tags">` +
    db.tags.map((t) => `<button type="button" class="tag ${sel.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('') +
    `</div>`;
}

/** Nur die Chips — wird nach dem Anlegen eines neuen Gegners neu gezeichnet. */
function playerChips(sel) {
  sel = sel || [];
  if (!db.players.length) return '<span class="hint">Noch keine Gegner angelegt.</span>';
  return [...db.players]
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((p) => `<button type="button" class="tag ${sel.includes(p.id) ? 'on' : ''}" data-pid="${p.id}">${styleOf(p).em} ${esc(p.name)}</button>`)
    .join('');
}

function playersHTML(sel) {
  return `<div class="sec-title">Gegner am Tisch</div>
    <div class="tagbox" id="f_opp">${playerChips(sel)}</div>
    <div class="addrow">
      <input id="f_newOpp" placeholder="Gegner hinzufügen" autocomplete="off">
      <button type="button" class="btn btn-sm" id="btnAddOpp">＋</button>
    </div>`;
}

/** mode: 'new' (Typwahl + Live-Start) | 'edit' (Löschen)
          | 'finish' (Live-Abschluss) | 'live' (Details der laufenden Session) */
function sessionForm(type, s, mode) {
  s = s || {};
  const d = s.date ? new Date(s.date) : new Date();
  const dm = num(s.durationMin);
  const live = mode === 'live';
  return `
    ${mode === 'new' ? `<div class="typepick" id="typePick">${TYPE_KEYS.map((k) =>
      `<button type="button" data-type="${k}" class="${k === type ? 'on' : ''}">
         <span class="em">${TYPES[k].em}</span>${TYPES[k].label}</button>`).join('')}</div>` : ''}
    <div class="form-grid">
      <label>${live ? 'Beginn' : 'Datum &amp; Uhrzeit'}<input id="f_date" type="datetime-local" value="${localISO(d)}"></label>
      <label>Ort<input id="f_location" list="locs" placeholder="z.B. Casino Wien" value="${esc(s.location || '')}"></label>
      <datalist id="locs">${[...new Set(db.sessions.map((x) => x.location).filter(Boolean))]
        .map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
      ${live ? '<div class="hint">Die Dauer kommt von der laufenden Uhr und läuft weiter.</div>' : `
      <div class="form-grid two">
        <label>Dauer — Stunden<input id="f_h" type="number" inputmode="numeric" placeholder="0" value="${dm ? Math.floor(dm / 60) : ''}"></label>
        <label>Minuten<input id="f_m" type="number" inputmode="numeric" placeholder="0" value="${dm ? dm % 60 : ''}"></label>
      </div>`}
      <div class="divider"></div>
      <div id="typeFields">${fieldsFor(type, s)}</div>
      <div class="divider"></div>
      ${playersHTML(s.playerIds)}
      <div class="divider"></div>
      ${tagsHTML(s.tags)}
      <label>Notizen<textarea id="f_notes" placeholder="Wie lief die Session?">${esc(s.notes || '')}</textarea></label>
      ${mode === 'new' && type !== 'casino' ? `<button type="button" class="btn btn-block" id="btnStartLive">▶︎ Stattdessen live mitlaufen lassen</button>` : ''}
      ${mode === 'edit' ? `<button type="button" class="btn btn-danger btn-block" id="btnDelete">Session löschen</button>` : ''}
    </div>`;
}

let formType = 'cash';

function wireForm(existing) {
  const pick = $('#typePick');
  if (pick) pick.onclick = (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    formType = b.dataset.type;
    $$('#typePick button').forEach((x) => x.classList.toggle('on', x === b));
    $('#typeFields').innerHTML = fieldsFor(formType);
    const live = $('#btnStartLive');
    if (live) live.classList.toggle('hidden', formType === 'casino');
  };
  $('#f_tags').onclick = (e) => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    b.classList.toggle('on');
  };

  const opp = $('#f_opp');
  if (opp) opp.onclick = (e) => {
    const b = e.target.closest('[data-pid]'); if (!b) return;
    b.classList.toggle('on');
  };
  const addOpp = $('#btnAddOpp'), oppInp = $('#f_newOpp');
  if (addOpp && oppInp) {
    // Neuer Gegner wird sofort gespeichert — die Gegner-Liste hängt nicht
    // daran, ob diese Session am Ende gesichert wird.
    const doAdd = () => {
      const p = findOrCreatePlayer(oppInp.value);
      if (!p) return;
      const sel = $$('#f_opp .tag.on').map((b) => b.dataset.pid);
      if (!sel.includes(p.id)) sel.push(p.id);
      save();
      opp.innerHTML = playerChips(sel);
      oppInp.value = '';
      oppInp.focus();
    };
    addOpp.onclick = doAdd;
    oppInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
  }

  const del = $('#btnDelete');
  if (del) del.onclick = () => {
    askSheet('Session löschen',
      `${TYPES[existing.type].label} vom ${fmtDate(existing.date)} über ${signed(profit(existing))} wird entfernt.`,
      'Löschen', () => {
        db.sessions = db.sessions.filter((x) => x.id !== existing.id);
        save(); closeSheet(); render(); toast('Session gelöscht');
      }, () => editSession(existing.id), true);
  };
  const live = $('#btnStartLive');
  if (live) live.onclick = () => startLive();
}

function readForm(type, base) {
  const g = (id) => { const el = $('#' + id); return el ? el.value : ''; };
  const s = Object.assign({ id: uid(), type }, base || {});
  s.type = type;
  s.date = new Date(g('f_date') || Date.now()).toISOString();
  s.location = g('f_location').trim();
  // Bei der laufenden Session gibt es keine Dauer-Felder — dann bleibt der
  // Wert aus `base` stehen, die Uhr ist die Quelle.
  if ($('#f_h') || $('#f_m')) s.durationMin = num(g('f_h')) * 60 + num(g('f_m'));
  s.notes = g('f_notes').trim();
  s.tags = $$('#f_tags .tag.on').map((b) => b.dataset.tag);
  if ($('#f_opp')) s.playerIds = $$('#f_opp .tag.on').map((b) => b.dataset.pid);

  if (type === 'cash') {
    s.stakes = g('f_stakes').trim();
    s.bb = bbFromStakes(s.stakes);
    s.players = num(g('f_players'));
    s.buyin = num(g('f_buyin'));
    s.cashout = num(g('f_cashout'));
  } else if (type === 'mtt') {
    s.buyin = num(g('f_buyin'));
    s.fee = num(g('f_fee'));
    s.entries = Math.max(1, num(g('f_entries')) || 1);
    s.fieldSize = num(g('f_fieldSize'));
    s.place = num(g('f_place'));
    s.prize = num(g('f_prize'));
  } else {
    s.result = num(g('f_result'));
    s.game = g('f_game').trim();
  }
  return s;
}

/** "1/2" oder "0,5/1" → Big Blind als Zahl. */
function bbFromStakes(str) {
  if (!str) return 0;
  const parts = String(str).replace(/[€$\s]/g, '').split(/[\/\-]/).map(num).filter((n) => n > 0);
  return parts.length ? Math.max(...parts) : 0;
}

function newSession() {
  formType = 'cash';
  openSheet('Neue Session', sessionForm(formType, null, 'new'), () => {
    const s = readForm(formType);
    db.sessions.push(s); save(); closeSheet(); render();
    toast('Session gespeichert');
  });
  wireForm(null);
}

function editSession(id) {
  const s = db.sessions.find((x) => x.id === id); if (!s) return;
  openSheet(TYPES[s.type].label + ' bearbeiten', sessionForm(s.type, s, 'edit'), () => {
    const upd = readForm(s.type, { id: s.id });
    Object.assign(s, upd); save(); closeSheet(); render();
    toast('Gespeichert');
  });
  wireForm(s);
}

/* ── Live-Session ───────────────────────────────────────────── */
function elapsed() {
  if (!db.live) return 0;
  return db.live.elapsedMs + (db.live.running ? Date.now() - db.live.lastStart : 0);
}

function startLive() {
  const type = formType;
  const d = readForm(type);          // aktuelle Formularwerte übernehmen
  db.live = {
    type, data: d,
    elapsedMs: 0, running: true, lastStart: Date.now(),
    startedAt: new Date().toISOString(),
  };
  save(); closeSheet(); render(); openLive();
  toast('Session läuft');
}

function renderLiveBar() {
  const bar = $('#liveBar');
  if (!db.live) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const d = db.live.data;
  $('#liveTitle').textContent = TYPES[db.live.type].label + (db.live.running ? '' : ' · pausiert');
  $('#liveSub').textContent = [d.stakes, d.location].filter(Boolean).join(' · ') || 'läuft';
  $('#liveTimer').textContent = fmtClock(elapsed());
  bar.querySelector('.livebar-dot').style.animationPlayState = db.live.running ? 'running' : 'paused';
}

function openLive() {
  const L = db.live; if (!L) return;
  const d = L.data;
  const addLabel = L.type === 'cash' ? 'Nachkauf hinzufügen' : 'Re-entry / Addon';
  const opp = (d.playerIds || []).map(playerById).filter(Boolean);
  openSheet(TYPES[L.type].label + ' läuft', `
    <div class="live-panel">
      <div class="live-clock" id="lvClock">${fmtClock(elapsed())}</div>
      <div class="live-state" id="lvState">${L.running ? 'läuft' : 'pausiert'}</div>
    </div>
    <div class="bd" style="margin-bottom:10px">
      <div class="bd-row"><span>Ort</span><span class="c"></span><span class="v">${esc(d.location || '—')}</span></div>
      ${L.type === 'cash'
        ? `<div class="bd-row"><span>Stakes</span><span class="c"></span><span class="v">${esc(d.stakes || '—')}</span></div>
           <div class="bd-row"><span>Investiert</span><span class="c"></span><span class="v" id="lvIn">${money(invested(d))}</span></div>`
        : `<div class="bd-row"><span>Entries</span><span class="c"></span><span class="v" id="lvEntries">${d.entries || 1}</span></div>
           <div class="bd-row"><span>Investiert</span><span class="c"></span><span class="v" id="lvIn">${money(invested(d))}</span></div>`}
    </div>
    <button class="btn btn-block" id="lvEdit" style="margin-bottom:16px">✎ Details bearbeiten</button>

    <div class="sec-title">Gegner am Tisch</div>
    <div class="tagbox" id="lvOpp" style="margin-bottom:16px">${opp.length
      ? opp.map((p) => `<button type="button" class="tag" data-note="${p.id}">${styleOf(p).em} ${esc(p.name)} <span class="muted">✎</span></button>`).join('')
      : '<span class="hint">Über „Details bearbeiten“ eintragen.</span>'}</div>

    <div class="btn-row" style="margin-bottom:8px">
      <button class="btn" id="lvToggle">${L.running ? '⏸ Pause' : '▶︎ Weiter'}</button>
      <button class="btn" id="lvAdd">＋ ${addLabel}</button>
    </div>
    <button class="btn btn-primary btn-block" id="lvEnd">Session beenden</button>
    <button class="btn btn-danger btn-block" id="lvCancel" style="margin-top:8px">Verwerfen</button>
  `, null);

  $('#lvEdit').onclick = () => editLiveDetails();
  $('#lvOpp').onclick = (e) => {
    const b = e.target.closest('[data-note]'); if (!b) return;
    askPlayerNote(b.dataset.note, openLive);
  };

  $('#lvToggle').onclick = () => {
    if (L.running) { L.elapsedMs = elapsed(); L.running = false; }
    else { L.lastStart = Date.now(); L.running = true; }
    save(); openLive(); renderLiveBar();
  };
  $('#lvAdd').onclick = () => {
    const cash = L.type === 'cash';
    askText(cash ? 'Nachkauf' : 'Re-entry / Addon',
      cash ? 'Betrag des Nachkaufs (€)' : 'Zusätzliche Entries',
      { numeric: true, value: cash ? (num(d.buyin) || '') : 1, okLabel: 'Hinzufügen' },
      (val) => {
        const v = num(val);
        if (!v) { toast('Betrag fehlt'); return; }
        if (cash) d.buyin = num(d.buyin) + v;
        else d.entries = Math.max(1, num(d.entries) || 1) + Math.max(1, v);
        save(); openLive();
        toast(cash ? 'Nachkauf erfasst' : 'Re-entry erfasst');
      }, openLive);
  };
  $('#lvCancel').onclick = () => {
    askSheet('Session verwerfen', 'Die laufende Session wird nicht gespeichert. Die Uhr und alle Eingaben sind dann weg.',
      'Verwerfen', () => { db.live = null; save(); closeSheet(); render(); toast('Session verworfen'); },
      openLive, true);
  };
  $('#lvEnd').onclick = () => endLive();
}

/** Ort, Stakes, Buy-in, Gegner & Notizen ändern, während die Uhr läuft.
    Die Dauer bleibt außen vor — die kommt aus dem Timer. */
function editLiveDetails() {
  const L = db.live; if (!L) return;
  formType = L.type;
  const d = Object.assign({}, L.data, { date: L.startedAt });
  openSheet('Details bearbeiten', sessionForm(L.type, d, 'live'), () => {
    const upd = readForm(L.type, { id: L.data.id, durationMin: L.data.durationMin });
    L.startedAt = upd.date;
    Object.assign(L.data, upd);
    save(); closeSheet(); renderLiveBar(); openLive();
    toast('Details aktualisiert');
  });
  wireForm(null);
  $('#sheetCancel').onclick = () => { openLive(); };   // zurück, nicht zumachen
}

function endLive() {
  const L = db.live; if (!L) return;
  const d = Object.assign({}, L.data, {
    date: L.startedAt,
    durationMin: Math.round(elapsed() / 60000),
  });
  formType = L.type;
  openSheet('Session abschließen', sessionForm(L.type, d, 'finish'), () => {
    const s = readForm(L.type);
    db.sessions.push(s); db.live = null; save(); closeSheet(); render();
    toast('Session gespeichert');
  });
  wireForm(null);
  const f = $(L.type === 'cash' ? '#f_cashout' : '#f_prize');
  if (f) { f.focus(); f.select?.(); }
}

setInterval(() => {
  if (!db.live || !db.live.running) return;
  renderLiveBar();
  const c = $('#lvClock'); if (c) c.textContent = fmtClock(elapsed());
}, 1000);

/* ── Bankroll-Detail & Ein-/Auszahlungen ────────────────────── */
function openBankroll(k) {
  const list = [...txnsOf(k)].sort((a, b) => new Date(b.date) - new Date(a.date));
  openSheet(TYPES[k].label, `
    <div class="hero" style="padding-top:0">
      <div class="hero-label">Bankroll</div>
      <div class="hero-value ${cls(bankroll(k))}">${money(bankroll(k))}</div>
      <div class="hero-sub">${signed(totalProfit(k))} aus ${sessionsOf(k).length} Sessions
        · ${signed(txnsOf(k).reduce((a, t) => a + num(t.amount), 0))} Ein-/Auszahlungen</div>
    </div>
    <div class="sec-title">Ein-/Auszahlung buchen</div>
    <div class="form-grid two" style="margin-bottom:10px">
      <label>Betrag (€)<input id="tx_amt" type="number" inputmode="decimal" step="any" placeholder="200"></label>
      <label>Notiz<input id="tx_note" placeholder="Einzahlung"></label>
    </div>
    <div class="btn-row" style="margin-bottom:18px">
      <button class="btn" id="txIn">＋ Einzahlung</button>
      <button class="btn" id="txOut">− Auszahlung</button>
    </div>
    <div class="sec-title">Buchungen</div>
    <div class="bd">${list.length ? list.map((t) => `<div class="bd-row">
        <span>${esc(t.note || 'Buchung')}</span>
        <span class="c">${fmtDate(t.date)}</span>
        <span class="v ${cls(num(t.amount))}">${signed(num(t.amount))}
          <button class="link" data-txdel="${t.id}" style="padding:0 0 0 8px">✕</button></span>
      </div>`).join('') : '<div class="empty" style="padding:14px">Keine Buchungen</div>'}</div>
  `, null);

  const book = (sign) => {
    const a = num($('#tx_amt').value);
    if (!a) { toast('Betrag fehlt'); return; }
    db.txns.push({ id: uid(), type: k, date: new Date().toISOString(), amount: sign * Math.abs(a), note: $('#tx_note').value.trim() });
    save(); openBankroll(k); render(); toast('Gebucht');
  };
  $('#txIn').onclick = () => book(1);
  $('#txOut').onclick = () => book(-1);
  $('#sheetBody').onclick = (e) => {
    const b = e.target.closest('[data-txdel]'); if (!b) return;
    db.txns = db.txns.filter((t) => t.id !== b.dataset.txdel);
    save(); openBankroll(k); render();
  };
}

/* ── Start-Bankroll ─────────────────────────────────────────── */
const startTxn = (k) => db.txns.find((t) => t.kind === 'start' && t.type === k);

/** Anfangsstand je Bereich. Wird als normale Buchung abgelegt, damit die
    Bankroll-Rechnung unverändert bleibt — nur mit `kind:'start'` markiert,
    um sie später wieder ersetzen zu können. */
function openStartBankroll(first) {
  const others = [...db.sessions, ...db.txns.filter((t) => t.kind !== 'start')];
  const earliest = others.map((x) => +new Date(x.date)).sort((a, b) => a - b)[0];
  const ex = TYPE_KEYS.map(startTxn).find(Boolean);
  // Der Stichtag muss vor dem ersten Eintrag liegen, sonst springt die Kurve.
  const d0 = ex ? new Date(ex.date) : earliest ? new Date(earliest - 60000) : new Date();

  openSheet('Start-Bankroll', `
    <p class="hint" style="margin-bottom:14px">Womit fängst Du an? Der Betrag wird als
      erste Buchung abgelegt, Deine Sessions rechnen ab da weiter. Lässt sich jederzeit
      in den Einstellungen ändern.</p>
    <label>Stichtag<input id="sb_date" type="datetime-local" value="${localISO(d0)}"></label>
    <div class="form-grid" style="margin-top:12px">
      ${TYPE_KEYS.map((k) => `<label>${TYPES[k].em} ${TYPES[k].label} (€)
        <input id="sb_${k}" type="number" inputmode="decimal" step="any" placeholder="0"
          value="${startTxn(k) ? num(startTxn(k).amount) : ''}"></label>`).join('')}
    </div>
    <div class="hint" style="margin-top:10px">Leer lassen heißt: bei null anfangen.<br>
      Alles bleibt auf diesem Gerät — kein Konto, keine Cloud, niemand sieht Deine Zahlen.</div>
    ${first ? '<button class="btn btn-block" id="sbSkip" style="margin-top:20px">Später</button>' : ''}
  `, () => {
    const date = new Date($('#sb_date').value || Date.now()).toISOString();
    db.txns = db.txns.filter((t) => t.kind !== 'start');
    TYPE_KEYS.forEach((k) => {
      const a = num($('#sb_' + k).value);
      if (a) db.txns.push({ id: uid(), type: k, kind: 'start', date, amount: a, note: 'Start-Bankroll' });
    });
    db.setup = true;
    save(); closeSheet(); render(); toast('Start-Bankroll gesetzt');
  }, 'Übernehmen');

  const skip = $('#sbSkip');
  if (skip) skip.onclick = () => { db.setup = true; save(); closeSheet(); };
}

/* ── Einstellungen / Backup ─────────────────────────────────── */
function openSettings() {
  openSheet('Einstellungen', `
    <div class="sec-title">Darstellung</div>
    <p class="hint" style="margin:8px 0 12px">Tippe einen Stil an — er greift sofort,
      auch die untere Leiste ändert sich mit.</p>
    <div class="themes" id="themePick">
      ${THEME_KEYS.map((k) => `
        <button class="theme-card${db.theme === k ? ' on' : ''}" data-th="${k}">
          <span class="tprev t-${k}">
            <span class="tp-t"></span><span class="tp-s"></span><span class="tp-a"></span>
            <span class="tp-c"></span><span class="tp-b"></span>
          </span>
          <span class="theme-name">
            <span class="n">${esc(THEMES[k].label)}</span>
            <span class="d">${esc(THEMES[k].note)}</span>
          </span>
        </button>`).join('')}
    </div>
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Bankroll</div>
    <p class="hint" style="margin:8px 0 12px">Anfangsstand je Bereich — der Betrag, den Du
      hattest, bevor Du hier angefangen hast zu tracken.</p>
    <button class="btn btn-block" id="btnStart" style="margin-bottom:18px">Start-Bankroll festlegen</button>
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Datensicherung</div>
    <p class="hint" style="margin:8px 0 12px">Deine Daten liegen nur in diesem Browser.
      Lade regelmäßig ein Backup herunter — z.B. in Google Drive.</p>
    <div class="btn-row" style="margin-bottom:8px">
      <button class="btn" id="btnExport">Backup speichern</button>
      <button class="btn" id="btnImport">Backup laden</button>
    </div>
    <input type="file" id="fileImport" accept="application/json,.json" class="hidden">
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Aus anderem Tracker übernehmen</div>
    <p class="hint" style="margin:8px 0 12px">CSV mit den Spalten
      <b>start;end;breakMinutes;location;currency;expenses;profit</b> — die Sessions werden
      <b>ergänzt</b>, nichts wird überschrieben.</p>
    <button class="btn btn-block" id="btnCsv">CSV-Datei wählen</button>
    <input type="file" id="fileCsv" accept="text/csv,.csv" class="hidden">
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Tags verwalten</div>
    <label style="margin:8px 0 12px">Session-Tags (mit Komma getrennt)
      <input id="setTags" value="${esc(db.tags.join(', '))}"></label>
    <label style="margin:8px 0 12px">Gegner-Merkmale (mit Komma getrennt)
      <input id="setPlayerTags" value="${esc(db.playerTags.join(', '))}"></label>
    <div class="divider" style="margin:18px 0"></div>
    <div class="bd" style="margin-bottom:14px">
      <div class="bd-row"><span>Sessions</span><span class="c"></span><span class="v">${db.sessions.length}</span></div>
      <div class="bd-row"><span>Buchungen</span><span class="c"></span><span class="v">${db.txns.length}</span></div>
      <div class="bd-row"><span>Gegner</span><span class="c">${db.players.reduce((a, p) => a + p.notes.length, 0)} Notizen</span><span class="v">${db.players.length}</span></div>
      <div class="bd-row"><span>Speicher</span><span class="c"></span><span class="v">${nf0.format(new Blob([JSON.stringify(db)]).size / 1024)} KB</span></div>
      <div class="bd-row" id="verRow"><span>Version</span><span class="c"></span><span class="v">${APP_VERSION}</span></div>
      <div class="bd-row"><span>Offline-Cache</span><span class="c"></span><span class="v" id="swState">—</span></div>
    </div>
    <button class="btn btn-block" id="btnUpdate" style="margin-bottom:18px">Nach Update suchen</button>
    <button class="btn btn-danger btn-block" id="btnWipe">Alle Daten löschen</button>
    <p class="credit">Gebaut von Kilian</p>
  `, () => {
    const split = (id) => $(id).value.split(',').map((t) => t.trim()).filter(Boolean);
    db.tags = split('#setTags');
    db.playerTags = split('#setPlayerTags');
    save(); closeSheet(); toast('Gespeichert');
  });

  /* Theme sofort anwenden statt erst beim Sichern — der Sinn der Auswahl ist ja,
     das Ergebnis zu sehen. Das Sheet bleibt dabei offen. */
  $('#themePick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-th]'); if (!b) return;
    applyTheme(b.dataset.th); save();
    $$('.theme-card', $('#themePick')).forEach((c) => c.classList.toggle('on', c === b));
  });

  $('#btnStart').onclick = () => openStartBankroll(false);
  $('#btnExport').onclick = exportBackup;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = (e) => importBackup(e.target.files[0]);
  $('#btnCsv').onclick = () => $('#fileCsv').click();
  $('#fileCsv').onchange = (e) => readCsv(e.target.files[0]);
  showSwState();
  $('#btnUpdate').onclick = checkForUpdate;
  $('#btnWipe').onclick = () => {
    askSheet('Alle Daten löschen',
      `${plural(db.sessions.length, 'Session', 'Sessions')}, ${plural(db.txns.length, 'Buchung', 'Buchungen')} `
      + `und ${plural(db.players.length, 'Gegner-Profil', 'Gegner-Profile')} werden gelöscht. `
      + 'Das lässt sich nicht rückgängig machen — zieh vorher ein Backup.',
      'Alles löschen', () => {
        db.sessions = []; db.txns = []; db.live = null; db.players = []; db.setup = false;
        save(); closeSheet(); render(); toast('Alle Daten gelöscht');
      }, openSettings, true);
  };
}

function exportBackup() {
  // Vor dem Serialisieren setzen, damit der Stand auch im Backup selbst steht.
  db.lastBackup = new Date().toISOString();
  db.lastBackupCount = db.sessions.length + db.txns.length;
  db.snoozeBackup = 0;
  save();
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pokertracker-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  renderBackupHint();
  toast('Backup heruntergeladen');
}

function importBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.sessions)) throw new Error('Kein gültiges Backup');
      askSheet('Backup laden',
        `Das Backup enthält ${plural(d.sessions.length, 'Session', 'Sessions')} und `
        + `${plural((d.players || []).length, 'Gegner-Profil', 'Gegner-Profile')}. `
        + `Deine jetzigen Daten (${plural(db.sessions.length, 'Session', 'Sessions')}) werden dabei ersetzt.`,
        'Laden', () => {
          db = Object.assign(blank(), { tags: db.tags, playerTags: db.playerTags }, d);
          applyTheme(db.theme);
          save(); closeSheet(); render(); toast('Backup geladen');
        }, openSettings);
    } catch (e) { infoSheet('Import fehlgeschlagen', e.message, openSettings); }
  };
  r.readAsText(file);
}

/* ── Update-Verwaltung ──────────────────────────────────────── */
/** Welche APP_VERSION liegt im Offline-Cache? Das ist die Fassung,
    die beim nächsten Laden ausgeliefert wird — nicht zwingend die laufende. */
async function cachedVersion() {
  if (!('caches' in window)) return null;
  for (const k of await caches.keys()) {
    if (!k.startsWith('pokertracker')) continue;
    const c = await caches.open(k);
    const res = (await c.match('./app.js')) || (await c.match('app.js'));
    if (!res) continue;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (m) return m[1];
  }
  return null;
}

async function cacheName() {
  if (!('caches' in window)) return 'nicht unterstützt';
  return (await caches.keys()).find((k) => k.startsWith('pokertracker')) || 'leer';
}

async function showSwState() {
  const el = $('#swState'); if (!el) return;
  if (!('serviceWorker' in navigator)) { el.textContent = 'nicht unterstützt'; return; }
  const cv = await cachedVersion();
  el.textContent = await cacheName();
  const vr = $('#verRow');
  if (vr && cv && cv !== APP_VERSION) {
    vr.innerHTML = `<span>Version</span><span class="c">${esc(cv)} bereit</span>
      <span class="v down">${APP_VERSION} veraltet</span>`;
  }
}

/** Lädt neu, wenn im Cache eine andere Fassung liegt als die laufende.
    Die Sperre in sessionStorage verhindert eine Endlosschleife, falls das
    Neuladen die Version wider Erwarten nicht ändert. */
let reloading = false;
async function applyIfNewer(announce) {
  if (reloading) return false;
  const cv = await cachedVersion();
  if (!cv || cv === APP_VERSION) return false;
  if (sessionStorage.getItem('pt-reload') === cv) return false;   // schon versucht
  if (!$('#sheet').classList.contains('hidden')) {                // Formular offen
    toast(`Version ${cv} bereit — App neu starten`);
    return true;
  }
  reloading = true;
  sessionStorage.setItem('pt-reload', cv);
  if (announce) toast(`Version ${cv} wird geladen …`);
  setTimeout(() => location.reload(), announce ? 700 : 0);
  return true;
}

async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) { toast('Kein Offline-Cache aktiv'); return; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { toast('Kein Offline-Cache aktiv'); return; }
  toast('Suche nach Update …');
  sessionStorage.removeItem('pt-reload');          // manuelle Prüfung: Sperre lösen
  try { await reg.update(); } catch (e) { toast('Keine Verbindung'); return; }
  // Dem neuen Worker Zeit geben, seinen Cache zu füllen
  for (let i = 0; i < 20; i++) {
    if (await applyIfNewer(true)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  toast(`Bereits aktuell (${APP_VERSION})`);
  showSwState();
}

function wireUpdates() {
  if (!('serviceWorker' in navigator)) return;

  /* Auf 'controllerchange' ist kein Verlass: aktualisiert sich dieselbe
     Registrierung, gilt die Seite nicht als "neu kontrolliert" und das
     Ereignis bleibt aus. Verlässlich ist der Zustandswechsel des neuen
     Workers auf 'activated' — dann liegt der frische Cache bereit. */
  const watch = (w) => {
    if (!w) return;
    if (w.state === 'activated') { applyIfNewer(false); return; }
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') applyIfNewer(false);
    });
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => applyIfNewer(false));

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      watch(reg.installing); watch(reg.waiting);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // Beim Start prüfen: liegt aus einem früheren Besuch schon Neueres bereit?
      navigator.serviceWorker.ready.then(() => applyIfNewer(false));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
  });
}

/* ── CSV-Import aus anderen Trackern ────────────────────────── */
/** Zerlegt eine CSV mit Semikolon (oder Komma) in Objekte je Zeile. */
function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => {
    const cells = l.split(sep);
    const o = {};
    head.forEach((h, i) => (o[h] = (cells[i] || '').trim()));
    return o;
  });
}

/* Spalten, in denen eine Spielart stehen könnte, und wie ihre Werte zu deuten sind. */
const TYPE_COLS = ['type', 'typ', 'gametype', 'gamemode', 'spielart', 'spieltyp',
                   'modus', 'mode', 'kategorie', 'category', 'format', 'variante', 'art'];
const TYPE_WORDS = [
  [/^(mtt|sng|sit.?n?.?go|turnier|tournament|tourney|t)$/i, 'mtt'],
  [/^(cash|cashgame|cash.?game|ring|ringgame|cg|c)$/i, 'cash'],
  [/^(casino|cas|slots?|roulette|blackjack|bj|automat)$/i, 'casino'],
  [/turnier|tournament|mtt|sng/i, 'mtt'],
  [/cash|ring/i, 'cash'],
  [/casino|roulette|blackjack|slot/i, 'casino'],
];

/** Findet die Spalte, die die Spielart enthält — oder null. */
function findTypeColumn(rows) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  const named = cols.find((c) => TYPE_COLS.includes(c));
  if (named && rows.some((r) => mapType(r[named]))) return named;
  // Kein passender Name: Spalte suchen, deren Werte durchweg Spielarten sind
  return cols.find((c) => rows.every((r) => !r[c] || mapType(r[c]))
                       && rows.some((r) => mapType(r[c]))) || null;
}

/** Freitext → 'cash' | 'mtt' | 'casino' | null */
function mapType(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  for (const [re, t] of TYPE_WORDS) if (re.test(s)) return t;
  return null;
}

/** CSV-Zeile → Session. Dauer = Ende − Start − Pausen. */
function csvToSession(r, type) {
  const start = new Date(r.start);
  if (isNaN(start)) return null;
  const end = new Date(r.end);
  const gross = isNaN(end) ? 0 : (end - start) / 60000;
  const dur = Math.max(0, Math.round(gross - num(r.breakminutes)));
  const p = num(r.profit) - num(r.expenses);

  const s = {
    id: uid(), type, date: start.toISOString(),
    location: r.location || '', durationMin: dur,
    notes: '', tags: ['Import'],
  };
  if (type === 'casino') { s.result = p; s.game = ''; }
  else if (type === 'mtt') { s.buyin = 0; s.fee = 0; s.entries = 1; s.prize = p; }
  else { s.stakes = ''; s.bb = 0; s.players = 0; s.buyin = 0; s.cashout = p; }
  return s;
}

function readCsv(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    let rows;
    try { rows = parseCsv(r.result); }
    catch (e) { infoSheet('CSV nicht lesbar', e.message, openSettings); return; }
    const valid = rows.filter((x) => x.start && !isNaN(new Date(x.start)));
    if (!valid.length) {
      infoSheet('Keine Sessions gefunden',
        'In der Datei steht keine Zeile mit einer brauchbaren Spalte „start“. Erwartet werden die Spalten start;end;breakMinutes;location;currency;expenses;profit.',
        openSettings);
      return;
    }

    const sum = valid.reduce((a, x) => a + num(x.profit) - num(x.expenses), 0);

    // Spielart automatisch aus der CSV lesen, sonst alles auf Cash vorbelegen
    const typeCol = findTypeColumn(valid);
    const types = valid.map((x) => (typeCol && mapType(x[typeCol])) || 'cash');
    const auto = valid.filter((x, i) => typeCol && mapType(x[typeCol])).length;

    const rowHtml = (x, i) => {
      const p = num(x.profit) - num(x.expenses);
      const st = new Date(x.start), en = new Date(x.end);
      const dur = Math.max(0, Math.round((isNaN(en) ? 0 : (en - st) / 60000) - num(x.breakminutes)));
      return `<div class="imp-row">
        <div class="imp-info">
          <div class="imp-d">${dfShort.format(st)}${dur ? ' · ' + fmtDur(dur) : ''}${x.location ? ' · ' + esc(x.location) : ''}</div>
          <div class="imp-p ${cls(p)}">${signed(p)}</div>
        </div>
        <div class="seg imp-seg" data-i="${i}">
          ${TYPE_KEYS.map((k) => `<button type="button" data-t="${k}"
             class="${types[i] === k ? 'on' : ''}">${k === 'cash' ? 'Cash' : k === 'mtt' ? 'MTT' : 'Cas'}</button>`).join('')}
        </div>
      </div>`;
    };

    openSheet('CSV importieren', `
      <div class="bd" style="margin-bottom:14px">
        <div class="bd-row"><span>Gefundene Sessions</span><span class="c"></span><span class="v">${valid.length}</span></div>
        <div class="bd-row"><span>Summe Gewinn/Verlust</span><span class="c"></span>
          <span class="v ${cls(sum)}">${signed(sum)}</span></div>
        <div class="bd-row"><span>Zeitraum</span><span class="c"></span><span class="v">
          ${dfShort.format(new Date(Math.min(...valid.map((x) => +new Date(x.start)))))} –
          ${dfShort.format(new Date(Math.max(...valid.map((x) => +new Date(x.start)))))}</span></div>
      </div>

      <div class="hint" style="margin-bottom:12px">${typeCol
        ? `Spielart automatisch aus der Spalte <b>${esc(typeCol)}</b> erkannt — ${auto} von ${valid.length} Zeilen zugeordnet.`
        : `Die CSV enthält <b>keine Spalte mit der Spielart</b>. Ordne die Sessions unten zu
           — oder ergänze in der Tabelle eine Spalte <b>type</b> mit <code>cash</code> bzw.
           <code>turnier</code>, dann geht es automatisch.`}</div>

      <div class="sec-title">Alle setzen auf</div>
      <div class="btn-row" id="csvAll" style="margin:8px 0 14px">
        ${TYPE_KEYS.map((k) => `<button type="button" class="btn btn-sm" data-all="${k}">${TYPES[k].label}</button>`).join('')}
      </div>

      <div class="sec-title">Zuordnung je Session</div>
      <div class="imp-list" id="csvRows">${valid.map(rowHtml).join('')}</div>

      <p class="hint" style="margin-top:14px">Die CSV enthält nur das Netto-Ergebnis, keine
        Buy-ins. Buy-in wird deshalb auf 0 gesetzt und das Ergebnis als Cash-out geführt —
        Gewinn und Stundenrate stimmen dadurch, „Ø Buy-in" und ROI bleiben leer.
        Alle Einträge bekommen den Tag <b>Import</b>.</p>
      <button class="btn btn-primary btn-block" id="csvGo" style="margin-top:8px"></button>
    `, null);

    const refresh = () => {
      const n = (k) => types.filter((t) => t === k).length;
      $('#csvGo').textContent = `${valid.length} Sessions importieren  ·  `
        + TYPE_KEYS.filter((k) => n(k)).map((k) => `${n(k)} ${TYPES[k].label}`).join(', ');
    };
    refresh();

    $('#csvRows').onclick = (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const seg = b.closest('.imp-seg');
      types[+seg.dataset.i] = b.dataset.t;
      $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
      refresh();
    };
    $('#csvAll').onclick = (e) => {
      const b = e.target.closest('[data-all]'); if (!b) return;
      types.fill(b.dataset.all);
      $$('.imp-seg', $('#csvRows')).forEach((seg) => $$('button', seg)
        .forEach((x) => x.classList.toggle('on', x.dataset.t === b.dataset.all)));
      refresh();
    };
    $('#csvGo').onclick = () => {
      const added = valid.map((x, i) => csvToSession(x, types[i])).filter(Boolean);
      db.sessions.push(...added);
      if (!db.tags.includes('Import')) db.tags.push('Import');
      save(); closeSheet(); nav('sessions');
      toast(`${added.length} Sessions importiert`);
    };
  };
  r.readAsText(file);
}

/* ── EV / Equity ────────────────────────────────────────────── */
const SLOTS = ['h0', 'h1', 'v0', 'v1', 'b0', 'b1', 'b2', 'b3', 'b4'];
/* Der Wähler springt nur innerhalb einer Gruppe weiter: erst die vier
   Hole Cards, dann der Flop am Stück, danach Turn und River einzeln. */
const SLOT_GROUPS = [['h0', 'h1', 'v0', 'v1'], ['b0', 'b1', 'b2'], ['b3'], ['b4']];
const ev = { cards: {}, slot: 'h0', job: null };

function renderSlots() {
  $$('.slot').forEach((el) => {
    const c = ev.cards[el.dataset.slot];
    el.className = 'slot' + (c != null ? ` filled s${Equity.suitOf(c)}` : '')
      + (el.dataset.slot === ev.slot ? ' sel' : '');
    el.innerHTML = c != null
      ? `<span class="r">${Equity.RANKS[Equity.rankOf(c)]}</span><span>${Equity.SUITS[Equity.suitOf(c)]}</span>`
      : '';
  });
  const hole = ['h0', 'h1', 'v0', 'v1'].every((k) => ev.cards[k] != null);
  const nb = boardCards().length;
  const okBoard = [0, 3, 4, 5].includes(nb) && contiguousBoard();
  $('#evCalc').disabled = !(hole && okBoard);
  if (!hole) $('#eqMeta').textContent = 'Wähle vier Karten aus.';
  else if (!okBoard) $('#eqMeta').textContent = 'Das Board braucht 0, 3, 4 oder 5 Karten (lückenlos).';
  else if (!ev.job) $('#eqMeta').textContent = 'Bereit — tippe auf Berechnen.';
}
const boardCards = () => ['b0', 'b1', 'b2', 'b3', 'b4'].map((k) => ev.cards[k]).filter((c) => c != null);
function contiguousBoard() {
  const ks = ['b0', 'b1', 'b2', 'b3', 'b4'].map((k) => ev.cards[k] != null);
  return ks.indexOf(false) === -1 || !ks.slice(ks.indexOf(false)).includes(true);
}

function openCardPicker(slot) {
  ev.slot = slot;
  $('#cpTitle').textContent = 'Karte wählen';
  const used = new Set(Object.entries(ev.cards).filter(([k]) => k !== slot).map(([, c]) => c));
  let html = '';
  for (let s = 0; s < 4; s++) {
    for (let r = 12; r >= 0; r--) {
      const c = r * 4 + s;
      html += `<button class="cp s${s}${used.has(c) ? ' used' : ''}" data-c="${c}" ${used.has(c) ? 'disabled' : ''}>
        ${Equity.RANKS[r]}<small>${Equity.SUITS[s]}</small></button>`;
    }
  }
  $('#cpGrid').innerHTML = html;
  $('#cardPicker').classList.remove('hidden');
  $('#cardScrim').classList.remove('hidden');
  renderSlots();
}
function closeCardPicker() {
  $('#cardPicker').classList.add('hidden');
  $('#cardScrim').classList.add('hidden');
  ev.slot = null; renderSlots();
}

function pickCard(c) {
  ev.cards[ev.slot] = c;
  resetEqDisplay();
  const group = SLOT_GROUPS.find((g) => g.includes(ev.slot)) || [];
  const next = group.slice(group.indexOf(ev.slot) + 1).find((k) => ev.cards[k] == null);
  if (next) openCardPicker(next);
  else closeCardPicker();
}

function resetEqDisplay() {
  $('#eqHero').textContent = '–'; $('#eqHero').className = 'ev-eq';
  $('#eqVill').textContent = '–'; $('#eqVill').className = 'ev-eq';
  $('#eqBar').children[0].style.width = '0%';
  $('#eqBar').children[1].style.width = '0%';
  $('#evDetail').innerHTML = '';
}

function calcEquity() {
  if (ev.job) { ev.job.cancel(); ev.job = null; }
  const hero = [ev.cards.h0, ev.cards.h1];
  const vill = [ev.cards.v0, ev.cards.v1];
  const board = boardCards();

  const bar = $('#evProgress');
  bar.classList.remove('hidden'); bar.firstElementChild.style.width = '0%';
  $('#evCalc').disabled = true;
  $('#eqMeta').textContent = 'Berechne …';

  ev.job = Equity.run({
    hero, villain: vill, board,
    onProgress: (f) => { bar.firstElementChild.style.width = (f * 100).toFixed(0) + '%'; },
    onDone: (res) => {
      ev.job = null;
      bar.classList.add('hidden');
      $('#evCalc').disabled = false;
      $('#eqHero').textContent = nfa.format(res.heroEq * 100) + ' %';
      $('#eqVill').textContent = nfa.format(res.villEq * 100) + ' %';
      $('#eqHero').className = 'ev-eq ' + (res.heroEq > res.villEq ? 'up' : 'down');
      $('#eqVill').className = 'ev-eq ' + (res.villEq > res.heroEq ? 'up' : 'down');
      const w = res.win / res.total, t = res.tie / res.total;
      $('#eqBar').children[0].style.width = (w * 100) + '%';
      $('#eqBar').children[1].style.width = (t * 100) + '%';
      $('#eqMeta').textContent =
        `${nf0.format(res.total)} mögliche Boards · exakt berechnet`;
      const top = res.cats.slice(0, 4).map((c) => `${c.name} ${nfa.format(+(c.pct * 100).toFixed(1))} %`).join(' · ');
      $('#evDetail').innerHTML =
        `Gewinnt: <b>${nf0.format(res.win)}</b> · Split: <b>${nf0.format(res.tie)}</b> · Verliert: <b>${nf0.format(res.lose)}</b>
         <br>Deine Endhand: ${top}`;
    },
  });
}

function wireEV() {
  $('#view-ev').addEventListener('click', (e) => {
    const s = e.target.closest('.slot');
    if (s) { openCardPicker(s.dataset.slot); return; }
  });
  $('#cpGrid').onclick = (e) => {
    const b = e.target.closest('[data-c]');
    if (b && !b.disabled) pickCard(+b.dataset.c);
  };
  $('#cpClose').onclick = closeCardPicker;
  $('#cardScrim').onclick = closeCardPicker;
  $('#cpClear').onclick = () => { delete ev.cards[ev.slot]; resetEqDisplay(); openCardPicker(ev.slot); };
  $('#evCalc').onclick = calcEquity;
  $('#evClear').onclick = () => {
    if (ev.job) { ev.job.cancel(); ev.job = null; }
    ev.cards = {}; ev.slot = null;
    $('#evProgress').classList.add('hidden');
    resetEqDisplay(); renderSlots();
  };

  const po = () => {
    const pot = num($('#poPot').value), bet = num($('#poBet').value);
    $('#poOut').innerHTML = (pot > 0 && bet > 0)
      ? `Benötigte Equity: <b>${nfa.format(bet / (pot + 2 * bet) * 100)} %</b>
         <br><span style="font-size:12px">Du zahlst ${money(bet)}, um ${money(pot + bet)} zu gewinnen.</span>`
      : 'Benötigte Equity: <b>–</b>';
  };
  $('#poPot').oninput = po; $('#poBet').oninput = po;
}

/* ── Verdrahtung ────────────────────────────────────────────── */
function wire() {
  document.body.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]'); if (n) { nav(n.dataset.nav); return; }
    const r = e.target.closest('[data-sid]'); if (r) { editSession(r.dataset.sid); return; }
    const b = e.target.closest('[data-roll]'); if (b) { openBankroll(b.dataset.roll); return; }
    const p = e.target.closest('[data-player]'); if (p) { openPlayer(p.dataset.player); return; }
  });
  $('#btnNew').onclick = () => (db.live ? openLive() : newSession());
  $('#btnNewPlayer').onclick = newPlayerSheet;
  $('#btnSettings').onclick = openSettings;
  $('#liveOpen').onclick = openLive;
  $('#sheetCancel').onclick = closeSheet;
  $('#scrim').onclick = closeSheet;
  $('#sheetSave').onclick = () => sheetSaveFn && sheetSaveFn();

  const seg = (id, set) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', $(id)).forEach((x) => x.classList.toggle('on', x === b));
    set(b.dataset.k);
  });
  seg('#chartSeg', (k) => { chartKey = k; drawChart(); });
  seg('#filterSeg', (k) => { filterKey = k; renderSessions(); });
  seg('#statSeg', (k) => { statKey = k; renderStats(); });
  seg('#playerSeg', (k) => { playerSort = k; renderPlayers(); });

  wireEV();
}

/* ── Start ──────────────────────────────────────────────────── */
load();
applyTheme(db.theme);
wire();
renderSlots();
nav('home');
if (db.live) openLive();
else if (!db.setup && !db.sessions.length && !db.txns.length) openStartBankroll(true);

if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
wireUpdates();
