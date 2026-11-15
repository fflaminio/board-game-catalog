---
name: board-game-catalog-from-photos
description: Build or extend a Board Game Wall catalog. Turns photos of a board game shelf into the catalog Excel (data/Giochi_in_scatola_FINALE.xlsx), cover images and thumbnails ready for the site build; also adds a single game from a name or BoardGameGeek link.
---

# Board game catalog from photos

Produces everything the site build needs, inside a copy of the `board-game-catalog` repository (or as files to upload, see step 7):

- `data/Giochi_in_scatola_FINALE.xlsx`: sheet `Giochi` (one row per game) and sheet `Glossary` (definitions).
- `public/covers/NNN.webp`: front cover per game (NNN = 3-digit game ID).
- `public/covers/thumbs/NNN.webp`: thumbnail per game.

Never invent data. A value that is not verified is either an estimate (yellow cell) or marked as missing. Ask the user only critical questions, one at a time, with options.

## Modes

- **From photos**: the user gives shelf photos (a folder or attachments) and usually the sample Excel as template. Build the full catalog (steps 1–7). The new catalog replaces the sample games: keep sheets and headers, delete the sample rows and their Glossary terms no longer used, start IDs from 1.
- **Add one game**: the user gives a name, a BoardGameGeek (BGG) link or a box photo. Skip step 1, append one row with the next free ID (steps 2–7).

Before writing, back up the existing Excel (`*_backup_<date>.xlsx`, outside `data/`) and never renumber or reorder existing rows.

## 1. Read the photos

- Analyse every photo at full resolution (zoom on spines). For each box record: title as printed, edition/language, publisher/designer, codes (EAN, article number), players/age/time printed on the box, photo file, certainty (High/Medium/Low).
- Merge duplicates (same game in several photos). Keep expansions as separate games.
- List unreadable boxes separately with photo and position, and show them to the user: ask for a close-up photo or the title before going on.
- Confirm the final list with the user (count, doubtful titles) before step 2.

## 2. Identify each game on BoardGameGeek

- Find the BGG ID: BGG search, the public ranking snapshot `https://github.com/beefsack/bgg-ranking-historicals` (CSV with ID, Name, Year, URL) for base games, web search for expansions (`boardgamegeek.com/boardgameexpansion/<ID>`). Use only IDs confirmed by a source.
- Get the data: BGG XML API2 (`/xmlapi2/thing?id=<ID>&stats=1`; it may require a registered application token) or, in a browser session on boardgamegeek.com, `fetch('/api/geekitems?objectid=<ID>&objecttype=thing')`. If BGG shows a bot check, ask the user to clear it; never bypass it.
- No BGG page: use the publisher or a shop page, mark the source and estimate Mechanic/Category with existing BGG labels (yellow).

## 3. Fill the row (sheet `Giochi`)

Headers in row 1 must match exactly (the build looks them up by name; columns 5, 10 and 20 are notes the site does not read). Players, Best players, Playing time and Age are text. Ranges use an en dash (`2–4`).

| # | Header | Content |
|---|---|---|
| 1 | ID | integer, unique, never reused |
| 2 | Titolo | title as on the box |
| 3 | DESCRIZIONE | English, max 30 words, engaging, from BGG/publisher text; expansions say what they add |
| 4 | Tipo | `Base` or `Expansion` |
| 5 | Autore / Editore (da scatola) | `Designer; Publisher` as printed, `n.d.` if unknown |
| 6 | BGG ID | integer or empty |
| 7 | Nome su BGG | BGG name |
| 8 | Anno BGG | year (integer) or empty |
| 9 | Link BGG | hyperlink (`/boardgame/` or `/boardgameexpansion/`) or external page |
| 10 | Stato link | free note on the link check, e.g. `Verified via web` (not shown on the site) |
| 11 | Players | `2–7` or `2` |
| 12 | Best players | `4–5` or `2, 4` (BGG poll) |
| 13 | Playing time (min) | `30` or `40–70` |
| 14 | Age | `10+` |
| 15 | Complexity (1-5) | number, 2 decimals (BGG weight) |
| 16 | Score (voto medio) | number 0–10, 2 decimals (BGG average) |
| 17–19 | Designer / Artist / Publisher | max 4 / 3 / 3, comma separated; `Non accreditato (BGG)` if absent |
| 20 | Fonte dati | free note, e.g. `BGG (ID 68448)`, `Web (domain) + estimate` (not shown on the site) |
| 21 | Mechanic (BGG) | BGG labels, comma separated, alphabetical; `Non classificato su BGG` if none |
| 22 | Category (BGG) | BGG labels; expansions include `Expansion for Base-game` |
| 23 | Link regolamento | rulebook hyperlink; `Non reperito` if none |
| 24 | Regolamento: lingua · tipo · fonte | e.g. `EN · PDF · Publisher`, `—` if none |
| 25 | Link traccia audio (Melodice) | Melodice playlist, or a generic board game music playlist |
| 26 | Traccia audio: stato | e.g. `Dedicated playlist (209 tracks)` |
| 27 | Macro categoria | one or more of the 6 macros below, comma separated |

