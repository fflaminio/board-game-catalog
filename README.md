# Board Game Wall

A public, responsive catalog of your own board game collection, built from photos of your shelves and hosted for free.

Live example: https://board-game-catalog.fflaminio.workers.dev

## What you get

- **Wall of covers**: every game as a tile, vertical scroll, desktop and mobile.
- **Analog filters**: four knobs (Duration, Players, Effort, Category), keyword search, a game counter and a PANIC reset button.
- **Game card**: description, players, duration, age, a stats chart (effort, score, duration), rulebook and music links, category and mechanic chips with short definitions, BoardGameGeek credit.
- **Owner features**: favorites and a play log ("Play it!", with play count, share and last play). Everyone can see them; only the owner can change them, with a password.
- **Zero cost**: GitHub and the Cloudflare free plan. No server to manage.

## How it works

```
Photos ──(Claude + skill)──> Excel + covers ──(build)──> catalog.json ──> website
                                                     Cloudflare D1 <──> /api (favorites, plays)
```

1. The catalog lives in one Excel file (`data/Giochi_in_scatola_FINALE.xlsx`) plus one cover per game.
2. At every deploy, `scripts/build-catalog.mjs` checks the data and writes `public/catalog.json`. Any data error stops the deploy, so a broken catalog is never published.
3. The site (`public/`) is plain HTML, CSS and JavaScript, with no framework. Filters run in the browser.
4. A small Cloudflare Worker (`src/worker.js`) stores favorites and plays in a Cloudflare D1 database. Writes need the owner password, kept as a Cloudflare secret and never in the code.

## Repository layout

| Path | Content |
|---|---|
| `data/` | catalog Excel: sheet `Giochi` (one row per game) and sheet `Glossary` |
| `public/` | website: `index.html`, `css/`, `js/`, `fonts/`, `covers/` (and `covers/thumbs/`) |
| `scripts/build-catalog.mjs` | Excel → `public/catalog.json`, with validation |
| `src/worker.js` | API: `/api/state`, `/api/login`, `/api/favorite`, `/api/play`, `/api/play/undo` |
| `db/schema.sql` | D1 tables |
| `skills/board-game-catalog-from-photos/` | AI skill: photos → Excel, covers and thumbnails |
| `wrangler.jsonc` | Cloudflare configuration |

## Make your own catalog

You need free accounts on GitHub and Cloudflare, and an AI assistant that can read images and browse the web (the skill is written for Claude).

1. **Copy the project**: click **Fork** (or **Use this template**) on GitHub. The sample data and covers belong to the original collection, so you will replace them.
2. **Build your data from photos**:
   - Add `skills/board-game-catalog-from-photos` to your assistant. For Claude, upload the folder as a custom skill, or put it in `.claude/skills/` for Claude Code.
   - Give it your shelf photos and your copy of the repository.
   - It writes the Excel, `public/covers/NNN.webp` and `public/covers/thumbs/NNN.webp`. Remove the sample covers you do not use.
3. **Create the database**:
   - In Cloudflare, go to **Storage & Databases → D1 → Create** and name it `board-game-db`.
   - In its **Console**, run the content of `db/schema.sql`.
   - Copy the **Database ID** into `wrangler.jsonc` (`database_id`) and commit.
4. **Deploy**:
   - In Cloudflare, go to **Workers & Pages → Create → Import a repository** and pick your fork.
   - Set the build command to `npm run build` and the deploy command to `npx wrangler deploy`.
   - The Worker name must match `name` in `wrangler.jsonc`.
5. **Set the owner password**:
   - In the Worker, open **Settings → Variables and Secrets → Add**.
   - Choose type **Secret**, name `ADMIN_PASSWORD`, value of your choice (max 16 characters), then deploy.
6. Open the `*.workers.dev` address shown by Cloudflare.

**Updating**: edit the Excel and covers, then commit to `main`. Cloudflare rebuilds the site in 1–2 minutes. If the data has an error, the build log in Cloudflare (**Builds**) names the row and the field.

## Run it locally (optional)

```
npm install
npm run build
echo ADMIN_PASSWORD="choose-one" > .dev.vars
npx wrangler d1 execute board-game-db --local --file db/schema.sql
npx wrangler dev
```

## Data, images and credits

- Game data comes mostly from [BoardGameGeek](https://boardgamegeek.com). Its use is limited to non-commercial purposes with attribution: every game card links to its BoardGameGeek page.
- Cover images belong to their publishers. They are included only as the sample collection. Use covers of your own games.
- Music links point to [Melodice](https://melodice.org) playlists.
- The fonts (Fredoka, Nunito, Share Tech Mono) are under the SIL Open Font License: see `public/fonts/LICENSES.txt`.

## License

The code is released under the MIT License (see `LICENSE`). The license does not cover cover images, game data from BoardGameGeek or the fonts, which keep their own terms.

Built with the help of Claude (Anthropic).
