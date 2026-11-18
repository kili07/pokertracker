/* ─────────────────────────────────────────────────────────────
   app.js — Pokertracker
   ───────────────────────────────────────────────────────────── */
'use strict';

/* Bewusst derselbe Schlüssel wie in 1.x: 2.0 kommt als normales Update auf
   schon installierte Apps, die vorhandenen Daten sollen einfach da sein.
   normalize() ergänzt, was in älteren Datensätzen noch fehlt. */
const KEY = 'pokertracker.v1';
/* Bei jeder Änderung hochzählen — wird in den Einstellungen angezeigt,
   damit sich auf dem Handy prüfen lässt, welche Fassung wirklich läuft. */
const APP_VERSION = '2.5.1';

/* Darstellung. `bar` ist die Hintergrundfarbe des Themes und landet im
   <meta name="theme-color">, damit die Systemleiste des Handys mitzieht —
   sie muss mit --bg in style.css übereinstimmen. */
const THEME_KEY = 'pokertracker.theme';
const THEMES = {
  midnight: { label: 'Midnight', note: 'Tiefblau, ruhig',    bar: '#0b0e14' },
  daylight: { label: 'Daylight', note: 'Hell, für den Tag',  bar: '#f3f5f9' },
  felt:     { label: 'Felt',     note: 'Pokertisch & Gold',  bar: '#0b1511' },
  neon:     { label: 'Neon',     note: 'Schwarz mit Cyan',   bar: '#06070c' },
  sunset:   { label: 'Sunset',   note: 'Warmes Dunkel, Bernstein', bar: '#1c1210' },
  blossom:  { label: 'Blossom',  note: 'Sanftes Hell, Rosé', bar: '#faf3f2' },
};
const THEME_KEYS = Object.keys(THEMES);

/* Designs. „Klassisch" ist die bisherige Oberfläche mit den Farbschemata oben.
   Die anderen vier (Entwürfe A bis D aus „PWA Startseiten") bringen eigene
   Farben, Schriften und eine eigene Übersicht mit — das Farbschema ruht dann.
   Wer nichts umstellt, bleibt klassisch. `bar` muss --bg in style.css
   entsprechen, wie bei THEMES. */
const UI_KEY = 'pokertracker.ui';
const UIS = {
  classic: { label: 'Klassisch',   note: 'Bisheriges Design, mit Farbschema', bar: null },
  chips:   { label: 'Filz und Chips', note: 'Tischgrün, Bankroll als Chipstapel', bar: '#0e4d36' },
  playcard:{ label: 'Spielkarte',  note: 'Hell, Bankroll als Kartenindex',    bar: '#e4e2dc' },
  curve:   { label: 'Kurve',       note: 'Dunkel, Verlauf im Mittelpunkt',    bar: '#111315' },
  month:   { label: 'Monatsblatt', note: 'Hell, Kalender mit Spieltagen',     bar: '#f7f6f2' },
};
const UI_KEYS = Object.keys(UIS);

const TYPES = {
  cash:   { label: 'Cash Game', short: 'CASH', em: '♠️' },
  mtt:    { label: 'Turnier',   short: 'MTT',  em: '🏆' },
  casino: { label: 'Casino',    short: 'CAS',  em: '🎰' },
};
const TYPE_KEYS = ['cash', 'mtt', 'casino'];

/* Spielertypen für die Gegner-Einschätzung. Die Namen hier sind nur die
   Voreinstellung — wer lieber eigene Begriffe benutzt, überschreibt sie in den
   Einstellungen, der Wert landet dann in db.styleNames. Die Schlüssel
   ('fish', 'nit', …) bleiben davon unberührt, sonst würden die Gegner-Profile
   ihre Zuordnung verlieren. */
const P_STYLES = {
  unknown: { label: 'Unbekannt', em: '❔' },
  fish:    { label: 'Fisch',     em: '🐟' },
  nit:     { label: 'Nit',       em: '🪨' },
  tag:     { label: 'TAG',       em: '🎯' },
  lag:     { label: 'LAG',       em: '⚡' },
  maniac:  { label: 'Maniac',    em: '🔥' },
};
const P_STYLE_KEYS = Object.keys(P_STYLES);

/* Gängige Cash-Stakes als Vorschlagsliste. Eigene Werte sind über „＋ Andere
   Stakes" trotzdem möglich und wandern danach mit in die Auswahl. */
const STAKES_PRESETS = ['0,05/0,10', '0,10/0,25', '0,25/0,50', '0,50/1',
  '1/2', '1/3', '2/5', '5/10', '10/25', '25/50'];

/* ── Persistenz ─────────────────────────────────────────────── */
/** Frische Grundstruktur. Wird beim Laden und beim Backup-Import als Basis
    benutzt, damit später ergänzte Felder in alten Daten nicht fehlen. */
const blank = () => ({
  v: 3,
  sessions: [],   // {id,type,date,location,durationMin,…,notes,tags,playerIds}
  txns: [],       // {id,type,date,amount,note,kind?}   Ein-/Auszahlungen
  live: null,     // laufende Session
  tags: ['Gut gespielt', 'Tilt', 'Müde', 'Guter Tisch', 'Schwerer Tisch'],
  players: [],    // {id,name,style,loose,aggro,traits,notes:[{id,date,text,sessionId}]}
  playerTags: ['Callt zu viel', 'Foldet zu viel', '3-Bettet light', 'Bluffed oft',
    'Limpt', 'Tiltet schnell', 'Spielt Position', 'Overbets', 'Nur Premium'],
  theme: 'midnight',   // Darstellung, siehe THEMES
  ui: 'classic',       // Design, siehe UIS; Farbschema gilt nur bei 'classic'
  setup: false,        // Start-Bankroll schon abgefragt?
  lastBackup: null,    // ISO-Datum des letzten Backups
  lastBackupCount: 0,  // Anzahl Einträge zu dem Zeitpunkt
  snoozeBackup: 0,     // Hinweis bis zu diesem Zeitstempel ausgeblendet

  styleNames: {},      // eigene Namen der Spielertypen, z.B. {fish:'Spender'}
  /* Orte getrennt je Bereich: im Casino spielst Du woanders als im Turnier,
     eine gemeinsame Liste wäre in der Auswahl nur im Weg. Gefüllt wird sie
     aus den gespeicherten Sessions plus dem, was hier von Hand dazukommt. */
  locations: { cash: [], mtt: [], casino: [] },
  stakesList: [],      // eigene Stakes zusätzlich zu STAKES_PRESETS
  defaults: {          // Vorbelegung neuer Sessions
    type: 'cash',
    stakes: '',
    location: { cash: '', mtt: '', casino: '' },
  },
});

let db = blank();

/** Einen fremden Datensatz (aus localStorage oder aus einem Backup) auf die
    aktuelle Struktur bringen. Object.assign allein reicht nicht: es ersetzt
    verschachtelte Objekte im Ganzen, ein älteres `defaults` ohne das Feld
    `location` würde die Vorgabe also nicht ergänzen, sondern löschen.
    Alles, was die App erwartet, wird hier nachgezogen — Daten aus dem
    Datensatz haben dabei immer Vorrang vor der Vorgabe. */
function normalize(src) {
  // Zwei getrennte Aufrufe: das eine Objekt wird befüllt, das andere bleibt
  // als unveränderte Vorgabe zum Nachschlagen stehen.
  const base = blank();
  const d = Object.assign(blank(), src || {});
  delete d.meta;                                   // Kopfdaten des Backups gehören nicht in die Daten

  d.sessions = Array.isArray(d.sessions) ? d.sessions : [];
  d.txns = Array.isArray(d.txns) ? d.txns : [];
  d.players = Array.isArray(d.players) ? d.players : [];
  d.tags = Array.isArray(d.tags) && d.tags.length ? d.tags : base.tags;
  d.playerTags = Array.isArray(d.playerTags) && d.playerTags.length ? d.playerTags : base.playerTags;
  d.stakesList = Array.isArray(d.stakesList) ? d.stakesList : [];
  d.styleNames = d.styleNames && typeof d.styleNames === 'object' ? d.styleNames : {};

  // Ältere Sessions haben weder Tag- noch Gegnerliste — ohne die Arrays
  // stolpern Filter und Auswertungen über undefined.
  d.sessions.forEach((s) => {
    if (!s.id) s.id = uid();
    if (!Array.isArray(s.tags)) s.tags = [];
    if (!Array.isArray(s.playerIds)) s.playerIds = [];
  });
  d.players.forEach((p) => {
    if (!p.id) p.id = uid();
    if (!Array.isArray(p.notes)) p.notes = [];
    if (!Array.isArray(p.traits)) p.traits = [];
  });

  const loc = d.locations && typeof d.locations === 'object' ? d.locations : {};
  d.locations = {};
  TYPE_KEYS.forEach((k) => { d.locations[k] = Array.isArray(loc[k]) ? loc[k] : []; });

  const def = d.defaults && typeof d.defaults === 'object' ? d.defaults : {};
  const defLoc = def.location && typeof def.location === 'object' ? def.location : {};
  d.defaults = {
    type: TYPE_KEYS.includes(def.type) ? def.type : 'cash',
    stakes: def.stakes || '',
    location: {},
  };
  TYPE_KEYS.forEach((k) => { d.defaults.location[k] = defLoc[k] || ''; });

  if (!THEMES[d.theme]) d.theme = 'midnight';
  if (!UIS[d.ui]) d.ui = 'classic';
  d.v = base.v;
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    db = normalize(parsed);
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
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* nicht schlimm */ }
  applyLook();
}

/** Design und Farbschema aufs Dokument legen. Kurve und Monatsblatt laufen
    in style.css als eigene data-theme-Werte: so greift keine der
    Theme-Sonderregeln (Tabbar-Silhouetten) aus Versehen mit. Das gewählte
    Farbschema bleibt in db.theme stehen und kommt beim Zurückschalten wieder. */
function applyLook() {
  const u = UIS[db.ui] ? db.ui : 'classic';
  const root = document.documentElement;
  if (u === 'classic') { root.dataset.theme = db.theme; delete root.dataset.ui; }
  else { root.dataset.theme = u; root.dataset.ui = u; }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = UIS[u].bar || THEMES[db.theme].bar;
  try { localStorage.setItem(UI_KEY, u); } catch (e) { /* nicht schlimm */ }
}

