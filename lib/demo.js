// sample results so the page can be tried before any api keys are set.
// images are left empty — the page shows your own photo in their place.

const ETSY = [
  ['Dainty Gold Herringbone Chain Necklace, 14k Gold Filled', 'etsy · LittleGoldStudio', 24.0, 7],
  ['Minimalist Snake Chain Necklace — Gold Vermeil', 'etsy · WildflowerJewelryCo', 18.5, 2],
  ['Thin Flat Herringbone Choker, Waterproof Gold', 'etsy · NoraAndPearl', 21.0, 14],
  ['Gold Herringbone Necklace 3mm, Layering Chain', 'etsy · TheTinyCharm', 29.0, 0],
  ['Liquid Gold Chain Necklace, Everyday Jewelry', 'etsy · SunnyAtelier', 16.75, 1],
];

const WEB = [
  ['Herringbone Chain Necklace 18K Plated', 'amazon.com', 12.99, 'ok'],
  ['Flat Snake Chain Necklace', 'shein.com', 6.49, 'ok'],
  ['Herringbone Necklace — Gold', 'mejuri.com', 98.0, 'ok'],
  ['Dainty Herringbone Chain', 'aliexpress.com', 3.2, 'unknown'],
  ['Gold Flat Chain Necklace', 'amazon.com', 15.99, 'out'],
  ['Herringbone Chain 16"', 'nordstrom.com', 38.0, 'ok'],
  ['Thin Herringbone Necklace', 'walmart.com', 9.97, 'ok'],
];

export function demoResults({ maxPrice }) {
  const etsy = ETSY.map(([title, store, price, qty], i) => ({
    id: `demo-etsy-${i}`,
    listingId: null,
    title,
    url: 'https://www.etsy.com/search?q=' + encodeURIComponent(title),
    store,
    image: null,
    price,
    currency: 'USD',
    isEtsy: true,
    match: i < 2 ? 'visual' : 'similar',
    stock: qty === 0
      ? { qty: 0, label: 'sold out', level: 'out' }
      : { qty, label: `≈ ${qty} left`, level: qty <= 3 ? 'low' : 'ok' },
  }));

  const web = WEB.map(([title, store, price, level], i) => ({
    id: `demo-web-${i}`,
    title,
    url: `https://${store}`,
    store,
    image: null,
    price,
    currency: 'USD',
    isEtsy: false,
    match: 'visual',
    stock: { qty: level === 'out' ? 0 : null, label: { ok: 'in stock', out: 'sold out', unknown: 'unknown' }[level], level },
  }));

  const sort = (a, b) => a.price - b.price;
  const stores = new Map();
  for (const r of web) {
    const s = stores.get(r.store) || { store: r.store, count: 0, lowest: null, currency: 'USD', url: r.url };
    s.count++;
    s.lowest = s.lowest == null ? r.price : Math.min(s.lowest, r.price);
    stores.set(r.store, s);
  }

  return {
    etsy: etsy.sort(sort),
    web: web.sort(sort),
    stores: [...stores.values()].sort((a, b) => a.lowest - b.lowest),
    maxPrice,
  };
}
