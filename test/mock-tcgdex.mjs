// Servidor que imita la API de TCGdex con los datos reales de Héroes Ascendentes (1 nov 2026).
// Sirve para probar el script de datos sin conexión y para generar la vista previa.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', 'asc-2026-11-01.json'), 'utf8'));
const RAR = { C: 'Common', U: 'Uncommon', R: 'Rare', DR: 'Double rare', IR: 'Illustration rare', UR: 'Ultra Rare', MAR: 'Ultra Rare', SIR: 'Special illustration rare', MHR: 'Mega Hyper Rare' };
const pad = n => String(n).padStart(3, '0');
const SET = 'me02.5';
const img = (lang, n) => `https://assets.tcgdex.net/${lang}/me/${SET}/${pad(n)}`;

function card(c) {
  const bulky = ['C', 'U', 'R'].includes(c.r);
  const t = c.trend ?? (bulky ? Math.max(0.02, c.usd * 0.5) : null);
  return {
    id: `${SET}-${pad(c.n)}`, localId: pad(c.n), name: c.name, image: img('en', c.n), rarity: RAR[c.r],
    pricing: { cardmarket: { updated: '2026-11-01T02:00:00.000Z', unit: 'EUR', trend: t, avg: c.avg30 ?? t, avg30: c.avg30 ?? t, low: t ? t * 0.7 : null,
      ...(bulky ? { 'trend-holo': 0.12, 'avg-holo': 0.12, 'avg30-holo': 0.12 } : {}) },
      tcgplayer: { updated: '2026-11-01', unit: 'USD', holofoil: { marketPrice: c.usd } } }
  };
}

const routes = {
  '/v2/en/series/me': { id: 'me', name: 'Mega Evolution', sets: [{ id: SET, name: 'Ascended Heroes' }] },
  '/v2/es/series/me': { id: 'me', name: 'Megaevolución', sets: [{ id: SET, name: 'Héroes Ascendentes' }] },
  [`/v2/en/sets/${SET}`]: { id: SET, name: 'Ascended Heroes', releaseDate: '2026-01-30', logo: `https://assets.tcgdex.net/en/me/${SET}/logo`, symbol: `https://assets.tcgdex.net/univ/me/${SET}/symbol`,
    cardCount: { total: 295, official: 217 }, cards: data.cards.map(c => ({ id: `${SET}-${pad(c.n)}`, localId: pad(c.n), name: c.name, image: img('en', c.n) })) },
  [`/v2/es/sets/${SET}`]: { id: SET, name: 'Héroes Ascendentes', logo: `https://assets.tcgdex.net/es/me/${SET}/logo`,
    cards: data.cards.map(c => ({ id: `${SET}-${pad(c.n)}`, localId: pad(c.n), name: c.name, image: img('es', c.n) })) }
};
for (const c of data.cards) routes[`/v2/en/cards/${SET}-${pad(c.n)}`] = card(c);

export function startMock(port = 0) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const body = routes[req.url.split('?')[0]];
      if (!body) { res.writeHead(404); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srv = await startMock(Number(process.env.PORT || 8787));
  console.log('Mock TCGdex en http://127.0.0.1:' + srv.address().port + '/v2');
}
