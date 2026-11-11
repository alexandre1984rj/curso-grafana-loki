// Diagramas dos módulos. Cada aresta tem um tipo: dados (linhas, chunks, resultados),
// controle (ring, heartbeats, filas, decisões), confirmação (ACK) ou falha.
// As etapas apontam para um componente ou para uma aresta e trazem uma nota própria.
export const NODE_W = 160;
export const NODE_H = 64;
const COLS = [20, 250, 480, 710];
const ROWS = [30, 180, 330];

export const edgeKinds = {
  data: { label: 'Dados', description: 'linhas, chunks, índices ou resultados' },
  control: { label: 'Controle', description: 'ring, heartbeats, filas e decisões' },
  ack: { label: 'Confirmação', description: 'respostas de sucesso' },
  failure: { label: 'Falha', description: 'recusas, erros e descartes' }
};

const node = (title, detail, col, row) => ({ title, detail, x: COLS[col], y: ROWS[row] });
const R = (n, d = 0) => [n.x + NODE_W, n.y + NODE_H / 2 + d];
const L = (n, d = 0) => [n.x, n.y + NODE_H / 2 + d];
const T = (n, d = 0) => [n.x + NODE_W / 2 + d, n.y];
const B = (n, d = 0) => [n.x + NODE_W / 2 + d, n.y + NODE_H];

// Aresta: from/to são índices; points é a rota (opcional para vizinhos na mesma linha ou coluna).
const e = (from, to, kind, label, extra = {}) => ({ from, to, kind, label, ...extra });

function autoPoints(a, b) {
  if (a.y === b.y) return a.x < b.x ? [R(a), L(b)] : [L(a), R(b)];
  if (a.x === b.x) return a.y < b.y ? [B(a), T(b)] : [T(a), B(b)];
  throw new Error('Aresta diagonal precisa de rota explícita: ' + a.title + ' → ' + b.title);
}

export function edgeGeometry(flow, edge) {
  const a = flow.nodes[edge.from], b = flow.nodes[edge.to];
  const points = edge.points || autoPoints(a, b);
  const d = 'M' + points.map(([x, y]) => x + ' ' + y).join(' L');
  let best = 0, seg = [points[0], points[1]];
  for (let i = 1; i < points.length; i++) {
    const len = Math.abs(points[i][0] - points[i - 1][0]) + Math.abs(points[i][1] - points[i - 1][1]);
    if (len > best) { best = len; seg = [points[i - 1], points[i]]; }
  }
  const [[x1, y1], [x2, y2]] = seg;
  let label;
  if (edge.labelAt) label = { x: edge.labelAt[0], y: edge.labelAt[1], anchor: edge.labelAnchor || 'middle' };
  else if (y1 === y2) label = { x: (x1 + x2) / 2, y: edge.labelSide === 'below' ? y1 + 15 : y1 - 6, anchor: 'middle' };
  else label = edge.labelSide === 'left' ? { x: x1 - 6, y: (y1 + y2) / 2 + 4, anchor: 'end' } : { x: x1 + 6, y: (y1 + y2) / 2 + 4, anchor: 'start' };
  return { d, points, label };
}

function flowOf(title, nodes, edges, steps, extra = {}) {
  return { title, nodes, edges, steps: steps || nodes.map((n, i) => ({ node: i, note: n.detail })), ...extra };
}