function applyUi(u) {
  db.ui = UIS[u] ? u : 'classic';
  applyLook();
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

/** Angezeigter Name eines Spielertyps — eigener Name aus den Einstellungen,
    sonst der vorgegebene. */
const styleLabel = (k) => (db.styleNames && db.styleNames[k]) || (P_STYLES[k] || P_STYLES.unknown).label;
/** {label, em} eines Gegners, mit dem angezeigten Namen. */
function styleOf(p) {
  const k = P_STYLES[p && p.style] ? p.style : 'unknown';
  return { label: styleLabel(k), em: P_STYLES[k].em, key: k };
}

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
  if (v !== 'home') armBack();            // Zurück führt dann erst auf die Übersicht
  view = v;
  document.body.dataset.view = v;          // für Regeln, die nur auf der Übersicht gelten
  $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
  $$('.tabbar button[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
  // Kurve und Monatsblatt haben auf der Übersicht einen eigenen Kopf.
  $('#viewTitle').textContent = v === 'home' && db.ui !== 'classic' ? '' : TITLES[v];
  window.scrollTo(0, 0);
  render();
}

function render() {
  if (view === 'home') { renderHome(); }
  else if (view === 'sessions') { renderSessions(); }
  else if (view === 'players') { renderPlayers(); }
  else if (view === 'stats') { renderStats(); }
  renderLiveBar();
  fitCard();
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

function renderBackupHint(box = $('#backupNote')) {
  if (!box) return;
  const msg = backupHint();
  box.classList.toggle('hidden', !msg);
  if (!msg) return;
  box.innerHTML = `<div class="notice-t">${esc(msg)}</div>
    <button class="btn btn-sm note-save">Sichern</button>
    <button class="link note-hide" aria-label="Ausblenden">✕</button>`;
  // Im Kasten suchen, nicht global: die klassische Übersicht und die der
  // anderen Designs haben je einen eigenen Hinweiskasten.
  box.querySelector('.note-save').onclick = exportBackup;
  box.querySelector('.note-hide').onclick = () => {
    db.snoozeBackup = Date.now() + 14 * 864e5;
    save(); renderBackupHint(box);
  };
}

/* ── Übersicht ──────────────────────────────────────────────── */
let chartKey = 'all';

function renderHome() {
  const alt = db.ui !== 'classic';
  $('#homeClassic').classList.toggle('hidden', alt);
  $('#homeAlt').classList.toggle('hidden', !alt);
  if (db.ui === 'chips') return renderHomeChips();
  if (db.ui === 'playcard') return renderHomeCard();
  if (db.ui === 'curve') return renderHomeCurve();
  if (db.ui === 'month') return renderHomeMonth();
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
    return `<div class="roll">
      <div class="roll-name">${TYPES[k].label}</div>
      <div class="roll-val">${money(b)}</div>
      <div class="roll-delta ${cls(pr)}">${n ? signed(pr) : '—'}</div>
    </div>`;
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
    ${s.photo ? `<img class="row-thumb" src="${s.photo}" alt="">` : ''}
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

/* ── Übersicht der Designs Kurve und Monatsblatt ────────────── */
/* Beide zeigen den laufenden Kalendermonat als Bezugsrahmen — „seit dem
   1." ist die Frage, die man sich am Tisch stellt, nicht „seit Beginn". */
const dfMonthName = new Intl.DateTimeFormat('de-DE', { month: 'long' });
const dfDayLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Sessions eines Kalendermonats (m: 0 bis 11), neueste zuerst. */
function monthSessions(y, m) {
  const a = new Date(y, m, 1), b = new Date(y, m + 1, 1);
  return db.sessions.filter((s) => { const d = new Date(s.date); return d >= a && d < b; })
    .sort((p, q) => new Date(q.date) - new Date(p.date));
}

/** Kurzbeschreibung einer Session in einer Zeile, ohne Ort. */
function altLine(s) {
  const bits = [];
  if (s.type === 'cash') bits.push('Cash' + (s.stakes ? ' ' + esc(s.stakes) : ''));
  else if (s.type === 'mtt') {
    bits.push(num(s.place)
      ? `Turnier, Platz ${num(s.place)}${num(s.fieldSize) ? ' von ' + num(s.fieldSize) : ''}`
      : 'Turnier');
  } else bits.push(esc(s.location) || 'Casino');
  if (num(s.durationMin)) bits.push(fmtDur(num(s.durationMin)));
  return bits.join(', ');
}

/** Stundenlohn nur über Sessions mit erfasster Dauer, sonst verfälschen
    Casino-Abende ohne Zeitangabe den Wert. */
function hourly(list) {
  const timed = list.filter((s) => num(s.durationMin) > 0);
  const h = timed.reduce((a, s) => a + hours(s), 0);
  if (!h) return '—';
  const v = timed.reduce((a, s) => a + profit(s), 0) / h;
  return (v < -0.5 ? '−' : '') + nf0.format(Math.abs(v)) + ' €/h';
}

/** Bankroll je Bereich als Knöpfe, die das Konto des Bereichs öffnen. */
function altRolls(klass) {
  return TYPE_KEYS.map((k) => `<button class="${klass}" data-roll-open="${k}">
      <span class="alt-k">${TYPES[k].label}</span>
      <span class="alt-v ${bankroll(k) < 0 ? 'down' : ''}">${money(bankroll(k))}</span>
    </button>`).join('');
}

/** Großer Knopf: neue Session, bei laufender Session deren Ansicht. */
function altStartBtn(klass, label) {
  return `<button class="${klass}" data-act="new">${db.live ? 'Laufende Session öffnen' : label}</button>`;
}

/** Datum als „Sa 7.11." für die Sessionlisten von Filz und Spielkarte. */
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dateShort = (iso) => { const d = new Date(iso); return `${WD_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };

/** Letzte Sessions als schlichte Zeilen (Datum, Beschreibung, Ergebnis). */
function altRecent(prefix, emptyText) {
  const recent = [...db.sessions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  return `<div class="${prefix}-recent">
      <div class="alt-recent-head"><h2>Letzte Sessions</h2><button class="link" data-nav="sessions">Alle</button></div>
      ${recent.length ? recent.map((s) => `<button class="alt-row" data-sid="${s.id}">
          <span class="alt-date">${dateShort(s.date)}</span>
          <span class="alt-desc">${altLine(s)}</span>
          <span class="alt-val ${profit(s) < 0 ? 'down' : ''}">${signed(profit(s))}</span>
        </button>`).join('') : `<div class="empty">${emptyText}</div>`}
    </div>`;
}

/* ── Filz und Chips ────────────────────────────────────────── */
/** Wert eines Chips: 100 € wie im Entwurf, bei großen Bankrolls die nächste
    runde Stufe, damit der höchste Stapel höchstens 15 Chips hat. */
function chipUnit(max) {
  const steps = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  return steps.find((u) => max / u <= 15) || Math.ceil(max / 15 / 100000) * 100000;
}

function renderHomeChips() {
  const now = new Date();
  const list = monthSessions(now.getFullYear(), now.getMonth());
  const mp = list.reduce((a, s) => a + profit(s), 0);
  const total = bankroll('all');
  const unit = chipUnit(Math.max(0, ...TYPE_KEYS.map((k) => bankroll(k))));

  const stacks = TYPE_KEYS.map((k) => {
    const b = bankroll(k);
    // Angebrochene Chips aufrunden: auch 30 € sollen sichtbar etwas sein.
    const n = b > 0 ? Math.max(1, Math.round(b / unit)) : 0;
    return `<button class="fz-roll" data-roll-open="${k}">
        <span class="fz-stack fz-${k}${n ? '' : ' fz-zero'}" role="img"
          aria-label="${n ? `Stapel aus ${n} ${n === 1 ? 'Chip' : 'Chips'}` : 'Kein Chip'}" style="height:${n ? n * 11 : 4}px"></span>
        <span class="fz-k">${TYPES[k].label}</span>
        <span class="fz-v ${b < 0 ? 'down' : ''}">${money(b)}</span>
      </button>`;
  }).join('');

  $('#homeAlt').innerHTML = `
    <div class="fz-head">
      <span class="alt-k">Bankroll gesamt</span>
      <span class="fz-big ${total < 0 ? 'down' : ''}">${money(total)}</span>
      <span class="fz-sub">${dfMonthName.format(now)} <b class="${mp < 0 ? 'down' : ''}">${signed(mp)}</b> in ${plural(list.length, 'Session', 'Sessions')}</span>
    </div>
    <div class="notice hidden" id="backupNoteAlt"></div>
    <div class="fz-rolls">${stacks}</div>
    <div class="fz-hint">Ein Chip steht für ${money(unit)}. Stapel antippen, um ein- oder auszuzahlen.</div>
    ${altStartBtn('fz-start', 'Session erfassen')}
    ${altRecent('fz', 'Tippe auf „Session erfassen“ für Deine erste Session.')}`;
  renderBackupHint($('#backupNoteAlt'));
}

/* ── Spielkarte ────────────────────────────────────────────── */
/* Farbsymbole: Pik für Cash, Kreuz für Turnier, Karo (rot) für Casino. */
const SUITS = {
  cash: '<path d="M12 2C8 7 3 10 3 14.5A4.5 4.5 0 0 0 11 17c-.3 2-1 3.5-2.5 5h7c-1.5-1.5-2.2-3-2.5-5a4.5 4.5 0 0 0 8-2.5C21 10 16 7 12 2z"/>',
  mtt: '<circle cx="12" cy="7" r="4.6"/><circle cx="6.6" cy="14" r="4.6"/><circle cx="17.4" cy="14" r="4.6"/><path d="M12 11c-.2 5.5-1 8.5-3 11h6c-2-2.5-2.8-5.5-3-11z"/>',
  casino: '<path d="M12 2 20 12 12 22 4 12z"/>',
};

/* Eigene Dame (keine Kopie einer Vorlage): Brustbild im Stil alter
   Hofkarten mit Krone, offenem Haar, Perlenkette, Gewand und einem Zepter,
   dessen Spitze das Farbsymbol der Karte trägt. Als <symbol> einmal
   definiert und per <use> eingesetzt. Gewand, Ärmel, Haar und Zepterspitze
   kommen über CSS-Variablen der jeweiligen Karte (.pc-q-cash usw.), die
   in den <use>-Inhalt vererbt werden. */
const QUEEN_SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <pattern id="pqDots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1" class="pa-paper"/></pattern>
  <pattern id="pqScroll" width="10" height="8" patternUnits="userSpaceOnUse"><path d="M0 6 q2.5 -5 5 0 q2.5 5 5 0" fill="none" class="pa-sline"/></pattern>
  <pattern id="pqZig" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6 L3 1 L6 6Z" class="pa-ink"/></pattern>
  <symbol id="pcQueen" viewBox="0 0 120 170">
    <path d="M37 60 C30 86 32 112 40 128 L56 120 L55 66 Z" class="pa-hair pa-line"/>
    <path d="M83 60 C90 86 88 112 80 128 L64 120 L65 66 Z" class="pa-hair pa-line"/>
    <path d="M41 76 C38 92 40 108 45 120 M45 70 C43 88 45 104 49 116 M79 76 C82 92 80 108 75 120 M75 70 C77 88 75 104 71 116" fill="none" class="pa-sline"/>
    <path d="M6 170 C8 142 28 125 60 122 C92 125 112 142 114 170 Z" class="pa-gown pa-line"/>
    <path d="M6 170 C8 142 28 125 60 122 C92 125 112 142 114 170 Z" fill="url(#pqScroll)" opacity=".55"/>
    <path d="M6 170 C8 152 16 139 28 131 L40 170 Z" class="pa-sleeve pa-line"/>
    <path d="M6 170 C8 152 16 139 28 131 L40 170 Z" fill="url(#pqDots)"/>
    <path d="M114 170 C112 152 104 139 92 131 L80 170 Z" class="pa-sleeve pa-line"/>
    <path d="M114 170 C112 152 104 139 92 131 L80 170 Z" fill="url(#pqDots)"/>
    <path d="M30 129 C44 142 76 142 90 129 L86 123 C72 135 48 135 34 123 Z" class="pa-gold pa-line"/>
    <path d="M50 170 L60 137 L70 170 Z" class="pa-gold pa-line"/>
    <path d="M50 170 L60 137 L70 170 Z" fill="url(#pqZig)" opacity=".85"/>
    <rect x="54" y="98" width="12" height="28" class="pa-skin pa-line"/>
    <ellipse cx="60" cy="79" rx="15.5" ry="19.5" class="pa-skin pa-line"/>
    <path d="M44.5 72 C47 60 73 60 75.5 72 C70 66 50 66 44.5 72 Z" class="pa-hair pa-line"/>
    <path d="M50 73.5 q4 -3 8 -.5 M62 73 q4 -2.5 8 .5" fill="none" class="pa-sline"/>
    <path d="M50.5 78 q3.8 2.2 7.6 0 M61.9 78 q3.8 2.2 7.6 0" fill="none" class="pa-sline"/>
    <circle cx="54.3" cy="78.6" r="1.1" class="pa-ink"/><circle cx="65.7" cy="78.6" r="1.1" class="pa-ink"/>
    <path d="M60 79 L58.3 87.5 L61.2 88.3" fill="none" class="pa-sline"/>
    <path d="M56 92.5 q4 2.6 8 0 q-4 -1.2 -8 0Z" class="pa-red"/>
    <circle cx="51.5" cy="86" r="3" class="pa-red" opacity=".22"/><circle cx="68.5" cy="86" r="3" class="pa-red" opacity=".22"/>
    <path d="M42 60 L40 41 L49 51 L55 36 L60 49 L65 36 L71 51 L80 41 L78 60 Z" class="pa-gold pa-line"/>
    <path d="M42 58 H78 L78.6 64 H41.4 Z" class="pa-gold pa-line"/>
    <circle cx="40" cy="40" r="2.4" class="pa-paper pa-line"/><circle cx="55" cy="35" r="2.4" class="pa-paper pa-line"/>
    <circle cx="65" cy="35" r="2.4" class="pa-paper pa-line"/><circle cx="80" cy="40" r="2.4" class="pa-paper pa-line"/>
    <circle cx="50" cy="61" r="1.7" class="pa-red"/><circle cx="60" cy="61" r="1.9" class="pa-blue"/><circle cx="70" cy="61" r="1.7" class="pa-red"/>
    <path d="M60 46 l3 4 -3 4 -3 -4Z" class="pa-red pa-line"/>
    <path d="M45 125 C52 131 68 131 75 125" fill="none" class="pa-dash"/>
    <path d="M100 168 L104.5 62" class="pa-rod"/><path d="M100 168 L104.5 62" class="pa-rodin"/>
    <path d="M104.5 44 C101 49 96 52 96 56.5 A4.2 4.2 0 0 0 103.6 58.8 C103.4 60.6 102.8 62 101.6 63.4 H107.4 C106.2 62 105.6 60.6 105.4 58.8 A4.2 4.2 0 0 0 113 56.5 C113 52 108 49 104.5 44Z" class="pa-ink pa-fin-sp"/>
    <g class="pa-fin-cl"><circle cx="104.5" cy="48.5" r="4" class="pa-ink"/><circle cx="100" cy="55" r="4" class="pa-ink"/><circle cx="109" cy="55" r="4" class="pa-ink"/><path d="M104.5 52 C104.3 57 103.6 60.5 101.8 63.4 H107.2 C105.4 60.5 104.7 57 104.5 52Z" class="pa-ink"/></g>
    <path d="M104.5 43 L110.5 53.5 L104.5 64 L98.5 53.5Z" class="pa-red pa-line pa-fin-di"/>
    <circle cx="104.3" cy="66" r="2.4" class="pa-gold pa-line"/>
    <ellipse cx="100.5" cy="142" rx="6.5" ry="5" class="pa-skin pa-line"/>
    <path d="M95 141 q5.5 -2 11 0" fill="none" class="pa-sline"/>
  </symbol></defs></svg>`;

/* Je Bereich eine Dame: Pik für Cash Game, Kreuz für Turnier, Karo für
   Casino. Nur die oberste Karte des Stapels ist bedienbar. */
let cardIdx = 0;

function renderHomeCard() {
  const pip = (k, cls) => `<svg aria-hidden="true" class="${cls} pc-pip-${k}" viewBox="0 0 24 24">${SUITS[k]}</svg>`;
  /* Eckindex wie auf einer echten Karte: Buchstabe über dem Farbsymbol. */
  const corner = (k, rot) => `<div class="pc-corner${rot ? ' pc-corner-rot' : ''}" aria-hidden="true">
      <span class="pc-q">Q</span>${pip(k, 'pc-cpip')}</div>`;
  /* Kartenhälfte: großes Farbsymbol und die Dame. Unten dieselbe Hälfte
     um 180° gedreht, wie bei Hofkarten (punktsymmetrisch). */
  const half = (k, rot) => `<div class="pc-half${rot ? ' pc-half-rot' : ''}" aria-hidden="true">
      <div class="pc-head">${pip(k, 'pc-bigpip')}</div>
      <svg class="pc-queen" viewBox="0 0 120 170" preserveAspectRatio="xMaxYMax meet"><use href="#pcQueen"/></svg>
    </div>`;
  const face = (k, i) => {
    const b = bankroll(k), pr = totalProfit(k), n = sessionsOf(k).length;
    return `<div class="pc-face pc-q-${k}" data-i="${i}" role="group" aria-roledescription="Karte"
        aria-label="${TYPES[k].label}, ${i + 1} von ${TYPE_KEYS.length}">
      ${corner(k, false)}
      <div class="pc-court">
        ${half(k, false)}
        <div class="pc-plaque">
          <button class="pc-main" data-roll-open="${k}">
            <span class="pc-kind">${pip(k, 'pc-suit')}${TYPES[k].label}</span>
            <span class="pc-big ${b < 0 ? 'down' : ''}">${money(b)}</span>
            <span class="pc-sub">${n ? `${signed(pr)} aus ${plural(n, 'Session', 'Sessions')}` : 'Noch keine Session'}</span>
          </button>
        </div>
        ${half(k, true)}
      </div>
      ${corner(k, true)}
    </div>`;
  };

  /* Die Karte ist die ganze Startseite: keine Sessionliste, kein eigener
     Knopf (neue Session über ＋ in der Leiste). Der Hinweis zur Sicherung
     steht über der Karte, damit fitCard() ihn bei der Höhe mitrechnet.
     Hinten liegt ein Stapel verdeckter Karten, offen ist nur die Dame des
     gewählten Bereichs. Wischen wirft sie weg, dann wird die nächste
     ausgeteilt. */
  $('#homeAlt').innerHTML = `${QUEEN_SVG}
    <div class="notice hidden" id="backupNoteAlt"></div>
    <div class="pc-card" id="pcCard" aria-roledescription="Kartenstapel" aria-label="Bankroll je Bereich, wischen zum Blättern">
      <div class="pc-stack" id="pcStack">
        <div class="pc-deck pc-deck-2" aria-hidden="true"></div>
        <div class="pc-deck pc-deck-1" aria-hidden="true"></div>
        ${TYPE_KEYS.map(face).join('')}
      </div>
      <div class="pc-dots" role="tablist" aria-label="Bereich wählen">${TYPE_KEYS.map((k, i) =>
        `<button class="pc-dot" role="tab" data-card="${i}" aria-label="${TYPES[k].label}"></button>`).join('')}</div>
    </div>`;
  renderBackupHint($('#backupNoteAlt'));
  showCard();
  wireCardSwipe();
}

/** Nur die Karte cardIdx offen zeigen, Punkte nachziehen. */
function showCard() {
  $$('#pcStack .pc-face').forEach((f) => {
    const on = Number(f.dataset.i) === cardIdx;
    f.classList.toggle('is-top', on);
    f.inert = !on;                       // nur die offene Karte ist bedienbar
    f.style.transform = ''; f.style.opacity = '';
  });
  $$('#pcCard .pc-dot').forEach((d) => {
    const on = Number(d.dataset.card) === cardIdx;
    d.classList.toggle('on', on);
    d.setAttribute('aria-selected', on);
  });
}

let cardBusy = false;
let cardNext = null;     // während einer Animation angetippter Punkt, kommt danach dran
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Zur Karte i blättern, in zwei getrennten Schritten:
    1. die offene Karte fliegt in Richtung dir (-1 links, 1 rechts) aus dem
       Bild und blendet dabei aus, ausgehend von der Lage, in der der Finger
       sie losgelassen hat;
    2. erst danach wird die neue Karte vom Stapel ausgeteilt: sie hebt sich
       leicht vergrößert an und legt sich gerade hin. */
async function goCard(i, dir, from) {
  const n = TYPE_KEYS.length;
  i = (i + n) % n;
  const stack = $('#pcStack');
  if (!stack) return;
  if (cardBusy) { if (!from) cardNext = [i, dir]; return; }
  const old = stack.querySelector('.pc-face.is-top');
  const nu = stack.querySelector(`.pc-face[data-i="${i}"]`);
  if (!old || !nu || i === cardIdx) { showCard(); return; }
  if (calm() || !old.animate) { cardIdx = i; showCard(); return; }
  cardBusy = true;
  const w = stack.clientWidth;
  const start = from || 'none';
  try {
    await old.animate([
      { transform: start, opacity: 1 },
      { transform: `translate(${dir * w * 1.25}px, ${-w * 0.08}px) rotate(${dir * 14}deg)`, opacity: 0 },
    ], { duration: 280, easing: 'cubic-bezier(.45,0,.85,.4)', fill: 'forwards' }).finished;
    old.getAnimations().forEach((a) => a.cancel());
    cardIdx = i; showCard();
    await nu.animate([
      { transform: 'translateY(14px) scale(.94)', opacity: 0, offset: 0 },
      { transform: 'translateY(-4px) scale(1.01)', opacity: 1, offset: .7 },
      { transform: 'none', opacity: 1 },
    ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished;
  } catch (e) { cardIdx = i; showCard(); }
  cardBusy = false;
  if (cardNext) { const [ni, nd] = cardNext; cardNext = null; goCard(ni, nd); }
}

/** Wischgeste: die offene Karte folgt dem Finger und kippt leicht. Ab
    einem Viertel der Breite (höchstens 110 px) oder einem schnellen Wisch wird geblättert,
    sonst federt sie zurück. Senkrechtes Wischen bleibt der Seite. */
function wireCardSwipe() {
  const card = $('#pcCard'); if (!card) return;
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, drag = false, axis = null, swallow = false, top = null;
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.pc-dot')) return;
    if (cardBusy) return;
    top = card.querySelector('.pc-face.is-top'); if (!top) return;
    x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); dx = 0; drag = true; axis = null;
  });
  card.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (axis === 'x') { top.classList.add('pc-drag'); card.setPointerCapture(e.pointerId); }
    }
    if (axis !== 'x') return;
    dx = mx;
    top.style.transform = `translate(${dx}px, ${Math.abs(dx) * -0.04}px) rotate(${dx * 0.045}deg)`;
  });
  const end = () => {
    if (!drag) return;
    drag = false;
    if (axis !== 'x') return;
    top.classList.remove('pc-drag');
    swallow = true; setTimeout(() => { swallow = false; }, 50);   // kein Antippen nach dem Wischen
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > Math.min(card.clientWidth * 0.25, 110) || (v > 0.5 && Math.abs(dx) > 30)) {
      // Links wischen: nächste Karte, rechts: vorige. Die Karte fliegt in
      // Wischrichtung weiter, ab der Lage, in der sie losgelassen wurde.
      const from = top.style.transform;
      goCard(cardIdx + (dx < 0 ? 1 : -1), dx < 0 ? -1 : 1, from);
    } else if (top.animate && !calm()) {
      // Zurückfedern statt springen
      const from = top.style.transform;
      top.style.transform = '';
      top.animate([{ transform: from }, { transform: 'none' }],
        { duration: 300, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    } else showCard();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  card.addEventListener('click', (e) => {
    if (swallow) { e.stopPropagation(); e.preventDefault(); return; }
    const d = e.target.closest('.pc-dot');
    if (d) { const i = Number(d.dataset.card); goCard(i, i > cardIdx ? -1 : 1); }
  }, true);
}

/** Höhe der Spielkarte so setzen, dass sie genau den Platz zwischen ihrer
    Oberkante und der unteren Leiste füllt. CSS allein kennt die Höhe von
    Kopfzeile, Live-Leiste und Sicherungshinweis nicht; die Vorgabe in
    style.css gilt nur bis zum ersten Messen. */
function fitCard() {
  const card = $('#pcCard');
  if (!card || view !== 'home' || db.ui !== 'playcard') return;
  const top = card.getBoundingClientRect().top + window.scrollY;
  const padBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
  const h = Math.max(200, Math.floor(window.innerHeight - top - padBottom));
  card.style.setProperty('--pc-h', h + 'px');
}

/* ── Kurve ─────────────────────────────────────────────────── */
function renderHomeCurve() {
  const now = new Date();
  const list = monthSessions(now.getFullYear(), now.getMonth());
  const mp = list.reduce((a, s) => a + profit(s), 0);
  const wins = list.filter((s) => profit(s) > 0).length;
  const total = bankroll('all');

  // Aufteilung als Balken: Bereiche im Minus haben keine Breite.
  const parts = TYPE_KEYS.map((k) => Math.max(0, bankroll(k)));
  const sum = parts.reduce((a, v) => a + v, 0);
  const bar = sum > 0
    ? TYPE_KEYS.map((k, i) => parts[i] > 0 ? `<span class="cv-seg cv-${k}" style="flex:${parts[i]}"></span>` : '').join('')
    : '<span class="cv-seg cv-none" style="flex:1"></span>';
  const barLabel = 'Aufteilung: ' + TYPE_KEYS.map((k) => `${TYPES[k].label} ${money(bankroll(k))}`).join(', ');

  const recent = [...db.sessions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);

  $('#homeAlt').innerHTML = `
    <div class="cv-head">
      <div class="cv-total">
        <span class="alt-k">Bankroll</span>
        <span class="cv-big ${total < 0 ? 'down' : ''}">${money(total)}</span>
      </div>
      <div class="cv-month">
        <span class="cv-delta ${mp < 0 ? 'down' : mp > 0 ? 'acc' : ''}">${signed(mp)}</span>
        <span class="alt-k">seit 1. ${dfMonthName.format(now)}</span>
      </div>
    </div>
    <div class="notice hidden" id="backupNoteAlt"></div>
    <div class="cv-chart" id="cvChart"></div>
    <div class="cv-stats">
      <div><span class="alt-k">Stundenlohn</span><span class="alt-v">${hourly(list)}</span></div>
      <div><span class="alt-k">Sessions</span><span class="alt-v">${list.length}</span></div>
      <div><span class="alt-k">Im Plus</span><span class="alt-v">${list.length ? `${wins} von ${list.length}` : '—'}</span></div>
    </div>
    <div class="cv-bar" role="img" aria-label="${esc(barLabel)}">${bar}</div>
    <div class="cv-rolls">${altRolls('cv-roll')}</div>
    ${altStartBtn('cv-start', `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/></svg>Session starten`)}
    <div class="cv-recent">
      <div class="cv-recent-head"><h2>Letzte Sessions</h2><button class="link" data-nav="sessions">Alle</button></div>
      ${recent.length ? recent.map((s) => `<button class="cv-row" data-sid="${s.id}">
          <span class="cv-date">${pad2(new Date(s.date).getDate())}.${pad2(new Date(s.date).getMonth() + 1)}</span>
          <span class="cv-desc">${altLine(s)}</span>
          <span class="cv-val ${profit(s) < 0 ? 'down' : ''}">${signed(profit(s))}</span>
        </button>`).join('')
        : '<div class="empty">Tippe auf „Session starten“ für Deine erste Session.</div>'}
    </div>`;
  renderBackupHint($('#backupNoteAlt'));
  drawCurveChart($('#cvChart'));
}

/** Verlauf der Gesamtbankroll über die letzten Einträge, mit Monatsgrenzen.
    In echten Pixeln gezeichnet statt mit preserveAspectRatio="none", damit
    der Endpunkt rund bleibt und die Striche nicht verzerren. */
function drawCurveChart(box) {
  const pts = curve('all').slice(-30);
  if (pts.length < 2) {
    box.innerHTML = '<div class="chart-empty">Mindestens 2 Einträge für den Verlauf</div>';
    return;
  }
  const W = Math.max(200, Math.round(box.clientWidth || 335)), H = 150, P = 6, B = 145;
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = (hi - lo) || Math.abs(hi) || 1;
  const x = (i) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v) => B - 2 - ((v - lo) / span) * (B - 14);

  const mk = (p) => { const d = new Date(p.d); return d.getFullYear() * 12 + d.getMonth(); };
  const starts = [0];
  for (let i = 1; i < pts.length; i++) if (mk(pts[i]) !== mk(pts[i - 1])) starts.push(i);
  const grid = starts.slice(1).map((i) => {
    const gx = ((x(i - 1) + x(i)) / 2).toFixed(1);
    return `<line x1="${gx}" y1="0" x2="${gx}" y2="${B}" class="cv-mline"/>`;
  }).join('');
  // Monatsnamen nur, wenn der Abschnitt breit genug für das Wort ist.
  const labels = starts.map((i, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : pts.length - 1;
    const left = n ? (x(i - 1) + x(i)) / 2 : 0;
    const right = n + 1 < starts.length ? (x(end - 1) + x(end)) / 2 : W;
    if (right - left < 64 && starts.length > 1) return '';
    return `<span style="left:${(left / W * 100).toFixed(1)}%">${dfMonthName.format(new Date(pts[i].d))}</span>`;
  }).join('');

  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const last = pts.length - 1;
  box.innerHTML = `<svg role="img" aria-label="Verlauf der Bankroll über die letzten ${pts.length} Einträge, von ${esc(money(pts[0].y))} auf ${esc(money(pts[last].y))}"
      width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <line x1="0" y1="${y(hi).toFixed(1)}" x2="${W}" y2="${y(hi).toFixed(1)}" class="cv-grid" stroke-dasharray="3 4"/>
      <line x1="0" y1="${y((hi + lo) / 2).toFixed(1)}" x2="${W}" y2="${y((hi + lo) / 2).toFixed(1)}" class="cv-grid" stroke-dasharray="3 4"/>
      <line x1="0" y1="${B}" x2="${W}" y2="${B}" class="cv-grid"/>
      ${grid}
      <polyline points="${line}" class="cv-line"/>
      <circle cx="${x(last).toFixed(1)}" cy="${y(pts[last].y).toFixed(1)}" r="4.5" class="cv-dot"/>
    </svg>
    <div class="cv-months">${labels}</div>`;
}

/* ── Monatsblatt ───────────────────────────────────────────── */
let monthView = null;   // {y, m} des angezeigten Monats, null = aktueller
let monthPick = null;   // gewählter Tag als 'JJJJ-MM-TT'

function shiftMonth(step) {
  const now = new Date();
  const cur = monthView || { y: now.getFullYear(), m: now.getMonth() };
  const d = new Date(cur.y, cur.m + step, 1);
  // Nicht in die Zukunft blättern, dort steht nichts.
  if (d > new Date(now.getFullYear(), now.getMonth(), 1)) return;
  monthView = { y: d.getFullYear(), m: d.getMonth() };
  monthPick = null;
  renderHome();
}

/** Gesamtbankroll unmittelbar vor dem Zeitpunkt `until`. */
function rollAt(until) {
  const pts = curve('all').filter((p) => new Date(p.d) < until);
  return pts.length ? pts[pts.length - 1].y : 0;
}

/** Kurzer Betrag für die Kalenderkachel: ohne €, ab 10.000 in Tausend. */
function tileAmount(v) {
  const a = Math.abs(v);
  const t = a >= 10000 ? nf0.format(a / 1000) + 'k' : nf0.format(a);
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + t;
}

function renderHomeMonth() {
  const now = new Date();
  const { y, m } = monthView || { y: now.getFullYear(), m: now.getMonth() };
  const isNow = y === now.getFullYear() && m === now.getMonth();
  const list = monthSessions(y, m);
  const mp = list.reduce((a, s) => a + profit(s), 0);

  const byDay = {};
  list.forEach((s) => { (byDay[dayKey(new Date(s.date))] = byDay[dayKey(new Date(s.date))] || []).push(s); });
  if (!monthPick || !byDay[monthPick]) monthPick = list.length ? dayKey(new Date(list[0].date)) : null;

  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;            // Montag zuerst
  const days = new Date(y, m + 1, 0).getDate();
  const today = dayKey(now);
  let cells = '<span></span>'.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const ss = byDay[k];
    if (ss) {
      const v = ss.reduce((a, s) => a + profit(s), 0);
      const word = ss.length > 1 ? `${ss.length} Sessions` : TYPES[ss[0].type].label;
      cells += `<button class="mb-day ${v > 0 ? 'plus' : v < 0 ? 'minus' : 'even'}${k === monthPick ? ' sel' : ''}${k === today ? ' today' : ''}"
          data-day="${k}" aria-label="${d}. ${dfMonthName.format(first)}, ${esc(word)}, ${esc(signed(v))}${k === monthPick ? ', ausgewählt' : ''}">
          <span class="mb-n">${d}</span><span class="mb-v">${tileAmount(v)}</span></button>`;
    } else {
      const when = k === today ? 'today' : k < today ? 'past' : 'future';
      cells += `<span class="mb-day ${when}"><span class="mb-n">${d}</span></span>`;
    }
  }

  const pick = monthPick ? byDay[monthPick] : null;
  const detail = pick
    ? pick.map((s) => `<button class="mb-detail" data-sid="${s.id}">
        <span class="mb-detail-main">
          <span class="alt-k">${dfDayLong.format(new Date(s.date))}</span>
          <span class="mb-detail-t">${altLine(s)}</span>
          ${s.location && s.type !== 'casino' ? `<span class="alt-k">${esc(s.location)}</span>` : ''}
        </span>
        <span class="mb-detail-v ${profit(s) < 0 ? 'minus' : 'plus'}">${signed(profit(s))}</span>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>
      </button>`).join('')
    : `<div class="mb-detail mb-detail-empty">Keine Session ${isNow ? 'in diesem Monat' : 'im ' + dfMonthName.format(first)}.</div>`;

  $('#homeAlt').innerHTML = `
    <div class="mb-head">
      <div class="mb-title">
        <div class="mb-nav">
          <button class="mb-arrow" data-mnav="-1" aria-label="Vormonat"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>
          <h2 class="mb-month">${dfMonthName.format(first)}${y !== now.getFullYear() ? ' ' + y : ''}</h2>
          ${isNow ? '' : `<button class="mb-arrow" data-mnav="1" aria-label="Nächster Monat"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></button>`}
        </div>
        <span class="alt-k">${isNow ? 'Bankroll ' + money(bankroll('all')) : 'Bankroll am Monatsende ' + money(rollAt(new Date(y, m + 1, 1)))}</span>
      </div>
      <div class="mb-sum">
        <span class="mb-big ${mp < 0 ? 'minus' : mp > 0 ? 'plus' : ''}">${signed(mp)}</span>
        <span class="alt-k">${plural(list.length, 'Session', 'Sessions')}</span>
      </div>
    </div>
    <div class="notice hidden" id="backupNoteAlt"></div>
    <div class="mb-week" aria-hidden="true"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div>
    <div class="mb-grid">${cells}</div>
    <div class="mb-details">${detail}</div>
    <div class="mb-rolls">${altRolls('mb-roll')}</div>
    ${altStartBtn('mb-start', 'Session erfassen')}`;
  renderBackupHint($('#backupNoteAlt'));
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
      `<button type="button" class="tag ${k === (p.style || 'unknown') ? 'on' : ''}" data-st="${k}">${P_STYLES[k].em} ${esc(styleLabel(k))}</button>`).join('')}</div>

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
  sheetKind = 'player:' + p.id;

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
      `<button type="button" class="tag ${k === 'unknown' ? 'on' : ''}" data-st="${k}">${P_STYLES[k].em} ${esc(styleLabel(k))}</button>`).join('')}</div>
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

