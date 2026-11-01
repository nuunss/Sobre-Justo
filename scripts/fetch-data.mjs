#!/usr/bin/env node
// Descarga colecciones, cartas, imágenes y precios desde TCGdex y genera los JSON de la web.
// Uso: node scripts/fetch-data.mjs            (series por defecto: me, sv)
//      SERIES=me node scripts/fetch-data.mjs
//      TCGDEX_BASE=http://localhost:8787/v2 ... (para tests)
// Sin dependencias: requiere Node 20+.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rarityCode, packModel, DEFAULT_SETTINGS, productEV } from '../site/ev.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.TCGDEX_BASE || 'https://api.tcgdex.net/v2').replace(/\/$/, '');
const SERIES = (process.env.SERIES || 'me,sv').split(',').map(s => s.trim()).filter(Boolean);
const OUT = process.env.OUT_DIR || path.join(ROOT, 'site', 'data');
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const ONLY_SETS = process.env.ONLY_SETS ? process.env.ONLY_SETS.split(',') : null;

const readJSON = async p => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, { optional = false } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'sobrejusto/1.0 (+github pages)' } });
      if (res.status === 404 && optional) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 4) { if (optional) return null; throw new Error(`${url}: ${e.message}`); }
      await sleep(500 * attempt * attempt);
    }
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function inRange(localId, range) {
  const n = parseInt(localId, 10); if (Number.isNaN(n)) return false;
  return range.split(',').some(part => { const [a, b] = part.split('-').map(Number); return n >= a && n <= (b ?? a); });
}

function findRates(rates, set) {
  return rates.sets.find(r => (r.ids || []).includes(set.id) || (r.match || []).some(m => m.toLowerCase() === String(set.nameEn).toLowerCase())) || null;
}

const pick = (o, keys) => { const r = {}; let any = false; for (const [k, src] of keys) { const v = o?.[src]; if (typeof v === 'number' && v > 0) { r[k] = Math.round(v * 100) / 100; any = true; } } return any ? r : null; };

async function main() {
  const rates = await readJSON('config/pull-rates.json');
  const products = await readJSON('config/products.json');
  const factors = await readJSON('config/language-factors.json');
  await fs.mkdir(path.join(OUT, 'sets'), { recursive: true });

  const index = { updated: new Date().toISOString(), source: 'TCGdex (Cardmarket, TCGplayer)', sets: [], cards: [] };
  const unknownRarities = new Set();

  for (const serieId of SERIES) {
    const serieEn = await get(`${BASE}/en/series/${serieId}`);
    const serieEs = await get(`${BASE}/es/series/${serieId}`, { optional: true });
    const esSetNames = new Map((serieEs?.sets || []).map(s => [s.id, s.name]));
    let sets = serieEn.sets || [];
    if (ONLY_SETS) sets = sets.filter(s => ONLY_SETS.includes(s.id));
    console.log(`Serie ${serieId}: ${sets.length} colecciones`);

    for (const brief of sets) {
      const setEn = await get(`${BASE}/en/sets/${brief.id}`);
      const setEs = await get(`${BASE}/es/sets/${brief.id}`, { optional: true });
      const esCards = new Map((setEs?.cards || []).map(c => [c.localId, c]));
      const meta = {
        id: setEn.id, nameEn: setEn.name, name: setEs?.name || esSetNames.get(setEn.id) || setEn.name,
        serie: serieEs?.name || serieEn.name, serieId, releaseDate: setEn.releaseDate || null,
        logo: setEs?.logo || setEn.logo || null, symbol: setEn.symbol || null,
        total: setEn.cardCount?.total ?? setEn.cards?.length ?? 0, official: setEn.cardCount?.official ?? null
      };
      const rate = findRates(rates, meta);

      const details = await pool(setEn.cards || [], CONCURRENCY, c => get(`${BASE}/en/cards/${c.id}`, { optional: true }));
      const cards = (setEn.cards || []).map((c, k) => {
        const d = details[k] || {};
        const es = esCards.get(c.localId);
        let r = rarityCode(d.rarity);
        if (r === 'X' && d.rarity) unknownRarities.add(d.rarity);
        if (rate?.tierOverrides) for (const [t, range] of Object.entries(rate.tierOverrides)) if (inRange(c.localId, range)) r = t;
        const cm = d.pricing?.cardmarket;
        return {
          id: c.id, n: c.localId, name: es?.name || c.name, nameEn: c.name, r, rarity: d.rarity || null,
          img: es?.image || c.image || d.image || null, imgLang: es?.image ? 'es' : 'en',
          price: pick(cm, [['trend', 'trend'], ['avg', 'avg'], ['low', 'low'], ['avg1', 'avg1'], ['avg7', 'avg7'], ['avg30', 'avg30']]),
          priceHolo: pick(cm, [['trend', 'trend-holo'], ['avg', 'avg-holo'], ['low', 'low-holo'], ['avg30', 'avg30-holo']]),
          usd: d.pricing?.tcgplayer ? (Object.values(d.pricing.tcgplayer).find(v => v && typeof v === 'object' && v.marketPrice)?.marketPrice ?? null) : null
        };
      });

      const type = rate?.type || (/\.5|\.\d[a-z]?$/.test(meta.id) ? 'special' : 'main');
      const prods = products.sets[meta.id]?.products || products.defaults[type];
      const setData = { ...meta, type, rates: rate ? { rare: rate.rare, hit: rate.hit, godPack: rate.godPack || null, source: rate.source, sample: rate.sample, note: rate.note || null } : null,
        products: prods, productsChecked: products.sets[meta.id]?.checked || null, priceUpdated: details.find(d => d?.pricing?.cardmarket?.updated)?.pricing.cardmarket.updated || null, cards };

      let evPack = null, packPrice = prods.find(p => p.id === 'pack')?.price ?? null, top = null;
      if (rate) {
        const m = packModel(setData, setData.rates, DEFAULT_SETTINGS, factors);
        evPack = Math.round(m.net * 100) / 100;
        setData.missingTiers = m.missing;
      }
      const priced = cards.filter(c => c.price?.trend).sort((a, b) => b.price.trend - a.price.trend);
      top = priced[0] ? { id: priced[0].id, name: priced[0].name, img: priced[0].img, trend: priced[0].price.trend } : null;

      await fs.writeFile(path.join(OUT, 'sets', `${meta.id}.json`), JSON.stringify(setData));
      index.sets.push({ ...meta, type, hasRates: !!rate, evPack, packPrice, top, priced: priced.length });
      for (const c of cards) index.cards.push([c.id, meta.id, c.n, c.name, c.nameEn, c.r, c.img, c.price?.trend ?? null]);
      console.log(`  ${meta.id} ${meta.nameEn}: ${cards.length} cartas, ${priced.length} con precio${rate ? `, EV sobre ${evPack} €` : ''}`);
    }
  }

  index.sets.sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)));
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index));
  await fs.writeFile(path.join(OUT, 'factors.json'), JSON.stringify(factors));
  if (unknownRarities.size) console.warn('Rarezas sin clasificar:', [...unknownRarities].join(', '));
  console.log(`Listo: ${index.sets.length} colecciones, ${index.cards.length} cartas.`);
}

main().catch(e => { console.error(e); process.exit(1); });