// ---------------------------------------------------------------------------
const overviewNodes = [
  node('Aplicação', 'Grava E1 em /var/log/demo/json.log.', 0, 0),
  node('Alloy', 'Lê o arquivo, monta lotes e envia ao Loki.', 1, 0),
  node('Distributor', 'Valida, limita e escolhe ingesters pelo ring.', 2, 0),
  node('Ingester', 'Mantém o chunk aberto do stream e o WAL; responde dados recentes.', 3, 0),
  node('Ring', 'Plano de controle: quem é dono de cada token. Não guarda logs.', 2, 1),
  node('Object storage', 'Chunks e índices imutáveis por chave. No laboratório, disco local.', 3, 1),
  node('Grafana', 'Envia Q1 e mostra o resultado.', 0, 2),
  node('Query frontend', 'Divide Q1 em tarefas, enfileira e junta respostas.', 1, 2),
  node('Querier', 'Lê ingesters, índice e chunks; filtra, interpreta e agrega.', 2, 2)
];
const overview = flowOf('Onde está o trabalho: dados × controle', overviewNodes, [
  e(0, 1, 'data', 'arquivo'),
  e(1, 2, 'data', 'push'),
  e(2, 3, 'data', 'gRPC'),
  e(2, 4, 'control', 'dono?', { points: [B(overviewNodes[2], -20), T(overviewNodes[4], -20)], labelSide: 'left' }),
  e(3, 4, 'control', 'heartbeat', { points: [B(overviewNodes[3], -40), [750, 135], [600, 135], T(overviewNodes[4], 40)], labelAt: [675, 129] }),
  e(3, 5, 'data', 'flush', { points: [B(overviewNodes[3], 30), T(overviewNodes[5], 30)] }),
  e(6, 7, 'data', 'Q1'),
  e(7, 8, 'data', 'tarefas'),
  e(8, 5, 'data', 'chunks', { points: [R(overviewNodes[8], 10), [790, 372], B(overviewNodes[5], 0)], labelAt: [730, 366] }),
  e(8, 3, 'data', 'recentes', { points: [R(overviewNodes[8], -10), [675, 352], [675, 72], L(overviewNodes[3], 10)], labelAt: [681, 292], labelAnchor: 'start' })
], [
  { node: 0, note: 'E1 nasce como uma linha JSON num arquivo. Até aqui, só o disco da aplicação a guarda.' },
  { edge: 0, note: 'O Alloy lê a linha, anexa labels e request_id, e a coloca num lote.' },
  { edge: 1, note: 'O lote chega ao distributor por HTTP. É aqui que limites e validações recusam dados (módulo 8).' },
  { edge: 3, note: 'Controle: o distributor pergunta ao ring quais ingesters são donos do token de E1. Nenhum log passa pelo ring.' },
  { edge: 2, note: 'Dados: E1 vai por gRPC aos ingesters escolhidos, que a guardam em memória e no WAL (módulos 9 e 10).' },
  { edge: 4, note: 'Controle contínuo: cada ingester renova seu heartbeat no ring. Sem heartbeat, ele deixa de receber escritas mesmo com os dados íntegros.' },
  { edge: 5, note: 'Horas depois (ou com o chunk cheio), o flush grava o chunk e o índice no object storage (módulo 11).' },
  { edge: 6, note: 'Q1 parte do Grafana para o query frontend.' },
  { edge: 7, note: 'O frontend divide Q1 em tarefas por hora e por shard e as entrega aos queriers por uma fila (módulo 12).' },
  { edge: 9, note: 'Dados recentes: o querier pergunta a todos os ingesters, porque parte de E1 ainda não está no bucket (módulo 13).' },
  { edge: 8, note: 'Dados antigos: o índice aponta os chunks candidatos, que o querier baixa, descomprime e filtra (módulos 13 e 14).' }
]);

