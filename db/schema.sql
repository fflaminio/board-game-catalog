-- Board Game Wall: dati dinamici (Cloudflare D1, database board-game-db)
-- Preferiti: un elenco unico, una riga per gioco preferito
CREATE TABLE IF NOT EXISTS favorites (
  game_id    INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Partite: una riga per ogni "Play it!"
CREATE TABLE IF NOT EXISTS plays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL,
  played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS plays_game ON plays (game_id);
-- Tentativi di password errati (limite: 5 in 15 minuti per indirizzo IP)
CREATE TABLE IF NOT EXISTS login_fail (
  ip        TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_fail_ip ON login_fail (ip, failed_at);
