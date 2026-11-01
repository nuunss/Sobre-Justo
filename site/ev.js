// Cálculos de valor esperado. Módulo puro: lo usan la web, el script de datos y los tests.

export const DEFAULT_SETTINGS = {
  priceField: 'trend',   // trend | avg30 | avg | low  (Cardmarket, todos los idiomas)
  esAdjust: true,        // ajustar al precio de la carta en español
  saleFactor: 90,        // % del precio al que vendes de forma realista
  fee: 5,                // comisión de venta %
  ship: 1.0,             // coste de envío/protección por carta vendida €
  thr: 1.0,              // por debajo de este valor la carta es bulk
  bulk: 0.02,            // valor de una carta bulk €
  gradeOn: false, p10: 40, m10: 2.5, gcost: 30,
  godOn: false, godX: 2000
};

export const TIER_NAMES = {
  C: 'Común', U: 'Infrecuente', R: 'Rara', DR: 'Doble Rara', UR: 'Ultra Rara', IR: 'Rara Ilustración',
  SIR: 'Rara Ilustración Especial', HR: 'Hiper Rara', MHR: 'Mega Hiper Rara', MAR: 'Rara Ataque Mega',
  ACE: 'AS TÁCTICO', BWR: 'Rara Blanco y Negro', SR: 'Variocolor', SSR: 'Variocolor Ultra', P: 'Promo', X: 'Otra'
};

// Normaliza el texto de rareza de la API a un código corto.
export function rarityCode(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s || s === 'none') return 'X';
  if (s.includes('mega') && s.includes('hyper')) return 'MHR';
  if (s.includes('mega') && s.includes('attack')) return 'MAR';
  if (s.includes('hyper')) return 'HR';
  if (s.includes('special illustration')) return 'SIR';
  if (s.includes('illustration')) return 'IR';
  if (s.includes('ace spec')) return 'ACE';
  if (s.includes('black white')) return 'BWR';
  if (s.includes('shiny ultra')) return 'SSR';
  if (s.includes('shiny')) return 'SR';
  if (s.includes('double')) return 'DR';
  if (s.includes('ultra')) return 'UR';
  if (s.includes('uncommon')) return 'U';
  if (s.includes('common')) return 'C';
  if (s.includes('promo')) return 'P';
  if (s.includes('rare')) return 'R';
  return 'X';
}

export function langFactor(price, factors) {
  const b = factors?.buckets; if (!b || !b.length) return 1;
  for (const x of b) if (price < x.max) return x.factor;
  return b[b.length - 1].factor;
}

// Precio de compra estimado (lo que pagarías por la carta suelta)
export function buyPrice(card, s, factors, overrides = {}) {
  if (overrides[card.id] != null) return overrides[card.id];
  const pr = card.price || {};
  const p = pr[s.priceField] ?? pr.trend ?? pr.avg ?? pr.avg30 ?? null;
  if (p == null) return null;
  return s.esAdjust ? p * langFactor(p, factors) : p;
}

function sellNet(v, s) {
  if (v == null) return s.bulk;
  const x = v * s.saleFactor / 100;
  if (x < s.thr) return s.bulk;
  return Math.max(x * (1 - s.fee / 100) - s.ship, s.bulk);
}

// Valor neto si la vendes (tras descuento de venta rápida, comisión y envío)
export function netValue(card, s, factors, overrides) {
  const v = buyPrice(card, s, factors, overrides);
  let net = sellNet(v, s);
  if (v != null && s.gradeOn && ['SIR', 'MHR', 'HR', 'BWR', 'SSR'].includes(card.r)) {
    const x = v * s.saleFactor / 100;
    const g = (s.p10 / 100 * s.m10 + (1 - s.p10 / 100)) * x * (1 - s.fee / 100) - s.gcost - s.ship;
    if (g > net) net = g;
  }
  return net;
}

// Valor de una carta reverse holo cualquiera de comunes/infrecuentes/raras
function reverseValue(cards, s, factors) {
  const pool = cards.filter(c => c.r === 'C' || c.r === 'U' || c.r === 'R');
  if (!pool.length) return s.bulk;
  let sum = 0;
  for (const c of pool) {
    const ph = c.priceHolo || {};
    let p = ph[s.priceField] ?? ph.trend ?? ph.avg ?? null;
    if (p != null && s.esAdjust) p *= langFactor(p, factors);
    sum += sellNet(p, s);
  }
  return sum / pool.length;
}