// ---------------------------------------------------------------------------
const wn = [
  node('Alloy', 'Cliente: monta o lote e decide se reenvia.', 0, 1),
  node('Distributor', 'Valida, aplica limites, calcula o token e espera o quorum.', 1, 1),
  node('Ring', 'Tokens e heartbeats dos ingesters, no KV store.', 1, 0),
  node('Ingester A', 'Uma das RF réplicas do stream de E1.', 2, 1),
  node('Ingesters B e C', 'As outras réplicas (RF=3). No laboratório, RF=1 e elas não existem.', 1, 2),
  node('WAL', 'Disco local do ingester. Escrito sem fsync por requisição.', 3, 1),
  node('Object storage', 'Recebe o chunk comprimido no flush.', 2, 2),
  node('Índice TSDB', 'Head em memória + WAL do índice; vira arquivo a cada 15 min.', 3, 2)
];
const write = flowOf('Escrita de E1: quando o cliente recebe ACK?', wn, [
  e(0, 1, 'data', 'lote', { points: [R(wn[0], -12), L(wn[1], -12)] }),
  e(1, 2, 'control', 'Get(token)', { points: [T(wn[1], -15), B(wn[2], -15)], labelAt: [309, 126], labelAnchor: 'end' }),
  e(2, 1, 'control', 'réplicas', { points: [B(wn[2], 15), T(wn[1], 15)], labelAt: [351, 126], labelAnchor: 'start' }),
  e(1, 3, 'data', 'Push', { points: [R(wn[1], -12), L(wn[3], -12)] }),
  e(1, 4, 'data', 'Push', { points: [B(wn[1], -15), T(wn[4], -15)], labelSide: 'left' }),
  e(3, 5, 'data', 'wal.Log'),
  e(3, 1, 'ack', 'OK', { points: [L(wn[3], 12), R(wn[1], 12)], labelSide: 'below' }),
  e(4, 1, 'ack', 'OK', { points: [T(wn[4], 15), B(wn[1], 15)] }),
  e(1, 0, 'ack', '204', { points: [L(wn[1], 12), R(wn[0], 12)], labelSide: 'below' }),
  e(1, 0, 'failure', '429 / 5xx', { points: [T(wn[1], -50), [280, 150], [100, 150], T(wn[0], 0)], labelAt: [190, 144] }),
  e(3, 6, 'data', 'flush', { points: [B(wn[3], 0), T(wn[6], 0)] }),
  e(3, 7, 'data', 'ChunkMetas', { points: [B(wn[3], 55), [615, 288], [790, 288], T(wn[7], 0)], labelAt: [700, 282] }),
  e(7, 6, 'data', 'upload', { points: [L(wn[7], 0), R(wn[6], 0)] }),
  e(3, 2, 'control', 'heartbeat', { points: [T(wn[3], 0), [560, 62], R(wn[2], 0)], labelAt: [485, 56] })
], [
  { node: 0, note: 'E1 está no lote do Alloy, em memória. Se o Alloy morrer agora, E1 se perde (módulo 3).' },
  { edge: 0, note: 'POST /loki/api/v1/push. PushWithResolver valida labels, tamanho e idade; inválidas recebem 400 parcial. O rate limiter do tenant pode recusar o lote inteiro com 429.' },
  { edge: 1, note: 'Controle: TokenFor(tenant, labels) gera um uint32. ingestersRing.Get(token, WriteNoExtend) percorre o anel a partir dele.' },
  { edge: 2, note: 'O ring devolve RF instâncias e, via Filter, quantos erros tolerar: RF=3 → minSuccess 2, maxErrors 1. Sem maioria viva, o push falha aqui, antes de enviar.' },
  { edge: 3, note: 'Envio gRPC paralelo, com contexto WithoutCancel e remote_timeout (5 s). Ele continua mesmo depois que o cliente receber a resposta.' },
  { edge: 4, note: 'As outras réplicas recebem o mesmo stream. Cada resposta incrementa contadores atômicos no distributor.' },
  { edge: 5, note: 'No ingester: a linha entra no head block do chunk aberto (memória) e só então a requisição vai ao WAL com Write, sem fsync. Disco acima de 90% → ErrReadOnly antes disso.' },
  { edge: 6, note: 'Confirmação da réplica A: "está na minha memória e escrevi no WAL". Não significa "está no disco" nem "está no bucket".' },
  { edge: 7, note: 'Segunda confirmação: minSuccess atingido. doneWithResult(nil) libera a resposta ao cliente.' },
  { edge: 8, note: 'ACK ao Alloy: 204. Garantia: pelo menos 2 de 3 réplicas têm E1 em memória e no WAL escrito. Nenhuma cópia está no object storage ainda.' },
  { edge: 9, note: 'Caminho de falha: 429 (limite) ou 5xx (quorum não atingido). O Alloy reenvia com backoff; réplicas que já gravaram podem gerar duplicatas.' },
  { edge: 13, note: 'Controle contínuo: heartbeat a cada 5 s. Sem ele por 1 min (heartbeat_timeout), o ring exclui o ingester das próximas escritas.' },
  { edge: 10, note: 'Até 2 h depois (max_chunk_age), 30 min sem linhas (chunk_idle_period) ou chunk cheio (~1,5 MB comprimido): o flush grava o chunk no bucket.' },
  { edge: 11, note: 'Depois do Put do chunk, o ingester acrescenta a referência (ChunkMeta) ao head TSDB local.' },
  { edge: 12, note: 'A cada 15 min o head vira arquivo TSDB; o shipper o envia em até 1 min. Só agora queriers sem acesso a este ingester conseguem achar E1 pelo índice.' }
]);

