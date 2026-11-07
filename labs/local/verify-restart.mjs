// Executa apenas o reinício do serviço Loki deste laboratório e preserva volumes.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const base = process.env.LOKI_URL || 'http://127.0.0.1:3100';
const compose = fileURLToPath(new URL('compose.yaml', import.meta.url));
const query = new URL('/loki/api/v1/query_range', base);
query.searchParams.set('query', '{app="checkout",env="lab",format="json"}');
query.searchParams.set('since', '5m');
query.searchParams.set('limit', '1');
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
try {
  const data = await get(query);
  const original = data.data.result[0]?.values?.[0];
  if (!original) throw new Error('Sem evento inicial. Execute verify.mjs antes.');
  const id = JSON.parse(original[1]).request_id;
  query.searchParams.delete('since');
  query.searchParams.set('start', original[0]);
  query.searchParams.set('end', String(BigInt(original[0]) + 1n));
  query.searchParams.set('query', '{app="checkout",env="lab",format="json"} |= ' + JSON.stringify('"request_id":"' + id + '"'));
  await promisify(execFile)('docker', ['compose', '-f', compose, 'restart', 'loki'], { windowsHide: true, timeout: 60000 });
  const deadline = Date.now() + 90000;
  let found = false;
  while (Date.now() < deadline) {
    try {
      const recovered = await get(query);
      found = recovered.data.result.some(stream => stream.values.some(value => value[0] === original[0] && value[1] === original[1]));
      if (found) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!found) throw new Error('O evento anterior ao reinício não foi reencontrado.');
  console.log('OK: o mesmo timestamp e a mesma linha anteriores ao reinício foram recuperados, com volumes preservados.');
  console.log('Este teste não simula perda de disco nem comprova alta disponibilidade.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
