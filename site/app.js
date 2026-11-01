import { DEFAULT_SETTINGS, TIER_NAMES, packModel, simulate, productEV, acquire, cardOdds, buyPrice } from './ev.js';

// ---------- Estado y utilidades ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('sj-' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sj-' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem('sj-' + k); } catch { /* nada */ } }
};
let S = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
let OV = store.get('overrides', {});
let INDEX = null, FACTORS = null;
const SETS = new Map();
const app = document.getElementById('app');

const eur = (v, d = 2) => (v == null || !isFinite(v) ? '–' : v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €');
const pct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v * 100).toLocaleString('es-ES', { maximumFractionDigits: d }) + ' %');
const int = v => Math.round(v).toLocaleString('es-ES');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hashId = id => id.replace(/\./g, '_');
const unhash = h => h.replace(/_/g, '.');
const fmtDate = d => d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function cardImg(img, name, n, size = 'low', cls = '') {
  const ph = `<span class="ph"><b>${esc(name)}</b>${n ? `#${esc(n)}` : ''}</span>`;
  if (!img) return `<div class="cimg ${cls}">${ph}</div>`;
  return `<div class="cimg ${cls}">${ph}<img src="${esc(img)}/${size}.webp" alt="${esc(name)}" loading="lazy" decoding="async" onerror="this.remove()"></div>`;
}

async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); }
async function loadSet(id) {
  if (SETS.has(id)) return SETS.get(id);
  const set = await getJSON(`data/sets/${id}.json`);
  const savedP = store.get('products-' + id, null);
  if (savedP) set.products = savedP;
  const savedR = store.get('rates-' + id, null);
  if (savedR && set.rates) { set.rates = { ...set.rates, rare: savedR.rare, hit: savedR.hit }; set.ratesEdited = true; }
  SETS.set(id, set); return set;
}
const modelFor = set => set.rates ? packModel(set, set.rates, S, FACTORS, OV) : null;

function verdictChip(ratio) {
  if (ratio == null) return '<span class="chip neutral">Sin probabilidades</span>';
  if (ratio >= 1) return '<span class="chip good">Por debajo de su valor</span>';
  if (ratio >= 0.8) return '<span class="chip warn">Cerca de su valor</span>';
  return '<span class="chip bad">Caro para abrir</span>';
}

// Efecto holográfico al mover el puntero sobre una carta
function holo(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('.holo').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', ((x - .5) * 16).toFixed(1) + 'deg'); el.style.setProperty('--rx', ((.5 - y) * 16).toFixed(1) + 'deg');
      el.style.setProperty('--mx', (x * 100).toFixed(0) + '%'); el.style.setProperty('--my', (y * 100).toFixed(0) + '%'); el.classList.add('on');
    });
    el.addEventListener('pointerleave', () => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.classList.remove('on'); });
  });
}

// ---------- Buscador global ----------
function searchCards(q, limit = 12) {
  const terms = norm(q).split(/\s+/).filter(Boolean); if (!terms.length) return [];
  const setName = new Map(INDEX.sets.map(s => [s.id, s.name]));
  const res = [];
  for (const c of INDEX.cards) {
    const hay = norm(c[3] + ' ' + c[4] + ' ' + c[2] + ' ' + String(parseInt(c[2], 10)) + ' ' + setName.get(c[1]));
    if (terms.every(t => hay.includes(t))) res.push(c);
  }
  res.sort((a, b) => (b[7] ?? 0) - (a[7] ?? 0));
  return res.slice(0, limit).map(c => ({ id: c[0], set: c[1], n: c[2], name: c[3], r: c[5], img: c[6], trend: c[7], setName: setName.get(c[1]) }));
}
function bindSearch(input, box) {
  let sel = -1, items = [];
  const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); sel = -1; };
  const draw = () => {
    items = searchCards(input.value);
    if (!input.value.trim()) return close();
    box.innerHTML = items.length ? items.map((c, i) => `<a class="qitem" role="option" id="qopt-${i}" aria-selected="${i === sel}" href="#carta-${hashId(c.id)}">
        ${cardImg(c.img, c.name, '', 'low')}<span class="t"><b>${esc(c.name)}</b><span>${esc(c.setName)} · #${esc(c.n)} · <span class="rar ${c.r}">${c.r}</span></span></span>
        <span class="num">${eur(c.trend)}</span></a>`).join('') : '<p class="qempty">No hay cartas con ese nombre. Prueba con el nombre en inglés o el número.</p>';
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', draw);
  input.addEventListener('focus', () => input.value.trim() && draw());
  input.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items.length) { location.hash = 'carta-' + hashId(items[Math.max(sel, 0)].id); close(); input.blur(); }
    else if (e.key === 'Escape') close();
  });
  box.addEventListener('click', e => { if (e.target.closest('a')) { close(); input.value = ''; } });
  document.addEventListener('click', e => { if (!box.contains(e.target) && e.target !== input) close(); });
}