// ---------------------------------------------------------------------------
const rn = [
  node('Grafana', 'Envia Q1 com intervalo de 24 h.', 0, 1),
  node('Query frontend', 'Middlewares: limites, split por 1 h, cache, shards e retry.', 1, 1),
  node('Results cache', 'Desligado por padrão (query_range.cache_results = false).', 1, 0),
  node('Fila por tenant', 'No scheduler, se configurado; no laboratório, dentro do frontend (v1).', 2, 1),
  node('Querier', 'Puxa até max_concurrent (4) tarefas de cada vez.', 3, 1),
  node('Ingesters', 'Todos os ingesters do ring de leitura, para dados recentes.', 3, 0),
  node('Índice TSDB', 'Direto no querier, ou via index gateway quando configurado.', 2, 2),
  node('Chunk cache / bucket', 'Cache embutido (100 MB) se nenhum outro existir; depois o bucket.', 3, 2)
];
const read = flowOf('Leitura de Q1: em quantas tarefas ela vira e quem limita?', rn, [
  e(0, 1, 'data', 'Q1', { points: [R(rn[0], -12), L(rn[1], -12)] }),
  e(1, 2, 'control', 'extents?', { points: [T(rn[1], -15), B(rn[2], -15)], labelAt: [309, 126], labelAnchor: 'end' }),
  e(2, 1, 'data', 'acertos', { points: [B(rn[2], 15), T(rn[1], 15)], labelAt: [351, 126], labelAnchor: 'start' }),
  e(1, 3, 'control', 'enqueue', { points: [R(rn[1], -12), L(rn[3], -12)] }),
  e(3, 1, 'failure', '429', { points: [L(rn[3], 12), R(rn[1], 12)], labelSide: 'below' }),
  e(3, 4, 'control', 'tarefa', { points: [R(rn[3], -12), L(rn[4], -12)] }),
  e(4, 5, 'data', 'recentes', { points: [T(rn[4], -15), B(rn[5], -15)], labelAt: [769, 126], labelAnchor: 'end' }),
  e(5, 4, 'data', 'streams', { points: [B(rn[5], 15), T(rn[4], 15)], labelAt: [811, 126], labelAnchor: 'start' }),
  e(4, 6, 'control', 'refs?', { points: [B(rn[4], -50), [740, 280], [580, 280], T(rn[6], 20)], labelAt: [660, 274] }),
  e(6, 4, 'data', 'ChunkRefs', { points: [R(rn[6], 0), [675, 362], [675, 232], L(rn[4], 20)], labelAt: [670, 320], labelAnchor: 'end' }),
  e(4, 7, 'data', 'GET', { points: [B(rn[4], 15), T(rn[7], 15)], labelSide: 'left' }),
  e(7, 4, 'data', 'chunks', { points: [T(rn[7], 45), B(rn[4], 45)] }),
  e(4, 1, 'data', 'parciais', { points: [T(rn[4], -50), [740, 150], [380, 150], T(rn[1], 50)], labelAt: [560, 144] }),
  e(1, 0, 'data', 'resposta', { points: [L(rn[1], 12), R(rn[0], 12)], labelSide: 'below' })
], [
  { node: 0, note: 'Q1: sum by (app) (count_over_time({app="checkout", env="lab"} |= "timeout" | json | level="error" [5m])) em 24 h.' },
  { edge: 0, note: 'A requisição chega ao frontend. NewMetricTripperware aplica limites (max_query_length, max_query_series) antes de qualquer trabalho.' },
  { edge: 1, note: 'Com cache_results ligado, o frontend procura extents já calculados por (tenant, consulta, step, intervalo). Default: desligado, então esta etapa não acontece no laboratório.' },
  { node: 1, note: 'split_queries_by_interval (1 h) gera 24 subconsultas. Para cada uma, o frontend consulta o índice (index/stats) e escolhe o número de shards: potência de 2 de bytes ÷ 600 MB.' },
  { edge: 3, note: 'As tarefas entram na fila do tenant. Um semáforo (tsdb_max_query_parallelism, 128) limita quantas desta consulta estão em voo ao mesmo tempo.' },
  { edge: 4, note: 'Caminho de falha: fila do tenant cheia (2048 no frontend v1; 32 000 no scheduler) → 429 "too many outstanding requests".' },
  { edge: 5, note: 'Cada querier puxa tarefas por rodízio entre tenants, até max_concurrent (4) ao mesmo tempo, dividido entre os frontends/schedulers a que se conecta.' },
  { edge: 6, note: 'Se a tarefa termina dentro de query_ingesters_within (3 h), o querier pergunta a todos os ingesters, porque não sabe quais têm streams que casam com o seletor.' },
  { edge: 7, note: 'Ingesters devolvem entradas de chunks ainda em memória. Réplicas devolvem as mesmas linhas; o merge deduplica entradas idênticas.' },
  { edge: 8, note: 'Para o store, o querier pede ao índice os ChunkRefs dos streams que casam com {app="checkout", env="lab"} no intervalo da tarefa e no shard dela.' },
  { edge: 9, note: 'O índice devolve referências (fingerprint, from, through, checksum). Só labels e tempo foram usados: "timeout" ainda não foi procurado.' },
  { edge: 10, note: 'O fetcher procura cada chunk no cache e, na falta, faz GET no bucket pela chave derivada da referência.' },
  { edge: 11, note: 'Chunks chegam comprimidos. Descompressão → filtro |= "timeout" → | json → level="error" → contagem por 5 min. O custo é proporcional aos bytes descomprimidos.' },
  { edge: 12, note: 'Cada tarefa devolve uma matriz parcial. Os shards foram desenhados para que a soma das parciais seja exata para sum e count.' },
  { edge: 13, note: 'O frontend junta 24 × shards respostas parciais e devolve a série por app ao Grafana.' }
]);

