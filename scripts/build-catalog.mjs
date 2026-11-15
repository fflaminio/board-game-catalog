// Converte data/Giochi_in_scatola_FINALE.xlsx (foglio "Giochi") in public/catalog.json.
// Si esegue con: npm run build  (Cloudflare lo lancia a ogni deploy).
// Se trova errori nei dati interrompe il build e NON pubblica nulla.

import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_FILE = join(ROOT, 'data', 'Giochi_in_scatola_FINALE.xlsx');
const SHEET = 'Giochi';
const COVERS_DIR = join(ROOT, 'public', 'covers');
const OUT_FILE = join(ROOT, 'public', 'catalog.json');

const MACROS = ['Bambini', 'Party', 'Abilità e riflessi', 'Bluff e deduzione', 'Strategia', 'Avventura e fantasy'];
const HIDDEN_CATEGORIES = ['Expansion for Base-game'];
const MISSING_PREFIXES = ['Non reperito', 'Non accreditato', 'Non classificato', '—'];
const YELLOW = 'FFF2CC';

// Campi usati dal sito -> intestazione della colonna Excel
const COL = {
  id: 'ID',
  title: 'Titolo',
  description: 'DESCRIZIONE',
  type: 'Tipo',
  bggId: 'BGG ID',
  bggName: 'Nome su BGG',
  year: 'Anno BGG',
  bggUrl: 'Link BGG',
  players: 'Players',
  bestPlayers: 'Best players',
  playingTime: 'Playing time (min)',
  age: 'Age',
  complexity: 'Complexity (1-5)',
  score: 'Score (voto medio)',
  designer: 'Designer',
  artist: 'Artist',
  publisher: 'Publisher',
  mechanics: 'Mechanic (BGG)',
  categories: 'Category (BGG)',
  rulebookUrl: 'Link regolamento',
  rulebookInfo: 'Regolamento: lingua · tipo · fonte',
  musicUrl: 'Link traccia audio (Melodice)',
  musicStatus: 'Traccia audio: stato',
  macro: 'Macro categoria',
};

// Campi che, se la cella è gialla, vengono segnalati come "stimati"
const ESTIMABLE = ['players', 'bestPlayers', 'playingTime', 'age', 'complexity', 'score', 'mechanics', 'categories'];

const errors = [];
const warnings = [];

// ---------- utilità di lettura ----------

function cellValue(cell) {
  let v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('richText' in v) v = v.richText.map((t) => t.text).join('');
    else if ('result' in v) v = v.result;
    else if ('text' in v) v = v.text;
  }
  return v ?? null;
}

function text(cell) {
  const v = cellValue(cell);
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function urlOf(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && v.hyperlink) return String(v.hyperlink).trim();
  return text(cell);
}

function isMissing(s) {
  return s == null || MISSING_PREFIXES.some((p) => s.startsWith(p));
}

function isYellow(cell) {
  const f = cell.fill;
  if (!f || f.type !== 'pattern' || !f.fgColor || !f.fgColor.argb) return false;
  return f.fgColor.argb.toUpperCase().endsWith(YELLOW);
}