// ---------- Inicio ----------
function renderHome() {
  const sets = INDEX.sets;
  const rated = sets.filter(s => s.hasRates);
  const popular = INDEX.cards.filter(c => c[7]).sort((a, b) => b[7] - a[7]).slice(0, 5);
  app.innerHTML = `
  <section class="hero">
    <span class="eyebrow">Pokémon TCG · cartas en español · ${sets.length} colecciones</span>
    <h1>¿Abres sobres o compras la carta suelta?</h1>
    <p>Calculamos cuánto vale de verdad cada sobre y cada producto sellado, y cuánto te costaría conseguir una carta concreta abriendo sobres frente a comprarla suelta.</p>
    <div class="hero-search search" role="search">
      <input type="search" id="hq" placeholder="¿Qué carta buscas?" autocomplete="off" aria-label="Buscar carta" aria-controls="hqres" aria-expanded="false">
      <div class="qres" id="hqres" role="listbox" hidden></div>
    </div>
    <div class="examples"><span class="hint">Las más cotizadas:</span>${popular.map(c => `<a class="pill" href="#carta-${hashId(c[0])}">${esc(c[3])} <span class="muted">#${esc(c[2])}</span></a>`).join('')}</div>
  </section>
  <section class="section">
    <div class="sechead"><div><h2>Colecciones</h2><p class="hint">${rated.length} con probabilidades medidas; en el resto puedes buscar cartas y precios.</p></div></div>
    <div class="sets">${sets.map(s => {
      const ratio = s.evPack && s.packPrice ? s.evPack / s.packPrice : null;
      return `<a class="setcard" href="#set-${hashId(s.id)}">
        ${s.top ? cardImg(s.top.img, s.top.name, '', 'low') : '<div class="cimg"></div>'}
        <div style="min-width:0;display:grid;gap:3px">
          ${s.logo ? `<img class="logo" src="${esc(s.logo)}.png" alt="" loading="lazy" onerror="this.remove()">` : ''}
          <span class="name">${esc(s.name)}</span>
          <span class="meta">${esc(s.serie)} · ${fmtDate(s.releaseDate)} · ${s.total} cartas</span>
          <span class="ev">${s.evPack != null ? `<span class="num">${eur(s.evPack)}</span><span class="hint">por sobre</span>` : ''}${verdictChip(ratio)}</span>
        </div></a>`; }).join('')}</div>
  </section>`;
  bindSearch(document.getElementById('hq'), document.getElementById('hqres'));
  document.title = 'SobreJusto';
}

// ---------- Colección ----------
let selectedProduct = null;
async function renderSet(id) {
  const set = await loadSet(id);
  const M = modelFor(set);
  document.title = set.name + ' · SobreJusto';
  const pack = set.products.find(p => p.id === 'pack') || set.products[0];
  if (!selectedProduct || !set.products.some(p => p.id === selectedProduct)) selectedProduct = (set.products.find(p => p.id === 'etb') || pack).id;

  const head = `<section class="sethead">
    <div style="display:grid;gap:10px;min-width:0">
      <div class="crumbs"><a href="#">Colecciones</a> / ${esc(set.serie)}</div>
      ${set.logo ? `<img class="logo" src="${esc(set.logo)}.png" alt="" onerror="this.remove()">` : ''}
      <h1>${esc(set.name)}</h1>
      <div class="facts"><span>${esc(set.nameEn)}</span><span>${fmtDate(set.releaseDate)}</span><span>${set.total} cartas</span>${set.priceUpdated ? `<span>Precios del ${fmtDate(set.priceUpdated)}</span>` : ''}</div>
    </div>
  </section>`;

  if (!M) {
    app.innerHTML = head + `<section class="section"><div class="panel"><h2>Sin probabilidades de apertura</h2>
      <p>Todavía no hay datos fiables de cuántas veces sale cada rareza en esta colección, así que no podemos calcular el valor de un sobre. Puedes consultar todas sus cartas y precios abajo.</p></div></section>` + cardsSection(set, null);
    bindCards(set, null); return;
  }
  const ratio = M.net / pack.price;
  app.innerHTML = head + `
  <section class="section">
    <div class="kpis">
      <div class="kpi hero-k"><span class="l">Valor neto por sobre</span><span class="v">${eur(M.net)}</span><span class="l">tras comisiones, envío y bulk</span></div>
      <div class="kpi"><span class="l">Valor bruto de mercado</span><span class="v">${eur(M.gross)}</span><span class="l">sin descuentos ni comisiones</span></div>
      <div class="kpi"><span class="l">Precio de un sobre</span><span class="v">${eur(pack.price)}</span><span class="l">editable abajo</span></div>
      <div class="kpi"><span class="l">Recuperas por cada €</span><span class="v">${ratio.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €</span><span class="l">${ratio >= 1 ? 'abrir sale a cuenta de media' : 'pierdes ' + eur(pack.price - M.net) + ' por sobre de media'}</span></div>
    </div>
  </section>
  <section class="section">
    <div class="panel">
      <div class="sechead"><div><h2>Productos sellados</h2><p class="hint">Pon el precio que te piden, los sobres que trae y el valor de las promos. Pulsa una fila para ver su simulación.</p></div>
        <button class="btn" id="addProd">Añadir producto</button></div>
      <div class="tablewrap"><table id="prodTable"><thead><tr><th>Producto</th><th class="r">Sobres</th><th class="r">Promo €</th><th class="r">Precio €</th><th class="r">Valor neto</th><th class="r">Diferencia</th><th class="r">Recuperas</th><th>Veredicto</th></tr></thead><tbody></tbody></table></div>
      <p class="hint">"Valor neto" es también el precio máximo que puedes pagar sin perder dinero de media. "Recuperas" es la probabilidad de sacar al menos lo que pagaste (20.000 aperturas simuladas).${set.productsChecked ? ` Precios de referencia revisados el ${fmtDate(set.productsChecked)}.` : ' Los precios por defecto son orientativos.'}</p>
    </div>
  </section>
  <section class="section"><div class="panel" id="simPanel"></div></section>
  <section class="section">
    <div class="panel">
      <div class="sechead"><div><h2>Las cartas que mueven el valor</h2><p class="hint" id="concNote"></p></div></div>
      <div class="top-cards" id="topCards"></div>
    </div>
  </section>
  <section class="section two">
    <div class="panel"><h2>De dónde sale el valor de un sobre</h2><div class="bars" id="tierBars"></div></div>
    <div class="panel">
      <div class="sechead"><h2>Probabilidades</h2>${set.ratesEdited ? '<button class="btn" id="resetRates">Restaurar</button>' : ''}</div>
      <p class="hint">1 de cada X sobres. Fuente: ${esc(set.rates.source)}${set.rates.sample ? ` (${int(set.rates.sample)} sobres)` : ''}. Son estimaciones; puedes ajustarlas.${set.rates.note ? ' ' + esc(set.rates.note) : ''}</p>
      <div class="rates">${[...Object.entries(set.rates.rare || {}), ...Object.entries(set.rates.hit || {})].map(([t, x]) =>
        `<label class="field">${esc(TIER_NAMES[t] || t)}<input type="number" min="1" step="1" id="rate-${t}" data-t="${t}" value="${x}"></label>`).join('')}</div>
      ${M.missing.length ? `<p class="hint">No se encontraron cartas de: ${M.missing.map(t => TIER_NAMES[t] || t).join(', ')}.</p>` : ''}
      ${set.rates.godPack ? `<p class="hint">Esta colección tiene god pack (${Object.entries(set.rates.godPack.contents).map(([t, n]) => n + ' ' + (TIER_NAMES[t] || t)).join(' + ')}). Su frecuencia no está medida: actívalo en Ajustes si quieres incluirlo.</p>` : ''}
    </div>
  </section>` + cardsSection(set, M);

  // Productos y simulación
  const tb = app.querySelector('#prodTable tbody');
  const sims = {};
  set.products.forEach(pr => sims[pr.id] = simulate(M, pr, 20000));
  tb.innerHTML = set.products.map(pr => {
    const ev = productEV(M, pr), r = ev / pr.price, sim = sims[pr.id];
    return `<tr class="click${pr.id === selectedProduct ? ' sel' : ''}" data-id="${esc(pr.id)}">
      <td>${esc(pr.name)}</td><td class="r"><input type="number" id="packs-${esc(pr.id)}" data-k="packs" step="1" min="1" value="${pr.packs}" aria-label="Sobres"></td>
      <td class="r"><input type="number" id="promo-${esc(pr.id)}" data-k="promo" step="0.5" min="0" value="${pr.promo}" aria-label="Valor de la promo"></td>
      <td class="r"><input type="number" id="price-${esc(pr.id)}" data-k="price" step="0.5" min="0" value="${pr.price}" aria-label="Precio"></td>
      <td class="r num">${eur(ev)}</td><td class="r num" style="color:var(${ev >= pr.price ? '--good' : '--bad'})">${ev >= pr.price ? '+' : ''}${eur(ev - pr.price)}</td>
      <td class="r num">${pct(sim.win)}</td><td>${verdictChip(r)}</td></tr>`; }).join('');
  tb.querySelectorAll('tr').forEach(tr => tr.addEventListener('click', e => { if (e.target.tagName === 'INPUT') return; selectedProduct = tr.dataset.id; renderSet(id); }));
  tb.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    const pr = set.products.find(p => p.id === inp.closest('tr').dataset.id); pr[inp.dataset.k] = inp.dataset.k === 'packs' ? Math.max(1, Math.round(+inp.value || 1)) : Math.max(0, +inp.value || 0);
    store.set('products-' + id, set.products); renderSet(id); }));
  app.querySelector('#addProd').addEventListener('click', () => {
    const packs = 3;
    set.products.push({ id: 'p' + Date.now(), name: `Producto de ${packs} sobres`, packs, promo: 0, price: Math.round(packs * pack.price * 100) / 100 });
    store.set('products-' + id, set.products); renderSet(id); });
  drawSim(set, M, sims[selectedProduct]);

  // Contribución por rareza
  const entries = Object.entries(M.contrib).filter(([, v]) => v > 0.0005).sort((a, b) => b[1] - a[1]);
  const mx = Math.max(...entries.map(e => e[1]));
  app.querySelector('#tierBars').innerHTML = entries.map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span><span class="track"><span class="fill ${/Bulk|normal|Reverse/.test(k) ? '' : 'hit'}" style="width:${v / mx * 100}%"></span></span><span class="num" style="text-align:right">${eur(v, 3)}</span><span class="num pct muted" style="text-align:right">${pct(v / M.net)}</span></div>`).join('');

  // Cartas top por aportación
  const per = [];
  for (const [t, d] of Object.entries(M.tiers)) d.pool.forEach((c, i) => per.push({ c, v: d.p / d.pool.length * d.net[i], odds: d.pool.length / d.p }));
  per.sort((a, b) => b.v - a.v);
  const top = per.slice(0, 12);
  app.querySelector('#topCards').innerHTML = top.map(o => `<a class="ccard" href="#carta-${hashId(o.c.id)}">${cardImg(o.c.img, o.c.name, o.c.n, 'low', 'holo')}
    <span class="info"><b>${esc(o.c.name)}</b><span class="row"><span class="num">${eur(buyPrice(o.c, S, FACTORS, OV))}</span><span class="rar ${o.c.r}">${o.c.r}</span></span>
    <span class="hint">1 de cada ${int(o.odds)} · ${pct(o.v / M.net)} del valor</span></span></a>`).join('');
  const top3 = per.slice(0, 3).reduce((a, o) => a + o.v, 0);
  app.querySelector('#concNote').textContent = `Las 3 primeras aportan el ${pct(top3 / M.net)} del valor neto de un sobre. Si ${top[0].c.name} bajara un 30 %, cada sobre valdría ${eur(top[0].v * 0.3)} menos.`;

  // Probabilidades editables
  app.querySelectorAll('.rates input').forEach(inp => inp.addEventListener('change', () => {
    const t = inp.dataset.t, x = Math.max(1, +inp.value || 1);
    if (t in (set.rates.rare || {})) set.rates.rare[t] = x; else set.rates.hit[t] = x;
    store.set('rates-' + id, { rare: set.rates.rare, hit: set.rates.hit }); set.ratesEdited = true; renderSet(id); }));
  app.querySelector('#resetRates')?.addEventListener('click', () => { store.del('rates-' + id); SETS.delete(id); renderSet(id); });

  bindCards(set, M); holo(app);
}

