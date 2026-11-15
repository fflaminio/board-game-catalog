// Board Game Wall — API (Cloudflare Worker). Static files are served from ./public;
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//
// Bindings: DB (D1 board-game-db), ASSETS (static files), ADMIN_PASSWORD (secret).
// Public read: GET /api/state. Writes need a token from POST /api/login.

const TOKEN_TTL = 2 * 60 * 60; // seconds: one visit
const FAIL_LIMIT = 5; // wrong passwords allowed per IP...
const FAIL_WINDOW = 15 * 60; // ...in this many seconds
const UNDO_WINDOW = 60; // seconds the server accepts an undo (the UI offers 10)
const MAX_PASSWORD = 64;

const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
const fail = (status, error, extra) => json({ error }, status, extra);

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function same(a, b) {
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The signing key comes from the password: changing the secret logs every open page out.
async function signer(env) {
  return crypto.subtle.importKey('raw', await sha256(`token:${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function makeToken(env) {
  const exp = now() + TOKEN_TTL;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await signer(env), enc.encode(String(exp))));
  return { token: `${exp}.${b64url(sig)}`, exp };
}

async function validToken(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer (\d+)\.([\w-]+)$/);
  if (!m || Number(m[1]) <= now()) return false;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await signer(env), enc.encode(m[1])));
  return same(enc.encode(b64url(sig)), enc.encode(m[2]));
}

// Valid game ids come from the published catalog, so the API never accepts unknown games.
let ids = null;
async function gameIds(env, request) {
  if (!ids) {
    const res = await env.ASSETS.fetch(new URL('/catalog.json', request.url));
    if (!res.ok) throw new Error('catalog not available');
    ids = new Set((await res.json()).games.map((g) => g.id));
  }
  return ids;
}

async function body(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return null;
  const text = await request.text();
  if (text.length > 1000) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function gamePlays(env, id) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n, MAX(played_at) AS last FROM plays WHERE game_id = ?').bind(id).first();
  const t = await env.DB.prepare('SELECT COUNT(*) AS n FROM plays').first();
  return { game: { n: r.n, last: r.last }, total: t.n };
}

// ---------- routes ----------

async function getState(env) {
  const [fav, plays] = await env.DB.batch([
    env.DB.prepare('SELECT game_id FROM favorites ORDER BY game_id'),
    env.DB.prepare('SELECT game_id, COUNT(*) AS n, MAX(played_at) AS last FROM plays GROUP BY game_id'),
  ]);
  const byGame = {};
  let total = 0;
  for (const r of plays.results) { byGame[r.game_id] = { n: r.n, last: r.last }; total += r.n; }
  return json({ favorites: fav.results.map((r) => r.game_id), plays: byGame, total });
}

async function login(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const since = now() - FAIL_WINDOW;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(failed_at) AS first FROM login_fail WHERE ip = ? AND failed_at > ?').bind(ip, since).first();
  if (row.n >= FAIL_LIMIT) {
    const wait = Math.max(60, row.first + FAIL_WINDOW - now());
    return fail(429, 'locked', { 'retry-after': String(wait) });
  }
  const b = await body(request);
  const pw = b && typeof b.password === 'string' ? b.password : '';
  if (pw && pw.length <= MAX_PASSWORD && same(await sha256(pw), await sha256(env.ADMIN_PASSWORD))) {
    await env.DB.prepare('DELETE FROM login_fail WHERE ip = ? OR failed_at < ?').bind(ip, now() - 86400).run();
    return json(await makeToken(env));
  }
  await env.DB.prepare('INSERT INTO login_fail (ip, failed_at) VALUES (?, ?)').bind(ip, now()).run();
  return fail(401, 'wrong_password', { 'x-attempts-left': String(Math.max(0, FAIL_LIMIT - row.n - 1)) });
}

async function setFavorite(request, env) {
  const b = await body(request);
  const known = await gameIds(env, request);
  if (!b || !known.has(b.id) || typeof b.on !== 'boolean') return fail(400, 'bad_request');
  const sql = b.on ? 'INSERT OR IGNORE INTO favorites (game_id) VALUES (?)' : 'DELETE FROM favorites WHERE game_id = ?';
  await env.DB.prepare(sql).bind(b.id).run();
  const fav = await env.DB.prepare('SELECT game_id FROM favorites ORDER BY game_id').all();
  return json({ favorites: fav.results.map((r) => r.game_id) });
}

async function addPlay(request, env) {
  const b = await body(request);
  const known = await gameIds(env, request);
  if (!b || !known.has(b.id)) return fail(400, 'bad_request');
  const r = await env.DB.prepare('INSERT INTO plays (game_id) VALUES (?) RETURNING id').bind(b.id).first();
  return json({ playId: r.id, ...(await gamePlays(env, b.id)) });
}

async function undoPlay(request, env) {
  const b = await body(request);
  if (!b || !Number.isInteger(b.playId)) return fail(400, 'bad_request');
  const r = await env.DB.prepare(
    "DELETE FROM plays WHERE id = ? AND played_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) RETURNING game_id",
  ).bind(b.playId, `-${UNDO_WINDOW} seconds`).first();
  if (!r) return fail(409, 'too_late');
  return json(await gamePlays(env, r.game_id));
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const m = request.method;
    try {
      if (pathname === '/api/state' && m === 'GET') return await getState(env);
      if (!env.ADMIN_PASSWORD) return fail(503, 'not_configured');
      if (pathname === '/api/login' && m === 'POST') return await login(request, env);
      const route = { '/api/favorite': setFavorite, '/api/play': addPlay, '/api/play/undo': undoPlay }[pathname];
      if (!route) return fail(404, 'not_found');
      if (m !== 'POST') return fail(405, 'method_not_allowed');
      if (!(await validToken(request, env))) return fail(401, 'login_required');
      return await route(request, env);
    } catch (e) {
      console.error(e);
      return fail(500, 'server_error');
    }
  },
};