// ---------------------------------------------------------------------------
const mn = [
  node('Entrada recebida', 'Labels, timestamp, linha e structured metadata.', 0, 1),
  node('Labels', 'Identidade do stream: {app, env, format, service_name}.', 1, 0),
  node('Structured metadata', 'request_id e detected_level: viajam com a entrada.', 1, 1),
  node('Conteúdo da linha', 'JSON com level, message, duration_ms.', 1, 2),
  node('Índice TSDB', 'Guarda labels e intervalos de chunks por stream.', 2, 0),
  node('Chunk do stream', 'Guarda timestamp, linha e metadata de cada entrada, comprimidos.', 2, 1),
  node('Consulta', 'Seletor usa o índice; o resto exige ler chunks.', 3, 1)
];
const model = flowOf('Um atributo, três lugares', mn, [
  e(0, 1, 'data', 'label', { points: [T(mn[0], 0), [100, 62], L(mn[1], 0)], labelAt: [175, 56] }),
  e(0, 2, 'data', 'metadata'),
  e(0, 3, 'data', 'linha', { points: [B(mn[0], 0), [100, 362], L(mn[3], 0)], labelAt: [175, 356] }),
  e(1, 4, 'data', 'índice'),
  e(1, 5, 'data', 'stream', { points: [B(mn[1], 0), [330, 130], [520, 130], T(mn[5], -40)], labelAt: [425, 124] }),
  e(2, 5, 'data', 'no chunk'),
  e(3, 5, 'data', 'no chunk', { points: [R(mn[3], 0), [560, 362], B(mn[5], 0)], labelAt: [485, 356] }),
  e(4, 6, 'control', 'quais chunks', { points: [R(mn[4], 0), [790, 62], T(mn[6], 0)], labelAt: [715, 56] }),
  e(5, 6, 'data', 'ler e filtrar')
], [
  { node: 0, note: 'E1 chega com labels, timestamp, linha e request_id em structured metadata.' },
  { edge: 0, note: 'Labels definem o stream. service_name foi acrescentado pelo Loki a partir de app.' },
  { edge: 3, note: 'Só labels vão ao índice, junto com o intervalo de tempo de cada chunk.' },
  { edge: 1, note: 'Structured metadata não muda o stream nem o índice.' },
  { edge: 4, note: 'Todas as entradas do mesmo stream vão para o mesmo chunk aberto.' },
  { edge: 5, note: 'Metadata é guardado por entrada, dentro do chunk.' },
  { edge: 6, note: 'A linha também vai inteira para o chunk.' },
  { edge: 7, note: 'Na consulta, o índice só responde quais chunks podem conter o resultado.' },
  { edge: 8, note: 'Filtros por metadata e por conteúdo exigem ler esses chunks. Por isso o seletor é o filtro mais barato.' }
]);