function drawSim(set, M, sim) {
  const pr = set.products.find(p => p.id === selectedProduct);
  const edges = [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, 1.25, 1.5, 2, 3, 5, Infinity];
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of sim.values) { const r = v / pr.price; for (let i = 0; i < counts.length; i++) if (r < edges[i + 1]) { counts[i]++; break; } }
  const N = sim.values.length, W = 720, H = 230, L = 38, B = 38, T = 14, R = 8, n = counts.length, bw = (W - L - R) / n;
  const ymax = Math.max(0.1, Math.ceil(Math.max(...counts) / N * 10) / 10);
  let s = '';
  for (let k = 0; k <= 4; k++) { const y = T + (H - T - B) * (1 - k / 4); s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 6}" y="${y + 3}" text-anchor="end">${Math.round(ymax * k / 4 * 100)}%</text>`; }
  counts.forEach((c, i) => { const f = c / N, h = (H - T - B) * f / ymax, x = L + i * bw + 2, y = H - B - h, loss = edges[i + 1] <= 1;
    s += `<rect x="${x}" y="${y}" width="${bw - 4}" height="${Math.max(h, 0)}" rx="2" fill="var(${loss ? '--bad' : '--good'})" opacity="${loss ? .75 : .9}"><title>${pct(f)} de las aperturas</title></rect>`;
    const lab = edges[i + 1] === Infinity ? '>5×' : edges[i] < 1 ? Math.round(edges[i] * 100) + '%' : edges[i] + '×';
    s += `<text x="${x + (bw - 4) / 2}" y="${H - B + 14}" text-anchor="middle">${lab}</text>`; });
  const x1 = L + 10 * bw;
  s += `<line x1="${x1}" x2="${x1}" y1="${T}" y2="${H - B}" stroke="var(--fg)" stroke-dasharray="4 3"/><text x="${x1 + 5}" y="${T + 9}" style="fill:var(--fg)">recuperas lo pagado</text><text x="${W / 2}" y="${H - 6}" text-anchor="middle">valor obtenido ÷ precio pagado</text>`;
  document.getElementById('simPanel').innerHTML = `
    <div class="sechead"><div><h2>Simulación: ${esc(pr.name)}</h2><p class="hint">${pr.packs} sobre${pr.packs > 1 ? 's' : ''} · pagas ${eur(pr.price)} · recuperas el precio en el ${pct(sim.win)} de las aperturas</p></div></div>
    <div class="sim"><div><div class="v">${eur(sim.mean)}</div><div class="l">Media (valor esperado)</div></div>
      <div><div class="v">${eur(sim.median)}</div><div class="l">Mediana: lo que saca un comprador típico</div></div>
      <div><div class="v">${eur(sim.p10)}</div><div class="l">El 10 % peor saca menos de esto</div></div>
      <div><div class="v">${eur(sim.p90)}</div><div class="l">El 10 % mejor saca más de esto</div></div></div>
    <div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Distribución de resultados de la simulación">${s}</svg></div>`;
}

