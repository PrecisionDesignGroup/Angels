const $ = (id) => document.getElementById(id);
const els = {
  form: $('form'), drop: $('drop'), file: $('file'), preview: $('preview'), hint: $('hint'),
  imageUrl: $('imageUrl'), maxPrice: $('maxPrice'), extra: $('extra'), fees: $('fees'), keywords: $('keywords'),
  searchingFor: $('searchingFor'), go: $('go'), status: $('status'), results: $('results'), notes: $('notes'),
  sortSeg: $('sortSeg'), show: $('show'), hideSold: $('hideSold'), savePiece: $('savePiece'),
  etsy: $('etsy'), web: $('web'), stores: $('stores'), etsyCount: $('etsyCount'), webCount: $('webCount'),
  saved: $('saved'), savedEmpty: $('savedEmpty'), savedCount: $('savedCount'), refresh: $('refresh'),
  pieces: $('pieces'), piecesTable: $('piecesTable'), piecesEmpty: $('piecesEmpty'), piecesCount: $('piecesCount'),
  piecesBadge: $('piecesBadge'), suppliersBadge: $('suppliersBadge'), tabs: $('tabs'),
  statUnits: $('statUnits'), statUnitsSub: $('statUnitsSub'), statReorder: $('statReorder'), statReorderSub: $('statReorderSub'),
  statReorderTile: $('statReorderTile'), statValue: $('statValue'), statValueSub: $('statValueSub'),
  statMargin: $('statMargin'), statMarginSub: $('statMarginSub'),
  copy: $('copy'), toast: $('toast'), card: $('card'), pieceRow: $('pieceRow'),
};

const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#ebebef"/><circle cx="20" cy="20" r="7" fill="none" stroke="#b8b8be" stroke-width=".8"/><circle cx="20" cy="13" r="1.4" fill="#b8b8be"/></svg>`
);
const STALE = 6 * 60 * 60 * 1000; // re-check supplier stock when older than this

let photo = null;       // resized data url of the uploaded photo
let thumb = null;       // smaller copy kept with a saved piece
let last = null;        // last search response
let activePiece = null; // id of the piece the current search is for
let sortBy = 'price';
let demoMode = false;

// ── storage (this browser only) ─────────────────────────────────────
function load(key, fallback = []) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked or full */ }
}
const pieces = () => load('angels.pieces');
const kept = () => load('angels.kept');
const settings = () => ({ extra: 0, fees: true, ...load('angels.settings', {}) });
const setPieces = (list) => { store('angels.pieces', list); renderPieces(); };
const setKept = (list) => { store('angels.kept', list); renderKept(); renderPieces(); };

// ── money ───────────────────────────────────────────────────────────
// etsy seller fees on a sale: 6.5% transaction, 3% + $0.25 payment processing, $0.20 listing
const etsyFees = (sale) => sale * 0.095 + 0.45;

// everything between what you paid and what you sell it for
function breakdown(sale, paid) {
  if (sale == null || paid == null || !(sale > 0)) return null;
  const s = settings();
  const fees = s.fees ? etsyFees(sale) : 0;
  const extra = Number(s.extra) || 0;
  const profit = sale - paid - fees - extra;
  return { sale, paid, fees, extra, profit, margin: profit / sale };
}

function money(n, cur) {
  const code = /^[A-Z]{3}$/.test(cur || '') ? cur : 'USD';
  const sym = cur && !/^[A-Z]{3}$/.test(cur) ? cur : null;
  if (sym) return sym + n.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}
const signed = (n, cur) => `${n < 0 ? '−' : '+'}${money(Math.abs(n), cur)}`;
const pct = (m) => `${m < 0 ? '−' : ''}${Math.abs(Math.round(m * 100))}%`;
const round = (n) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
const span = (ms) => (ms < 36e5 ? `${Math.max(1, Math.round(ms / 6e4))}m` : ms < 864e5 ? `${Math.round(ms / 36e5)}h` : `${Math.round(ms / 864e5)}d`);

