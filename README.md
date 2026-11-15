# Board Game Catalog

Catalogo pubblico dei giochi da tavolo di Flaminio.

- `public/` — sito pubblicato (pagine, JSON del catalogo, copertine)
- `data/` — Excel sorgente; `scripts/build-catalog.mjs` genera `public/catalog.json` al build
- `src/worker.js` — API per preferiti e partite (`/api/*`)
- `db/schema.sql` — tabelle del database Cloudflare D1 `board-game-db`
- `wrangler.jsonc` — configurazione Cloudflare Workers

Ospitato su Cloudflare Workers; deploy automatico a ogni modifica del ramo `main`.
La password del proprietario è il secret `ADMIN_PASSWORD` del Worker (dashboard Cloudflare), mai nel codice.
