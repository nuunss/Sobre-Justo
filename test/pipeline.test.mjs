import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-tcgdex.mjs';
import { packModel, simulate, acquire, cardOdds, rarityCode, DEFAULT_SETTINGS } from '../site/ev.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

test('rarityCode clasifica las rarezas de TCGdex', () => {
  assert.equal(rarityCode('Special illustration rare'), 'SIR');
  assert.equal(rarityCode('Illustration rare'), 'IR');
  assert.equal(rarityCode('Mega Hyper Rare'), 'MHR');
  assert.equal(rarityCode('Hyper rare'), 'HR');
  assert.equal(rarityCode('Double rare'), 'DR');
  assert.equal(rarityCode('Ultra Rare'), 'UR');
  assert.equal(rarityCode('Uncommon'), 'U');
  assert.equal(rarityCode('Common'), 'C');
  assert.equal(rarityCode('Rare'), 'R');
  assert.equal(rarityCode('ACE SPEC Rare'), 'ACE');
  assert.equal(rarityCode('Black White Rare'), 'BWR');
});

test('el script genera datos correctos desde la API', async () => {
  const srv = await startMock();
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'pv-'));
  try {
    const { stdout } = await run('node', [path.join(ROOT, 'scripts/fetch-data.mjs')], {
      env: { ...process.env, TCGDEX_BASE: `http://127.0.0.1:${srv.address().port}/v2`, SERIES: 'me', OUT_DIR: out } });
    assert.match(stdout, /me02\.5 Ascended Heroes: 295 cartas/);
    const index = JSON.parse(await fs.readFile(path.join(out, 'index.json'), 'utf8'));
    assert.equal(index.sets.length, 1);
    assert.equal(index.sets[0].name, 'Héroes Ascendentes');
    assert.equal(index.sets[0].hasRates, true);
    assert.equal(index.cards.length, 295);
    const set = JSON.parse(await fs.readFile(path.join(out, 'sets', 'me02.5.json'), 'utf8'));
    const count = r => set.cards.filter(c => c.r === r).length;
    // La API etiqueta las Ataque Mega como Ultra Rara: la corrección por rangos debe separarlas
    assert.equal(count('MAR'), 7);
    assert.equal(count('UR'), 14);
    assert.equal(count('SIR'), 22);
    assert.equal(count('MHR'), 2);
    assert.equal(count('IR'), 33);
    assert.equal(count('DR'), 39);
    assert.ok(set.cards[283].img.includes('/es/'), 'usa la imagen en español');
    assert.equal(set.products.length, 11);
    assert.ok(index.sets[0].evPack > 1 && index.sets[0].evPack < 6, 'EV por sobre plausible: ' + index.sets[0].evPack);
  } finally { srv.close(); }
});

test('la simulación coincide con el valor esperado analítico', async () => {
  const set = JSON.parse(await fs.readFile(path.join(ROOT, 'site/data/sets/me02.5.json'), 'utf8').catch(() => 'null'));
  if (!set) return;
  const factors = JSON.parse(await fs.readFile(path.join(ROOT, 'config/language-factors.json'), 'utf8'));
  const m = packModel(set, set.rates, DEFAULT_SETTINGS, factors);
  let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sim = simulate(m, { packs: 9, promo: 2, price: 70 }, 60000, rand);
  const ev = 9 * m.net + 2;
  assert.ok(Math.abs(sim.mean - ev) / ev < 0.08, `media ${sim.mean} vs EV ${ev}`);
  assert.ok(sim.median < sim.mean, 'la mediana queda por debajo de la media');
});

test('single o sobre: una carta común se compra suelta y las probabilidades cuadran', async () => {
  const set = JSON.parse(await fs.readFile(path.join(ROOT, 'site/data/sets/me02.5.json'), 'utf8').catch(() => 'null'));
  if (!set) return;
  const factors = JSON.parse(await fs.readFile(path.join(ROOT, 'config/language-factors.json'), 'utf8'));
  const m = packModel(set, set.rates, DEFAULT_SETTINGS, factors);
  const gengar = set.cards.find(c => c.n === '284');
  assert.equal(gengar.r, 'SIR');
  const p = cardOdds(m, gengar);
  assert.ok(Math.abs(p - 1 / 1650) < 1e-9);
  const a = acquire(m, gengar, 7.41, 100, DEFAULT_SETTINGS, factors);
  assert.equal(a.verdict, 'single');
  assert.ok(a.costOpen > a.single * 5);
  assert.ok(Math.abs(a.probBudget - (1 - Math.pow(1 - p, 13))) < 1e-12);
});