// ── tabs ────────────────────────────────────────────────────────────
const TABS = ['find', 'pieces', 'suppliers'];
function showTab(name, { scroll = true } = {}) {
  if (!TABS.includes(name)) name = 'find';
  TABS.forEach((t) => ($(`tab-${t}`).hidden = t !== name));
  els.tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === name)));
  try { history.replaceState(null, '', `#${name}`); } catch { /* sandboxed */ }
  if (scroll) window.scrollTo({ top: 0 });
}
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab]');
  if (!t) return;
  ev.preventDefault();
  showTab(t.dataset.tab);
});
showTab(location.hash.slice(1), { scroll: false });

let toastTimer;
function toast(msg, action) {
  els.toast.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { els.toast.hidden = true; action.run(); });
    els.toast.append(b);
  }
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 3500);
}

// ── config ──────────────────────────────────────────────────────────
fetch('/api/config').then((r) => r.json()).then((c) => {
  demoMode = !c.serpapi && !c.etsy;
  els.status.classList.toggle('on', !demoMode);
  els.status.querySelector('span').textContent = demoMode ? 'demo' : c.serpapi && c.etsy ? 'live' : c.etsy ? 'live · etsy only' : 'live · web only';
  els.status.title = demoMode ? 'demo mode: add api keys in .env for live results' : '';
  refreshStale();
}).catch(() => {});

// ── settings: extra costs + fees ────────────────────────────────────
{
  const s = settings();
  els.extra.value = s.extra || '';
  els.fees.checked = s.fees;
  const save = () => {
    store('angels.settings', { extra: Number(els.extra.value) || 0, fees: els.fees.checked });
    if (last) render();
    renderPieces();
    renderKept();
  };
  els.extra.addEventListener('input', save);
  els.fees.addEventListener('change', save);
}

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
  if (ev.target.closest?.('input')) return;
  const item = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { showTab('find'); usePhoto(item.getAsFile()); }
});
els.imageUrl.addEventListener('change', () => {
  const url = els.imageUrl.value.trim();
  if (!url) return;
  photo = thumb = null;
  setActive(null);
  showPreview(url);
});

async function usePhoto(file) {
  photo = await shrink(file, 1024, 0.88);
  thumb = await shrink(file, 400, 0.8);
  els.imageUrl.value = '';
  setActive(null); // a new photo is a new piece
  showPreview(photo);
}

function showPreview(src) {
  els.preview.src = src;
  els.preview.hidden = false;
  els.hint.hidden = true;
}

// longest side ≤ max px, jpeg
function shrink(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ── search ──────────────────────────────────────────────────────────
els.form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  search();
});

async function search() {
  const imageUrl = els.imageUrl.value.trim();
  if (!photo && !imageUrl && !els.keywords.value.trim()) {
    els.results.hidden = false;
    els.notes.textContent = 'add a photo, an image link, or keywords first.';
    return;
  }

  els.go.disabled = true;
  els.go.textContent = 'searching…';
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
        maxPrice: els.show.value === 'all' ? null : els.maxPrice.value || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'search failed');
    data.etsy.forEach((r, i) => (r.rank = i));
    data.web.forEach((r, i) => (r.rank = i));
    last = data;
    render();
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    els.notes.textContent = `search failed: ${err.message}. check your connection and try again.`;
  } finally {
    els.go.disabled = false;
    els.go.textContent = 'search etsy + web';
  }
}

els.sortSeg.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-sort]');
  if (!b) return;
  sortBy = b.dataset.sort;
  els.sortSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (last) render();
});
[els.show, els.hideSold].forEach((el) => el.addEventListener('change', () => last && render()));
els.maxPrice.addEventListener('input', () => last && render());

const stockScore = (r) => r.stock?.qty ?? (r.stock?.level === 'ok' ? 0.5 : -1);
const SORTS = {
  price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  margin: (a, b) => (b.calc?.margin ?? -Infinity) - (a.calc?.margin ?? -Infinity),
  stock: (a, b) => stockScore(b) - stockScore(a),
  match: (a, b) => (a.match === b.match ? a.rank - b.rank : a.match === 'visual' ? -1 : 1),
};

