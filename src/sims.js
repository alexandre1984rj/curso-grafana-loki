// Modelos didáticos dos mecanismos do Loki 3.7.0.
// Cada função reproduz uma regra verificada no código-fonte (arquivo indicado no comentário)
// ou declara explicitamente a simplificação adotada. Nenhuma delas executa Loki.

// ---------------------------------------------------------------------------
// 1. Quorum de escrita
// Regras: vendor/github.com/grafana/dskit/ring/replication_strategy.go (Filter)
//         pkg/distributor/distributor.go (sendStreams, PushTracker.doneWithResult)
// ---------------------------------------------------------------------------
export const ingesterStates = {
  ok: { label: 'Responde rápido', latency: 8 },
  slow: { label: 'Responde devagar', latency: 900 },
  error: { label: 'Retorna erro', latency: 12 },
  timeout: { label: 'Excede remote_timeout', latency: null },
  unhealthy: { label: 'Sem heartbeat no ring', latency: null }
};

export function quorumOutcome(states, { remoteTimeoutMs = 5000 } = {}) {
  if (!Array.isArray(states) || states.length < 1 || states.length > 5) throw new Error('Use entre 1 e 5 instâncias no conjunto de réplicas.');
  for (const state of states) if (!ingesterStates[state]) throw new Error('Estado desconhecido: ' + state);
  // Filter: o fator efetivo é o maior entre RF e o tamanho do conjunto; instâncias sem heartbeat
  // são removidas mas continuam contando no cálculo de minSuccess.
  const replicationFactor = states.length;
  const minSuccess = Math.floor(replicationFactor / 2) + 1;
  const healthy = states.map((state, index) => ({ state, index })).filter(item => item.state !== 'unhealthy');
  const events = [];
  if (healthy.length < minSuccess) {
    return {
      replicationFactor, minSuccess, maxErrors: 0, healthy: healthy.length,
      status: 'rejected-before-send',
      ackAtMs: null,
      message: 'at least ' + minSuccess + ' live replicas required, could only find ' + healthy.length,
      events: [{ t: 0, text: 'Ring.Get filtra instâncias sem heartbeat: sobram ' + healthy.length + ' de ' + replicationFactor + '. Nenhuma requisição é enviada.' }]
    };
  }
  const maxErrors = healthy.length - minSuccess;
  const responses = healthy.map(({ state, index }) => {
    if (state === 'timeout') return { index, state, t: remoteTimeoutMs, ok: false, why: 'DeadlineExceeded após remote_timeout' };
    const t = ingesterStates[state].latency;
    if (t > remoteTimeoutMs) return { index, state, t: remoteTimeoutMs, ok: false, why: 'DeadlineExceeded após remote_timeout' };
    return { index, state, t, ok: state !== 'error', why: state === 'error' ? 'erro retornado pelo ingester' : 'Push concluído' };
  }).sort((a, b) => a.t - b.t || a.index - b.index);
  let succeeded = 0;
  let failed = 0;
  let status = 'pending';
  let ackAtMs = null;
  for (const response of responses) {
    if (response.ok) succeeded++; else failed++;
    events.push({ t: response.t, text: 'Ingester ' + (response.index + 1) + ': ' + response.why + ' (sucessos ' + succeeded + '/' + minSuccess + ', falhas ' + failed + '/' + maxErrors + ' toleradas)' });
    if (status === 'pending' && response.ok && succeeded === minSuccess) { status = 'acked'; ackAtMs = response.t; events.push({ t: response.t, text: 'doneWithResult(nil): quorum atingido; o distributor responde 204 ao cliente.' }); }
    if (status === 'pending' && !response.ok && failed > maxErrors) { status = 'failed'; ackAtMs = response.t; events.push({ t: response.t, text: 'doneWithResult(err): falhas excederam maxErrors; o cliente recebe erro e deve reenviar.' }); }
  }
  const late = status === 'acked' ? responses.filter(r => r.t > ackAtMs).length : 0;
  return {
    replicationFactor, minSuccess, maxErrors, healthy: healthy.length, status, ackAtMs, events,
    late,
    message: status === 'acked'
      ? 'ACK em ' + ackAtMs + ' ms com ' + minSuccess + ' de ' + replicationFactor + ' confirmações. ' + (late ? late + ' envio(s) continuam em segundo plano (contexto WithoutCancel).' : '')
      : 'Erro em ' + ackAtMs + ' ms. Algumas réplicas podem ter gravado a linha: um reenvio do cliente pode gerar duplicata, que o ingester descarta só se timestamp e conteúdo forem iguais à última linha do stream.'
  };
}