**Estimates**: any estimated or uncertain value gets the yellow fill `FFF2CC`; the site shows it with "≈".

**Rulebook priority**: official in the user's language > community in the user's language > official English > community/summary (for example Board Game Arena). Check that BGG files belong to the right game.

**Music**: Melodice (`https://melodice.org/api/autocomplete/?term=<name>`, header `X-Requested-With: XMLHttpRequest`; confirm the match, since unknown slugs still return 200).

**Macro categoria** (derive from Category: write every matching macro, in this order; no other values allowed):

- `Kids`: Children's Game, Educational
- `Party`: Party Game, Humor, Word Game, Trivia
- `Skill & Reflexes`: Action / Dexterity, Real-time, Racing, Sports, Memory
- `Bluff & Deduction`: Deduction, Bluffing, Murder / Mystery, Spies / Secret Agents, Negotiation, Puzzle, Maze
- `Strategy`: Abstract Strategy, Territory Building, City Building, Economic, Civilization, Farming, Industry / Manufacturing, Trains, Political, Wargame, Transportation, Number
- `Adventure & Fantasy`: Fantasy, Adventure, Exploration, Horror, Science Fiction, Mythology, Fighting, Novel-based, Movies / TV / Radio theme, Comic Book / Strip, Pirates, Space Exploration, Miniatures, Video Game Theme

If no macro results, propose the closest one to the user.

## 4. Glossary (sheet `Glossary`)

Columns: `Term` · `Type` (`Mechanic` or `Category`) · `Definition (max 10 words)`. Every Mechanic and Category used by any game needs exactly one row, in English, max 10 words. Without it the build stops.

## 5. Covers and thumbnails

- Front of the box only (BGG main image, then publisher or a reliable shop; or crop from the user's photo). No borders, watermarks or people.
- `public/covers/NNN.webp`: WebP, long side 800 px (do not upscale), quality ~80, ≤ 230 KB.
- `public/covers/thumbs/NNN.webp`: WebP, long side 320 px, quality ~75.

## 6. Quality check

- IDs unique and sequential; no duplicate BGG IDs; every row has cover and thumbnail.
- Headers unchanged; types and formats as in the table; yellow only on estimates.
- DESCRIZIONE ≤ 30 words; Tipo and Macro only from the allowed values; every term in Glossary.
- Links open and belong to the right game.
- Run `npm install && npm run build`: it must end with `OK: <n> giochi`. Fix every error it lists.

## 7. Deliver

Report: games added (ID, title), estimated cells, unresolved items, backup location. Publishing = commit the changed files to the repository's `main` branch; Cloudflare rebuilds the site.

If you cannot write to the repository (for example in a chat app), deliver ready-to-upload files instead:

- the Excel file `Giochi_in_scatola_FINALE.xlsx` (it goes in `data/`);
- one ZIP per upload batch, each with at most 100 images, keeping the paths `public/covers/NNN.webp` and `public/covers/thumbs/NNN.webp`;
- the upload order for the user: images first, Excel last (a build that runs in between may fail; the site stays online).