/* Zusätzliche Filter über der Bereichsauswahl. Sie greifen alle gleichzeitig,
   lassen sich also frei kombinieren. Bewusst nicht im Datensatz: eine
   vergessene Einstellung, die nach Tagen noch die Zahlen beschneidet, wäre
   irreführender als der kleine Aufwand, sie neu zu setzen. Ein Neuladen
   übersteht sie trotzdem (siehe saveResume) — nur ein frischer Start nicht. */
const RANGES = {
  all:  { label: 'Alles',      days: 0 },
  d30:  { label: '30 Tage',    days: 30 },
  d90:  { label: '90 Tage',    days: 90 },
  d365: { label: '12 Monate',  days: 365 },
  ytd:  { label: 'Dieses Jahr', days: -1 },
  free: { label: 'Zeitraum',   days: -2 },
};
const MINDUR = { 0: 'egal', 60: 'ab 1 h', 120: 'ab 2 h', 180: 'ab 3 h', 300: 'ab 5 h' };
const RESULTS = { all: 'Alle', win: 'Nur Gewinn', loss: 'Nur Verlust' };
/* Montag zuerst, aber gespeichert wird der Wert von Date#getDay() (0=So),
   damit der Vergleich gegen s.date ohne Umrechnung auskommt. */
const WEEKDAYS = [
  { d: 1, label: 'Mo' }, { d: 2, label: 'Di' }, { d: 3, label: 'Mi' }, { d: 4, label: 'Do' },
  { d: 5, label: 'Fr' }, { d: 6, label: 'Sa' }, { d: 0, label: 'So' },
];

