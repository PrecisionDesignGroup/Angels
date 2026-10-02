// angels — find the same (or similar) jewelry for the same price or less.
// zero-dependency node server: serves /public and a small JSON api.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lensSearch, hostImage } from './lib/lens.js';
import { etsyListings, etsyKeywordSearch, listingIdFromUrl } from './lib/etsy.js';
import { demoResults } from './lib/demo.js';

try { process.loadEnvFile(); } catch { /* no .env — fine */ }

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(import.meta.dirname, 'public');
const MAX_BODY = 8 * 1024 * 1024;

// uploaded images live in memory for a short while so google lens can fetch them
const images = new Map();
const IMAGE_TTL = 15 * 60 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function config() {
  return {
    serpapi: Boolean(process.env.SERPAPI_KEY),
    etsy: Boolean(process.env.ETSY_API_KEY),
    hosting: Boolean(process.env.PUBLIC_URL || process.env.IMGBB_API_KEY),
  };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('image too large (8mb max)'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400 });
  }
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { type: m[1], buffer: Buffer.from(m[2], 'base64') };
}

// sort cheapest first; unknown prices sink to the bottom
const byPrice = (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity);

async function search({ image, imageUrl, keywords, maxPrice }) {
  const cfg = config();
  const notes = [];

  if (!cfg.serpapi && !cfg.etsy) {
    return { demo: true, notes: ['demo mode — add api keys in .env for live results'], ...demoResults({ maxPrice }) };
  }

  // 1. make the photo reachable by google lens
  let publicUrl = imageUrl || null;
  if (!publicUrl && image) {
    const parsed = parseDataUrl(image);
    if (!parsed) throw Object.assign(new Error('unsupported image'), { status: 400 });
    const id = randomUUID();
    images.set(id, { ...parsed, expires: Date.now() + IMAGE_TTL });
    publicUrl = await hostImage({ id, parsed, base64: image.split(',')[1] }).catch((err) => {
      notes.push(`could not host image: ${err.message}`);
      return null;
    });
  }

  // 2. visual search across the web
  let web = [];
  if (cfg.serpapi && publicUrl) {
    web = await lensSearch(publicUrl).catch((err) => {
      notes.push(`image search failed: ${err.message}`);
      return [];
    });
  } else if (!cfg.serpapi) {
    notes.push('image search off — set SERPAPI_KEY');
  } else if (!image && !imageUrl) {
    notes.push('no photo — searched by words only');
  } else if (!publicUrl) {
    notes.push('image search off — set PUBLIC_URL or IMGBB_API_KEY, or paste an image link');
  }

  // 3. etsy: enrich lens hits with live stock, then a keyword sweep
  let etsy = [];
  if (cfg.etsy) {
    const lensEtsy = web.filter((r) => r.isEtsy);
    const ids = lensEtsy.map((r) => listingIdFromUrl(r.url)).filter(Boolean);

    const words = (keywords || '').trim() || guessKeywords(web);
    const [matched, swept] = await Promise.all([
      etsyListings(ids).catch((err) => { notes.push(`etsy lookup failed: ${err.message}`); return []; }),
      words
        ? etsyKeywordSearch(words, maxPrice).catch((err) => { notes.push(`etsy search failed: ${err.message}`); return []; })
        : [],
    ]);
    matched.forEach((r) => (r.match = 'visual'));
    swept.forEach((r) => (r.match = 'similar'));

    const seen = new Set();
    etsy = [...matched, ...swept].filter((r) => !seen.has(r.id) && seen.add(r.id));
    web = web.filter((r) => !r.isEtsy || !listingIdFromUrl(r.url));
    if (words) notes.push(`etsy searched for “${words}”`);
  } else {
    notes.push('etsy stock off — set ETSY_API_KEY');
    etsy = web.filter((r) => r.isEtsy);
    web = web.filter((r) => !r.isEtsy);
  }

  return { demo: false, notes, etsy: etsy.sort(byPrice), web: web.sort(byPrice), stores: groupStores(web) };
}

// pull a short keyword phrase out of the best lens titles
function guessKeywords(results) {
  const title = (results.find((r) => r.isEtsy) || results[0])?.title;
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 6)
    .join(' ');
}
const STOP = new Set(['the', 'and', 'for', 'with', 'etsy', 'gift', 'her', 'women', 'womens', 'mom', 'free', 'shipping', 'sale', 'new', 'amazon', 'com']);

function groupStores(results) {
  const stores = new Map();
  for (const r of results) {
    const s = stores.get(r.store) || { store: r.store, count: 0, lowest: null, currency: r.currency, url: r.url, icon: r.icon };
    s.count++;
    if (r.price != null && (s.lowest == null || r.price < s.lowest)) {
      s.lowest = r.price;
      s.url = r.url;
    }
    stores.set(r.store, s);
  }
  return [...stores.values()].sort((a, b) => (a.lowest ?? Infinity) - (b.lowest ?? Infinity));
}

async function serveStatic(res, pathname) {
  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && pathname === '/api/config') return send(res, 200, config());

    if (req.method === 'POST' && pathname === '/api/search') {
      const body = await readJson(req);
      const maxPrice = body.maxPrice ? Number(body.maxPrice) : null;
      return send(res, 200, await search({ ...body, maxPrice }));
    }

    const listing = /^\/api\/etsy\/(\d+)$/.exec(pathname);
    if (req.method === 'GET' && listing) {
      if (!config().etsy) return send(res, 400, { error: 'ETSY_API_KEY not set' });
      const [item] = await etsyListings([listing[1]]);
      return item ? send(res, 200, item) : send(res, 404, { error: 'listing not found' });
    }

    const img = /^\/img\/([\w-]+)$/.exec(pathname);
    if (req.method === 'GET' && img) {
      const hit = images.get(img[1]);
      if (!hit || hit.expires < Date.now()) return send(res, 404, 'gone', 'text/plain');
      return send(res, 200, hit.buffer, hit.type);
    }

    if (req.method === 'GET') return serveStatic(res, pathname);
    send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    send(res, err.status || 500, { error: err.message || 'something went wrong' });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [id, v] of images) if (v.expires < now) images.delete(id);
}, 60_000).unref();

server.listen(PORT, () => {
  const c = config();
  console.log(`angels · http://localhost:${PORT}`);
  console.log(`  image search ${c.serpapi ? 'on' : 'off'} · etsy stock ${c.etsy ? 'on' : 'off'} · image hosting ${c.hosting ? 'on' : 'off'}`);
});