// ---------------------------------------------------------------------------
// 2. Construção de chunks
// Regras: pkg/chunkenc/memchunk.go (Append, SpaceFor), pkg/ingester/stream.go
// (validateEntries: janela de unordered writes; storeEntries: cutChunk).
// Simplificação: compressão por razão fixa escolhida pelo aluno.
// ---------------------------------------------------------------------------
export function createChunkModel({ blockSize = 256, targetSize = 1536, ratio = 6, maxChunkAgeMin = 120 } = {}) {
  for (const [name, value] of Object.entries({ blockSize, targetSize, ratio, maxChunkAgeMin })) if (!(Number.isFinite(value) && value > 0)) throw new Error('Parâmetro inválido: ' + name);
  return { blockSize, targetSize, ratio, maxChunkAgeMin, head: 0, headLines: 0, blocks: [], closedChunks: [], highestMin: null, rejected: 0, log: [] };
}

export function chunkCompressedSize(model) {
  return model.blocks.reduce((sum, block) => sum + block.compressed, 0);
}

export function appendLine(model, options = {}) {
  const m = appendLineRaw(model, options);
  if (m.log.length > 20) m.log.length = 20;
  return m;
}

function appendLineRaw(model, { sizeKB = 1, minute = null } = {}) {
  const m = structuredClone(model);
  const ts = minute ?? (m.highestMin ?? 0);
  if (m.highestMin !== null) {
    const cutoff = m.highestMin - m.maxChunkAgeMin / 2;
    if (ts < cutoff) {
      m.rejected++;
      m.log.unshift('Rejeitada: timestamp ' + ts + ' min < corte ' + cutoff + ' min (maior timestamp − max_chunk_age/2). Erro "entry too far behind".');
      return m;
    }
  }
  // SpaceFor: blocos já comprimidos + head ainda não comprimido + nova linha < target.
  if (chunkCompressedSize(m) + m.head + sizeKB >= m.targetSize) {
    const compressedHead = m.head / m.ratio;
    const total = chunkCompressedSize(m) + compressedHead;
    m.closedChunks.push({ blocks: m.blocks.length + (m.head ? 1 : 0), compressed: Number(total.toFixed(1)) });
    m.log.unshift('SpaceFor = false: chunk fechado com ' + total.toFixed(1) + ' KB comprimidos; ele entra na fila de flush com motivo "full".');
    m.blocks = []; m.head = 0; m.headLines = 0;
  }
  m.head += sizeKB; m.headLines++;
  if (m.highestMin === null || ts > m.highestMin) m.highestMin = ts;
  if (m.head >= m.blockSize) {
    const compressed = Number((m.head / m.ratio).toFixed(1));
    m.blocks.push({ raw: m.head, compressed, lines: m.headLines });
    m.log.unshift('Head block atingiu ' + m.head + ' KB ≥ chunk_block_size: cut() comprime o bloco para ~' + compressed + ' KB.');
    m.head = 0; m.headLines = 0;
  }
  return m;
}