const statFilterBlank = () => ({
  range: 'all', from: '', to: '',
  loc: [], stakes: [], tags: [], player: '', minMin: 0,
  result: 'all', weekdays: [], buyinMin: 0, buyinMax: 0,
});
let statF = statFilterBlank();

/** Untere Grenze des gewählten Zeitraums als Zeitstempel — oder null. */
function rangeStart() {
  const r = RANGES[statF.range] || RANGES.all;
  if (r.days > 0) return Date.now() - r.days * 864e5;
  if (statF.range === 'ytd') return new Date(new Date().getFullYear(), 0, 1).getTime();
  if (statF.range === 'free' && statF.from) return new Date(statF.from + 'T00:00').getTime();
  return null;
}
function rangeEnd() {
  // Der Endtag zählt voll mit, deshalb bis 23:59:59.
  if (statF.range === 'free' && statF.to) return new Date(statF.to + 'T23:59:59').getTime();
  return null;
}

/** Bereichsauswahl plus alle gesetzten Filter. */
function statSessions() {
  const von = rangeStart(), bis = rangeEnd();
  return sessionsOf(statKey).filter((s) => {
    const t = new Date(s.date).getTime();
    if (von != null && t < von) return false;
    if (bis != null && t > bis) return false;
    // Ort/Stakes/Tags sind je ein Oder: „Wien oder Graz" statt „Wien und Graz".
    if (statF.loc.length && !statF.loc.includes(s.location || '')) return false;
    if (statF.stakes.length && !statF.stakes.includes(s.stakes || '')) return false;
    if (statF.player && !(s.playerIds || []).includes(statF.player)) return false;
    if (statF.minMin && num(s.durationMin) < statF.minMin) return false;
    if (statF.tags.length && !statF.tags.some((x) => (s.tags || []).includes(x))) return false;
    if (statF.result === 'win' && !(profit(s) > 0)) return false;
    if (statF.result === 'loss' && !(profit(s) < 0)) return false;
    if (statF.weekdays.length && !statF.weekdays.includes(new Date(s.date).getDay())) return false;
    if (statF.buyinMin && invested(s) < statF.buyinMin) return false;
    if (statF.buyinMax && invested(s) > statF.buyinMax) return false;
    return true;
  });
}

const statFilterOn = () => JSON.stringify(statF) !== JSON.stringify(statFilterBlank());

/** Kurzfassung der aktiven Filter für die Leiste über den Zahlen. */
function statFilterText(n, gesamt) {
  if (!statFilterOn()) return `alle ${plural(gesamt, 'Session', 'Sessions')}`;
  const bits = [];
  if (statF.range === 'free') {
    const d = (v) => (v ? dfShort.format(new Date(v + 'T12:00')) : '…');
    if (statF.from || statF.to) bits.push(`${d(statF.from)} – ${d(statF.to)}`);
  } else if (statF.range !== 'all') bits.push(RANGES[statF.range].label);
  if (statF.loc.length) bits.push(statF.loc.join(' / '));
  if (statF.stakes.length) bits.push(statF.stakes.join(' / '));
  if (statF.tags.length) bits.push(statF.tags.join(' / '));
  if (statF.player) { const p = playerById(statF.player); if (p) bits.push('mit ' + p.name); }
  if (statF.minMin) bits.push(MINDUR[statF.minMin]);
  if (statF.result !== 'all') bits.push(RESULTS[statF.result]);
  if (statF.weekdays.length) {
    bits.push(WEEKDAYS.filter((w) => statF.weekdays.includes(w.d)).map((w) => w.label).join('/'));
  }
  if (statF.buyinMin || statF.buyinMax) {
    bits.push(`Buy-in ${statF.buyinMin || 0}–${statF.buyinMax || '∞'}`);
  }
  // „Zeitraum" ohne Von und Bis schränkt nichts ein — dann bleibt die Liste leer.
  if (!bits.length) return `alle ${plural(gesamt, 'Session', 'Sessions')}`;
  return `${n} von ${gesamt} Sessions · ${bits.join(' · ')}`;
}

