-- Board Game Wall: dynamic data (Cloudflare D1, binding DB). Applied by "wrangler d1 migrations apply DB".
-- Manual setup: paste this file in the D1 Console and run it.
-- Favorites: one list, one row per favorite game
CREATE TABLE IF NOT EXISTS favorites (
  game_id    INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Plays: one row per "Play it!"
CREATE TABLE IF NOT EXISTS plays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL,
  played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS plays_game ON plays (game_id);
-- Wrong password attempts (limit: 5 in 15 minutes per IP address)
CREATE TABLE IF NOT EXISTS login_fail (
  ip        TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_fail_ip ON login_fail (ip, failed_at);
