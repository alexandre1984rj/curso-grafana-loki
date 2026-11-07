// Consulta o Loki real. Não usa o simulador do site.
const base = process.env.LOKI_URL || 'http://127.0.0.1:3100';
const deadline = Date.now() + 90000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' em ' + url.pathname);
  return response.json();
}
let lastError;
while (Date.now() < deadline) {
  try {
    const ready = await fetch(base + '/ready', { signal: AbortSignal.timeout(5000) });
    if (!ready.ok) throw new Error('Loki ainda não está pronto: HTTP ' + ready.status);
    for (const format of ['json','logfmt']) {
      const url = new URL('/loki/api/v1/query_range', base);
      const parser = format === 'json' ? 'json' : 'logfmt';
      url.searchParams.set('query', '{app="checkout", env="lab", format="' + format + '"} | ' + parser + ' | level="error" | __error__=""');
      url.searchParams.set('since', '5m');
      url.searchParams.set('limit', '20');
      const data = await json(url);
      if (data.status !== 'success' || !data.data.result.some(stream => stream.values?.length)) throw new Error('Ainda sem erros coletados no formato ' + format);
    }
    const metric = new URL('/loki/api/v1/query', base);
    metric.searchParams.set('query', 'sum(count_over_time({app="checkout",env="lab",format="json"} | json | level="error" | __error__="" [5m]))');
    const result = await json(metric);
    if (!result.data.result.some(series => Number(series.value?.[1]) > 0)) throw new Error('Contagem de erros ainda não positiva.');
    const metadata = new URL('/loki/api/v1/query_range', base);
    metadata.searchParams.set('query', '{app="checkout",format="json"} | request_id!=""');
    metadata.searchParams.set('since', '5m');
    metadata.searchParams.set('limit', '5');
    const metaResult = await json(metadata);
    if (!metaResult.data.result.some(stream => stream.values?.length)) throw new Error('Metadado request_id não encontrado sem parser.');
    const average = new URL('/loki/api/v1/query', base);
    average.searchParams.set('query', 'avg_over_time({app="checkout",format="json"} | json duration_ms="duration_ms" | drop request_id | unwrap duration_ms | __error__="" [5m]) by (app,env,format)');
    const averages = await json(average);
    if (averages.data.result.length !== 1 || !(Number(averages.data.result[0].value?.[1]) >= 40)) throw new Error('Média não consolidada em uma série de origem.');
    console.log('OK: Loki pronto; JSON e logfmt ingeridos; parsing, contagem, metadados e média executados no Loki real.');
    process.exit(0);
  } catch(error) { lastError=error; await pause(2000); }
}
console.error('Falha ao validar ingestão: ' + lastError?.message);
console.error('Confira docker compose ps e docker compose logs loki alloy generator.');
process.exitCode = 1;