function toNumber(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseRange(s) {
  // "2–7", "2-7" oppure "4" -> { min, max, text }
  const m = s == null ? null : String(s).match(/^(\d+)\s*(?:[–—-]\s*(\d+))?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] ? Number(m[2]) : min;
  return { min, max, text: m[2] ? `${min}–${max}` : String(min) };
}

function parseAge(s) {
  const m = s == null ? null : String(s).match(/^(\d+)\+?$/);
  return m ? { min: Number(m[1]), text: `${Number(m[1])}+` } : null;
}

function splitList(s) {
  if (s == null) return [];
  return s.split(',').map((x) => x.trim()).filter((x) => x && !MISSING_PREFIXES.some((p) => x.startsWith(p)));
}

function creditText(s) {
  const items = splitList(s);
  return items.length ? items.join(', ') : null;
}

function validUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- lettura del file ----------

if (!existsSync(XLSX_FILE)) {
  console.error(`ERRORE: file non trovato: ${XLSX_FILE}`);
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX_FILE);
const ws = wb.getWorksheet(SHEET);
if (!ws) {
  console.error(`ERRORE: foglio "${SHEET}" non trovato nel file Excel.`);
  process.exit(1);
}

const colIndex = {};
const headerRow = ws.getRow(1);
headerRow.eachCell((cell, n) => {
  const h = text(cell);
  if (h) colIndex[h] = n;
});
for (const [key, header] of Object.entries(COL)) {
  if (!colIndex[header]) errors.push(`Colonna mancante o rinominata: "${header}" (campo ${key})`);
}
if (errors.length) fail();

const coverFiles = new Set(existsSync(COVERS_DIR) ? readdirSync(COVERS_DIR) : []);
const usedCovers = new Set();
const seenIds = new Set();
const games = [];

for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const get = (key) => row.getCell(colIndex[COL[key]]);
  if (!text(get('id')) && !text(get('title'))) continue; // riga vuota

  const idNum = toNumber(text(get('id')));
  const title = text(get('title'));
  const label = `Riga ${r} (ID ${idNum ?? '?'}, ${title ?? 'senza titolo'})`;
  const err = (msg) => errors.push(`${label}: ${msg}`);
  const warn = (msg) => warnings.push(`${label}: ${msg}`);

  if (!Number.isInteger(idNum) || idNum < 1) err('ID non valido (serve un intero ≥ 1)');
  else if (seenIds.has(idNum)) err('ID duplicato');
  else seenIds.add(idNum);
  if (!title) err('Titolo mancante');

  const description = text(get('description'));
  if (!description) err('DESCRIZIONE mancante');
  else if (description.split(/\s+/).length > 30) warn('DESCRIZIONE oltre 30 parole');

  const typeRaw = text(get('type'));
  const type = typeRaw === 'Base' ? 'base' : typeRaw === 'Espansione' ? 'expansion' : null;
  if (!type) err(`Tipo non valido: "${typeRaw}" (ammessi: Base, Espansione)`);

  const players = parseRange(text(get('players')));
  if (!players) err(`Players non valido: "${text(get('players'))}"`);
  const playingTime = parseRange(text(get('playingTime')));
  if (!playingTime) err(`Playing time non valido: "${text(get('playingTime'))}"`);
  const age = parseAge(text(get('age')));
  if (!age) err(`Age non valido: "${text(get('age'))}"`);
  const complexity = toNumber(text(get('complexity')));
  if (complexity == null || complexity < 1 || complexity > 5) err(`Complexity non valido: "${text(get('complexity'))}" (1-5)`);
  const score = toNumber(text(get('score')));
  if (score == null || score < 0 || score > 10) err(`Score non valido: "${text(get('score'))}" (0-10)`);
  const bestPlayers = text(get('bestPlayers'));
  if (!bestPlayers) err('Best players mancante');

  const macroCategories = splitList(text(get('macro')));
  if (!macroCategories.length) err('Macro categoria mancante');
  for (const m of macroCategories) if (!MACROS.includes(m)) err(`Macro categoria sconosciuta: "${m}"`);

  const yearRaw = toNumber(text(get('year')));
  const year = yearRaw && yearRaw > 0 ? yearRaw : null;
  const bggIdRaw = toNumber(text(get('bggId')));
  const bggUrlRaw = urlOf(get('bggUrl'));
  const bggUrl = bggUrlRaw && validUrl(bggUrlRaw) ? bggUrlRaw : null;
  if (bggUrlRaw && !bggUrl) err(`Link BGG non valido: "${bggUrlRaw}"`);

  // regolamento
  const rbUrlRaw = urlOf(get('rulebookUrl'));
  const rbUrl = isMissing(rbUrlRaw) ? null : rbUrlRaw;
  if (rbUrl && !validUrl(rbUrl)) err(`Link regolamento non valido: "${rbUrl}"`);
  const rbParts = (text(get('rulebookInfo')) ?? '').split('·').map((x) => x.trim());
  const rbHasInfo = rbUrl && rbParts[0] && rbParts[0] !== '—';
  const rulebook = {
    url: rbUrl,
    language: rbHasInfo ? rbParts[0] : null,
    kind: rbHasInfo ? rbParts[1] || null : null,
    source: rbHasInfo ? rbParts[2] || null : null,
  };

  // Music Board
  const musicUrl = urlOf(get('musicUrl'));
  if (!musicUrl || !validUrl(musicUrl)) err(`Link Music Board mancante o non valido: "${musicUrl}"`);
  const music = { url: musicUrl, status: text(get('musicStatus')) };

  // copertina
  const coverName = `${String(idNum).padStart(3, '0')}.webp`;
  if (Number.isInteger(idNum)) {
    if (coverFiles.has(coverName)) usedCovers.add(coverName);
    else err(`Copertina mancante: public/covers/${coverName}`);
  }

  // celle gialle = valori stimati
  const estimated = [];
  for (const key of ESTIMABLE) if (isYellow(get(key))) estimated.push(key);
  if (isYellow(get('rulebookUrl')) && rbUrl) estimated.push('rulebook');

  games.push({
    id: idNum,
    title,
    description,
    type,
    year,
    bgg: { id: bggIdRaw, name: text(get('bggName')), url: bggUrl },
    players,
    bestPlayers,
    playingTime,
    age,
    complexity,
    score,
    designer: creditText(text(get('designer'))),
    artist: creditText(text(get('artist'))),
    publisher: creditText(text(get('publisher'))),
    mechanics: splitList(text(get('mechanics'))),
    categories: splitList(text(get('categories'))).filter((c) => !HIDDEN_CATEGORIES.includes(c)),
    macroCategories,
    rulebook,
    music,
    cover: `covers/${coverName}`,
    estimated,
  });
}

for (const f of coverFiles) if (f.endsWith('.webp') && !usedCovers.has(f)) warnings.push(`Copertina senza gioco nell'Excel: ${f}`);
if (!games.length) errors.push('Nessun gioco trovato nel foglio Excel.');

if (warnings.length) {
  console.warn(`\nAVVISI (${warnings.length}):`);
  warnings.forEach((w) => console.warn(`  - ${w}`));
}
if (errors.length) fail();

games.sort((a, b) => a.id - b.id);
mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify({ version: 1, count: games.length, games }));
console.log(`OK: ${games.length} giochi -> public/catalog.json`);

function fail() {
  console.error(`\nERRORI (${errors.length}): catalogo NON generato, deploy interrotto.`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
