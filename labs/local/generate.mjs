import { mkdir, appendFile, stat, writeFile } from 'node:fs/promises';

export function eventFor(index) {
  const error = index % 3 === 1;
  return {
    level: error ? 'error' : 'info',
    message: error ? 'payment timeout' : 'pedido concluido',
    duration_ms: error ? 1200 + index % 800 : 40 + index % 160,
    request_id: 'req-' + index
  };
}

async function main() {
  const directory = '/var/log/demo';
  await mkdir(directory, { recursive: true });
  let index = 0;
  while (true) {
    const event = { timestamp: new Date().toISOString(), ...eventFor(index++) };
    const json = directory + '/json.log';
    const logfmt = directory + '/logfmt.log';
    // shortcut: truncamento limita espaço no laboratório; produção precisa de rotação coordenada.
    for (const path of [json, logfmt]) {
      try { if ((await stat(path)).size > 5 * 1024 * 1024) await writeFile(path, ''); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await appendFile(json, JSON.stringify(event) + '\n');
    await appendFile(logfmt, 'timestamp=' + event.timestamp + ' level=' + event.level + ' message="' + event.message + '" duration_ms=' + event.duration_ms + ' request_id=' + event.request_id + '\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/generate.mjs')) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