// ---------------------------------------------------------------------------
// 3. Durabilidade de uma linha confirmada
// Regras: pkg/ingester/instance.go (Push → wal.Log), pkg/ingester/wal.go,
// prometheus tsdb/wlog (write sem fsync por registro; fsync ao trocar de segmento),
// pkg/ingester/flush.go, tsdb/head_manager.go (rotação de 15 min), indexshipper (upload 1 min).
// ---------------------------------------------------------------------------
export const durabilityStages = [
  { id: 'memory', title: 'Linha no head block', where: 'Memória do processo ingester', evidence: 'Código: stream.storeEntries antes de wal.Log' },
  { id: 'wal-write', title: 'Registro WAL escrito', where: 'Cache de páginas do kernel (write, sem fsync)', evidence: 'Código: wlog.log/flushPage chamam Write; fsync só em nextSegment/Close' },
  { id: 'ack', title: 'ACK do ingester ao distributor', where: 'Resposta gRPC; quorum decide o ACK ao cliente', evidence: 'Código: Ingester.Push retorna após instance.Push' },
  { id: 'wal-fsync', title: 'Segmento WAL sincronizado', where: 'Disco local do ingester', evidence: 'Código: fsync ao fechar segmento de 512 MB (128 MB × 4) ou no Close' },
  { id: 'flushed', title: 'Chunk enviado ao object storage', where: 'Bucket (ou filesystem no laboratório)', evidence: 'Código: flushChunks → store.Put; motivos idle, max_age, full, synced' },
  { id: 'index-head', title: 'Referência no head TSDB', where: 'Memória + WAL do índice no ingester', evidence: 'Código: HeadManager.Append registra ChunkMetas' },
  { id: 'index-shipped', title: 'Índice TSDB enviado', where: 'Bucket: arquivo multi-tenant do ingester', evidence: 'Código: rotação a cada 15 min; shipper verifica uploads a cada 1 min' }
];

export const failureModes = {
  process: { label: 'Processo reinicia, disco preservado', survivesLocal: stage => stage >= 1 },
  power: { label: 'Nó perde energia (kernel não grava cache)', survivesLocal: stage => stage >= 3 },
  disk: { label: 'Disco do ingester perdido', survivesLocal: stage => stage >= 6 }
};

export function durabilityOutcome({ stage, failure, replicationFactor = 3, affected = 1 }) {
  if (!Number.isInteger(stage) || stage < 0 || stage >= durabilityStages.length) throw new Error('Etapa inválida.');
  const mode = failureModes[failure];
  if (!mode) throw new Error('Falha desconhecida.');
  if (![1, 3].includes(replicationFactor)) throw new Error('Use RF 1 ou 3 nesta simulação.');
  if (!(Number.isInteger(affected) && affected >= 1 && affected <= replicationFactor)) throw new Error('Réplicas afetadas devem estar entre 1 e RF.');
  if (stage < 2) return { acked: false, survives: null, reason: 'Ainda não houve ACK. Se a escrita falhar aqui, o cliente recebe erro ou timeout e é responsável por reenviar; não existe promessa de durabilidade.' };
  const local = mode.survivesLocal(stage);
  const otherReplicas = replicationFactor - affected;
  // Réplicas não afetadas confirmaram (ou continuam recebendo) a mesma linha; com RF=3 o ACK exige 2.
  const replicasThatHadIt = replicationFactor === 1 ? 0 : Math.max(0, Math.min(otherReplicas, replicationFactor));
  if (local) return { acked: true, survives: true, reason: 'A cópia local sobrevive: ' + durabilityStages[stage].where + '. ' + (stage >= 4 ? 'O dado já está no object storage.' : 'Ao reiniciar, o ingester repete checkpoint + segmentos WAL antes de entrar no ring.') };
  if (failure === 'disk' && (stage === 4 || stage === 5) && replicasThatHadIt === 0) return { acked: true, survives: false, reason: 'O objeto do chunk está no bucket, mas a referência a ele ainda existe só no head TSDB e no WAL do índice deste disco. Sem o arquivo TSDB enviado, nenhum querier encontra esse chunk. Inferência: ele também fica fora da retenção do compactor, que percorre o índice para marcar chunks.' };
  if (replicasThatHadIt > 0) return { acked: true, survives: true, reason: 'A cópia local foi perdida, mas ' + replicasThatHadIt + ' réplica(s) em outro(s) nó(s) ainda têm a linha em memória/WAL. Inferência: vale se as falhas forem independentes (zona, disco e energia separados).' };
  return { acked: true, survives: false, reason: 'Perda possível de dado confirmado: nenhuma cópia fora do componente afetado e a etapa atual não resiste a esta falha. O ACK não equivalia a dado no bucket.' };
}