// ---------------------------------------------------------------------------
const cn = [
  node('Arquivo', 'json.log no volume compartilhado com o gerador.', 0, 0),
  node('source.file', 'Tailer por arquivo; lê linhas novas.', 1, 0),
  node('positions.yml', 'Offset lido por arquivo, gravado a cada 10 s.', 1, 1),
  node('loki.process', 'stage.json + stage.structured_metadata.', 2, 0),
  node('loki.write (lote)', 'Lote por tenant: envia com 1 MiB ou 1 s.', 2, 1),
  node('Loki', 'Responde 204, 400, 429 ou 5xx.', 3, 1),
  node('Descarte', 'loki_write_dropped_entries_total{reason}.', 2, 2)
];
const collect = flowOf('Coleta: o que o Alloy faz com cada resposta', cn, [
  e(0, 1, 'data', 'linha'),
  e(1, 2, 'control', 'offset lido'),
  e(1, 3, 'data', 'entrada'),
  e(3, 4, 'data', 'entrada'),
  e(4, 5, 'data', 'POST', { points: [R(cn[4], -12), L(cn[5], -12)] }),
  e(5, 4, 'ack', '204', { points: [L(cn[5], 12), R(cn[4], 12)], labelSide: 'below' }),
  e(5, 4, 'failure', '429 / 5xx', { points: [T(cn[5], 0), [790, 150], [600, 150], T(cn[4], 40)], labelAt: [695, 144] }),
  e(4, 6, 'failure', '4xx ou fim dos retries')
], [
  { edge: 0, note: 'O tailer lê E1 do arquivo assim que o gerador a grava.' },
  { edge: 1, note: 'Controle: o offset lido é salvo periodicamente. Ele não espera o 204 do Loki.' },
  { edge: 2, note: 'loki.process extrai request_id do JSON e o anexa como structured metadata.' },
  { edge: 3, note: 'A entrada entra no lote do tenant. O lote sai ao passar de 1 MiB ou ao completar 1 s.' },
  { edge: 4, note: 'POST protobuf+snappy. O envio é síncrono no laço do cliente: nada mais sai enquanto ele não terminar.' },
  { edge: 5, note: '204: o lote inteiro foi aceito. O Alloy segue para o próximo.' },
  { edge: 6, note: '429, 5xx ou erro de conexão: espera de 0,5–1 s, depois 1–2 s, dobrando, até 10 envios no total.' },
  { edge: 7, note: 'Outros 4xx (como 400) ou retries esgotados: o lote é descartado e conta em loki_write_dropped_entries_total.' }
]);

