const $ = (id) => document.getElementById(id);
const els = {
  form: $('form'), drop: $('drop'), file: $('file'), preview: $('preview'), hint: $('hint'),
  imageUrl: $('imageUrl'), maxPrice: $('maxPrice'), keywords: $('keywords'), searchingFor: $('searchingFor'),
  go: $('go'), status: $('status'), results: $('results'), notes: $('notes'),
  sort: $('sort'), show: $('show'), hideSold: $('hideSold'), savePiece: $('savePiece'),
  etsy: $('etsy'), web: $('web'), stores: $('stores'), etsyCount: $('etsyCount'), webCount: $('webCount'),
  saved: $('saved'), savedBlock: $('savedBlock'), savedCount: $('savedCount'), refresh: $('refresh'),
  pieces: $('pieces'), piecesEmpty: $('piecesEmpty'), piecesCount: $('piecesCount'), reorderCount: $('reorderCount'),
  copy: $('copy'), card: $('card'), pieceRow: $('pieceRow'),
};

const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="7" fill="none" stroke="#d9d3ca" stroke-width=".8"/><circle cx="20" cy="13" r="1.4" fill="#d9d3ca"/></svg>`
);
const STALE = 6 * 60 * 60 * 1000; // re-check supplier stock when older than this

let photo = null;      // resized data url of the uploaded photo
let thumb = null;      // small copy kept with a saved piece
let last = null;       // last search response
let activePiece = null; // id of the piece the current search is for

// ── storage (this browser only) ─────────────────────────────────────
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function store(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage blocked or full */ }
}
const pieces = () => load('angels.pieces');
const kept = () => load('angels.kept');
const setPieces = (list) => { store('angels.pieces', list); renderPieces(); };
const setKept = (list) => { store('angels.kept', list); renderKept(); renderPieces(); };

// ── money ───────────────────────────────────────────────────────────
// etsy seller fees on a sale: 6.5% transaction, 3% + $0.25 payment processing, $0.20 listing
const fees = (p) => p * 0.095 + 0.45;
const profitOf = (sell, cost) => (sell == null || cost == null ? null : sell - cost - fees(sell));

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

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

const span = (ms) => (ms < 36e5 ? `${Math.max(1, Math.round(ms / 6e4))}m` : ms < 864e5 ? `${Math.round(ms / 36e5)}h` : `${Math.round(ms / 864e5)}d`);

// ── config ──────────────────────────────────────────────────────────
let demoMode = false;
fetch('/api/config').then((r) => r.json()).then((c) => {
  demoMode = !c.serpapi && !c.etsy;
  const on = (x) => (x ? '<b>on</b>' : 'off');
  els.status.innerHTML = demoMode
    ? 'demo mode · add keys to .env for live results'
    : `image search ${on(c.serpapi)} · etsy stock ${on(c.etsy)}`;
  refreshStale();
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
  if (ev.target.closest?.('input')) return;
  const item = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) usePhoto(item.getAsFile());
});
els.imageUrl.addEventListener('change', () => {
  const url = els.imageUrl.value.trim();
  if (!url) return;
  photo = thumb = null;
  newSearch();
  showPreview(url);
});

async function usePhoto(file) {
  photo = await shrink(file, 1024, 0.88);
  thumb = await shrink(file, 400, 0.8);
  els.imageUrl.value = '';
  newSearch();
  showPreview(photo);
}

// a new photo means a new piece, unless "search again" set one
function newSearch() {
  activePiece = null;
  els.searchingFor.hidden = true;
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
    els.notes.textContent = 'add a photo, an image link, or a few words first';
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
        maxPrice: els.show.value === 'cheaper' ? els.maxPrice.value || null : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'search failed');
    data.etsy.forEach((r, i) => (r.rank = i));
    data.web.forEach((r, i) => (r.rank = i));
    last = data;
    render();
  } catch (err) {
    els.notes.textContent = `search failed: ${err.message}. check your connection and try again.`;
  } finally {
    els.go.disabled = false;
  }
}

[els.sort, els.show, els.hideSold].forEach((el) => el.addEventListener('change', () => last && render()));
els.maxPrice.addEventListener('input', () => last && render());

const SORTS = {
  price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  profit: (a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity),
  stock: (a, b) => (b.stock?.qty ?? (b.stock?.level === 'ok' ? 0.5 : -1)) - (a.stock?.qty ?? (a.stock?.level === 'ok' ? 0.5 : -1)),
  match: (a, b) => (a.match === b.match ? a.rank - b.rank : a.match === 'visual' ? -1 : 1),
};

function render() {
  const sell = Number(els.maxPrice.value) || null;
  const show = els.show.value;
  const keep = (r) => {
    if (els.hideSold.checked && r.stock?.level === 'out') return false;
    if (show === 'cheaper' && sell != null && r.price != null && r.price > sell) return false;
    if (show === 'profit' && sell != null && r.price != null && profitOf(sell, r.price) <= 0) return false;
    return true;
  };
  const prep = (list) => list.map((r) => ({ ...r, profit: profitOf(sell, r.price) })).filter(keep).sort(SORTS[els.sort.value]);

  const etsy = prep(last.etsy);
  const web = prep(last.web);

  els.notes.textContent = (last.notes || []).join('\n');
  els.etsyCount.textContent = count(etsy.length, last.etsy.length);
  els.webCount.textContent = count(web.length, last.web.length);
  els.savePiece.hidden = Boolean(activePiece);

  fill(els.etsy, etsy, 'no etsy matches with these filters');
  fill(els.web, web, 'nothing found elsewhere with these filters');

  els.stores.innerHTML = '';
  const stores = last.stores.filter((s) => show === 'all' || sell == null || s.lowest == null || s.lowest <= sell);
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

// ── result / supplier card ──────────────────────────────────────────
function card(r, { saved = false } = {}) {
  const piece = saved && r.pieceId ? pieces().find((p) => p.id === r.pieceId) : null;
  const sell = saved ? piece?.myPrice ?? null : Number(els.maxPrice.value) || null;
  const node = els.card.content.firstElementChild.cloneNode(true);

  const img = node.querySelector('img');
  img.src = r.image || (demoMode && (photo || piece?.image)) || r.fallback || PLACEHOLDER;
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

  const profit = profitOf(sell, r.price);
  const pe = node.querySelector('.profit');
  if (profit != null) {
    pe.textContent = `${profit >= 0 ? '+' : '−'}${money(Math.abs(profit), r.currency)} · ${profit < 0 ? '−' : ''}${Math.abs(Math.round((profit / sell) * 100))}%`;
    pe.classList.add(profit > 0 ? 'gain' : 'loss');
    pe.title = `profit if you sell at ${money(sell, r.currency)} after etsy fees`;
  }

  if (saved) {
    const t = trend(r);
    const te = node.querySelector('.trend');
    te.textContent = t.text;
    if (t.warn) te.classList.add('warn');
  }

  const match = node.querySelector('.match');
  if (saved) {
    match.textContent = piece ? `for ${piece.name}` : `saved ${ago(r.checked)}`;
    match.title = r.checked ? `checked ${ago(r.checked)}` : '';
  } else {
    match.textContent = r.match === 'similar' ? 'similar' : 'match';
  }
  if (sell != null && r.price != null && r.price <= sell && !saved) node.querySelector('.deal').hidden = false;

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
    return { text: `price ↓ ${money(prev.price - now.price, r.currency)}`, warn: false };
  }
  if (first.qty == null || now.qty == null) return { text: '' };
  const sold = first.qty - now.qty;
  const elapsed = now.t - first.t;
  if (sold <= 0) return { text: `steady ${span(elapsed)}` };
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
  } else {
    const { profit, rank, ...item } = r;
    list.unshift({
      ...item,
      pieceId: activePiece,
      fallback: r.image ? null : thumb,
      checked: Date.now(),
      history: [{ t: Date.now(), qty: r.stock?.qty ?? null, price: r.price }],
    });
  }
  setKept(list);
}

function renderKept() {
  const list = kept();
  els.savedBlock.hidden = !list.length;
  els.savedCount.textContent = list.length || '';
  els.saved.innerHTML = '';
  list.forEach((r) => els.saved.append(card(r, { saved: true })));
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
  els.refresh.textContent = n ? 'refresh stock' : 'only etsy listings can be re-checked';
  if (!n) setTimeout(() => (els.refresh.textContent = 'refresh stock'), 2500);
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
    onHand: 0,
    reorderAt: 2,
    created: Date.now(),
  };
  setPieces([piece, ...pieces()]);
  setActive(piece);
  if (last) render();
});

function setActive(piece) {
  activePiece = piece?.id || null;
  els.searchingFor.hidden = !piece;
  if (piece) els.searchingFor.textContent = `searching for · ${piece.name} — hearts save suppliers to this piece`;
}

function updatePiece(id, patch) {
  setPieces(pieces().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

function renderPieces() {
  const list = pieces();
  const sup = kept();
  els.piecesCount.textContent = list.length || '';
  els.piecesEmpty.hidden = list.length > 0;
  els.copy.hidden = !list.length && !sup.length;

  const low = list.filter((p) => p.onHand <= p.reorderAt);
  els.reorderCount.hidden = !low.length;
  els.reorderCount.textContent = `${low.length} to reorder`;

  els.pieces.innerHTML = '';
  for (const p of list) {
    const row = els.pieceRow.content.firstElementChild.cloneNode(true);
    const img = row.querySelector('.pthumb');
    img.src = p.image || PLACEHOLDER;
    img.onerror = () => (img.src = PLACEHOLDER);

    const name = row.querySelector('.pname');
    name.value = p.name;
    name.addEventListener('change', () => updatePiece(p.id, { name: name.value.trim() || p.name }));

    const price = row.querySelector('.pprice');
    price.value = p.myPrice ?? '';
    price.addEventListener('change', () => updatePiece(p.id, { myPrice: Number(price.value) || null }));

    const onHand = row.querySelector('.ponhand');
    onHand.value = p.onHand;
    onHand.addEventListener('change', () => updatePiece(p.id, { onHand: Math.max(0, Math.round(Number(onHand.value) || 0)) }));
    row.querySelector('.minus').addEventListener('click', () => updatePiece(p.id, { onHand: Math.max(0, p.onHand - 1) }));
    row.querySelector('.plus1').addEventListener('click', () => updatePiece(p.id, { onHand: p.onHand + 1 }));

    const reorder = row.querySelector('.preorder');
    reorder.value = p.reorderAt;
    reorder.addEventListener('change', () => updatePiece(p.id, { reorderAt: Math.max(0, Math.round(Number(reorder.value) || 0)) }));

    const state = row.querySelector('.pstate');
    const mine = sup.filter((s) => s.pieceId === p.id);
    if (p.onHand === 0) { state.textContent = 'out'; state.classList.add('out'); }
    else if (p.onHand <= p.reorderAt) { state.textContent = 'reorder'; state.classList.add('low'); }
    else { state.textContent = 'stocked'; state.classList.add('ok'); }

    const live = mine.filter((s) => s.stock?.level !== 'out');
    const cheapest = live.reduce((m, s) => (s.price != null && (m == null || s.price < m.price) ? s : m), null);
    const avail = live.reduce((n, s) => n + (s.stock?.qty || 0), 0);
    const bits = [`${mine.length} supplier${mine.length === 1 ? '' : 's'}`];
    if (cheapest) {
      const pr = profitOf(p.myPrice, cheapest.price);
      bits.push(`from ${money(cheapest.price, cheapest.currency)}${pr != null ? ` (${pr >= 0 ? '+' : '−'}${money(Math.abs(pr))})` : ''}`);
    }
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
        remove.textContent = 'sure?';
        setTimeout(() => { delete remove.dataset.armed; remove.textContent = 'remove'; }, 3000);
      }
    });

    els.pieces.append(row);
  }
}

function searchAgain(p) {
  els.keywords.value = p.keywords || p.name;
  els.maxPrice.value = p.myPrice ?? '';
  els.imageUrl.value = p.imageUrl || '';
  photo = p.imageUrl ? null : p.image;
  thumb = p.image;
  if (p.image) showPreview(p.image);
  setActive(p);
  els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  search();
}

// ── copy for spreadsheet (tab-separated, pastes into sheets / excel) ─
els.copy.addEventListener('click', async () => {
  const ps = pieces();
  const rows = [['piece', 'sell price', 'on hand', 'reorder at', 'status', 'supplier', 'store', 'their price', 'profit', 'stock', 'link']];
  const line = (p, s) => {
    const status = !p ? '' : p.onHand === 0 ? 'out' : p.onHand <= p.reorderAt ? 'reorder' : 'stocked';
    const pr = p && s ? profitOf(p.myPrice, s.price) : null;
    return [p?.name ?? '', p?.myPrice ?? '', p?.onHand ?? '', p?.reorderAt ?? '', status,
      s?.title ?? '', s?.store ?? '', s?.price ?? '', pr == null ? '' : pr.toFixed(2), s?.stock?.label ?? '', s?.url ?? ''];
  };
  const sup = kept();
  for (const p of ps) {
    const mine = sup.filter((s) => s.pieceId === p.id);
    if (!mine.length) rows.push(line(p, null));
    mine.forEach((s) => rows.push(line(p, s)));
  }
  sup.filter((s) => !ps.some((p) => p.id === s.pieceId)).forEach((s) => rows.push(line(null, s)));
  const text = rows.map((r) => r.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');

  try {
    await navigator.clipboard.writeText(text);
    els.copy.textContent = 'copied · paste into a sheet';
  } catch {
    els.copy.textContent = 'copy blocked by the browser';
  }
  setTimeout(() => (els.copy.textContent = 'copy for spreadsheet'), 2500);
});

renderPieces();
renderKept();
