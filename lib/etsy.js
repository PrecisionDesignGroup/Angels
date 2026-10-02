// etsy open api v3 — live price + quantity (the stock number) for listings.

const API = 'https://openapi.etsy.com/v3/application';

function headers() {
  const { ETSY_API_KEY: key, ETSY_SHARED_SECRET: secret } = process.env;
  // etsy expects "keystring:shared_secret"; accept either form
  return { 'x-api-key': secret && !key.includes(':') ? `${key}:${secret}` : key };
}

async function get(path, params = {}) {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: headers() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `etsy ${res.status}`);
  return json;
}

export function listingIdFromUrl(url) {
  return /etsy\.com\/(?:[a-z-]+\/)?listing\/(\d+)/i.exec(url || '')?.[1] || null;
}

// full listings with images + shop name, in batches of 100
export async function etsyListings(ids) {
  const unique = [...new Set(ids.map(String))];
  const out = [];
  for (let i = 0; i < unique.length; i += 100) {
    const json = await get('/listings/batch', {
      listing_ids: unique.slice(i, i + 100).join(','),
      includes: 'Images,Shop',
    });
    out.push(...(json.results || []).map(normalize));
  }
  return out;
}

export async function etsyKeywordSearch(keywords, maxPrice) {
  const params = { keywords, limit: 30, sort_on: 'score' };
  if (maxPrice) params.max_price = maxPrice;
  const json = await get('/listings/active', params);
  const ids = (json.results || []).map((l) => l.listing_id);
  return ids.length ? etsyListings(ids) : [];
}

function normalize(l) {
  const price = l.price ? l.price.amount / l.price.divisor : null;
  const image = l.images?.[0];
  return {
    id: String(l.listing_id),
    listingId: l.listing_id,
    title: decode(l.title || ''),
    url: l.url || `https://www.etsy.com/listing/${l.listing_id}`,
    store: l.shop?.shop_name ? `etsy · ${l.shop.shop_name}` : 'etsy',
    icon: null,
    image: image?.url_570xN || image?.url_170x135 || null,
    price,
    currency: l.price?.currency_code || null,
    isEtsy: true,
    stock: stock(l),
  };
}

function stock(l) {
  if (l.state && l.state !== 'active') return { qty: 0, label: l.state.replace('_', ' '), level: 'out' };
  const qty = l.quantity ?? null;
  if (qty == null) return { qty: null, label: 'unknown', level: 'unknown' };
  if (qty === 0) return { qty: 0, label: 'sold out', level: 'out' };
  return { qty, label: `≈ ${qty} left`, level: qty <= 3 ? 'low' : 'ok' };
}

function decode(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
