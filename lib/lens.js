// google lens via serpapi — visual matches from across the web, with prices when google has them.

const SERPAPI = 'https://serpapi.com/search.json';

// google lens has to fetch the photo itself, so it needs a public url.
export async function hostImage({ id, base64 }) {
  if (process.env.PUBLIC_URL) {
    return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/img/${id}`;
  }
  if (process.env.IMGBB_API_KEY) {
    const form = new URLSearchParams({ image: base64 });
    const res = await fetch(`https://api.imgbb.com/1/upload?expiration=600&key=${process.env.IMGBB_API_KEY}`, {
      method: 'POST',
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.data?.url) throw new Error(json?.error?.message || `imgbb ${res.status}`);
    return json.data.url;
  }
  throw new Error('set PUBLIC_URL or IMGBB_API_KEY');
}

export async function lensSearch(imageUrl) {
  const params = new URLSearchParams({
    engine: 'google_lens',
    url: imageUrl,
    hl: 'en',
    country: process.env.COUNTRY || 'us',
    api_key: process.env.SERPAPI_KEY,
  });
  const res = await fetch(`${SERPAPI}?${params}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `serpapi ${res.status}`);

  return (json.visual_matches || []).map(normalize).filter((r) => r.url);
}

function normalize(m) {
  const host = hostname(m.link);
  const isEtsy = /(^|\.)etsy\.com$/.test(host);
  return {
    id: m.link,
    title: m.title || '',
    url: m.link,
    store: isEtsy ? 'etsy' : (m.source || host).toLowerCase(),
    icon: m.source_icon || null,
    image: m.thumbnail || m.image || null,
    price: m.price?.extracted_value ?? null,
    currency: m.price?.currency || null,
    isEtsy,
    match: 'visual',
    stock: stockFromLens(m),
  };
}

// lens only knows in / out of stock for most shops — no counts
function stockFromLens(m) {
  if (m.in_stock === true) return { qty: null, label: 'in stock', level: 'ok' };
  if (m.in_stock === false || m.out_of_stock === true) return { qty: 0, label: 'sold out', level: 'out' };
  return { qty: null, label: 'unknown', level: 'unknown' };
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