// ---------------------------------------------------------------------------
// 4. Planejamento de consulta no query frontend
// Regras: split_by_interval.go, querysharding + shard_resolver.go (GuessShardFactor),
// limits.go (limitedRoundTripper: semáforo com tsdb_max_query_parallelism para TSDB),
// queue.go (limite por tenant), worker.go (max_concurrent por querier).
// Simplificação: bytes uniformes no tempo, subconsultas de duração igual, sem cache.
// ---------------------------------------------------------------------------
export function guessShardFactor(bytes, maxBytesPerShard, maxShards = 0) {
  if (!(bytes >= 0) || !(maxBytesPerShard > 0)) throw new Error('Bytes e limite por shard devem ser positivos.');
  if (bytes === 0) return 0;
  const minShards = bytes / maxBytesPerShard;
  let factor = 2 ** Math.ceil(Math.log2(minShards));
  if (maxShards > 0) factor = Math.min(factor, maxShards);
  return factor <= 1 ? 0 : factor;
}

export function planQuery({ rangeHours, splitMinutes, gbPerHour, maxBytesPerShardMB = 600, tsdbMaxQueryParallelism = 128, queriers = 4, maxConcurrent = 4, shardable = true, maxOutstandingPerTenant = 32000, secondsPerTask = 2 }) {
  const values = { rangeHours, splitMinutes, gbPerHour, maxBytesPerShardMB, tsdbMaxQueryParallelism, queriers, maxConcurrent };
  for (const [name, value] of Object.entries(values)) if (!(Number.isFinite(value) && value > 0)) throw new Error('Parâmetro inválido: ' + name);
  const splits = Math.ceil(rangeHours * 60 / splitMinutes);
  const bytesPerSplitMB = gbPerHour * 1024 * splitMinutes / 60;
  const factor = shardable ? guessShardFactor(bytesPerSplitMB, maxBytesPerShardMB) : 0;
  const shardsPerSplit = Math.max(1, factor);
  const tasks = splits * shardsPerSplit;
  const querierSlots = queriers * maxConcurrent;
  const effectiveConcurrency = Math.min(tsdbMaxQueryParallelism, querierSlots);
  const waves = Math.ceil(tasks / effectiveConcurrency);
  const queued = Math.max(0, Math.min(tasks, tsdbMaxQueryParallelism) - querierSlots);
  return {
    splits, bytesPerSplitMB, factor, shardsPerSplit, tasks, querierSlots, effectiveConcurrency, waves,
    estimatedSeconds: waves * secondsPerTask,
    bytesTotalGB: gbPerHour * rangeHours,
    bytesPerTaskMB: bytesPerSplitMB / shardsPerSplit,
    queued,
    rejected: queued > maxOutstandingPerTenant,
    limiter: tsdbMaxQueryParallelism < querierSlots ? 'tsdb_max_query_parallelism limita esta consulta' : 'os slots dos queriers (queriers × max_concurrent) limitam esta consulta'
  };
}

// ---------------------------------------------------------------------------
// 5. Gargalo e paralelismo (modelo de teto, não medição do Loki)
// ---------------------------------------------------------------------------
export function bottleneck({ workGB, queriers, coresPerQuerier, maxConcurrent, cpuMBps = 150, ioMBpsPerQuerier = 400, storeMBps = 4000, memPerTaskMB = 700, memPerQuerierGB = 8 }) {
  const values = { workGB, queriers, coresPerQuerier, maxConcurrent, cpuMBps, ioMBpsPerQuerier, storeMBps, memPerTaskMB, memPerQuerierGB };
  for (const [name, value] of Object.entries(values)) if (!(Number.isFinite(value) && value > 0)) throw new Error('Parâmetro inválido: ' + name);
  const workers = queriers * maxConcurrent;
  const cpu = queriers * Math.min(maxConcurrent, coresPerQuerier) * cpuMBps;
  const io = Math.min(queriers * ioMBpsPerQuerier, storeMBps);
  const throughput = Math.min(cpu, io);
  const limiting = cpu <= io ? (maxConcurrent < coresPerQuerier ? 'concorrência (há núcleos ociosos)' : 'CPU dos queriers') : (queriers * ioMBpsPerQuerier > storeMBps ? 'object storage (banda total)' : 'rede/IO de cada querier');
  const memoryNeededGB = maxConcurrent * memPerTaskMB / 1024;
  const oomRisk = memoryNeededGB > memPerQuerierGB;
  return { workers, cpuMBps: cpu, ioMBps: io, throughput, limiting, seconds: workGB * 1024 / throughput, memoryNeededGB, oomRisk };
}