function cardsSection(set, M) {
  const tiers = [...new Set(set.cards.map(c => c.r))];
  const order = ['MHR', 'HR', 'SIR', 'BWR', 'MAR', 'UR', 'IR', 'SSR', 'SR', 'ACE', 'DR', 'R', 'U', 'C', 'P', 'X'];
  tiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return `<section class="section"><div class="panel">
    <div class="sechead"><div><h2>Todas las cartas</h2><p class="hint">Pulsa una carta para ver si te conviene comprarla suelta o abrir sobres.</p></div>
      <div class="filters">
        <input type="search" id="cq" placeholder="Filtrar por nombre" aria-label="Filtrar cartas">
        <select id="cr" aria-label="Rareza"><option value="">Todas las rarezas</option>${tiers.map(t => `<option value="${t}">${esc(TIER_NAMES[t] || t)}</option>`).join('')}</select>
        <select id="cs" aria-label="Orden"><option value="price">Más caras primero</option><option value="num">Por número</option></select>
      </div></div>
    <div class="cards" id="cardGrid"></div>
    <button class="btn more" id="more" hidden>Ver más cartas</button>
  </div></section>`;
}
function bindCards(set, M) {
  let limit = 48;
  const draw = () => {
    const q = norm(app.querySelector('#cq').value), r = app.querySelector('#cr').value, sort = app.querySelector('#cs').value;
    let list = set.cards.filter(c => (!r || c.r === r) && (!q || norm(c.name + ' ' + c.nameEn + ' ' + c.n).includes(q)));
    if (sort === 'price') list.sort((a, b) => (buyPrice(b, S, FACTORS, OV) ?? -1) - (buyPrice(a, S, FACTORS, OV) ?? -1)); else list.sort((a, b) => parseInt(a.n) - parseInt(b.n));
    app.querySelector('#cardGrid').innerHTML = list.slice(0, limit).map(c => {
      const p = M ? cardOdds(M, c) : 0;
      return `<a class="ccard" href="#carta-${hashId(c.id)}">${cardImg(c.img, c.name, c.n, 'low', 'holo')}
        <span class="info"><b>${esc(c.name)}</b><span class="row"><span class="num">${eur(buyPrice(c, S, FACTORS, OV))}</span><span class="rar ${c.r}">${c.r}</span></span>
        <span class="hint">#${esc(c.n)}${p ? ' · 1 de cada ' + int(1 / p) : ''}</span></span></a>`; }).join('') || '<p class="empty">Ninguna carta coincide con el filtro.</p>';
    const more = app.querySelector('#more'); more.hidden = list.length <= limit;
    holo(app.querySelector('#cardGrid'));
  };
  ['#cq', '#cr', '#cs'].forEach(s => app.querySelector(s).addEventListener(s === '#cq' ? 'input' : 'change', () => { limit = 48; draw(); }));
  app.querySelector('#more').addEventListener('click', () => { limit += 96; draw(); });
  draw();
}

