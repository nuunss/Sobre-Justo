// Genera datos de ejemplo (Héroes Ascendentes, 1 nov 2026) sin conexión, usando el servidor simulado.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from '../test/mock-tcgdex.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = await startMock();
const child = spawn('node', [path.join(ROOT, 'scripts/fetch-data.mjs')], { stdio: 'inherit',
  env: { ...process.env, TCGDEX_BASE: `http://127.0.0.1:${srv.address().port}/v2`, SERIES: 'me' } });
child.on('exit', code => { srv.close(); process.exit(code ?? 1); });