// ---------------------------------------------------------------------------
// 6. Linha do tempo de retenção
// Regras: compactor (compaction_interval, apply_retention_interval), retention.markForDelete,
// marker.availableFiles (arquivos mais novos que retention_delete_delay são ignorados).
// Simplificação: um chunk, ciclo de compactação pontual, sem fila ou falha.
// ---------------------------------------------------------------------------
export function retentionTimeline({ retentionHours, chunkThroughHoursAgo = 0, compactionMinutes = 10, deleteDelayHours = 2, lifecycleDays = 0 }) {
  for (const [name, value] of Object.entries({ retentionHours, compactionMinutes, deleteDelayHours })) if (!(Number.isFinite(value) && value > 0)) throw new Error('Parâmetro inválido: ' + name);
  // tempo em horas a partir de agora em que o chunk passa a ser expirado
  const expiresIn = Math.max(0, retentionHours - chunkThroughHoursAgo);
  const markedIn = Math.ceil(expiresIn * 60 / compactionMinutes) * compactionMinutes / 60;
  const deletedIn = markedIn + deleteDelayHours;
  const lifecycleHours = lifecycleDays > 0 ? lifecycleDays * 24 - chunkThroughHoursAgo : null;
  const conflict = lifecycleHours !== null && lifecycleHours < markedIn;
  return { expiresIn, markedIn, deletedIn, lifecycleHours, conflict };
}

// ---------------------------------------------------------------------------
// 7. Custo de uma consulta com parser em janela longa
// Regras: o filtro de linha não evita descompressão (opera sobre linhas já descomprimidas);
// em consultas métricas NewParserHint permite extrair só os campos exigidos;
// em consultas de log o parser extrai todas as chaves.
// ---------------------------------------------------------------------------
export function parsingCost({ linesPerSecond, avgLineBytes, hours, selectivity, lineFilter = true, metric = true, fieldsPerLine = 12, requiredFields = 1 }) {
  for (const [name, value] of Object.entries({ linesPerSecond, avgLineBytes, hours, fieldsPerLine })) if (!(Number.isFinite(value) && value > 0)) throw new Error('Parâmetro inválido: ' + name);
  if (!(selectivity >= 0 && selectivity <= 1)) throw new Error('Seletividade deve estar entre 0 e 1.');
  const lines = linesPerSecond * hours * 3600;
  const bytesGB = lines * avgLineBytes / 1024 ** 3;
  const parsedLines = lineFilter ? lines * selectivity : lines;
  const fields = metric ? Math.min(requiredFields, fieldsPerLine) : fieldsPerLine;
  return { lines, bytesGB, decompressedGB: bytesGB, parsedLines, fieldsExtracted: parsedLines * fields, fieldsPerParsedLine: fields };
}

// ---------------------------------------------------------------------------
// 8. Retries do cliente de envio (Alloy loki.write)
// Regras: alloy internal/component/common/loki/client/client.go (sendBatch: reenvia 429, 5xx e
// erros de conexão; descarta outros 4xx) e dskit backoff (espera aleatória em [min, max), ambos
// dobrando até max_backoff; max_retries conta envios).
// Simplificação: duração da requisição desprezada; o Loki volta exatamente após `outageSeconds`.
// ---------------------------------------------------------------------------
export function backoffBounds({ minBackoffMs = 500, maxBackoffMs = 300000, maxRetries = 10 } = {}) {
  for (const [name, value] of Object.entries({ minBackoffMs, maxBackoffMs, maxRetries })) if (!(Number.isFinite(value) && value > 0)) throw new Error('Parâmetro inválido: ' + name);
  const waits = [];
  let lo = minBackoffMs, hi = Math.min(minBackoffMs * 2, maxBackoffMs);
  // Wait() só dorme enquanto Ongoing(): com maxRetries envios há maxRetries−1 esperas.
  for (let i = 1; i < maxRetries; i++) {
    waits.push([lo, lo >= hi ? lo : hi]);
    if (hi < maxBackoffMs) { lo = Math.min(lo * 2, maxBackoffMs); hi = Math.min(hi * 2, maxBackoffMs); }
  }
  const attempts = [[0, 0]];
  for (const [a, b] of waits) { const [pa, pb] = attempts.at(-1); attempts.push([pa + a, pb + b]); }
  return { waits, attempts };
}