// Modelo de un sobre. rates = {rare:{DR:5,...}, hit:{IR:8,...}}
export function packModel(set, rates, s, factors, overrides = {}) {
  const cards = set.cards;
  const byTier = {};
  for (const c of cards) (byTier[c.r] ||= []).push(c);
  const tiers = {}; const missing = [];
  let pRare = 0, pHit = 0;
  for (const [slot, group] of [['rare', rates.rare || {}], ['hit', rates.hit || {}]]) {
    for (const [t, x] of Object.entries(group)) {
      const pool = byTier[t] || [];
      if (!pool.length || !x) { missing.push(t); continue; }
      const p = 1 / x;
      if (slot === 'rare') pRare += p; else pHit += p;
      const net = pool.map(c => netValue(c, s, factors, overrides));
      const gross = pool.map(c => buyPrice(c, s, factors, overrides) ?? s.bulk);
      tiers[t] = { slot, p, pool, net, gross, avgNet: avg(net), avgGross: avg(gross) };
    }
  }
  const rev = reverseValue(cards, s, factors);
  const rareNormal = byTier.R?.length ? avg(byTier.R.map(c => netValue(c, s, factors, overrides))) : s.bulk;
  const contrib = {
    'Bulk (7 comunes e infrecuentes)': 7 * s.bulk,
    'Rara normal': Math.max(0, 1 - pRare) * rareNormal,
    'Reverse holo': rev + Math.max(0, 1 - pHit) * rev
  };
  let gross = 7 * s.bulk + Math.max(0, 1 - pRare) * rareNormal + rev + Math.max(0, 1 - pHit) * rev;
  for (const [t, d] of Object.entries(tiers)) { contrib[TIER_NAMES[t] || t] = d.p * d.avgNet; gross += d.p * d.avgGross; }
  let net = Object.values(contrib).reduce((a, b) => a + b, 0);
  const gp = rates.godPack;
  if (s.godOn && gp?.contents) {
    const g = 1 / s.godX;
    let gv = 0; for (const [t, n] of Object.entries(gp.contents)) gv += n * (tiers[t]?.avgNet ?? 0);
    contrib['God pack'] = g * (gv - net); net += g * (gv - net);
  }
  return { tiers, pRare, pHit, rev, rareNormal, contrib, net, gross, missing, settings: s, godPack: gp };
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

// Probabilidad por sobre de una carta concreta
export function cardOdds(model, card) {
  const t = model.tiers[card.r];
  if (!t) return 0;
  return t.p / t.pool.length;
}

// Generador de sobres aleatorios (rand inyectable para tests)
export function makeSampler(model, rand = Math.random) {
  const s = model.settings;
  const rare = Object.entries(model.tiers).filter(([, d]) => d.slot === 'rare');
  const hit = Object.entries(model.tiers).filter(([, d]) => d.slot === 'hit');
  const base = 7 * s.bulk + model.rev;
  const g = s.godOn && model.godPack?.contents ? 1 / s.godX : 0;
  const pick = a => a[(rand() * a.length) | 0];
  const draw = (group, fallback) => {
    let r = rand(), acc = 0;
    for (const [, d] of group) { acc += d.p; if (r < acc) return pick(d.net); }
    return fallback;
  };
  return () => {
    if (g && rand() < g) {
      let v = 0; for (const [t, n] of Object.entries(model.godPack.contents)) for (let i = 0; i < n; i++) v += model.tiers[t] ? pick(model.tiers[t].net) : 0;
      return v;
    }
    return base + draw(rare, model.rareNormal) + draw(hit, model.rev);
  };
}

export function simulate(model, product, n = 20000, rand = Math.random) {
  const sample = makeSampler(model, rand);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { let v = product.promo || 0; for (let k = 0; k < product.packs; k++) v += sample(); out[i] = v; }
  out.sort();
  let sum = 0, win = 0;
  for (let i = 0; i < n; i++) { sum += out[i]; if (out[i] >= product.price) win++; }
  return { mean: sum / n, median: out[n >> 1], p10: out[Math.floor(n * 0.1)], p90: out[Math.floor(n * 0.9)], win: win / n, values: out };
}

export function productEV(model, product) { return product.packs * model.net + (product.promo || 0); }

// ¿Comprar suelta o abrir sobres?
export function acquire(model, card, packPrice, budget, s, factors, overrides) {
  const p = cardOdds(model, card);
  const single = buyPrice(card, s, factors, overrides);
  if (!p) return { p: 0, single, available: false };
  const v = netValue(card, s, factors, overrides);
  const otherPerPack = model.net - p * v;          // lo que recuperas del resto de cartas por sobre
  const netCostPerPack = packPrice - otherPerPack; // lo que te cuesta de verdad cada sobre
  const expectedPacks = 1 / p;
  const costOpen = Math.max(netCostPerPack, 0) * expectedPacks;
  const medianPacks = Math.ceil(Math.log(0.5) / Math.log(1 - p));
  const budgetPacks = Math.floor(budget / packPrice);
  const probBudget = 1 - Math.pow(1 - p, budgetPacks);
  const singlePacks = single != null ? Math.floor(single / packPrice) : null; // sobres que podrías comprar con lo que cuesta la suelta
  const probSingleBudget = singlePacks != null ? 1 - Math.pow(1 - p, singlePacks) : null;
  let verdict = 'single';
  if (single != null && costOpen < single) verdict = 'open';
  return { available: true, p, single, net: v, expectedPacks, medianPacks, otherPerPack, netCostPerPack, costOpen,
    budgetPacks, probBudget, singlePacks, probSingleBudget, ratio: single ? costOpen / single : null, verdict };
}