// ---------------------------------------------------------------------------
const qn = [
  node('Seletor', '{app="checkout", env="lab"}: só labels.', 0, 0),
  node('Índice', 'Chunks dos streams que casam, no intervalo.', 1, 0),
  node('Descompressão', 'Todo chunk candidato é descomprimido.', 2, 0),
  node('Filtro |= "timeout"', 'Busca de substring na linha; descarta a maioria.', 3, 0),
  node('| json', 'Extrai campos; numa métrica, só os necessários.', 3, 1),
  node('level="error"', 'Filtro sobre o label extraído.', 2, 1),
  node('count_over_time', 'Conta por janela de 5 min e soma por app.', 1, 1)
];
const query = flowOf('O trabalho de Q1, na ordem', qn, [
  e(0, 1, 'control', 'matchers'), e(1, 2, 'data', 'chunks'), e(2, 3, 'data', 'linhas'),
  e(3, 4, 'data', 'restantes'), e(4, 5, 'data', 'campos'), e(5, 6, 'data', 'amostras')
]);

// ---------------------------------------------------------------------------
const sn = [
  node('Ingester', 'Fecha chunks e faz flush.', 0, 0),
  node('Chunks no bucket', '<tenant>/<fp>/<from>:<through>:<checksum>.', 1, 0),
  node('Head TSDB local', 'Referências em memória + WAL do índice.', 0, 1),
  node('Índices por ingester', 'Arquivo multi-tenant a cada 15 min, por tabela diária.', 1, 1),
  node('Compactor', 'A cada 10 min: compacta índices por tenant e aplica retenção.', 2, 1),
  node('Índice compactado', 'Um arquivo por tenant e tabela.', 3, 1),
  node('Marcadores', 'Chunks expirados, em disco local do compactor.', 2, 2),
  node('Sweeper', 'Apaga chunks marcados após retention_delete_delay (2 h).', 2, 0)
];
const storage = flowOf('Ciclo de vida: do flush ao DELETE', sn, [
  e(0, 1, 'data', 'flush'), e(0, 2, 'data', 'ChunkMetas'), e(2, 3, 'data', 'upload'),
  e(3, 4, 'data', 'download'), e(4, 5, 'data', 'compacta'),
  e(4, 6, 'control', 'marca', { points: [B(sn[4], -15), T(sn[6], -15)], labelSide: 'left' }),
  e(6, 4, 'control', 'após 2 h', { points: [T(sn[6], 15), B(sn[4], 15)] }),
  e(4, 7, 'control', 'sweeper'),
  e(7, 1, 'failure', 'DELETE')
], [
  { edge: 0, note: 'O chunk vai ao bucket primeiro; a chave já contém tenant e fingerprint.' },
  { edge: 1, note: 'A referência entra no head TSDB local do ingester.' },
  { edge: 2, note: 'A cada 15 min o head vira arquivo, enviado em até 1 min. Cada ingester envia o seu: há sobreposição entre réplicas.' },
  { edge: 3, note: 'O compactor baixa os arquivos de cada tabela diária.' },
  { edge: 4, note: 'Junta os arquivos por tenant e remove duplicatas de referências entre réplicas.' },
  { edge: 5, note: 'Com retention_enabled, marca chunks cujo through é mais antigo que a retenção e retira suas referências do índice.' },
  { edge: 6, note: 'Marcadores mais novos que retention_delete_delay (2 h) são ignorados, para dar tempo a queriers com índice antigo em cache.' },
  { edge: 7, note: 'O sweeper processa os marcadores elegíveis.' },
  { edge: 8, note: 'O objeto do chunk é apagado do bucket. Só agora o espaço é liberado.' }
]);

// ---------------------------------------------------------------------------
const deploy = flowOf('Do laboratório à decisão de produção', [
  node('Requisitos', 'Volume, consultas, retenção, isolamento e recuperação.', 0, 0),
  node('Topologia', 'Monolítico ou componentes separados.', 1, 0),
  node('Domínios de falha', 'Zonas, discos e energia independentes para cada réplica.', 2, 0),
  node('Validação', 'Teste ingestão, consultas e recuperação sob carga real.', 3, 0)
], [e(0, 1, 'control', 'decide'), e(1, 2, 'control', 'distribui'), e(2, 3, 'control', 'testa')]);

export const flows = { overview, model, collect, write, read, query, storage, deploy };