export function retryOutcome({ status = 503, outageSeconds = 60, minBackoffMs = 500, maxBackoffMs = 300000, maxRetries = 10, retryOn429 = true }) {
  const retryable = status === 0 || status === 429 && retryOn429 || Math.floor(status / 100) === 5;
  const { attempts } = backoffBounds({ minBackoffMs, maxBackoffMs, maxRetries });
  if (!retryable) return { retryable, attempts: attempts.slice(0, 1), outcome: 'dropped', text: status === 429 ? 'retry_on_http_429 = false: o lote é descartado na primeira resposta 429.' : 'Status ' + status + ' não é reenviado: o lote é descartado na primeira resposta.' };
  const outage = outageSeconds * 1000;
  const fast = attempts.findIndex(([lo]) => lo >= outage);
  const slow = attempts.findIndex(([, hi]) => hi >= outage);
  const windowMs = attempts.at(-1);
  let outcome, text;
  if (fast >= 0) { outcome = 'delivered'; text = 'Entregue em qualquer sorteio: mesmo com as esperas mínimas, a tentativa ' + (fast + 1) + ' já ocorre depois do retorno do Loki.'; }
  else if (slow >= 0) { outcome = 'depends'; text = 'Depende do sorteio das esperas: com as máximas, a tentativa ' + (slow + 1) + ' alcança o Loki; com as mínimas, as ' + maxRetries + ' tentativas acabam antes.'; }
  else { outcome = 'dropped'; text = 'Descartado: a última tentativa ocorre no máximo ' + (windowMs[1] / 1000).toFixed(0) + ' s após a primeira, antes do retorno do Loki.'; }
  return { retryable, attempts, outcome, text, windowMs };
}