function openStatFilter() {
  const alleTags = [...new Set(db.sessions.flatMap((s) => s.tags || []))].sort((a, b) => a.localeCompare(b, 'de'));
  const orte = [...new Set(sessionsOf(statKey).map((s) => s.location).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de'));
  const stk = [...new Set(db.sessions.filter((s) => s.type === 'cash').map((s) => s.stakes).filter(Boolean))]
    .sort((a, b) => bbFromStakes(a) - bbFromStakes(b));
  const gegner = [...db.players].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const opt = (v, l, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`;

  openSheet('Filter', `
    <div class="sec-title">Zeitraum</div>
    <div class="tagbox" id="sfRange" style="margin-bottom:12px">${Object.keys(RANGES).map((k) =>
      `<button type="button" class="tag ${statF.range === k ? 'on' : ''}" data-r="${k}">${esc(RANGES[k].label)}</button>`).join('')}</div>
    <div class="form-grid two ${statF.range === 'free' ? '' : 'hidden'}" id="sfFree" style="margin-bottom:16px">
      <label>Von<input type="date" id="sfFrom" value="${esc(statF.from)}"></label>
      <label>Bis<input type="date" id="sfTo" value="${esc(statF.to)}"></label>
    </div>

    <div class="sec-title">Ergebnis</div>
    <div class="tagbox" id="sfResult" style="margin-bottom:16px">${Object.keys(RESULTS).map((k) =>
      `<button type="button" class="tag ${statF.result === k ? 'on' : ''}" data-res="${k}">${esc(RESULTS[k])}</button>`).join('')}</div>

    <div class="sec-title">Wochentag <span class="muted">(einer davon reicht)</span></div>
    <div class="tagbox" id="sfWeekday" style="margin-bottom:16px">${WEEKDAYS.map((w) =>
      `<button type="button" class="tag ${statF.weekdays.includes(w.d) ? 'on' : ''}" data-d="${w.d}">${esc(w.label)}</button>`).join('')}</div>

    <div class="sec-title">Buy-in-Bereich</div>
    <div class="form-grid two" style="margin-bottom:16px">
      <label>Von<input type="number" inputmode="decimal" id="sfBuyinMin" placeholder="0" value="${statF.buyinMin || ''}"></label>
      <label>Bis<input type="number" inputmode="decimal" id="sfBuyinMax" placeholder="∞" value="${statF.buyinMax || ''}"></label>
    </div>

    ${orte.length ? `<div class="sec-title">Ort <span class="muted">(einer davon reicht)</span></div>
    <div class="tagbox" id="sfLoc" style="margin-bottom:16px">${orte.map((o) =>
      `<button type="button" class="tag ${statF.loc.includes(o) ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}

    ${stk.length ? `<div class="sec-title">Stakes <span class="muted">(einer davon reicht)</span></div>
    <div class="tagbox" id="sfStakes" style="margin-bottom:16px">${stk.map((o) =>
      `<button type="button" class="tag ${statF.stakes.includes(o) ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}

    <div class="form-grid" style="margin-bottom:16px">
      ${gegner.length ? `<label>Gegner am Tisch<select id="sfPlayer">${opt('', '— egal —', statF.player)}${gegner.map((p) => opt(p.id, p.name, statF.player)).join('')}</select></label>` : ''}
      <label>Mindestdauer<select id="sfMin">${Object.keys(MINDUR).map((m) =>
        `<option value="${m}"${+m === statF.minMin ? ' selected' : ''}>${esc(MINDUR[m])}</option>`).join('')}</select></label>
    </div>

    ${alleTags.length ? `<div class="sec-title">Tags <span class="muted">(eines davon reicht)</span></div>
    <div class="tagbox" id="sfTags" style="margin-bottom:16px">${alleTags.map((t) =>
      `<button type="button" class="tag ${statF.tags.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}

    <button class="btn btn-block" id="sfReset">Alle Filter zurücksetzen</button>
  `, () => {
    const g = (id) => { const el = $(id); return el ? el.value : ''; };
    statF.from = g('#sfFrom'); statF.to = g('#sfTo');
    statF.player = g('#sfPlayer'); statF.minMin = num(g('#sfMin'));
    statF.buyinMin = num(g('#sfBuyinMin')); statF.buyinMax = num(g('#sfBuyinMax'));
    statF.tags = $$('#sfTags .tag.on').map((b) => b.dataset.tag);
    statF.loc = $$('#sfLoc .tag.on').map((b) => b.dataset.v);
    statF.stakes = $$('#sfStakes .tag.on').map((b) => b.dataset.v);
    statF.weekdays = $$('#sfWeekday .tag.on').map((b) => num(b.dataset.d));
    closeSheet(); renderStats();
  }, 'Anwenden');

  $('#sfRange').onclick = (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    statF.range = b.dataset.r;
    $$('#sfRange .tag').forEach((x) => x.classList.toggle('on', x === b));
    $('#sfFree').classList.toggle('hidden', statF.range !== 'free');
  };
  $('#sfResult').onclick = (e) => {
    const b = e.target.closest('[data-res]'); if (!b) return;
    statF.result = b.dataset.res;
    $$('#sfResult .tag').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#sfWeekday').onclick = (e) => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    b.classList.toggle('on');
  };
  // Toggle-Tagboxen: mehrere gleichzeitig an, genau wie bei Tags.
  ['#sfLoc', '#sfStakes', '#sfTags'].forEach((sel) => {
    const box = $(sel);
    if (box) box.onclick = (e) => {
      const b = e.target.closest('.tag'); if (!b) return;
      b.classList.toggle('on');
    };
  });
  $('#sfReset').onclick = () => { statF = statFilterBlank(); closeSheet(); renderStats(); toast('Filter zurückgesetzt'); };
}

function statCard(k, v, n, klass) {
  return `<div class="stat"><div class="stat-k">${k}</div>
    <div class="stat-v ${klass || ''}">${v}</div>${n ? `<div class="stat-n">${n}</div>` : ''}</div>`;
}

function renderStats() {
  const alle = sessionsOf(statKey);
  const list = statSessions();
  const body = $('#statBody');

  $('#statFilterInfo').textContent = statFilterText(list.length, alle.length);
  $('#statFilterClear').classList.toggle('hidden', !statFilterOn());

  if (!list.length) {
    body.innerHTML = statFilterOn()
      ? '<div class="empty">Keine Session passt zu diesen Filtern.</div>'
      : '<div class="empty">Noch keine Daten für diese Auswahl.</div>';
    return;
  }

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
    + breakdown('Nach Tag', list, null, true)
    + breakdown('Nach Wochentag', list, (s) => WOCHENTAGE[new Date(s.date).getDay()], false, 'fest')
    + breakdown('Nach Monat', list, (s) => dfMonth.format(new Date(s.date)), false, 'zeit')
    + breakdown('Nach Tageszeit', list, (s) => tageszeit(new Date(s.date).getHours()), false, 'fest')
    + breakdownPlayers(list);
}

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const dfMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

function tageszeit(h) {
  if (h < 6) return 'Nachts (0–6 Uhr)';
  if (h < 12) return 'Vormittags (6–12 Uhr)';
  if (h < 18) return 'Nachmittags (12–18 Uhr)';
  return 'Abends (18–24 Uhr)';
}

/** `sort`: 'gewinn' (Vorgabe) sortiert nach Ergebnis, 'fest' hält die
    natürliche Reihenfolge der Schlüssel, 'zeit' sortiert chronologisch. */
function breakdown(title, list, keyFn, byTag, sort) {
  const map = new Map();
  const add = (k, s) => {
    if (!map.has(k)) map.set(k, { n: 0, p: 0, h: 0, t: new Date(s.date).getTime() });
    const e = map.get(k); e.n++; e.p += profit(s); e.h += hours(s);
    e.t = Math.min(e.t, new Date(s.date).getTime());
  };
  for (const s of list) {
    if (byTag) (s.tags || []).forEach((t) => add(t, s));
    else add(keyFn(s), s);
  }
  if (!map.size) return '';
  const entries = [...map.entries()];
  if (sort === 'zeit') entries.sort((a, b) => b[1].t - a[1].t);
  else if (sort !== 'fest') entries.sort((a, b) => b[1].p - a[1].p);
  const rows = entries.map(([k, e]) =>
    `<div class="bd-row"><span>${esc(k)}</span>
      <span class="c">${e.n}× · ${nfa.format(e.h)} h</span>
      <span class="v ${cls(e.p)}">${signed(e.p)}</span></div>`).join('');
  return `<div class="card" style="margin-top:14px">
    <div class="card-head"><h2>${title}</h2></div><div class="bd">${rows}</div></div>`;
}

/** Wie Du abschneidest, wenn ein bestimmter Gegner am Tisch sitzt. Eine
    Session zählt bei jedem ihrer Gegner mit — die Summen sind deshalb
    absichtlich nicht additiv. */
function breakdownPlayers(list) {
  const map = new Map();
  for (const s of list) {
    for (const pid of s.playerIds || []) {
      const p = playerById(pid); if (!p) continue;
      if (!map.has(pid)) map.set(pid, { name: p.name, em: styleOf(p).em, n: 0, p: 0, h: 0 });
      const e = map.get(pid); e.n++; e.p += profit(s); e.h += hours(s);
    }
  }
  if (!map.size) return '';
  const rows = [...map.values()].sort((a, b) => b.p - a.p).map((e) =>
    `<div class="bd-row"><span>${e.em} ${esc(e.name)}</span>
      <span class="c">${e.n}× · ${nfa.format(e.h)} h</span>
      <span class="v ${cls(e.p)}">${signed(e.p)}</span></div>`).join('');
  return `<div class="card" style="margin-top:14px">
    <div class="card-head"><h2>Mit welchem Gegner</h2></div><div class="bd">${rows}</div>
    <div class="hint" style="margin:10px 2px 0">Dein Ergebnis in den Sessions, in denen
      er am Tisch saß. Sessions mit mehreren Gegnern zählen bei jedem mit.</div></div>`;
}

/* ── Sheet-System ───────────────────────────────────────────── */
let sheetSaveFn = null;
/* Was gerade offen ist, damit ein Neuladen es wieder aufmachen kann —
   'wiz', 'live', 'settings', 'player:<id>', 'bankroll:<art>' oder null
   (siehe restoreSheet). Die Öffner setzen es direkt nach openSheet. */
let sheetKind = null;

/** Formulare füllen den ganzen Bildschirm — ein Tipp daneben oder ein
    verrutschter Wisch soll nicht die halbe Eingabe wegwerfen. Nur kurze
    Rückfragen (`compact`) bleiben ein Sheet von unten; sie lassen außerdem
    `sheetKind` stehen, weil sie über dem eigentlichen Formular liegen. */
function openSheet(title, html, saveFn, saveLabel, compact) {
  armBack();                              // Zurück soll das Sheet schließen, nicht die App
  if (!compact) sheetKind = null;
  $('#sheet').classList.toggle('full', !compact);
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
  sheetKind = null;
  $('#sheet').classList.add('hidden');
  $('#scrim').classList.add('hidden');
  resetSheetDrag();                       // Reste einer Wischgeste abräumen
  sheetSaveFn = null;
}

/* ── Runterwischen schließt das Sheet ───────────────────────────
   Bis jetzt ging das Sheet nur über „Abbrechen“ oder einen Tipp auf den
   abgedunkelten Rand zu — auf dem Handy erwartet man stattdessen, es nach
   unten wegzuschieben. Das Sheet folgt dabei dem Finger; weit genug unten
   losgelassen rutscht es vollends raus, sonst federt es zurück.

   Der Griff und die Kopfzeile ziehen immer, der Inhalt nur, solange er
   ganz oben steht — sonst ließe sich die Liste darin nicht mehr scrollen.
   Eingabefelder bleiben außen vor, damit das Markieren von Text im
   Textfeld nicht als Wischen durchgeht. */
function resetSheetDrag() {
  const sheet = $('#sheet');
  sheet.style.transition = '';
  sheet.style.transform = '';
  $('#scrim').style.opacity = '';
}

function wireSheetSwipe() {
  const sheet = $('#sheet'), body = $('#sheetBody'), scrim = $('#scrim');
  const CLOSE_PX = 105;        // so weit unten losgelassen: zu
  const FLICK_PX = 45;         // darunter zählt kein Schnipp — sonst schließt
  const FLICK_VEL = 0.55;      // schon ein hastiges Antippen das Sheet
  let y0 = 0, dy = 0, lastY = 0, lastT = 0, vel = 0, armed = false, active = false, swallow = false;

  sheet.addEventListener('touchstart', (e) => {
    armed = active = false;
    if (e.touches.length !== 1 || sheet.classList.contains('hidden')) return;
    if (sheet.classList.contains('full')) return;   // Vollbild: nur über Abbrechen/Zurück
    if (e.target.closest('input,select,textarea')) return;
    if (body.contains(e.target) && body.scrollTop > 0) return;
    y0 = lastY = e.touches[0].clientY;
    lastT = Date.now(); dy = 0; vel = 0; armed = true;
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!armed) return;
    const y = e.touches[0].clientY;
    dy = y - y0;
    // Tempo aus dem letzten Stück, nicht über die ganze Geste: wer erst
    // zögert und dann schnipst, soll trotzdem ein Schnipsen machen — und
    // wer weit zieht und kurz vorm Loslassen zurückrudert, keines.
    const dt = Date.now() - lastT;
    if (dt > 0) { vel = (y - lastY) / dt; lastY = y; lastT = Date.now(); }
    if (!active) {
      if (dy < 8) { if (dy < -8) armed = false; return; }   // nach oben: normal scrollen
      active = true;
      sheet.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / 420));
  }, { passive: false });

  const release = () => {
    if (!armed) return;
    const weg = active && (dy > CLOSE_PX || (dy > FLICK_PX && vel > FLICK_VEL));
    // Nach einer Wischgeste unterdrücken wir den Klick, den das Loslassen
    // sonst noch auf dem Element unter dem Finger auslöst.
    if (active) { swallow = true; setTimeout(() => { swallow = false; }, 400); }
    armed = active = false;
    if (weg) {
      sheet.style.transition = 'transform .2s ease-in';
      scrim.style.transition = 'opacity .2s ease-in';
      sheet.style.transform = 'translateY(110%)';
      scrim.style.opacity = '0';
      setTimeout(() => { scrim.style.transition = ''; closeSheet(); }, 190);
      return;
    }
    sheet.style.transition = `transform var(--mid) var(--ease)`;
    scrim.style.transition = 'opacity var(--mid)';
    sheet.style.transform = '';
    scrim.style.opacity = '';
    setTimeout(() => { scrim.style.transition = ''; resetSheetDrag(); }, 230);
  };
  sheet.addEventListener('touchend', release);
  sheet.addEventListener('touchcancel', release);

  document.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.stopPropagation(); e.preventDefault();
  }, true);
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
  `, null, null, true);
  const zurueck = () => (back ? back() : closeSheet());
  $('#dlgOk').onclick = onOk;
  $('#dlgNo').onclick = zurueck;
  $('#sheetCancel').onclick = zurueck;
}

function infoSheet(title, text, back) {
  openSheet(title, `
    <p class="dlg-t">${esc(text)}</p>
    <button class="btn btn-primary btn-block" id="dlgOk">Verstanden</button>
  `, null, null, true);
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
  `, () => onOk($('#dlg_in').value), opts.okLabel || 'Übernehmen', true);
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

/* ── Auswahlfelder mit freier Eingabe ───────────────────────────
   Ein <select> mit den bekannten Werten plus dem Eintrag „＋ …", der ein
   Textfeld darunter aufklappt. So ist die Auswahl auf dem Handy zwei Tipper
   weit weg, ohne dass etwas Neues unmöglich wird.
   Gelesen wird beides zusammen über readPick(id). */

/** Bisher benutzte Orte eines Bereichs: aus den Sessions und aus der von Hand
    gepflegten Liste. Getrennt je Bereich — siehe db.locations. */
function knownLocations(type) {
  const fromSessions = db.sessions.filter((s) => s.type === type).map((s) => s.location);
  return [...new Set([...(db.locations[type] || []), ...fromSessions].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de'));
}

/** Bekannte Stakes: die gängigen Vorgaben, die selbst ergänzten und alles,
    was schon in einer Cash-Session steht. Sortiert nach Big Blind. */
function knownStakes() {
  const fromSessions = db.sessions.filter((s) => s.type === 'cash').map((s) => s.stakes);
  return [...new Set([...STAKES_PRESETS, ...db.stakesList, ...fromSessions].filter(Boolean))]
    .sort((a, b) => bbFromStakes(a) - bbFromStakes(b));
}

/** `id` ist die Basis: das <select> heißt `<id>_sel`, das Textfeld `<id>`.
    Ein Wert, der nicht in der Liste steht (alter Freitext), wird vorne
    ergänzt, damit er beim Bearbeiten nicht stillschweigend verschwindet. */
function pickField(id, label, options, value, newLabel, emptyLabel) {
  const known = [...options];
  if (value && !known.includes(value)) known.unshift(value);
  return `<label>${label}
      <select id="${id}_sel">
        <option value="">${esc(emptyLabel || '— keine Angabe —')}</option>
        ${known.map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        <option value="__new">＋ ${esc(newLabel)}</option>
      </select>
    </label>
    <input id="${id}" class="pick-new hidden" placeholder="${esc(newLabel)}" autocomplete="off" value="">`;
}

/** Klappt das Textfeld auf, sobald „＋ …" gewählt ist. */
function wirePick(id) {
  const sel = $('#' + id + '_sel'), inp = $('#' + id);
  if (!sel || !inp) return;
  sel.onchange = () => {
    const neu = sel.value === '__new';
    inp.classList.toggle('hidden', !neu);
    if (neu) inp.focus();
  };
}

function readPick(id) {
  const sel = $('#' + id + '_sel'), inp = $('#' + id);
  if (!sel) return inp ? inp.value.trim() : '';
  return sel.value === '__new' ? (inp ? inp.value.trim() : '') : sel.value;
}

/* ── Chip-Auswahl ───────────────────────────────────────────────
   Dieselbe Sache wie pickField, aber als Knopfleiste statt Klappliste:
   im Assistenten steht pro Seite nur eine Frage, und ein Tipp auf den
   richtigen Chip soll direkt weiterblättern — eine Klappliste bräuchte
   dafür zwei Tipps plus einen dritten auf „Weiter". Gelesen wird über
   readChip(id); der letzte Chip klappt ein Textfeld für einen eigenen
   Wert auf. */
function chipPick(id, options, value, newLabel) {
  const known = [...options];
  if (value && !known.includes(value)) known.unshift(value);
  return `<div class="chippick" id="${id}_box">
      ${known.map((o) => `<button type="button" data-val="${esc(o)}"${o === value ? ' class="on"' : ''}>${esc(o)}</button>`).join('')}
      <button type="button" class="chip-add" data-val="__new">＋ ${esc(newLabel)}</button>
    </div>
    <input id="${id}" class="pick-new hidden" placeholder="${esc(newLabel)}" autocomplete="off" value="">`;
}

/** `onPick` wird aufgerufen, sobald ein fertiger Chip gewählt ist — im
    Assistenten blättert das eine Seite weiter. Beim eigenen Wert erst,
    wenn er mit Enter bestätigt wird. */
function wireChip(id, onPick) {
  const box = $('#' + id + '_box'), inp = $('#' + id);
  if (!box || !inp) return;
  box.onclick = (e) => {
    const b = e.target.closest('[data-val]'); if (!b) return;
    const neu = b.dataset.val === '__new';
    $$('button', box).forEach((x) => x.classList.toggle('on', x === b));
    inp.classList.toggle('hidden', !neu);
    if (neu) { inp.focus(); return; }
    inp.value = '';
    if (onPick) onPick();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); onPick && onPick(); } };
}

function readChip(id) {
  const box = $('#' + id + '_box'); if (!box) return '';
  const on = $('button.on', box); if (!on) return '';
  if (on.dataset.val !== '__new') return on.dataset.val;
  const inp = $('#' + id);
  return inp ? inp.value.trim() : '';
}

/** Einen frisch eingetippten Ort in die Liste des Bereichs übernehmen, damit
    er beim nächsten Mal in der Auswahl steht — auch wenn die Session selbst
    später wieder gelöscht wird. */
function rememberLocation(type, loc) {
  if (!loc || !TYPE_KEYS.includes(type)) return;
  if (!db.locations[type].includes(loc)) db.locations[type].push(loc);
}
function rememberStakes(st) {
  if (!st) return;
  if (!STAKES_PRESETS.includes(st) && !db.stakesList.includes(st)) db.stakesList.push(st);
}

/* ── Neue / bestehende Session ──────────────────────────────── */
function fieldsFor(type, s) {
  s = s || {};
  const v = (k, d) => (s[k] != null && s[k] !== '' ? esc(s[k]) : (d == null ? '' : d));
  if (type === 'cash') return `
    ${pickField('f_stakes', 'Stakes', knownStakes(),
      s.stakes != null ? s.stakes : db.defaults.stakes, 'Andere Stakes')}
    <div class="form-grid two" style="margin-top:12px">
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

/** Das Ort-Feld hängt am Bereich — wird beim Umschalten der Spielart neu
    gezeichnet, damit im Turnier nicht die Cash-Orte stehen. */
function locationField(type, s) {
  s = s || {};
  const val = s.location != null ? s.location : (db.defaults.location[type] || '');
  return pickField('f_location', 'Ort', knownLocations(type), val, 'Neuer Ort');
}

/* ── Foto-Anhang ────────────────────────────────────────────────
   Data-URL direkt am Session-Objekt, deshalb vor dem Speichern zwingend
   komprimiert (siehe compressPhoto) — sonst landet ein Handyfoto mit
   mehreren MB direkt in db, das komplett synchron in localStorage
   geschrieben wird (save(), s.o.), und in jedem Backup. */
let wizPhoto = null;

function photoField(dataUrl) {
  return `
    <div class="sec-title">Foto <span class="muted">(optional)</span></div>
    <div class="photofield" id="f_photo">
      <div class="photofield-prev${dataUrl ? '' : ' hidden'}" id="f_photoPrev">
        ${dataUrl ? `<img src="${dataUrl}" alt="">` : ''}
        <button type="button" class="link" id="f_photoRemove">Entfernen</button>
      </div>
      <button type="button" class="btn btn-block${dataUrl ? ' hidden' : ''}" id="f_photoPick">Foto hinzufügen</button>
      <input type="file" id="f_photoInput" accept="image/*" capture="environment" class="hidden">
    </div>`;
}

/** Bild auf max. 1000px lange Kante skalieren und als JPEG (Qualität 0.7)
    in eine Data-URL packen — bringt ein Handyfoto von mehreren MB auf
    üblicherweise 50–150 KB. */
function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1000;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Setzt `wizPhoto` auf den Startwert und verdrahtet Auswahl/Entfernen.
    `wizPhoto` ist der Stand, den `readDetailFields()` beim Speichern
    zurückliest — unabhängig davon, ob der Nutzer das Foto überhaupt
    angefasst hat. */
function wirePhotoField(existingUrl) {
  wizPhoto = existingUrl || null;
  const wrap = $('#f_photo'); if (!wrap) return;
  const prev = $('#f_photoPrev'), pick = $('#f_photoPick'), input = $('#f_photoInput');
  const showPhoto = () => {
    prev.innerHTML = `<img src="${wizPhoto}" alt=""><button type="button" class="link" id="f_photoRemove">Entfernen</button>`;
    prev.classList.remove('hidden');
    pick.classList.add('hidden');
    $('#f_photoRemove').onclick = clearPhoto;
  };
  const clearPhoto = () => {
    wizPhoto = null;
    prev.classList.add('hidden');
    prev.innerHTML = '';
    pick.classList.remove('hidden');
  };
  pick.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    try { wizPhoto = await compressPhoto(file); showPhoto(); }
    catch (e) { toast('Foto konnte nicht gelesen werden'); }
    input.value = '';
  };
  const rm = $('#f_photoRemove');
  if (rm) rm.onclick = clearPhoto;
}

/** Liest Datum, Ort, Dauer und die typspezifischen Kernfelder (Buy-in,
    Cash-out, Platzierung, …) — der Teil, der im Wizard auf dem
    Eckdaten-Schritt steht. */
function readCoreFields(type, base) {
  const g = (id) => { const el = $('#' + id); return el ? el.value : ''; };
  const s = Object.assign({}, base || {});
  s.type = type;
  s.date = new Date(g('f_date') || Date.now()).toISOString();
  s.location = readPick('f_location');
  rememberLocation(type, s.location);
  // Bei der laufenden Session gibt es keine Dauer-Felder — dann bleibt der
  // Wert aus `base` stehen, die Uhr ist die Quelle.
  if ($('#f_h') || $('#f_m')) s.durationMin = num(g('f_h')) * 60 + num(g('f_m'));

  if (type === 'cash') {
    s.stakes = readPick('f_stakes');
    rememberStakes(s.stakes);
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

/** Liest Gegner, Tags, Notizen und Foto — der Teil, der im Wizard auf dem
    Details-Schritt steht. Felder, die nicht im DOM stehen, bleiben
    unangetastet (wichtig, damit ein Zwischenaufruf nichts aus `base` löscht). */
function readDetailFields(base) {
  const g = (id) => { const el = $('#' + id); return el ? el.value : ''; };
  const s = Object.assign({}, base || {});
  if ($('#f_notes')) s.notes = g('f_notes').trim();
  if ($('#f_tags')) s.tags = $$('#f_tags .tag.on').map((b) => b.dataset.tag);
  if ($('#f_opp')) s.playerIds = $$('#f_opp .tag.on').map((b) => b.dataset.pid);
  if ($('#f_photo')) s.photo = wizPhoto;
  return s;
}

/** "1/2" oder "0,5/1" → Big Blind als Zahl. */
function bbFromStakes(str) {
  if (!str) return 0;
  const parts = String(str).replace(/[€$\s]/g, '').split(/[\/\-]/).map(num).filter((n) => n > 0);
  return parts.length ? Math.max(...parts) : 0;
}

/* ── Session-Wizard ─────────────────────────────────────────────
   Zwei Abläufe teilen sich `wiz`:

   • `mode:'new'` — der Klick-für-Klick-Assistent (siehe WIZ_PAGES weiter
     unten): eine Frage pro Seite, am Ende eine Zusammenfassung zum
     Bestätigen oder Nachbessern. Gesteuert über `wiz.idx` in der Liste
     aus `wizSteps()`.
   • 'edit' / 'finish' / 'live' — das kompakte Zwei-Schritt-Formular
     (Eckdaten → Details). Beim Bearbeiten will man alles auf einen Blick
     und nicht durch acht Seiten blättern; beim Abschließen einer
     laufenden Session fehlt meist nur noch der Cash-out.

   `wiz.data` sammelt die Felder über die Schritte hinweg ein —
   `readCoreFields()`/`readDetailFields()` (s.o.) lesen dabei jeweils nur,
   was auf dem aktuellen Schritt im DOM steht, und lassen den Rest von
   `wiz.data` unangetastet, auch beim Zurückblättern. */
let wiz = { mode: 'new', type: 'cash', data: {}, step: 1, live: false, idx: 0, ret: false };

const wizTotalSteps = () => 2;

function wizardProgress() {
  const total = wizTotalSteps();
  return `<div class="wiz-steps">${Array.from({ length: total }, (_, i) => i + 1).map((n) =>
    `<span class="wiz-dot${n === wiz.step ? ' on' : ''}${n < wiz.step ? ' done' : ''}"></span>`).join('')}</div>`;
}

function newSession() {
  wiz = { mode: 'new', type: db.defaults.type, data: {}, step: 1, live: false, idx: 0, ret: false };
  wizPhoto = null;
  openWizardStep();
}

function editSession(id) {
  const s = db.sessions.find((x) => x.id === id); if (!s) return;
  wiz = { mode: 'edit', type: s.type, data: Object.assign({}, s), step: 1, live: false, idx: 0, ret: false };
  openWizardStep();
}

function openWizardStep() {
  if (wiz.mode === 'new') return openWizPage();
  if (wiz.step === wizTotalSteps()) return openWizardDetails();
  return openWizardCore();
}

/** Überschrift der Eckdaten/Details-Schritte je Modus. */
const WIZ_TITLE = {
  edit: () => TYPES[wiz.type].label + ' bearbeiten',
  finish: () => 'Session abschließen',
  live: () => 'Details bearbeiten',
};

function openWizardCore() {
  const showDuration = wiz.mode !== 'live';
  const d = wiz.data.date ? new Date(wiz.data.date) : new Date();
  const dm = num(wiz.data.durationMin);
  openSheet(WIZ_TITLE[wiz.mode](), `
    ${wizardProgress()}
    <div class="form-grid">
      <label>${showDuration ? 'Datum &amp; Uhrzeit' : 'Beginn'}<input id="f_date" type="datetime-local" value="${localISO(d)}"></label>
      <div id="locField">${locationField(wiz.type, wiz.data)}</div>
      ${showDuration ? `
      <div class="form-grid two">
        <label>Dauer — Stunden<input id="f_h" type="number" inputmode="numeric" placeholder="0" value="${dm ? Math.floor(dm / 60) : ''}"></label>
        <label>Minuten<input id="f_m" type="number" inputmode="numeric" placeholder="0" value="${dm ? dm % 60 : ''}"></label>
      </div>` : '<div class="hint">Die Dauer kommt von der laufenden Uhr und läuft weiter.</div>'}
      <div class="divider"></div>
      <div id="typeFields">${fieldsFor(wiz.type, wiz.data)}</div>
    </div>
  `, () => {
    wiz.data = readCoreFields(wiz.type, wiz.data);
    wiz.step += 1;
    openWizardStep();
  }, 'Weiter');
  sheetKind = 'wiz';
  wirePick('f_location');
  wirePick('f_stakes');
  if (wiz.mode === 'live') {
    $('#sheetCancel').textContent = 'Abbrechen';
    $('#sheetCancel').onclick = () => openLive();
  } else {
    $('#sheetCancel').textContent = 'Abbrechen';   // Standard: schließt (closeSheet)
  }
  if (wiz.mode === 'finish') {
    const f = $(wiz.type === 'cash' ? '#f_cashout' : '#f_prize');
    if (f) { f.focus(); f.select?.(); }
  }
}

function openWizardDetails() {
  openSheet(WIZ_TITLE[wiz.mode](), `
    ${wizardProgress()}
    <div class="form-grid">
      ${playersHTML(wiz.data.playerIds)}
      <div class="divider"></div>
      ${tagsHTML(wiz.data.tags)}
      <label>Notizen<textarea id="f_notes" placeholder="Wie lief die Session?">${esc(wiz.data.notes || '')}</textarea></label>
      <div class="divider"></div>
      ${photoField(wiz.data.photo)}
      ${wiz.mode === 'edit' ? '<button type="button" class="btn btn-danger btn-block" id="btnDelete">Session löschen</button>' : ''}
    </div>
  `, () => saveWizard(), 'Sichern');
  sheetKind = 'wiz';
  wirePhotoField(wiz.data.photo);
  $('#f_tags').onclick = (e) => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    b.classList.toggle('on');
  };
  wireOpponentPicker();
  const del = $('#btnDelete');
  if (del) del.onclick = () => {
    const existing = wiz.data;
    askSheet('Session löschen',
      `${TYPES[existing.type].label} vom ${fmtDate(existing.date)} über ${signed(profit(existing))} wird entfernt.`,
      'Löschen', () => {
        db.sessions = db.sessions.filter((x) => x.id !== existing.id);
        save(); closeSheet(); render(); toast('Session gelöscht');
      }, () => openWizardDetails(), true);
  };
  $('#sheetCancel').textContent = 'Zurück';
  $('#sheetCancel').onclick = () => {
    wiz.data = readDetailFields(wiz.data);
    wiz.step -= 1;
    openWizardStep();
  };
}

/** Speichert, was der jeweilige Modus daraus macht — bestehende Session
    überschreiben oder die laufende abschließen/aktualisieren. Neue Sessions
    laufen über den Assistenten und `wizFinish()`. */
function saveWizard() {
  const s = readDetailFields(wiz.data);
  s.type = wiz.type;
  if (wiz.mode === 'edit') {
    const existing = db.sessions.find((x) => x.id === s.id); if (!existing) return;
    Object.assign(existing, s); save(); closeSheet(); render();
    toast('Gespeichert');
  } else if (wiz.mode === 'finish') {
    if (!s.id) s.id = uid();
    db.sessions.push(s); db.live = null; save(); closeSheet(); render();
    toast('Session gespeichert');
  } else if (wiz.mode === 'live') {
    const L = db.live; if (!L) return;
    L.startedAt = s.date;
    Object.assign(L.data, s);
    save(); renderLiveBar(); openLive();
    toast('Details aktualisiert');
  }
}

/* ── Assistent für neue Sessions ────────────────────────────────
   Eine Frage pro Seite statt eines Formulars am Stück: erst die Art, dann
   sofort die Entscheidung „live mitlaufen lassen oder nachträglich
   eintragen" — davon hängt ab, welche Fragen überhaupt noch kommen (bei
   einer laufenden Session gibt es weder Cash-out noch Dauer, die liefert
   die Uhr). Zum Schluss stehen alle Antworten auf einer Seite, jede Zeile
   führt zum passenden Schritt zurück.

   Jede Seite in WIZ_PAGES ist ein kleines Bündel aus:
     title()   Überschrift des Sheets
     q()       die Frage
     html()    Inhalt
     wire()    Verdrahtung nach dem Einfügen  (optional)
     read()    schreibt die Antwort nach wiz.data  (optional)
     sum()     Zeilen für die Zusammenfassung: [[Bezeichnung, Wert], …]
     choice    true = ohne „Weiter"-Knopf, der Tipp blättert selbst weiter
     next()    abweichende Beschriftung des Weiter-Knopfs
     onNext()  abweichende Aktion des Weiter-Knopfs
     focus     true = erstes Eingabefeld gleich aktivieren */

/** Die Schrittfolge hängt an Art und Erfassungsart und wird deshalb bei
    jedem Blättern neu bestimmt, nie zwischengespeichert. */
function wizSteps() {
  const t = wiz.type, live = wiz.live && t !== 'casino';
  const out = ['type'];
  if (t !== 'casino') out.push('mode');
  if (t === 'cash') {
    out.push('stakes', 'location', 'seats', 'buyin');
    if (!live) out.push('cashout');
  } else if (t === 'mtt') {
    out.push('location', 'buyin');
    if (!live) out.push('result');
  } else {
    out.push('location', 'game', 'result');
  }
  if (!live) out.push('when');
  out.push('opponents');
  if (!live) out.push('extras');
  out.push('summary');
  return out;
}

const WIZ_PAGES = {
  type: {
    title: () => 'Neue Session',
    q: () => 'Was spielst Du?',
    choice: true,
    html: () => `<div class="typepick wiz-typepick" id="wizPick">${TYPE_KEYS.map((k) =>
      `<button type="button" data-val="${k}"${k === wiz.type ? ' class="on"' : ''}>
         <span class="em">${TYPES[k].em}</span>${TYPES[k].label}</button>`).join('')}</div>`,
    wire: () => wizChoice((v) => {
      // Die Felder unterscheiden sich je Art — beim Umschalten fängt der
      // Assistent deshalb von vorn an, statt halbe Antworten mitzuschleppen.
      if (v !== wiz.type) { wiz.type = v; wiz.data = {}; wizPhoto = null; }
    }),
    sum: () => [['Art', TYPES[wiz.type].label]],
  },

  mode: {
    title: () => TYPES[wiz.type].label,
    q: () => 'Wie möchtest Du sie erfassen?',
    choice: true,
    html: () => `<div class="typepick wiz-typepick" id="wizPick">
      <button type="button" data-val="live"${wiz.live ? ' class="on"' : ''}>
        <span class="em">⏱</span><span class="wiz-opt"><b>Live mitlaufen lassen</b>
        <small>Die Uhr läuft mit, Nachkäufe trägst Du unterwegs ein</small></span></button>
      <button type="button" data-val="past"${wiz.live ? '' : ' class="on"'}>
        <span class="em">✎</span><span class="wiz-opt"><b>Nachträglich eintragen</b>
        <small>Die Session ist vorbei — Ergebnis steht fest</small></span></button>
    </div>`,
    wire: () => wizChoice((v) => { wiz.live = v === 'live'; }),
    sum: () => [['Erfassung', wiz.live ? 'Live · Uhr läuft mit' : 'Nachträglich']],
  },

  stakes: {
    title: () => 'Blinds',
    q: () => 'Welche Blinds?',
    html: () => chipPick('f_stakes', knownStakes(),
      wiz.data.stakes != null ? wiz.data.stakes : db.defaults.stakes, 'Andere Blinds'),
    wire: () => wireChip('f_stakes', wizNext),
    read: () => {
      wiz.data.stakes = readChip('f_stakes');
      rememberStakes(wiz.data.stakes);
      wiz.data.bb = bbFromStakes(wiz.data.stakes);
    },
    sum: () => [['Blinds', wiz.data.stakes]],
  },

  location: {
    title: () => 'Ort',
    q: () => (wiz.live ? 'Wo spielst Du?' : 'Wo hast Du gespielt?'),
    html: () => chipPick('f_location', knownLocations(wiz.type),
      wiz.data.location != null ? wiz.data.location : (db.defaults.location[wiz.type] || ''), 'Neuer Ort'),
    wire: () => wireChip('f_location', wizNext),
    read: () => {
      wiz.data.location = readChip('f_location');
      rememberLocation(wiz.type, wiz.data.location);
    },
    sum: () => [['Ort', wiz.data.location]],
  },

  seats: {
    title: () => 'Tisch',
    q: () => 'Wie viele Spieler sitzen am Tisch?',
    html: () => chipPick('f_players', ['2', '4', '5', '6', '7', '8', '9', '10'],
      wiz.data.players ? String(wiz.data.players) : '', 'Andere Anzahl'),
    wire: () => wireChip('f_players', wizNext),
    read: () => { wiz.data.players = num(readChip('f_players')); },
    sum: () => [['Spieler am Tisch', wiz.data.players || '']],
  },

  buyin: {
    title: () => 'Buy-in',
    q: () => (wiz.type === 'cash'
      ? (wiz.live ? 'Wie viel legst Du auf den Tisch?' : 'Wie viel hast Du insgesamt eingesetzt?')
      : 'Was kostet der Antritt?'),
    focus: true,
    html: () => (wiz.type === 'cash'
      ? `<label>Buy-in gesamt (€)<input id="f_buyin" type="number" inputmode="decimal" step="any"
           placeholder="200" value="${esc(wiz.data.buyin == null ? '' : wiz.data.buyin)}"></label>
         <div class="hint" style="margin-top:8px">Nachkäufe kommen später dazu — ${wiz.live
           ? 'während der Session über „＋ Nachkauf".'
           : 'trag hier alles ein, was Du insgesamt auf den Tisch gelegt hast.'}</div>`
      : `<div class="form-grid two">
           <label>Buy-in (€)<input id="f_buyin" type="number" inputmode="decimal" step="any"
             placeholder="100" value="${esc(wiz.data.buyin == null ? '' : wiz.data.buyin)}"></label>
           <label>Gebühr (€)<input id="f_fee" type="number" inputmode="decimal" step="any"
             placeholder="10" value="${esc(wiz.data.fee == null ? '' : wiz.data.fee)}"></label>
           ${wiz.live ? '' : `<label>Entries<input id="f_entries" type="number" inputmode="numeric"
             placeholder="1" value="${esc(wiz.data.entries == null ? '' : wiz.data.entries)}"></label>`}
         </div>
         <div class="hint" style="margin-top:8px">${wiz.live
           ? 'Re-entries und Add-ons trägst Du während des Turniers nach.'
           : 'Entries = 1 + Re-entries. Buy-in und Gebühr zählen je Entry.'}</div>`),
    read: () => {
      wiz.data.buyin = wizNum('f_buyin');
      if (wiz.type === 'mtt') {
        wiz.data.fee = wizNum('f_fee');
        if ($('#f_entries')) wiz.data.entries = Math.max(1, wizNum('f_entries') || 1);
        else if (!wiz.data.entries) wiz.data.entries = 1;
      }
    },
    sum: () => (wiz.type === 'cash'
      ? [['Buy-in', money(num(wiz.data.buyin))]]
      : [['Buy-in + Gebühr', money(num(wiz.data.buyin) + num(wiz.data.fee))],
         ['Entries', wiz.data.entries || 1]]),
  },

  cashout: {
    title: () => 'Cash-out',
    q: () => 'Mit wie viel bist Du aufgestanden?',
    focus: true,
    html: () => `<label>Cash-out (€)<input id="f_cashout" type="number" inputmode="decimal" step="any"
        placeholder="340" value="${esc(wiz.data.cashout == null ? '' : wiz.data.cashout)}"></label>
      <div class="hint" style="margin-top:8px">Der komplette Betrag, den Du vom Tisch mitgenommen hast.</div>`,
    read: () => { wiz.data.cashout = wizNum('f_cashout'); },
    sum: () => [['Cash-out', money(num(wiz.data.cashout))]],
  },

  game: {
    title: () => 'Spiel',
    q: () => 'Was hast Du gespielt?',
    html: () => chipPick('f_game', knownGames(), wiz.data.game || '', 'Anderes Spiel'),
    wire: () => wireChip('f_game', wizNext),
    read: () => { wiz.data.game = readChip('f_game'); },
    sum: () => [['Spiel', wiz.data.game]],
  },

  result: {
    title: () => 'Ergebnis',
    q: () => (wiz.type === 'mtt' ? 'Wie ist es ausgegangen?' : 'Was ist unterm Strich geblieben?'),
    focus: true,
    html: () => (wiz.type === 'mtt'
      ? `<div class="form-grid two">
           <label>Platzierung<input id="f_place" type="number" inputmode="numeric"
             placeholder="7" value="${esc(wiz.data.place == null ? '' : wiz.data.place)}"></label>
           <label>Feldgröße<input id="f_fieldSize" type="number" inputmode="numeric"
             placeholder="120" value="${esc(wiz.data.fieldSize == null ? '' : wiz.data.fieldSize)}"></label>
         </div>
         <label style="margin-top:12px">Preisgeld (€)<input id="f_prize" type="number" inputmode="decimal" step="any"
           placeholder="0" value="${esc(wiz.data.prize == null ? '' : wiz.data.prize)}"></label>
         <div class="hint" style="margin-top:8px">Ohne Geld ausgeschieden? Preisgeld einfach leer lassen.</div>`
      : `<label>Ergebnis (€)<input id="f_result" type="number" inputmode="decimal" step="any"
           placeholder="−20" value="${esc(wiz.data.result == null ? '' : wiz.data.result)}"></label>
         <div class="hint" style="margin-top:8px">Gewinn positiv, Verlust negativ — z.B. <b>−20</b> für 20 € Verlust.</div>`),
    read: () => {
      if (wiz.type === 'mtt') {
        wiz.data.place = wizNum('f_place');
        wiz.data.fieldSize = wizNum('f_fieldSize');
        wiz.data.prize = wizNum('f_prize');
      } else {
        wiz.data.result = wizNum('f_result');
      }
    },
    sum: () => (wiz.type === 'mtt'
      ? [['Platzierung', wiz.data.place ? wiz.data.place + (wiz.data.fieldSize ? ' von ' + wiz.data.fieldSize : '') : ''],
         ['Preisgeld', money(num(wiz.data.prize))]]
      : [['Ergebnis', signed(num(wiz.data.result))]]),
  },

  when: {
    title: () => 'Wann',
    q: () => 'Wann war das, und wie lange?',
    html: () => {
      const d = wiz.data.date ? new Date(wiz.data.date) : new Date();
      const dm = num(wiz.data.durationMin);
      return `<label>Datum &amp; Uhrzeit<input id="f_date" type="datetime-local" value="${localISO(d)}"></label>
        <div class="form-grid two" style="margin-top:12px">
          <label>Dauer — Stunden<input id="f_h" type="number" inputmode="numeric" placeholder="0"
            value="${dm ? Math.floor(dm / 60) : ''}"></label>
          <label>Minuten<input id="f_m" type="number" inputmode="numeric" placeholder="0"
            value="${dm ? dm % 60 : ''}"></label>
        </div>`;
    },
    read: () => {
      wiz.data.date = new Date($('#f_date').value || Date.now()).toISOString();
      wiz.data.durationMin = wizNum('f_h') * 60 + wizNum('f_m');
    },
    sum: () => [['Wann', wiz.data.date ? fmtDate(wiz.data.date) : ''],
                ['Dauer', wiz.data.durationMin ? fmtDur(wiz.data.durationMin) : '']],
  },

  opponents: {
    title: () => 'Gegner',
    q: () => 'Wer sitzt mit am Tisch?',
    html: () => playersHTML(wiz.data.playerIds) +
      '<div class="hint" style="margin-top:10px">Antippen zum Auswählen — kannst Du später jederzeit ergänzen.</div>',
    wire: () => wireOpponentPicker(),
    read: () => { wiz.data.playerIds = $$('#f_opp .tag.on').map((b) => b.dataset.pid); },
    sum: () => [['Gegner', (wiz.data.playerIds || []).map(playerById).filter(Boolean)
      .map((p) => p.name).join(', ')]],
  },

  extras: {
    title: () => 'Notizen',
    q: () => 'Noch etwas festhalten?',
    html: () => `${tagsHTML(wiz.data.tags)}
      <label style="margin-top:14px">Notizen<textarea id="f_notes"
        placeholder="Wie lief die Session?">${esc(wiz.data.notes || '')}</textarea></label>
      <div class="divider"></div>
      ${photoField(wiz.data.photo)}`,
    wire: () => {
      wirePhotoField(wiz.data.photo);
      $('#f_tags').onclick = (e) => {
        const b = e.target.closest('[data-tag]'); if (!b) return;
        b.classList.toggle('on');
      };
    },
    read: () => { wiz.data = readDetailFields(wiz.data); },
    sum: () => [['Tags', (wiz.data.tags || []).join(', ')],
                ['Notizen', wiz.data.notes],
                ['Foto', wiz.data.photo ? 'angehängt' : '']],
  },

  summary: {
    title: () => 'Überprüfen',
    q: () => (wiz.live ? 'Passt alles? Dann läuft die Uhr los.' : 'Passt alles?'),
    html: () => `<div class="wiz-sum" id="wizSum">${wizSummaryRows().map((r) =>
        `<button type="button" class="wiz-sum-row" data-step="${r.step}">
           <span class="k">${esc(r.label)}</span>
           <span class="v${r.val ? '' : ' unset'}">${esc(r.val || '—')}</span>
           <span class="ed">✎</span></button>`).join('')}</div>
      <div class="hint" style="margin-top:12px">${wiz.live
        ? 'Zeile antippen, um sie zu ändern. Während die Session läuft, kommst Du über „✎ Details bearbeiten" jederzeit wieder dran.'
        : 'Zeile antippen, um sie zu ändern.'}</div>`,
    wire: () => {
      $('#wizSum').onclick = (e) => {
        const b = e.target.closest('[data-step]'); if (!b) return;
        const i = wizSteps().indexOf(b.dataset.step);
        if (i < 0) return;
        wiz.ret = true;
        wiz.idx = i;
        openWizPage();
      };
    },
    next: () => (wiz.live ? '▶︎ Starten' : 'Sichern'),
    onNext: () => wizFinish(),
  },
};

/** Kurzform für „Zahl aus dem Feld, falls es auf dieser Seite steht". */
function wizNum(id) {
  const el = $('#' + id);
  return el ? num(el.value) : 0;
}

/** Bisher bespielte Casino-Spiele als Vorschlag. */
function knownGames() {
  return [...new Set(db.sessions.filter((s) => s.type === 'casino').map((s) => s.game).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de'));
}

/** Verdrahtung der beiden Auswahlseiten (Art, Erfassung): ein Tipp legt den
    Wert fest und blättert weiter. `wiz.ret` fällt dabei weg — beide ändern
    die Schrittfolge, danach läuft der Assistent wieder normal durch. */
function wizChoice(set) {
  $('#wizPick').onclick = (e) => {
    const b = e.target.closest('[data-val]'); if (!b) return;
    set(b.dataset.val);
    wiz.ret = false;
    wiz.idx += 1;
    openWizPage();
  };
}

/** Gegner-Chips samt „Gegner hinzufügen" — identisch im Assistenten und im
    Details-Schritt des kompakten Formulars. */
function wireOpponentPicker() {
  const opp = $('#f_opp');
  if (opp) opp.onclick = (e) => {
    const b = e.target.closest('[data-pid]'); if (!b) return;
    b.classList.toggle('on');
  };
  const addOpp = $('#btnAddOpp'), oppInp = $('#f_newOpp');
  if (!addOpp || !oppInp) return;
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

function wizSummaryRows() {
  const rows = [];
  wizSteps().forEach((k) => {
    const S = WIZ_PAGES[k];
    if (!S.sum) return;
    S.sum().forEach(([label, val]) => rows.push({
      step: k, label, val: val == null ? '' : String(val),
    }));
  });
  return rows;
}

function wizProgress() {
  const steps = wizSteps();
  return `<div class="wiz-steps">${steps.map((_, i) =>
    `<span class="wiz-dot${i === wiz.idx ? ' on' : ''}${i < wiz.idx ? ' done' : ''}"></span>`).join('')}</div>`;
}

function openWizPage() {
  const steps = wizSteps();
  wiz.idx = Math.min(Math.max(0, wiz.idx), steps.length - 1);
  const key = steps[wiz.idx];
  const S = WIZ_PAGES[key];

  openSheet(S.title(), `
    ${wizProgress()}
    <div class="wiz-q">${S.q()}</div>
    ${S.html()}
  `, S.choice ? null : (S.onNext || wizNext), (S.next ? S.next() : 'Weiter'));
  sheetKind = 'wiz';

  // Nur ganz am Anfang bricht es wirklich ab — aus einer von der
  // Zusammenfassung angesprungenen Seite geht es dorthin zurück.
  $('#sheetCancel').textContent = (wiz.idx === 0 && !wiz.ret) ? 'Abbrechen' : 'Zurück';
  $('#sheetCancel').onclick = wizBack;
  if (S.wire) S.wire();

  // Enter im Eingabefeld blättert weiter — sonst müsste man die Tastatur
  // erst wegklappen, um an „Weiter" zu kommen.
  if (!S.choice) {
    $$('#sheetBody input:not([type=file])').forEach((el) => {
      if (el.onkeydown) return;                 // Chip-Feld bringt seins schon mit
      el.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); sheetSaveFn && sheetSaveFn(); } };
    });
    if (S.focus) {
      const first = $('#sheetBody input:not(.hidden):not([type=file])');
      if (first) { first.focus(); first.select && first.select(); }
    }
  }
}

function wizNext() {
  const S = WIZ_PAGES[wizSteps()[wiz.idx]];
  if (S.read) S.read();
  if (wiz.ret) { wiz.ret = false; wiz.idx = wizSteps().indexOf('summary'); }
  else wiz.idx += 1;
  openWizPage();
}

/** „Zurück" — aus einer über die Zusammenfassung angesprungenen Seite
    zurück zur Zusammenfassung, sonst eine Seite nach hinten. Antworten
    werden auch dabei übernommen, damit beim Vorblättern nichts fehlt. */
function wizBack() {
  const S = WIZ_PAGES[wizSteps()[wiz.idx]];
  if (S.read) S.read();
  if (wiz.ret) { wiz.ret = false; wiz.idx = wizSteps().indexOf('summary'); }
  else if (wiz.idx === 0) { closeSheet(); return; }
  else wiz.idx -= 1;
  openWizPage();
}

/** Ende des Assistenten: entweder Uhr an oder direkt in die Liste. */
function wizFinish() {
  const s = Object.assign({ id: uid() }, wiz.data, { type: wiz.type });
  if (wiz.live && wiz.type !== 'casino') { startLive(wiz.type, s); return; }
  if (!s.date) s.date = new Date().toISOString();
  db.sessions.push(s); save(); closeSheet(); render();
  toast('Session gespeichert');
}

/* ── Live-Session ───────────────────────────────────────────── */
function elapsed() {
  if (!db.live) return 0;
  return db.live.elapsedMs + (db.live.running ? Date.now() - db.live.lastStart : 0);
}

/** Uhr an. `data` kommt fertig aus dem Assistenten — die Session beginnt
    jetzt, ein im Assistenten gesetztes Datum spielt deshalb keine Rolle. */
function startLive(type, data) {
  db.live = {
    type, data: Object.assign({}, data),
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
  sheetKind = 'live';

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
  wiz = { mode: 'live', type: L.type, data: Object.assign({}, L.data, { date: L.startedAt }), step: 1 };
  openWizardStep();
}

function endLive() {
  const L = db.live; if (!L) return;
  const d = Object.assign({}, L.data, {
    date: L.startedAt,
    durationMin: Math.round(elapsed() / 60000),
  });
  wiz = { mode: 'finish', type: L.type, data: d, step: 1 };
  openWizardStep();
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
  sheetKind = 'bankroll:' + k;

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
    <div class="sec-title">Design</div>
    <p class="hint" style="margin:8px 0 12px">Klassisch ist das bisherige Design. Die anderen
      ändern Übersicht, Schrift und Farben. Deine Daten bleiben dabei gleich.</p>
    <div class="themes" id="uiPick">
      ${UI_KEYS.map((k) => `
        <button class="theme-card${db.ui === k ? ' on' : ''}" data-ui-pick="${k}">
          <span class="tprev u-${k}">
            <span class="tp-t"></span><span class="tp-s"></span><span class="tp-a"></span>
            <span class="tp-c"></span><span class="tp-b"></span>
          </span>
          <span class="theme-name">
            <span class="n">${esc(UIS[k].label)}</span>
            <span class="d">${esc(UIS[k].note)}</span>
          </span>
        </button>`).join('')}
    </div>
    <div id="themeSec"${db.ui === 'classic' ? '' : ' class="hidden"'}>
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Farbschema</div>
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
    </div>
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Standard für neue Sessions</div>
    <p class="hint" style="margin:8px 0 12px">Womit „Neue Session“ vorbelegt ist. Ändern
      kannst Du es dort natürlich weiterhin bei jeder Session.</p>
    <div class="form-grid" style="margin-bottom:18px">
      <label>Bereich
        <select id="setDefType">${TYPE_KEYS.map((k) =>
          `<option value="${k}"${db.defaults.type === k ? ' selected' : ''}>${TYPES[k].em} ${esc(TYPES[k].label)}</option>`).join('')}</select>
      </label>
      ${pickField('setDefStakes', 'Stakes (Cash Game)', knownStakes(), db.defaults.stakes, 'Andere Stakes')}
      ${TYPE_KEYS.map((k) => pickField('setDefLoc_' + k, 'Ort — ' + TYPES[k].label,
        knownLocations(k), db.defaults.location[k], 'Neuer Ort')).join('')}
    </div>
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Spielertypen</div>
    <p class="hint" style="margin:8px 0 12px">Benenne die Typen so, wie Du sie im Kopf hast.
      Bereits vergebene Einschätzungen bleiben dabei erhalten.</p>
    <div class="form-grid" style="margin-bottom:10px">
      ${P_STYLE_KEYS.map((k) => `<label>${P_STYLES[k].em} <span class="muted">(${esc(P_STYLES[k].label)})</span>
        <input id="setStyle_${k}" value="${esc(styleLabel(k))}" placeholder="${esc(P_STYLES[k].label)}" autocomplete="off"></label>`).join('')}
    </div>
    <button class="btn btn-block" id="btnStyleReset" style="margin-bottom:18px">Namen zurücksetzen</button>
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Bankroll</div>
    <p class="hint" style="margin:8px 0 12px">Anfangsstand je Bereich — der Betrag, den Du
      hattest, bevor Du hier angefangen hast zu tracken.</p>
    <button class="btn btn-block" id="btnStart" style="margin-bottom:18px">Start-Bankroll festlegen</button>
    <p class="hint" style="margin:0 0 12px">Ein-/Auszahlung außerhalb einer Session buchen
      (z.B. Nachschuss oder Entnahme) — je Bereich.</p>
    <div class="btn-row" id="rollSettingsRow" style="margin-bottom:18px">
      ${TYPE_KEYS.map((k) => `<button class="btn" data-roll="${k}">${TYPES[k].em} ${esc(TYPES[k].label)}</button>`).join('')}
    </div>
    <div class="divider" style="margin:18px 0"></div>
    <div class="sec-title">Datensicherung</div>
    <p class="hint" style="margin:8px 0 12px">Deine Daten liegen nur in diesem Browser.
      Lade regelmäßig ein Backup herunter — z.B. in Google Drive. Die Datei enthält
      <b>alles</b>: Sessions, Buchungen, Gegner samt Notizen, Tags, Merkmale, Orte,
      Stakes, Spielertyp-Namen, Standardwerte, Design, Theme und eine laufende Session.
      Nach dem Löschen der Browserdaten bekommst Du damit den vollen Stand zurück.</p>
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

    db.defaults.type = $('#setDefType').value;
    db.defaults.stakes = readPick('setDefStakes');
    rememberStakes(db.defaults.stakes);
    TYPE_KEYS.forEach((k) => {
      const loc = readPick('setDefLoc_' + k);
      db.defaults.location[k] = loc;
      rememberLocation(k, loc);
    });

    // Leeres Feld heißt „wieder den vorgegebenen Namen benutzen" — dann gar
    // nichts speichern, sonst stünde später ein leerer Knopf im Profil.
    db.styleNames = {};
    P_STYLE_KEYS.forEach((k) => {
      const v = $('#setStyle_' + k).value.trim();
      if (v && v !== P_STYLES[k].label) db.styleNames[k] = v;
    });

    save(); closeSheet(); render(); toast('Gespeichert');
  });
  sheetKind = 'settings';

  TYPE_KEYS.forEach((k) => wirePick('setDefLoc_' + k));
  wirePick('setDefStakes');
  $('#btnStyleReset').onclick = () => {
    P_STYLE_KEYS.forEach((k) => { $('#setStyle_' + k).value = P_STYLES[k].label; });
    toast('Namen zurückgesetzt — noch sichern');
  };

  /* Theme sofort anwenden statt erst beim Sichern — der Sinn der Auswahl ist ja,
     das Ergebnis zu sehen. Das Sheet bleibt dabei offen. */
  $('#themePick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-th]'); if (!b) return;
    applyTheme(b.dataset.th); save();
    $$('.theme-card', $('#themePick')).forEach((c) => c.classList.toggle('on', c === b));
  });
  // Design ebenso sofort, die Übersicht hinter dem Sheet zieht gleich mit.
  $('#uiPick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ui-pick]'); if (!b) return;
    applyUi(b.dataset.uiPick); save();
    $$('.theme-card', $('#uiPick')).forEach((c) => c.classList.toggle('on', c === b));
    $('#themeSec').classList.toggle('hidden', db.ui !== 'classic');
    if (view === 'home') $('#viewTitle').textContent = db.ui === 'classic' ? TITLES.home : '';
    render();
  });

  $('#btnStart').onclick = () => openStartBankroll(false);
  $('#rollSettingsRow').onclick = (e) => {
    const b = e.target.closest('[data-roll]'); if (!b) return;
    openBankroll(b.dataset.roll);
  };
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
        // Die gesammelten Orte und Stakes stammen aus genau diesen Sessions —
        // sie stehen zu lassen wäre kein „alles gelöscht". Die Vorbelegung
        // zeigt dann auf etwas, das es nicht mehr gibt, und muss mit weg.
        db.locations = { cash: [], mtt: [], casino: [] };
        db.stakesList = [];
        db.defaults.stakes = '';
        db.defaults.location = { cash: '', mtt: '', casino: '' };
        save(); closeSheet(); render(); toast('Alle Daten gelöscht');
      }, openSettings, true);
  };
}