// ---------- Carta ----------
let budget = store.get('budget', 100);
async function renderCard(cardId) {
  const setId = cardId.slice(0, cardId.lastIndexOf('-'));
  const set = await loadSet(setId);
  const card = set.cards.find(c => c.id === cardId);
  if (!card) { app.innerHTML = '<p class="empty">No encontramos esa carta.</p>'; return; }
  document.title = card.name + ' · SobreJusto';
  const M = modelFor(set);
  const pack = set.products.find(p => p.id === 'pack') || set.products[0];
  const single = buyPrice(card, S, FACTORS, OV);
  const pr = card.price || {};
  const versions = INDEX.cards.filter(c => c[4] === card.nameEn && c[0] !== card.id && c[7]).sort((a, b) => a[7] - b[7]).slice(0, 10);
  const setNames = new Map(INDEX.sets.map(s => [s.id, s.name]));

  app.innerHTML = `<section class="cardpage">
    <div>${cardImg(card.img, card.name, card.n, 'high', 'holo')}</div>
    <div style="display:grid;gap:18px;min-width:0">
      <div class="crumbs"><a href="#">Colecciones</a> / <a href="#set-${hashId(set.id)}">${esc(set.name)}</a> / #${esc(card.n)}</div>
      <div style="display:grid;gap:6px"><h1>${esc(card.name)}</h1>
        <div class="facts" style="display:flex;gap:8px 14px;flex-wrap:wrap;color:var(--muted);font-size:14px"><span class="rar ${card.r}">${esc(TIER_NAMES[card.r] || card.r)}</span><span>${esc(set.name)} · ${esc(card.n)}/${set.official ?? set.total}</span>${card.nameEn !== card.name ? `<span>${esc(card.nameEn)}</span>` : ''}</div></div>
      <div class="prices">
        <div><div class="v">${eur(single)}</div><div class="l">Precio estimado en español${OV[card.id] != null ? ' (tuyo)' : ''}</div></div>
        <div><div class="v">${eur(pr.trend)}</div><div class="l">Tendencia Cardmarket (todos los idiomas)</div></div>
        <div><div class="v">${eur(pr.avg30)}</div><div class="l">Media 30 días</div></div>
        <div><div class="v">${eur(pr.low)}</div><div class="l">Más bajo</div></div>
      </div>
      <label class="field" style="max-width:320px">¿Has visto otro precio? Escríbelo aquí
        <input type="number" id="ov" min="0" step="0.5" placeholder="${single != null ? single.toFixed(2) : ''}" value="${OV[card.id] ?? ''}"></label>
      <div id="verdict"></div>
      ${versions.length ? `<div class="panel"><h3>Otras versiones de ${esc(card.nameEn)}</h3><div class="versions">${versions.map(c => `<a class="ccard" href="#carta-${hashId(c[0])}">${cardImg(c[6], c[3], c[2], 'low', 'holo')}<span class="info"><b>${esc(setNames.get(c[1]))}</b><span class="row"><span class="num">${eur(c[7])}</span><span class="rar ${c[5]}">${c[5]}</span></span></span></a>`).join('')}</div><p class="hint">Precios de tendencia sin ajustar al español.</p></div>` : ''}
    </div></section>`;

  const drawVerdict = () => {
    const box = app.querySelector('#verdict');
    if (!M) { box.innerHTML = `<div class="verdict single"><span class="big">Cómprala suelta</span><p>Esta colección no tiene probabilidades de apertura medidas, así que no podemos calcular cuánto te costaría sacarla abriendo sobres.</p></div>`; return; }
    const a = acquire(M, card, pack.price, budget, S, FACTORS, OV);
    if (!a.available) {
      const common = ['C', 'U', 'R'].includes(card.r);
      box.innerHTML = `<div class="verdict single"><span class="big">Cómprala suelta${single != null ? ' por ' + eur(single) : ''}</span><p>${common ? 'Es una carta común: sale en muchos sobres, pero vale tan poco que abrir sobres para buscarla nunca compensa.' : 'No tenemos la probabilidad de esta rareza en esta colección.'}</p></div>`; return; }
    const open = a.verdict === 'open';
    const times = a.single ? a.costOpen / a.single : null;
    box.innerHTML = `<div class="verdict ${a.verdict}">
      <span class="eyebrow">¿Single o sobre?</span>
      <span class="big">${open ? 'Abrir sobres te sale más barato de media' : `Cómprala suelta${times && times > 1.5 ? `: abrir te costaría ${times.toLocaleString('es-ES', { maximumFractionDigits: 0 })} veces más` : ''}`}</span>
      <div class="versus">
        <div class="${open ? '' : 'win'}"><span class="l">Comprarla suelta</span><span class="v">${eur(a.single)}</span><span class="l">precio estimado en español</span></div>
        <div class="${open ? 'win' : ''}"><span class="l">Abrir sobres hasta que salga</span><span class="v">${eur(a.costOpen, 0)}</span><span class="l">${int(a.expectedPacks)} sobres de media a ${eur(pack.price)}, vendiendo el resto de cartas</span></div>
      </div>
      <p class="hint">Sale en 1 de cada ${int(a.expectedPacks)} sobres. La mitad de la gente la consigue antes de ${int(a.medianPacks)} sobres. Sin vender nada, abrir costaría ${eur(pack.price * a.expectedPacks, 0)} de media.</p>
      <div class="budget">
        <label class="field" for="budget">Si me gasto en sobres <b class="num" id="budgetV">${eur(budget, 0)}</b></label>
        <input type="range" id="budget" min="${Math.ceil(pack.price)}" max="${Math.max(500, Math.ceil((a.single || 0) * 1.5))}" step="1" value="${budget}">
        <p class="out" id="budgetOut"></p>
      </div>
      <div style="overflow-x:auto"><svg class="chart" id="curve" viewBox="0 0 720 200" width="100%" role="img" aria-label="Probabilidad de conseguir la carta según los sobres abiertos"></svg></div>
    </div>`;
    const upd = () => {
      const b = +app.querySelector('#budget').value; budget = b; store.set('budget', b);
      const x = acquire(M, card, pack.price, b, S, FACTORS, OV);
      app.querySelector('#budgetV').textContent = eur(b, 0);
      app.querySelector('#budgetOut').innerHTML = `Con ${eur(b, 0)} abres <b>${x.budgetPacks} sobres</b> y tienes un <b>${pct(x.probBudget)}</b> de que te salga.${x.singlePacks != null ? ` Con lo que cuesta la carta suelta (${x.singlePacks} sobres) la probabilidad sería del ${pct(x.probSingleBudget)}.` : ''}`;
      drawCurve(x, pack.price);
    };
    app.querySelector('#budget').addEventListener('input', upd); upd();
  };
  drawVerdict();
  app.querySelector('#ov').addEventListener('change', e => { if (e.target.value === '') delete OV[card.id]; else OV[card.id] = +e.target.value; store.set('overrides', OV); renderCard(cardId); });
  holo(app);
}

