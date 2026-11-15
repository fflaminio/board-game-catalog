// Converts data/Giochi_in_scatola_FINALE.xlsx (sheet "Giochi") into public/catalog.json.
// Run with: npm run build  (Cloudflare runs it at every deploy).
// If the data has errors it stops the build and publishes nothing.
// Messages are in English for everyone who reuses the project.

import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_FILE = join(ROOT, 'data', 'Giochi_in_scatola_FINALE.xlsx');
const SHEET = 'Giochi';
const COVERS_DIR = join(ROOT, 'public', 'covers');
const THUMBS_DIR = join(COVERS_DIR, 'thumbs');
const OUT_FILE = join(ROOT, 'public', 'catalog.json');

const GLOSSARY_SHEET = 'Glossary';
const GLOSSARY_MAX_WORDS = 10;
const MACROS = ['Kids', 'Party', 'Skill & Reflexes', 'Bluff & Deduction', 'Strategy', 'Adventure & Fantasy'];
const HIDDEN_CATEGORIES = ['Expansion for Base-game'];
// Termini BGG che contengono virgole: non vanno spezzati dalla lista separata da virgole
const PROTECTED_TERMS = ['Deck, Bag, and Pool Building'];
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
  let work = s;
  PROTECTED_TERMS.forEach((term, i) => {
    work = work.split(term).join(`\u0001${i}\u0001`);
  });
  return work
    .split(',')
    .map((x) => x.trim().replace(/\u0001(\d+)\u0001/g, (_, i) => PROTECTED_TERMS[Number(i)]))
    .filter((x) => x && !MISSING_PREFIXES.some((p) => x.startsWith(p)));
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
  console.error(`ERROR: file not found: ${XLSX_FILE}`);
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX_FILE);
const ws = wb.getWorksheet(SHEET);
if (!ws) {
  console.error(`ERROR: sheet "${SHEET}" not found in the Excel file.`);
  process.exit(1);
}

const colIndex = {};
const headerRow = ws.getRow(1);
headerRow.eachCell((cell, n) => {
  const h = text(cell);
  if (h) colIndex[h] = n;
});
for (const [key, header] of Object.entries(COL)) {
  if (!colIndex[header]) errors.push(`Column missing or renamed: "${header}" (field ${key})`);
}
if (errors.length) fail();

const coverFiles = new Set(existsSync(COVERS_DIR) ? readdirSync(COVERS_DIR) : []);
const thumbFiles = new Set(existsSync(THUMBS_DIR) ? readdirSync(THUMBS_DIR) : []);
const usedCovers = new Set();
const seenIds = new Set();
const games = [];

for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const get = (key) => row.getCell(colIndex[COL[key]]);
  if (!text(get('id')) && !text(get('title'))) continue; // riga vuota

  const idNum = toNumber(text(get('id')));
  const title = text(get('title'));
  const label = `Row ${r} (ID ${idNum ?? '?'}, ${title ?? 'no title'})`;
  const err = (msg) => errors.push(`${label}: ${msg}`);
  const warn = (msg) => warnings.push(`${label}: ${msg}`);

  if (!Number.isInteger(idNum) || idNum < 1) err('invalid ID (a whole number ≥ 1 is required)');
  else if (seenIds.has(idNum)) err('duplicate ID');
  else seenIds.add(idNum);
  if (!title) err('Titolo (title) missing');

  const description = text(get('description'));
  if (!description) err('DESCRIZIONE (description) missing');
  else if (description.split(/\s+/).length > 30) warn('DESCRIZIONE (description) longer than 30 words');

  const typeRaw = text(get('type'));
  const type = typeRaw === 'Base' ? 'base' : typeRaw === 'Expansion' ? 'expansion' : null;
  if (!type) err(`invalid Tipo (type): "${typeRaw}" (allowed: Base, Expansion)`);

  const players = parseRange(text(get('players')));
  if (!players) err(`invalid Players: "${text(get('players'))}" (use 2–4 or 2)`);
  const playingTime = parseRange(text(get('playingTime')));
  if (!playingTime) err(`invalid Playing time: "${text(get('playingTime'))}" (use 30–45 or 30)`);
  const age = parseAge(text(get('age')));
  if (!age) err(`invalid Age: "${text(get('age'))}" (use 10+)`);
  const complexity = toNumber(text(get('complexity')));
  if (complexity == null || complexity < 1 || complexity > 5) err(`invalid Complexity: "${text(get('complexity'))}" (a number from 1 to 5)`);
  const score = toNumber(text(get('score')));
  if (score == null || score < 0 || score > 10) err(`invalid Score: "${text(get('score'))}" (a number from 0 to 10)`);
  const bestPlayers = text(get('bestPlayers'));
  if (!bestPlayers) err('Best players missing');

  const macroCategories = splitList(text(get('macro')));
  if (!macroCategories.length) err('Macro categoria (category) missing');
  for (const m of macroCategories) if (!MACROS.includes(m)) err(`unknown Macro categoria (category): "${m}" (allowed: ${MACROS.join(', ')})`);

  const yearRaw = toNumber(text(get('year')));
  const year = yearRaw && yearRaw > 0 ? yearRaw : null;
  const bggIdRaw = toNumber(text(get('bggId')));
  const bggUrlRaw = urlOf(get('bggUrl'));
  const bggUrl = bggUrlRaw && validUrl(bggUrlRaw) ? bggUrlRaw : null;
  if (bggUrlRaw && !bggUrl) err(`invalid Link BGG: "${bggUrlRaw}"`);

  // regolamento
  const rbUrlRaw = urlOf(get('rulebookUrl'));
  const rbUrl = isMissing(rbUrlRaw) ? null : rbUrlRaw;
  if (rbUrl && !validUrl(rbUrl)) err(`invalid Link regolamento (rulebook link): "${rbUrl}"`);
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
  if (!musicUrl || !validUrl(musicUrl)) err(`Music Board link missing or invalid: "${musicUrl}"`);
  const music = { url: musicUrl, status: text(get('musicStatus')) };

  // copertina
  const coverName = `${String(idNum).padStart(3, '0')}.webp`;
  if (Number.isInteger(idNum)) {
    if (coverFiles.has(coverName)) usedCovers.add(coverName);
    else err(`cover missing: public/covers/${coverName}`);
    if (coverFiles.has(coverName) && !thumbFiles.has(coverName)) warn(`thumbnail missing: public/covers/thumbs/${coverName} (the full cover is used: slower site)`);
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
    thumb: thumbFiles.has(coverName) ? `covers/thumbs/${coverName}` : `covers/${coverName}`,
    estimated,
  });
}