/** Was alles in einem Datensatz steckt — für die Bestätigung beim Import und
    die Rückmeldung beim Export. */
function contentSummary(d) {
  const notes = (d.players || []).reduce((a, p) => a + (p.notes || []).length, 0);
  const bits = [
    plural((d.sessions || []).length, 'Session', 'Sessions'),
    plural((d.txns || []).length, 'Buchung', 'Buchungen'),
    plural((d.players || []).length, 'Gegner', 'Gegner'),
  ];
  if (notes) bits.push(plural(notes, 'Notiz', 'Notizen'));
  if (d.live) bits.push('eine laufende Session');
  return bits.join(', ');
}

function exportBackup() {
  // Vor dem Serialisieren setzen, damit der Stand auch im Backup selbst steht.
  db.lastBackup = new Date().toISOString();
  db.lastBackupCount = db.sessions.length + db.txns.length;
  db.snoozeBackup = 0;
  save();
  /* Der gesamte Datensatz wandert unverändert in die Datei — Sessions,
     Buchungen, Gegner mit Notizen, Tags, Merkmale, Orte, Stakes,
     Spielertyp-Namen, Standardwerte, Theme und eine laufende Session.
     `meta` steht nur als Kopfzeile davor und wird beim Import wieder
     entfernt (siehe normalize), damit es nicht in die Daten wandert. */
  const payload = Object.assign({
    meta: {
      app: 'Pokertracker',
      appVersion: APP_VERSION,
      format: db.v,
      exported: db.lastBackup,
      contains: contentSummary(db),
    },
  }, db);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pokertracker-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  renderBackupHint();
  toast('Backup mit ' + contentSummary(db));
}

function importBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.sessions)) throw new Error('Die Datei ist kein Pokertracker-Backup.');
      const stand = d.meta && d.meta.exported ? ` vom ${dfLong.format(new Date(d.meta.exported))}` : '';
      askSheet('Backup laden',
        `Das Backup${stand} enthält ${contentSummary(d)} — dazu Tags, Merkmale, Orte, `
        + 'Stakes, Spielertyp-Namen, Standardwerte, Design und Theme. Alles davon wird '
        + `wiederhergestellt. Deine jetzigen Daten (${contentSummary(db)}) werden dabei ersetzt.`,
        'Laden', () => {
          // normalize() ergänzt, was in einem älteren Backup noch fehlt, und
          // wirft die Kopfzeile `meta` weg.
          db = normalize(d);
          applyTheme(db.theme);
          monthView = null; monthPick = null;
          $('#viewTitle').textContent = view === 'home' && db.ui !== 'classic' ? '' : TITLES[view];
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
    notes: '', tags: ['Import'], playerIds: [],
  };
  rememberLocation(type, s.location);   // taucht danach in der Ort-Auswahl auf
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
  armBack();                              // Zurück schließt den Wähler
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

/* ── Zurück-Taste ───────────────────────────────────────────────
   Ohne Zutun beendet ein einziger Druck auf Zurück die installierte App —
   viel zu leicht aus Versehen. Deshalb liegt ein zusätzlicher Verlaufseintrag
   („Wächter") über der App: Zurück landet dann bei uns statt beim System.

   Der Druck schließt der Reihe nach, was offen ist — Kartenwähler, Sheet,
   Unterseite — und baut den Wächter danach wieder auf. Steht nichts mehr offen
   und Du bist auf der Übersicht, kommt ein Hinweis, der nächste Druck beendet die App
   (leaveHint). */
let guardUp = false;

function pushGuard() {
  if (guardUp) return;
  guardUp = true;
  try { history.pushState({ pt: 'guard' }, ''); } catch (e) { guardUp = false; }
}

/** Vor allem, was die Zurück-Taste abfangen soll: Sheet öffnen, Seite wechseln. */
function armBack() {
  pushGuard();
}

/** Zurück auf der Übersicht: Hinweis statt Dialog. Ein „Verlassen"-Knopf
    kann die installierte App nicht schließen: history.back() vom ersten
    Verlaufseintrag aus tut nichts, window.close() blockt der Browser, sobald
    der Verlauf mehr als einen Eintrag hat. Nur die System-Zurückgeste selbst
    beendet die App. Deshalb bleibt der Wächter hier unten, und der nächste
    Zurück-Druck schließt die App. Tippt man stattdessen in die App, steht der
    Wächter wieder (Antippen zählt als Nutzeraktion; ohne sie überspringt
    Chrome den Eintrag beim Zurückgehen). In der Dashboard-Vorschau nichts tun,
    dann verkleinert das Dashboard die App. */
function leaveHint(msg) {
  if (window.__dashboard) return;
  toast(msg || 'Zum Verlassen nochmal zurück wischen');
  document.addEventListener('pointerdown', pushGuard, { once: true });
}

function wireBack() {
  // Nach einem Neuladen steht der Wächter vom letzten Mal noch obenauf —
  // ein zweiter würde Zurück einen Druck verschlucken lassen.
  if (history.state && history.state.pt === 'guard') guardUp = true;
  else pushGuard();
  window.addEventListener('popstate', () => {
    guardUp = false;

    if (!$('#cardPicker').classList.contains('hidden')) { closeCardPicker(); pushGuard(); return; }
    // Über den Abbrechen-Knopf, nicht über closeSheet: verschachtelte Sheets
    // haben dort ihren Rückweg zum vorherigen Sheet hinterlegt.
    if (!$('#sheet').classList.contains('hidden')) { $('#sheetCancel').click(); pushGuard(); return; }
    if (view !== 'home') { nav('home'); pushGuard(); return; }

    leaveHint(db.live
      ? 'Nochmal zurück wischen zum Verlassen. Die laufende Session bleibt gespeichert und läuft beim nächsten Start weiter.'
      : '');
  });
}

/* ── Neuladen übersteht den Stand ───────────────────────────────
   Ohne das landet ein Neuladen (oder das Handy, das die App im Hintergrund
   beendet hat) immer auf der Übersicht, und ein halb ausgefülltes Formular
   ist weg. Beim Verlassen der Seite wandert deshalb nach sessionStorage,
   wo man war: Ansicht, Auswahlen, Scrollstand und das offene Sheet samt
   allem, was darin eingetippt oder angetippt ist.

   sessionStorage statt localStorage mit Absicht: es gilt nur für diesen
   Tab bzw. diesen App-Lauf. Wer die App morgen frisch öffnet, startet wie
   gewohnt auf der Übersicht. */
const RESUME_KEY = 'pt-resume';

/** Kennung einer Chip-Taste — je nach Auswahl steckt sie in einem anderen data-Feld. */
const chipKey = (b) => b.dataset.val ?? b.dataset.tag ?? b.dataset.pid ?? b.dataset.st;

function saveResume() {
  const st = { view, chartKey, filterKey, playerSort, statKey, statF, scroll: window.scrollY, sheet: null };
  if (sheetKind && !$('#sheet').classList.contains('hidden')) {
    const body = $('#sheetBody'), vals = {}, on = {};
    $$('input[id],select[id],textarea[id]', body).forEach((el) => {
      if (el.type !== 'file') vals[el.id] = el.value;
    });
    $$('[id]', body).forEach((box) => {
      const chips = $$(':scope > button', box).filter((b) => chipKey(b) != null);
      if (chips.length) on[box.id] = chips.filter((b) => b.classList.contains('on')).map(chipKey);
    });
    st.sheet = { kind: sheetKind, vals, on, top: body.scrollTop };
    // Das Foto steht nur in wizPhoto, solange seine Seite offen ist.
    if (sheetKind === 'wiz') st.sheet.wiz = Object.assign({}, wiz,
      { data: $('#f_photo') ? Object.assign({}, wiz.data, { photo: wizPhoto }) : wiz.data });
  }
  try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(st)); }
  catch (e) {
    // Zu groß (Foto) — dann eben ohne Bild, der Rest ist wichtiger.
    if (!st.sheet || !st.sheet.wiz) return;
    st.sheet.wiz.data = Object.assign({}, st.sheet.wiz.data, { photo: null });
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(st)); } catch (e2) { /* egal */ }
  }
}