function render() {
  const sale = Number(els.maxPrice.value) || null;
  const show = els.show.value;
  const keep = (r) => {
    if (els.hideSold.checked && r.stock?.level === 'out') return false;
    if (show === 'cheaper' && sale != null && r.price != null && r.price > sale) return false;
    if (show === 'profit' && r.calc && r.calc.profit <= 0) return false;
    return true;
  };
  const prep = (list) => list.map((r) => ({ ...r, calc: breakdown(sale, r.price) })).filter(keep).sort(SORTS[sortBy]);

  const etsy = prep(last.etsy);
  const web = prep(last.web);

  els.notes.textContent = (last.notes || []).join('\n');
  els.etsyCount.textContent = count(etsy.length, last.etsy.length);
  els.webCount.textContent = count(web.length, last.web.length);
  els.savePiece.hidden = Boolean(activePiece);

  fill(els.etsy, etsy, 'no etsy matches with these filters.');
  fill(els.web, web, 'nothing found elsewhere with these filters.');

  els.stores.innerHTML = '';
  const stores = last.stores.filter((s) => show === 'all' || sale == null || s.lowest == null || s.lowest <= sale);
  if (!stores.length) els.stores.innerHTML = '<li class="empty">no other stores at this price.</li>';
  for (const s of stores) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span class="name"></span><span class="n">${s.count} listing${s.count === 1 ? '' : 's'}</span><span class="p">${s.lowest == null ? '—' : 'from ' + money(s.lowest, s.currency)}</span>`;
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

// ── result / supplier card ──────────────────────────────────────────
function card(r, { saved = false } = {}) {
  const piece = saved && r.pieceId ? pieces().find((p) => p.id === r.pieceId) : null;
  const sale = saved ? piece?.myPrice ?? null : Number(els.maxPrice.value) || null;
  const calc = breakdown(sale, r.price);
  const node = els.card.content.firstElementChild.cloneNode(true);

  const img = node.querySelector('img');
  img.src = r.image || (demoMode && (piece?.image || photo)) || r.fallback || PLACEHOLDER;
  img.onerror = () => (img.src = PLACEHOLDER);
  node.querySelector('.thumb').href = r.url;
  const title = node.querySelector('.title');
  title.href = r.url;
  title.textContent = r.title || 'untitled';
  node.querySelector('.store').textContent = r.store;

  const stock = node.querySelector('.stock');
  stock.textContent = r.stock?.label || 'unknown';
  stock.classList.add(r.stock?.level || 'unknown');
  if (r.stock?.level === 'out') node.classList.add('dim');

  // paid vs sale
  node.querySelector('.cost').textContent = r.price == null ? '—' : money(r.price, r.currency);
  node.querySelector('.sale').textContent = sale == null ? '—' : money(sale, r.currency);
  const ledger = node.querySelector('.ledger');
  if (calc) {
    const m = node.querySelector('.margin-n');
    m.innerHTML = `${pct(calc.margin)}<small>margin</small>`;
    const p = node.querySelector('.profit');
    p.textContent = signed(calc.profit, r.currency);
    p.title = `${money(calc.sale)} sale − ${money(calc.paid)} paid − ${money(calc.fees)} fees − ${money(calc.extra)} extra`;
    if (calc.profit < 0) { m.classList.add('loss'); p.classList.add('loss'); }
    const w = (n) => `${Math.max(0, Math.min(100, (n / calc.sale) * 100))}%`;
    const bar = node.querySelector('.mbar');
    bar.querySelector('.b-cost').style.width = w(calc.paid);
    bar.querySelector('.b-fees').style.width = w(Math.min(calc.fees + calc.extra, Math.max(0, calc.sale - calc.paid)));
    bar.querySelector('.b-profit').style.width = w(Math.max(0, calc.profit));
    if (calc.profit < 0) bar.classList.add('loss');
  } else {
    ledger.classList.add('none');
  }

  if (saved) {
    const t = trend(r);
    const te = node.querySelector('.trend');
    te.textContent = t.text || `checked ${ago(r.checked)}`;
    if (t.warn) te.classList.add('warn');
  }
  node.querySelector('.match').textContent = saved ? (r.isEtsy ? 'etsy' : 'web') : r.match === 'similar' ? 'similar' : 'match';

  const btn = node.querySelector('.keep');
  const isKept = () => kept().some((k) => k.id === r.id);
  const paint = () => {
    btn.classList.toggle('on', isKept());
    btn.textContent = isKept() ? '♥' : '♡';
    btn.title = isKept() ? 'remove from suppliers' : 'save as a supplier';
  };
  paint();
  btn.addEventListener('click', () => { toggleKeep(r); paint(); });
  return node;
}

// what changed since we started watching this listing
function trend(r) {
  const h = r.history || [];
  if (h.length < 2) return { text: '' };
  const first = h[0];
  const now = h[h.length - 1];
  const prev = h[h.length - 2];
  if (prev.price != null && now.price != null && now.price < prev.price) {
    return { text: `price ↓ ${money(prev.price - now.price, r.currency)}` };
  }
  if (first.qty == null || now.qty == null) return { text: '' };
  const sold = first.qty - now.qty;
  const elapsed = now.t - first.t;
  if (sold <= 0) return { text: `steady for ${span(elapsed)}` };
  if (now.qty === 0) return { text: 'sold through', warn: true };
  const left = (now.qty / sold) * elapsed;
  return { text: `−${sold} in ${span(elapsed)} · out ~${span(left)}`, warn: left < 7 * 864e5 };
}

// ── suppliers ───────────────────────────────────────────────────────
function toggleKeep(r) {
  const list = kept();
  const i = list.findIndex((k) => k.id === r.id);
  if (i >= 0) {
    list.splice(i, 1);
    setKept(list);
    return;
  }
  const { calc, rank, ...item } = r;
  list.unshift({
    ...item,
    pieceId: activePiece,
    fallback: r.image ? null : thumb,
    checked: Date.now(),
    history: [{ t: Date.now(), qty: r.stock?.qty ?? null, price: r.price }],
  });
  setKept(list);
  const piece = pieces().find((p) => p.id === activePiece);
  toast(piece ? `saved as a supplier for ${piece.name}` : 'saved to suppliers', { label: 'view', run: () => showTab('suppliers') });
}

function renderKept() {
  const list = kept();
  const ps = pieces();
  els.savedCount.textContent = list.length || '';
  els.suppliersBadge.textContent = list.length || '';
  els.savedEmpty.hidden = list.length > 0;
  els.refresh.hidden = !list.length;
  els.saved.innerHTML = '';

  const groups = [...ps.map((p) => ({ name: p.name, items: list.filter((s) => s.pieceId === p.id) })),
    { name: 'not linked to a piece', items: list.filter((s) => !ps.some((p) => p.id === s.pieceId)) }];
  for (const g of groups) {
    if (!g.items.length) continue;
    const h = document.createElement('h3');
    h.textContent = g.name;
    const ul = document.createElement('ul');
    ul.className = 'grid';
    g.items.forEach((r) => ul.append(card(r, { saved: true })));
    els.saved.append(h, ul);
  }
}

// re-check live stock + price for saved etsy listings
async function refreshKept(only = () => true) {
  const list = kept();
  const due = list.filter((r) => r.listingId && only(r));
  if (!due.length) return 0;
  await Promise.all(due.map(async (r) => {
    try {
      const res = await fetch(`/api/etsy/${r.listingId}`);
      if (!res.ok) return;
      const fresh = await res.json();
      r.price = fresh.price;
      r.stock = fresh.stock;
      r.image = fresh.image || r.image;
      r.checked = Date.now();
      r.history = [...(r.history || []), { t: r.checked, qty: fresh.stock?.qty ?? null, price: fresh.price }].slice(-60);
    } catch { /* keep the old numbers */ }
  }));
  setKept(list);
  return due.length;
}

els.refresh.addEventListener('click', async () => {
  els.refresh.textContent = 'checking…';
  const n = await refreshKept();
  els.refresh.textContent = 'refresh stock';
  toast(n ? `re-checked ${n} etsy listing${n === 1 ? '' : 's'}` : 'only etsy listings can be re-checked');
});

function refreshStale() {
  refreshKept((r) => Date.now() - (r.checked || 0) > STALE);
}

// ── my pieces ───────────────────────────────────────────────────────
els.savePiece.addEventListener('click', () => {
  const words = els.keywords.value.trim();
  const piece = {
    id: `p${Date.now().toString(36)}`,
    name: words || `piece ${pieces().length + 1}`,
    image: thumb || els.imageUrl.value.trim() || null,
    imageUrl: els.imageUrl.value.trim() || null,
    keywords: words,
    myPrice: Number(els.maxPrice.value) || null,
    cost: null,
    onHand: 0,
    reorderAt: 2,
    created: Date.now(),
  };
  setPieces([piece, ...pieces()]);
  setActive(piece);
  if (last) render();
  toast(`saved ${piece.name}. ♡ results to add suppliers`, { label: 'view', run: () => showTab('pieces') });
});

function setActive(piece) {
  activePiece = piece?.id || null;
  els.searchingFor.hidden = !piece;
  if (piece) els.searchingFor.textContent = `searching for ${piece.name}. ♡ saves suppliers to it.`;
  if (last) els.savePiece.hidden = Boolean(activePiece);
}

function updatePiece(id, patch) {
  setPieces(pieces().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

const num = (v) => (v === '' || v == null ? null : Number(v));

// what a piece costs you: what you entered, else the cheapest live supplier
function paidFor(p, sup) {
  if (p.cost != null) return { paid: p.cost, est: false };
  const live = sup.filter((s) => s.pieceId === p.id && s.stock?.level !== 'out' && s.price != null);
  if (!live.length) return { paid: null, est: false };
  return { paid: Math.min(...live.map((s) => s.price)), est: true };
}
const statusOf = (p) => (p.onHand === 0 ? 'out' : p.onHand <= p.reorderAt ? 'reorder' : 'stocked');

function renderPieces() {
  const list = pieces();
  const sup = kept();
  els.piecesCount.textContent = list.length || '';
  els.piecesEmpty.hidden = list.length > 0;
  els.piecesTable.hidden = !list.length;
  els.copy.hidden = !list.length && !sup.length;

  // summary
  const low = list.filter((p) => p.onHand <= p.reorderAt);
  const units = list.reduce((n, p) => n + p.onHand, 0);
  let value = 0, cost = 0, profit = 0;
  const margins = [];
  for (const p of list) {
    const { paid } = paidFor(p, sup);
    const b = breakdown(p.myPrice, paid);
    value += p.onHand * (p.myPrice || 0);
    cost += p.onHand * (paid || 0);
    if (b) { profit += p.onHand * b.profit; margins.push(b.margin); }
  }
  els.statUnits.textContent = units;
  els.statUnitsSub.textContent = `across ${list.length} piece${list.length === 1 ? '' : 's'}`;
  els.statReorder.textContent = low.length;
  els.statReorderSub.textContent = low.length ? low.map((p) => p.name).join(', ') : 'all stocked';
  els.statReorderTile.classList.toggle('alert', low.length > 0);
  els.statValue.textContent = round(value);
  els.statValueSub.textContent = `paid ${round(cost)} · at sale price`;
  els.statMargin.textContent = margins.length ? pct(margins.reduce((a, b) => a + b, 0) / margins.length) : '—';
  els.statMarginSub.textContent = margins.length ? `${signed(profit)} profit on hand` : 'add what you paid';

  els.piecesBadge.textContent = low.length || list.length || '';
  els.piecesBadge.classList.toggle('alert', low.length > 0);

  els.pieces.innerHTML = '';
  for (const p of list) {
    const row = els.pieceRow.content.firstElementChild.cloneNode(true);
    const img = row.querySelector('.pthumb');
    img.src = p.image || PLACEHOLDER;
    img.onerror = () => (img.src = PLACEHOLDER);

    const name = row.querySelector('.pname');
    name.value = p.name;
    name.addEventListener('change', () => updatePiece(p.id, { name: name.value.trim() || p.name }));

    const { paid, est } = paidFor(p, sup);
    const costIn = row.querySelector('.pcost');
    costIn.value = p.cost ?? '';
    if (est) costIn.placeholder = paid.toFixed(2);
    costIn.addEventListener('change', () => updatePiece(p.id, { cost: num(costIn.value) }));

    const price = row.querySelector('.pprice');
    price.value = p.myPrice ?? '';
    price.addEventListener('change', () => updatePiece(p.id, { myPrice: num(price.value) }));

    const b = breakdown(p.myPrice, paid);
    const mn = row.querySelector('.pm-n');
    const ms = row.querySelector('.pm-s');
    if (b) {
      mn.textContent = pct(b.margin);
      ms.textContent = `${signed(b.profit)} each${est ? ' · est.' : ''}`;
      ms.title = est ? 'using your cheapest supplier. enter what you paid for the real margin' : '';
      if (b.profit < 0) mn.classList.add('loss');
    } else {
      mn.textContent = '—';
      ms.textContent = p.myPrice ? 'add what you paid' : 'add a sale price';
    }

    const onHand = row.querySelector('.ponhand');
    onHand.value = p.onHand;
    onHand.addEventListener('change', () => updatePiece(p.id, { onHand: Math.max(0, Math.round(Number(onHand.value) || 0)) }));
    row.querySelector('.minus').addEventListener('click', () => updatePiece(p.id, { onHand: Math.max(0, p.onHand - 1) }));
    row.querySelector('.plus1').addEventListener('click', () => updatePiece(p.id, { onHand: p.onHand + 1 }));

    const reorder = row.querySelector('.preorder');
    reorder.value = p.reorderAt;
    reorder.addEventListener('change', () => updatePiece(p.id, { reorderAt: Math.max(0, Math.round(Number(reorder.value) || 0)) }));

    const state = row.querySelector('.pstate');
    const st = statusOf(p);
    state.textContent = st;
    state.classList.add({ out: 'out', reorder: 'low', stocked: 'ok' }[st]);

    const mine = sup.filter((s) => s.pieceId === p.id);
    const live = mine.filter((s) => s.stock?.level !== 'out');
    const cheapest = live.reduce((m, s) => (s.price != null && (m == null || s.price < m.price) ? s : m), null);
    const avail = live.reduce((n, s) => n + (s.stock?.qty || 0), 0);
    const bits = [`${mine.length} supplier${mine.length === 1 ? '' : 's'}`];
    if (cheapest) bits.push(`from ${money(cheapest.price, cheapest.currency)}`);
    if (avail) bits.push(`≈ ${avail} available`);
    if (mine.length && !live.length) bits.push('all sold out');
    row.querySelector('.psup').textContent = bits.join(' · ');

    row.querySelector('.again').addEventListener('click', () => searchAgain(p));

    const remove = row.querySelector('.remove');
    remove.addEventListener('click', () => {
      if (remove.dataset.armed) {
        setPieces(pieces().filter((x) => x.id !== p.id));
        setKept(kept().map((s) => (s.pieceId === p.id ? { ...s, pieceId: null } : s)));
        if (activePiece === p.id) setActive(null);
      } else {
        remove.dataset.armed = '1';
        remove.textContent = 'tap again to remove';
        setTimeout(() => { delete remove.dataset.armed; remove.textContent = 'remove'; }, 3000);
      }
    });

    els.pieces.append(row);
  }
}

function searchAgain(p) {
  showTab('find');
  els.keywords.value = p.keywords || p.name;
  els.maxPrice.value = p.myPrice ?? '';
  els.imageUrl.value = p.imageUrl || '';
  photo = p.imageUrl ? null : p.image;
  thumb = p.image;
  if (p.image) showPreview(p.image);
  setActive(p);
  search();
}

// ── copy for spreadsheet (tab-separated, pastes into sheets / excel) ─
els.copy.addEventListener('click', async () => {
  const ps = pieces();
  const sup = kept();
  const rows = [['piece', 'paid', 'sale price', 'profit each', 'margin', 'on hand', 'reorder at', 'status', 'supplier', 'store', 'supplier price', 'stock', 'link']];
  const line = (p, s) => {
    const { paid } = p ? paidFor(p, sup) : { paid: null };
    const b = p ? breakdown(p.myPrice, paid) : null;
    return [p?.name ?? '', paid ?? '', p?.myPrice ?? '', b ? b.profit.toFixed(2) : '', b ? `${Math.round(b.margin * 100)}%` : '',
      p?.onHand ?? '', p?.reorderAt ?? '', p ? statusOf(p) : '',
      s?.title ?? '', s?.store ?? '', s?.price ?? '', s?.stock?.label ?? '', s?.url ?? ''];
  };
  for (const p of ps) {
    const mine = sup.filter((s) => s.pieceId === p.id);
    if (!mine.length) rows.push(line(p, null));
    mine.forEach((s) => rows.push(line(p, s)));
  }
  sup.filter((s) => !ps.some((p) => p.id === s.pieceId)).forEach((s) => rows.push(line(null, s)));
  const text = rows.map((r) => r.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');

  try {
    await navigator.clipboard.writeText(text);
    toast(`copied ${rows.length - 1} rows. paste into google sheets or excel`);
  } catch {
    toast('your browser blocked copying. try another browser.');
  }
});

renderPieces();
renderKept();
