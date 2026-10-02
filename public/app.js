const $ = (id) => document.getElementById(id);
const els = {
  form: $('form'), drop: $('drop'), file: $('file'), preview: $('preview'), hint: $('hint'),
  imageUrl: $('imageUrl'), maxPrice: $('maxPrice'), keywords: $('keywords'), cheaperOnly: $('cheaperOnly'),
  go: $('go'), status: $('status'), results: $('results'), notes: $('notes'),
  etsy: $('etsy'), web: $('web'), stores: $('stores'), etsyCount: $('etsyCount'), webCount: $('webCount'),
  saved: $('saved'), savedBlock: $('savedBlock'), savedCount: $('savedCount'), refresh: $('refresh'),
  card: $('card'),
};

const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="7" fill="none" stroke="#d9d3ca" stroke-width=".8"/><circle cx="20" cy="13" r="1.4" fill="#d9d3ca"/></svg>`
);

let photo = null; // resized data url of the uploaded photo
let last = null;  // last search response

// ── config ──────────────────────────────────────────────────────────
fetch('/api/config').then((r) => r.json()).then((c) => {
  const on = (x) => (x ? '<b>on</b>' : 'off');
  els.status.innerHTML = c.serpapi || c.etsy
    ? `image search ${on(c.serpapi)} · etsy stock ${on(c.etsy)}`
    : 'demo mode · add keys to .env for live results';
}).catch(() => {});

// ── photo input: click, drop, paste ─────────────────────────────────
els.file.addEventListener('change', () => els.file.files[0] && usePhoto(els.file.files[0]));
['dragenter', 'dragover'].forEach((e) => els.drop.addEventListener(e, (ev) => { ev.preventDefault(); els.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => els.drop.addEventListener(e, () => els.drop.classList.remove('over')));
els.drop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const f = ev.dataTransfer.files[0];
  if (f?.type.startsWith('image/')) usePhoto(f);
});
document.addEventListener('paste', (ev) => {
  const item = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) usePhoto(item.getAsFile());
});
els.imageUrl.addEventListener('change', () => {
  const url = els.imageUrl.value.trim();
  if (!url) return;
  photo = null;
  showPreview(url);
});

async function usePhoto(file) {
  photo = await shrink(file, 1024);
  els.imageUrl.value = '';
  showPreview(photo);
}

function showPreview(src) {
  els.preview.src = src;
  els.preview.hidden = false;
  els.hint.hidden = true;
}

// keep uploads small: longest side ≤ max px, jpeg
function shrink(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ── search ──────────────────────────────────────────────────────────
els.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const imageUrl = els.imageUrl.value.trim();
  if (!photo && !imageUrl && !els.keywords.value.trim()) {
    els.notes.textContent = 'add a photo, an image link, or a few words first';
    els.results.hidden = false;
    return;
  }

  els.go.disabled = true;
  els.results.hidden = false;
  els.notes.innerHTML = '<span class="loading">searching etsy and the web</span>';
  [els.etsy, els.web, els.stores].forEach((el) => (el.innerHTML = ''));
  els.etsyCount.textContent = els.webCount.textContent = '';

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image: photo,
        imageUrl: imageUrl || null,
        keywords: els.keywords.value.trim(),
        maxPrice: els.maxPrice.value || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'search failed');
    last = data;
    render();
  } catch (err) {
    els.notes.textContent = err.message;
  } finally {
    els.go.disabled = false;
  }
});

els.cheaperOnly.addEventListener('change', () => last && render());
els.maxPrice.addEventListener('input', () => last && render());

function render() {
  const max = Number(els.maxPrice.value) || null;
  const keep = (r) => !els.cheaperOnly.checked || max == null || r.price == null || r.price <= max;

  const etsy = last.etsy.filter(keep);
  const web = last.web.filter(keep);

  els.notes.textContent = (last.notes || []).join('\n');
  els.etsyCount.textContent = count(etsy.length, last.etsy.length);
  els.webCount.textContent = count(web.length, last.web.length);

  fill(els.etsy, etsy, 'no etsy matches at this price');
  fill(els.web, web, 'nothing found elsewhere at this price');

  els.stores.innerHTML = '';
  const stores = last.stores.filter((s) => keep({ price: s.lowest }));
  if (!stores.length) els.stores.innerHTML = '<li class="empty">—</li>';
  for (const s of stores) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span class="name"></span><span class="n">${s.count} listing${s.count === 1 ? '' : 's'}</span><span>${s.lowest == null ? '—' : 'from ' + money(s.lowest, s.currency)}</span>`;
    a.querySelector('.name').textContent = s.store;
    li.append(a);
    els.stores.append(li);
  }
}