function drawCurve(a, packPrice) {
  const W = 720, H = 200, L = 40, R = 12, T = 12, B = 34;
  const maxPacks = Math.max(10, Math.ceil(Math.max(a.medianPacks * 3, a.budgetPacks * 1.3, a.singlePacks || 0)));
  const X = n => L + (W - L - R) * n / maxPacks, Y = p => T + (H - T - B) * (1 - p);
  let s = '';
  for (let k = 0; k <= 4; k++) s += `<line x1="${L}" x2="${W - R}" y1="${Y(k / 4)}" y2="${Y(k / 4)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(k / 4) + 3}" text-anchor="end">${k * 25}%</text>`;
  let d = ''; const steps = 120;
  for (let i = 0; i <= steps; i++) { const n = maxPacks * i / steps; d += (i ? 'L' : 'M') + X(n).toFixed(1) + ' ' + Y(1 - Math.pow(1 - a.p, n)).toFixed(1); }
  s += `<path d="${d} L${X(maxPacks)} ${Y(0)} L${X(0)} ${Y(0)} Z" fill="var(--accent-soft)" opacity=".7"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`;
  const mark = (n, label, color) => { if (n == null || n > maxPacks) return; const p = 1 - Math.pow(1 - a.p, n);
    s += `<line x1="${X(n)}" x2="${X(n)}" y1="${T}" y2="${Y(0)}" stroke="${color}" stroke-dasharray="4 3"/><circle cx="${X(n)}" cy="${Y(p)}" r="4.5" fill="${color}"/><text x="${Math.min(X(n) + 5, W - 120)}" y="${T + 10}" style="fill:${color}">${label}</text>`; };
  mark(a.singlePacks, 'precio de la suelta', 'var(--good)');
  mark(a.budgetPacks, 'tu presupuesto', 'var(--fg)');
  for (let k = 0; k <= 4; k++) { const n = Math.round(maxPacks * k / 4); s += `<text x="${X(n)}" y="${H - B + 14}" text-anchor="middle">${int(n)}</text>`; }
  s += `<text x="${(W + L) / 2}" y="${H - 4}" text-anchor="middle">sobres abiertos (${eur(packPrice)} cada uno)</text>`;
  app.querySelector('#curve').innerHTML = s;
}