function readResume() {
  try { return JSON.parse(sessionStorage.getItem(RESUME_KEY)); } catch (e) { return null; }
}

/** Auswahlen der Ansichten zurückholen — vor nav(), das gleich damit zeichnet. */
function applyResume(st) {
  if (!st) return;
  const mark = (id, k) => $$('button', $(id)).forEach((b) => b.classList.toggle('on', b.dataset.k === k));
  if (st.chartKey) { chartKey = st.chartKey; mark('#chartSeg', chartKey); }
  if (st.filterKey) { filterKey = st.filterKey; mark('#filterSeg', filterKey); }
  if (st.playerSort) { playerSort = st.playerSort; mark('#playerSeg', playerSort); }
  if (st.statKey) { statKey = st.statKey; mark('#statSeg', statKey); }
  if (st.statF) statF = Object.assign(statFilterBlank(), st.statF);
}

/** Öffnet das Sheet von vorhin wieder und trägt die Eingaben ein.
    false, wenn es nicht mehr passt (Session gelöscht, Uhr gestoppt, …). */
function restoreSheet(sh) {
  if (!sh || !sh.kind) return false;
  const i = sh.kind.indexOf(':');
  const kind = i < 0 ? sh.kind : sh.kind.slice(0, i), id = i < 0 ? '' : sh.kind.slice(i + 1);

  if (kind === 'wiz') {
    const w = sh.wiz;
    if (!w || !w.data) return false;
    if ((w.mode === 'live' || w.mode === 'finish') && !db.live) return false;
    if (w.mode === 'edit' && !db.sessions.some((x) => x.id === w.data.id)) return false;
    wiz = w;
    wizPhoto = w.data.photo || null;
    openWizardStep();
  } else if (kind === 'live') {
    if (!db.live) return false;
    openLive();
  } else if (kind === 'player') {
    if (!playerById(id)) return false;
    openPlayer(id);
  } else if (kind === 'bankroll') {
    if (!TYPES[id]) return false;
    openBankroll(id);
  } else if (kind === 'settings') {
    openSettings();
  } else return false;

  const body = $('#sheetBody');
  Object.entries(sh.on || {}).forEach(([bid, keys]) => {
    const box = body.querySelector('#' + CSS.escape(bid)); if (!box) return;
    $$(':scope > button', box).forEach((b) => {
      const k = chipKey(b);
      if (k != null) b.classList.toggle('on', keys.includes(k));
    });
  });
  Object.entries(sh.vals || {}).forEach(([fid, v]) => {
    const el = body.querySelector('#' + CSS.escape(fid));
    if (el && el.type !== 'file') el.value = v;
  });
  // Eigene Werte („＋ Neuer Ort" …) brauchen ihr aufgeklapptes Textfeld wieder.
  $$('.pick-new', body).forEach((inp) => {
    const sel = $('#' + inp.id + '_sel', body), box = $('#' + inp.id + '_box', body);
    const on = box && $('button.on', box);
    const neu = sel ? sel.value === '__new' : !!(on && on.dataset.val === '__new');
    inp.classList.toggle('hidden', !neu);
  });
  body.scrollTop = sh.top || 0;
  return true;
}

/* ── Verdrahtung ────────────────────────────────────────────── */
function wire() {
  document.body.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]'); if (n) { nav(n.dataset.nav); return; }
    const r = e.target.closest('[data-sid]'); if (r) { editSession(r.dataset.sid); return; }
    const p = e.target.closest('[data-player]'); if (p) { openPlayer(p.dataset.player); return; }
    // Übersicht der Designs Kurve und Monatsblatt
    const ro = e.target.closest('[data-roll-open]'); if (ro) { openBankroll(ro.dataset.rollOpen); return; }
    const mn = e.target.closest('[data-mnav]'); if (mn) { shiftMonth(Number(mn.dataset.mnav)); return; }
    const dy = e.target.closest('[data-day]'); if (dy) { monthPick = dy.dataset.day; renderHome(); return; }
    if (e.target.closest('[data-act="new"]')) { $('#btnNew').click(); return; }
  });
  $('#btnNew').onclick = () => (db.live ? openLive() : newSession());
  $('#btnNewPlayer').onclick = newPlayerSheet;
  $('#btnSettings').onclick = openSettings;
  $('#liveOpen').onclick = openLive;
  $('#sheetCancel').onclick = closeSheet;
  // Wie Abbrechen, nicht closeSheet: eine Rückfrage über einem Formular
  // führt so zum Formular zurück, statt alles zuzuklappen.
  $('#scrim').onclick = () => $('#sheetCancel').click();
  $('#sheetSave').onclick = () => sheetSaveFn && sheetSaveFn();
  wireSheetSwipe();

  const seg = (id, set) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', $(id)).forEach((x) => x.classList.toggle('on', x === b));
    set(b.dataset.k);
  });
  seg('#chartSeg', (k) => { chartKey = k; drawChart(); });
  seg('#filterSeg', (k) => { filterKey = k; renderSessions(); });
  // Ort und Stakes gehören zum Bereich — beim Wechsel würden sie sonst
  // weiterfiltern und die neue Auswahl leer aussehen lassen.
  seg('#statSeg', (k) => { statKey = k; statF.loc = []; statF.stakes = []; renderStats(); });
  $('#statFilterBtn').onclick = openStatFilter;
  $('#statFilterClear').onclick = () => { statF = statFilterBlank(); renderStats(); toast('Filter zurückgesetzt'); };
  seg('#playerSeg', (k) => { playerSort = k; renderPlayers(); });

  wireEV();
}

/* ── Start ──────────────────────────────────────────────────── */
load();
applyTheme(db.theme);
wire();
wireBack();
renderSlots();
const resume = readResume();
applyResume(resume);
nav(resume && TITLES[resume.view] ? resume.view : 'home');
if (resume) window.scrollTo(0, resume.scroll || 0);
if (!(resume && restoreSheet(resume.sheet))) {
  // Nach einem Neuladen mit zugeklapptem Sheet bleibt es zu — auch die
  // laufende Session springt dann nicht von selbst wieder auf.
  if (db.live && !resume) openLive();
  else if (!db.setup && !db.sessions.length && !db.txns.length) openStartBankroll(true);
}
window.addEventListener('pagehide', saveResume);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); });

if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
// Drehen, Tastatur, Fenstergröße: die Spielkarte neu einpassen.
window.addEventListener('resize', fitCard);
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCard);
wireUpdates();