const count = (shown, total) => (shown === total ? `${total}` : `${shown} of ${total}`);

function fill(list, items, emptyText) {
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<li class="empty">${emptyText}</li>`;
    return;
  }
  items.forEach((r) => list.append(card(r)));
}

function card(r, { saved = false } = {}) {
  const max = Number(els.maxPrice.value) || r.yourPrice || null;
  const node = els.card.content.firstElementChild.cloneNode(true);
  const img = node.querySelector('img');
  img.src = r.image || (last?.demo && photo) || r.fallback || PLACEHOLDER;
  img.onerror = () => (img.src = PLACEHOLDER);
  node.querySelector('.thumb').href = r.url;
  const title = node.querySelector('.title');
  title.href = r.url;
  title.textContent = r.title || 'untitled';
  node.querySelector('.store').textContent = r.store;
  node.querySelector('.price').textContent = r.price == null ? '—' : money(r.price, r.currency);

  const stock = node.querySelector('.stock');
  stock.textContent = r.stock?.label || 'unknown';
  stock.classList.add(r.stock?.level || 'unknown');
  if (r.stock?.level === 'out') node.classList.add('dim');

  node.querySelector('.match').textContent = saved ? (r.checked ? `checked ${ago(r.checked)}` : 'kept') : r.match === 'similar' ? 'similar' : 'match';
  if (max != null && r.price != null && r.price <= max) node.querySelector('.deal').hidden = false;

  const btn = node.querySelector('.keep');
  const isKept = () => kept().some((k) => k.id === r.id);
  const paint = () => { btn.classList.toggle('on', isKept()); btn.textContent = isKept() ? '♥' : '♡'; };
  paint();
  btn.addEventListener('click', () => { toggleKeep(r); paint(); });
  return node;
}

function money(n, cur) {
  const code = /^[A-Z]{3}$/.test(cur || '') ? cur : 'USD';
  const sym = cur && !/^[A-Z]{3}$/.test(cur) ? cur : null;
  try {
    const s = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
    return sym ? sym + n.toFixed(2) : s;
  } catch {
    return `${sym || '$'}${n.toFixed(2)}`;
  }
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// ── kept items (saved in this browser) ──────────────────────────────
const KEY = 'angels.kept';
function kept() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function setKept(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
  renderKept();
}
function toggleKeep(r) {
  const list = kept();
  const i = list.findIndex((k) => k.id === r.id);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({
    ...r,
    fallback: r.image ? null : photo && photo.length < 200_000 ? photo : null,
    yourPrice: Number(els.maxPrice.value) || null,
    checked: Date.now(),
  });
  setKept(list);
}

function renderKept() {
  const list = kept();
  els.savedBlock.hidden = !list.length;
  els.savedCount.textContent = list.length || '';
  els.saved.innerHTML = '';
  list.forEach((r) => els.saved.append(card(r, { saved: true })));
}

// re-check live stock + price for kept etsy listings
els.refresh.addEventListener('click', async () => {
  els.refresh.textContent = 'checking…';
  const list = kept();
  await Promise.all(list.map(async (r, i) => {
    if (!r.listingId) return;
    try {
      const res = await fetch(`/api/etsy/${r.listingId}`);
      if (!res.ok) return;
      const fresh = await res.json();
      list[i] = { ...r, price: fresh.price, stock: fresh.stock, image: fresh.image || r.image, checked: Date.now() };
    } catch { /* keep old */ }
  }));
  setKept(list);
  els.refresh.textContent = 'refresh stock';
});

renderKept();