for (const f of coverFiles) if (f.endsWith('.webp') && !usedCovers.has(f)) warnings.push(`cover with no game in the Excel file: ${f}`);
if (!games.length) warnings.push('The catalog is empty: the site shows an empty wall until you add games.');

// ---------- glossario (definizioni di Mechanic e Category) ----------

const glossary = { mechanics: {}, categories: {} };
const gws = wb.getWorksheet(GLOSSARY_SHEET);
if (!gws) {
  errors.push(`Sheet "${GLOSSARY_SHEET}" not found in the Excel file.`);
} else {
  const defs = { Mechanic: new Map(), Category: new Map() };
  for (let r = 2; r <= gws.rowCount; r++) {
    const row = gws.getRow(r);
    const term = text(row.getCell(1));
    const kind = text(row.getCell(2));
    const def = text(row.getCell(3));
    if (!term && !kind && !def) continue;
    const at = `Glossary row ${r} ("${term ?? '?'}")`;
    if (!term || !def) { errors.push(`${at}: term or definition missing`); continue; }
    if (!defs[kind]) { errors.push(`${at}: invalid Type "${kind}" (allowed: Mechanic, Category)`); continue; }
    if (defs[kind].has(term)) { errors.push(`${at}: duplicate term`); continue; }
    if (def.split(/\s+/).length > GLOSSARY_MAX_WORDS) errors.push(`${at}: definition longer than ${GLOSSARY_MAX_WORDS} words`);
    defs[kind].set(term, def);
  }
  const usedBy = { Mechanic: new Map(), Category: new Map() };
  for (const g of games) {
    for (const t of g.mechanics) (usedBy.Mechanic.get(t) ?? usedBy.Mechanic.set(t, []).get(t)).push(g.id);
    for (const t of g.categories) (usedBy.Category.get(t) ?? usedBy.Category.set(t, []).get(t)).push(g.id);
  }
  for (const [kind, used] of Object.entries(usedBy)) {
    const target = kind === 'Mechanic' ? glossary.mechanics : glossary.categories;
    for (const term of [...used.keys()].sort((a, b) => a.localeCompare(b))) {
      if (defs[kind].has(term)) target[term] = defs[kind].get(term);
      else errors.push(`Glossary: no definition for ${kind} "${term}" (used by game ID ${used.get(term).join(', ')}): add a row to the Glossary sheet`);
    }
  }
}

if (warnings.length) {
  console.warn(`\nWARNINGS (${warnings.length}): the site is published anyway`);
  warnings.forEach((w) => console.warn(`  - ${w}`));
}
if (errors.length) fail();

games.sort((a, b) => a.id - b.id);
mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify({ version: 2, count: games.length, games, glossary }));
console.log(
  `OK: ${games.length} games, ${Object.keys(glossary.mechanics).length} mechanics, ${Object.keys(glossary.categories).length} categories -> public/catalog.json`,
);

function fail() {
  console.error(`\nERRORS (${errors.length}): catalog NOT generated, deploy stopped. The site online is unchanged.`);
  errors.forEach((e) => console.error(`  - ${e}`));
  console.error('\nFix data/Giochi_in_scatola_FINALE.xlsx (the row number is the Excel row) and upload it again.');
  process.exit(1);
}