// ---------- Ajustes ----------
function bindSettings() {
  const dlg = document.getElementById('settings');
  const keys = ['saleFactor', 'fee', 'ship', 'thr', 'bulk', 'godX', 'p10', 'm10', 'gcost'];
  const sync = () => {
    dlg.querySelectorAll('[data-pf]').forEach(b => b.setAttribute('aria-pressed', b.dataset.pf === S.priceField));
    keys.forEach(k => dlg.querySelector('#s-' + k).value = S[k]);
    ['esAdjust', 'godOn', 'gradeOn'].forEach(k => dlg.querySelector('#s-' + k).checked = S[k]);
    dlg.querySelector('#s-saleFactorV').textContent = S.saleFactor + ' %';
  };
  const changed = () => { store.set('settings', S); sync(); route(); };
  document.getElementById('openSettings').addEventListener('click', () => { sync(); dlg.showModal(); });
  dlg.querySelectorAll('[data-pf]').forEach(b => b.addEventListener('click', () => { S.priceField = b.dataset.pf; changed(); }));
  keys.forEach(k => dlg.querySelector('#s-' + k).addEventListener('change', e => { S[k] = +e.target.value; changed(); }));
  dlg.querySelector('#s-saleFactor').addEventListener('input', e => { dlg.querySelector('#s-saleFactorV').textContent = e.target.value + ' %'; });
  ['esAdjust', 'godOn', 'gradeOn'].forEach(k => dlg.querySelector('#s-' + k).addEventListener('change', e => { S[k] = e.target.checked; changed(); }));
  dlg.querySelector('#s-reset').addEventListener('click', () => { S = { ...DEFAULT_SETTINGS }; changed(); });
}

// ---------- Rutas ----------
async function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  try {
    if (h.startsWith('set-')) await renderSet(unhash(h.slice(4)));
    else if (h.startsWith('carta-')) await renderCard(unhash(h.slice(6)));
    else renderHome();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty"><p>No se pudieron cargar los datos (${esc(e.message)}).</p><p><a href="#">Volver al inicio</a></p></div>`;
  }
}
let lastHash = null;
window.addEventListener('hashchange', () => { if (location.hash !== lastHash) { lastHash = location.hash; route().then(() => scrollTo(0, 0)); } });

(async function init() {
  try {
    [INDEX, FACTORS] = await Promise.all([getJSON('data/index.json'), getJSON('data/factors.json')]);
  } catch (e) {
    app.innerHTML = `<div class="empty"><p>Todavía no hay datos. Ejecuta <code>npm run data</code> para descargarlos.</p></div>`; return;
  }
  document.getElementById('updated').textContent = 'Datos actualizados el ' + new Date(INDEX.updated).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }) + '.';
  bindSearch(document.getElementById('q'), document.getElementById('qres'));
  bindSettings();
  lastHash = location.hash; route();
})();