// ---------------------------------------------------------------------------
// 9. Do label à chave do objeto
// Regras: pkg/util/ring/ring.go (TokenFor = FNV-1 32 de tenant + labels),
// pkg/storage/config/schema_config.go (newerExternalKey e PeriodicTableConfig.TableFor).
// Simplificação: o fingerprint real é xxhash64 calculado no ingester; aqui usamos FNV-1 64
// apenas para ilustrar o formato hexadecimal.
// ---------------------------------------------------------------------------
const utf8 = text => new TextEncoder().encode(text);
export function tokenFor(tenant, labels) {
  let h = 0x811c9dc5;
  for (const byte of utf8(tenant + labels)) { h = Math.imul(h, 0x01000193) >>> 0; h = (h ^ byte) >>> 0; }
  return h >>> 0;
}
export function illustrativeFingerprint(labels) {
  let h = 0xcbf29ce484222325n;
  for (const byte of utf8(labels)) { h = (h * 0x100000001b3n) & 0xffffffffffffffffn; h ^= BigInt(byte); }
  return h;
}
export function canonicalLabels(text) {
  const body = String(text).trim().replace(/^\{|\}$/g, '');
  if (!body.trim()) throw new Error('Informe ao menos um label, como {app="checkout"}.');
  const pairs = [];
  const re = /\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(,|$)/y;
  let m;
  while (re.lastIndex < body.length && (m = re.exec(body))) pairs.push([m[1], m[2]]);
  if (re.lastIndex < body.length || !pairs.length) throw new Error('Use o formato {nome="valor", …} com nomes válidos.');
  const names = new Set();
  for (const [name] of pairs) { if (names.has(name)) throw new Error('Label duplicado: ' + name); names.add(name); }
  pairs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return '{' + pairs.map(([n, v]) => n + '="' + v + '"').join(', ') + '}';
}
export function withServiceName(canonical, discover = ['service', 'app', 'application', 'app_name', 'name', 'app_kubernetes_io_name', 'container', 'container_name', 'k8s_container_name', 'component', 'workload', 'job', 'k8s_job_name']) {
  if (/(^|[{ ])service_name="/.test(canonical) || !discover.length) return canonical;
  let value = 'unknown_service';
  for (const name of discover) { const m = canonical.match(new RegExp('(?:^|[{ ])' + name + '="((?:[^"\\\\]|\\\\.)*)"')); if (m && m[1] !== '') { value = m[1]; break; } }
  return canonicalLabels(canonical.slice(0, -1) + ', service_name="' + value + '"}');
}
export function chunkKey({ tenant, fingerprint, fromMs, throughMs, checksum }) {
  return tenant + '/' + fingerprint.toString(16) + '/' + Math.trunc(fromMs).toString(16) + ':' + Math.trunc(throughMs).toString(16) + ':' + (checksum >>> 0).toString(16);
}
export function tableFor(ms, prefix = 'index_', periodHours = 24) {
  return prefix + Math.floor(ms / 1000 / (periodHours * 3600));
}

// ---------------------------------------------------------------------------
// 10. Fontes de uma tarefa de consulta
// Regras: pkg/querier/intervals.go (BuildQueryIntervalsWithLookback), com
// query_store_max_look_back_period = 0 (default).
// ---------------------------------------------------------------------------
export function querySources({ startHoursAgo, endHoursAgo, queryIngestersWithinH = 3, maxChunkAgeH = 2, indexDelayMin = 16 }) {
  if (!(startHoursAgo > endHoursAgo && endHoursAgo >= 0)) throw new Error('O início deve ser mais antigo que o fim.');
  const ingesters = queryIngestersWithinH === 0 || endHoursAgo < queryIngestersWithinH;
  // Pior caso: um dado fica só no ingester até o fim de max_chunk_age e mais o tempo até o índice ser enviado.
  const onlyInIngesterH = maxChunkAgeH + indexDelayMin / 60;
  const gap = queryIngestersWithinH !== 0 && queryIngestersWithinH < onlyInIngesterH;
  const gapRange = gap ? [queryIngestersWithinH, onlyInIngesterH] : null;
  // Com query_store_max_look_back_period = 0, ingesters consultados recebem o intervalo inteiro;
  // a lacuna só aparece quando a tarefa termina antes de agora − query_ingesters_within.
  const touchesGap = gap && !ingesters && endHoursAgo < onlyInIngesterH;
  return {
    ingesters: ingesters ? [startHoursAgo, endHoursAgo] : null,
    store: [startHoursAgo, endHoursAgo],
    onlyInIngesterH, gap, gapRange, touchesGap
  };
}

// ---------------------------------------------------------------------------
// 11. Domínios de falha × réplicas
// Regras: dskit ring (zone awareness: uma réplica por zona) e Filter (minSuccess = RF/2+1).
// Simplificação: sem zone awareness, as réplicas de um stream são tratadas como uma
// amostra uniforme de ingesters distintos (o ring real percorre tokens aleatórios).
// ---------------------------------------------------------------------------
const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
export function domainsOutcome({ replicationFactor = 3, zones = 3, ingestersPerZone = 3, zoneAware = true, failure = 'zone' }) {
  if (![1, 3].includes(replicationFactor)) throw new Error('Use RF 1 ou 3.');
  if (![1, 3].includes(zones)) throw new Error('Use 1 ou 3 zonas.');
  if (!(Number.isInteger(ingestersPerZone) && ingestersPerZone >= 1 && ingestersPerZone <= 10)) throw new Error('Use de 1 a 10 ingesters por zona.');
  const total = zones * ingestersPerZone;
  if (replicationFactor > total) throw new Error('RF maior que o número de ingesters.');
  const aware = zoneAware && zones >= replicationFactor && zones > 1;
  const minSuccess = Math.floor(replicationFactor / 2) + 1;
  const tolerated = replicationFactor - minSuccess;
  const failed = failure === 'zone' ? ingestersPerZone : failure === 'two-nodes' ? Math.min(2, total) : 1;
  let lostFraction;
  if (aware && failure === 'zone') lostFraction = 1 > tolerated ? 1 : 0;
  else if (aware && failure === 'two-nodes' && ingestersPerZone >= 2) {
    // Dois ingesters da mesma zona: cada stream tem no máximo uma réplica nessa zona.
    lostFraction = 0;
  } else {
    let p = 0;
    for (let k = tolerated + 1; k <= replicationFactor; k++) p += choose(failed, k) * choose(total - failed, replicationFactor - k) / choose(total, replicationFactor);
    lostFraction = p;
  }
  const fullyLost = aware ? 0 : choose(failed, replicationFactor) / choose(total, replicationFactor);
  return { total, failed, aware, minSuccess, tolerated, lostFraction, dataAtRisk: replicationFactor === 1 ? failed / total : fullyLost };
}
