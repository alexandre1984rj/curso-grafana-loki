// Motor das simulações por objetos.
// Funções puras e determinísticas: mesmos parâmetros produzem os mesmos frames.
// Nenhuma delas toca o DOM; a apresentação fica em src/lab/stage.js e src/lab/labs.js.
// Cada regra traz o arquivo da tag v3.7.0 do Loki em que foi conferida, ou declara a simplificação.
import { tokenFor } from '../sims.js';

export const TENANT = 'fake';
export const U32 = 2 ** 32;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
// PRNG mulberry32: reprodutível, sem depender de Math.random.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / U32;
  };
}
const utf8 = text => new TextEncoder().encode(text);
// FNV-1a 32 bits, usado como segunda função de hash nos bloom filters e para sementes.
export function fnv1a(text, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (const byte of utf8(text)) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
export const hex = (n, width = 8) => (n >>> 0).toString(16).padStart(width, '0');

// Conjunto canônico de labels: nomes ordenados, como parseStreamLabels faz no distributor
// (pkg/distributor/distributor.go, parseStreamLabels). A ordem de chegada não importa.
export function canon(labels) {
  const keys = Object.keys(labels).filter(k => labels[k] !== undefined && labels[k] !== '').sort();
  return '{' + keys.map(k => k + '="' + labels[k] + '"').join(', ') + '}';
}
// Token do ring: FNV-32 de tenant + labels canônicos (pkg/util/ring/ring.go, TokenFor).
export const streamToken = (labels, tenant = TENANT) => tokenFor(tenant, typeof labels === 'string' ? labels : canon(labels));

// ---------------------------------------------------------------------------
// Lab 1: labels criam streams
// ---------------------------------------------------------------------------
export const LAB1_KEYS = ['app', 'host', 'env', 'level'];
export const lab1Events = [
  { id: 1, labels: { app: 'checkout', host: 'srv-a', env: 'prod', level: 'info' }, line: 'pedido 1042 criado' },
  { id: 2, labels: { app: 'checkout', host: 'srv-a', env: 'prod', level: 'error' }, line: 'payment timeout pedido 1043' },
  { id: 3, labels: { host: 'srv-b', app: 'payments', env: 'prod', level: 'info' }, line: 'cobrança autorizada' },
  { id: 4, labels: { app: 'checkout', host: 'srv-b', env: 'prod', level: 'info' }, line: 'pedido 1044 criado' },
  { id: 5, labels: { env: 'prod', level: 'info', app: 'checkout', host: 'srv-a' }, line: 'pedido 1045 criado' },
  { id: 6, labels: { app: 'frontend', host: 'srv-c', env: 'prod', level: 'warn' }, line: 'GET /carrinho 1,8 s' },
  { id: 7, labels: { app: 'payments', host: 'srv-b', env: 'prod', level: 'error' }, line: 'gateway respondeu 503' },
  { id: 8, labels: { app: 'checkout', host: 'srv-a', env: 'staging', level: 'info' }, line: 'pedido de teste criado' },
  { id: 9, labels: { app: 'frontend', host: 'srv-c', env: 'prod', level: 'info' }, line: 'GET /produtos 120 ms' },
  { id: 10, labels: { app: 'checkout', host: 'srv-a', env: 'prod', level: 'info' }, line: 'pedido 1046 criado' }
];

export function groupStreams(events, keys) {
  const streams = new Map();
  const steps = [];
  for (const event of events) {
    const labels = Object.fromEntries(keys.filter(k => event.labels[k] !== undefined).map(k => [k, event.labels[k]]));
    const key = canon(labels);
    const isNew = !streams.has(key);
    if (isNew) streams.set(key, { key, labels, token: streamToken(key), events: [], order: streams.size });
    streams.get(key).events.push(event.id);
    steps.push({ event: event.id, stream: key, isNew, arrival: Object.keys(event.labels).filter(k => keys.includes(k)) });
  }
  return { streams: [...streams.values()], steps };
}

// ---------------------------------------------------------------------------
// Lab 2: cardinalidade A × B
// Premissas declaradas: linhas de 300 bytes; razão de compressão 5; chunk fechado por
// chunk_target_size (1.572.864 bytes comprimidos), chunk_idle_period (30 min) ou max_chunk_age (2 h),
// defaults em docs/sources/shared/configuration.md v3.7.0. "Entradas de índice" = séries +
// referências de chunk (simplificação do TSDB: cada chunk vira um ChunkMeta da série).
// ---------------------------------------------------------------------------
export const CARD_DEFAULTS = { clusters: 2, namespaces: 4, apps: 6, envs: 2, eventsPerMin: 300, minutes: 60, pod: false, trace_id: false, order_id: false, podsPerApp: 6, linesPerTrace: 4, linesPerOrder: 12, seed: 7 };
export const LIMITS = { maxGlobalStreams: 5000, idleMin: 30, maxChunkAgeMin: 120, targetBytes: 1572864, ratio: 5, lineBytes: 300 };

export function cardinalityRun(input = {}) {
  const p = { ...CARD_DEFAULTS, ...input };
  for (const k of ['clusters', 'namespaces', 'apps', 'envs', 'eventsPerMin', 'minutes', 'podsPerApp']) if (!(Number.isInteger(p[k]) && p[k] >= 1)) throw new Error('Parâmetro inválido: ' + k);
  if (p.eventsPerMin > 2000 || p.minutes > 120) throw new Error('Use até 2000 eventos/min e 120 min.');
  const r = rng(p.seed);
  const scen = { A: new Map(), B: new Map() };
  const chunks = { A: 0, B: 0 };
  const flushed = { A: { idle: 0, full: 0, age: 0 }, B: { idle: 0, full: 0, age: 0 } };
  const rejected = { A: 0, B: 0 };
  const activeCount = { A: 0, B: 0 };
  const frames = [];
  const highKeys = ['pod', 'trace_id', 'order_id'].filter(k => p[k]);
  let traceSeq = 0, orderSeq = 0, traceLeft = 0, orderLeft = 0;
  const chunkCap = LIMITS.targetBytes * LIMITS.ratio; // bytes brutos que enchem um chunk
  const ceiling = p.clusters * p.namespaces * p.apps * p.envs;
  for (let minute = 1; minute <= p.minutes; minute++) {
    for (let i = 0; i < p.eventsPerMin; i++) {
      const base = { cluster: 'c' + Math.floor(r() * p.clusters), namespace: 'ns' + Math.floor(r() * p.namespaces), app: 'app' + Math.floor(r() * p.apps), env: ['prod', 'staging', 'dev', 'qa', 'perf'][Math.floor(r() * p.envs)] };
      if (traceLeft <= 0) { traceSeq++; traceLeft = p.linesPerTrace; }
      if (orderLeft <= 0) { orderSeq++; orderLeft = p.linesPerOrder; }
      traceLeft--; orderLeft--;
      const high = { pod: base.app + '-' + Math.floor(r() * p.podsPerApp), trace_id: 't' + traceSeq, order_id: 'o' + orderSeq };
      const keyA = canon(base);
      const keyB = canon({ ...base, ...Object.fromEntries(highKeys.map(k => [k, high[k]])) });
      for (const [name, key] of [['A', keyA], ['B', keyB]]) {
        const map = scen[name];
        let s = map.get(key);
        if (!s) {
          if (activeCount[name] >= LIMITS.maxGlobalStreams) { rejected[name]++; continue; }
          s = { key, lines: 0, open: true, bytes: 0, chunkStart: minute, last: minute, chunks: 1 };
          map.set(key, s); chunks[name]++; activeCount[name]++;
        } else if (!s.open) {
          if (activeCount[name] >= LIMITS.maxGlobalStreams) { rejected[name]++; continue; }
          s.open = true; s.bytes = 0; s.chunkStart = minute; s.chunks++; chunks[name]++; activeCount[name]++;
        }
        s.lines++; s.bytes += LIMITS.lineBytes; s.last = minute;
        if (s.bytes >= chunkCap) { flushed[name].full++; s.bytes = 0; s.chunks++; chunks[name]++; s.chunkStart = minute; }
      }
    }
    // Fechamentos por relógio (flush loop do ingester).
    for (const name of ['A', 'B']) for (const s of scen[name].values()) {
      if (!s.open) continue;
      if (minute - s.last >= LIMITS.idleMin) { s.open = false; flushed[name].idle++; activeCount[name]--; }
      else if (minute - s.chunkStart >= LIMITS.maxChunkAgeMin) { flushed[name].age++; s.chunkStart = minute; s.chunks++; chunks[name]++; s.bytes = 0; }
    }
    const snap = name => {
      const list = [...scen[name].values()];
      const total = list.length;
      const active = activeCount[name];
      const lines = list.reduce((n, s) => n + s.lines, 0);
      return {
        streams: total, active, chunks: chunks[name], index: total + chunks[name],
        avgLinesPerStream: total ? lines / total : 0,
        avgChunkKB: chunks[name] ? lines * LIMITS.lineBytes / LIMITS.ratio / chunks[name] / 1024 : 0,
        rejected: rejected[name], flushed: { ...flushed[name] },
        sizes: list.slice(-900).map(s => s.lines)
      };
    };
    frames.push({ minute, A: snap('A'), B: snap('B') });
  }
  const highCeiling = highKeys.length ? '∞ (valores sem limite)' : ceiling;
  return { params: p, highKeys, ceiling, highCeiling, frames };
}

// ---------------------------------------------------------------------------
// Lab 3: hash ring
// Regras: vendor/github.com/grafana/dskit/ring/util.go (searchToken: primeiro token > chave,
// volta ao início no fim do anel) e ring.go (findInstancesForKey: anda no sentido horário
// pulando instâncias repetidas até reunir RF instâncias distintas).
// Simplificação: tokens por instância sorteados com semente fixa; o Loki usa 128 por padrão.
// ---------------------------------------------------------------------------
export const INGESTER_NAMES = ['ingester-0', 'ingester-1', 'ingester-2', 'ingester-3', 'ingester-4', 'ingester-5', 'ingester-6', 'ingester-7'];

export function instanceTokens(id, count) {
  const r = rng(fnv1a(id));
  const set = new Set();
  while (set.size < count) set.add(Math.floor(r() * U32) >>> 0);
  return [...set];
}
export function buildRing(ids, tokensPerInstance = 4) {
  if (!ids.length) return { ids: [], tokens: [] };
  const tokens = ids.flatMap(id => instanceTokens(id, tokensPerInstance).map(token => ({ token, owner: id })));
  tokens.sort((a, b) => a.token - b.token);
  return { ids: [...ids], tokens, tokensPerInstance };
}
export function searchToken(tokens, key) {
  let lo = 0, hi = tokens.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tokens[mid].token <= key) lo = mid + 1; else hi = mid; }
  return lo >= tokens.length ? 0 : lo;
}
export function lookup(ring, key, rf = 3) {
  if (!ring.tokens.length) return { start: -1, walk: [], replicas: [] };
  const start = searchToken(ring.tokens, key);
  const want = Math.min(rf, ring.ids.length);
  const walk = [], replicas = [];
  for (let i = 0; replicas.length < want && i < ring.tokens.length; i++) {
    const idx = (start + i) % ring.tokens.length;
    const owner = ring.tokens[idx].owner;
    const fresh = !replicas.includes(owner);
    walk.push({ idx, token: ring.tokens[idx].token, owner, taken: fresh });
    if (fresh) replicas.push(owner);
  }
  return { start, walk, replicas };
}
export function distribute(ring, streams, rf = 3) {
  const load = Object.fromEntries(ring.ids.map(id => [id, { primary: 0, replica: 0 }]));
  const owners = {};
  for (const s of streams) {
    const res = lookup(ring, s.token, rf);
    owners[s.key] = res.replicas;
    res.replicas.forEach((id, i) => { load[id][i === 0 ? 'primary' : 'replica']++; });
  }
  return { load, owners };
}
// Fração do anel que cada instância possui (soma dos arcos que terminam nos seus tokens).
export function ownership(ring) {
  const out = Object.fromEntries(ring.ids.map(id => [id, 0]));
  const t = ring.tokens;
  for (let i = 0; i < t.length; i++) {
    const prev = t[(i - 1 + t.length) % t.length].token;
    const arc = t.length === 1 ? U32 : (t[i].token - prev + U32) % U32;
    out[t[i].owner] += arc / U32;
  }
  return out;
}
export const ringStreams = [
  { app: 'checkout', env: 'prod', namespace: 'shop' }, { app: 'payments', env: 'prod', namespace: 'shop' },
  { app: 'frontend', env: 'prod', namespace: 'web' }, { app: 'checkout', env: 'staging', namespace: 'shop' },
  { app: 'catalog', env: 'prod', namespace: 'shop' }, { app: 'auth', env: 'prod', namespace: 'identity' },
  { app: 'search', env: 'prod', namespace: 'web' }, { app: 'banking-api', env: 'prod', namespace: 'banking' },
  { app: 'ledger', env: 'prod', namespace: 'banking' }, { app: 'notifier', env: 'prod', namespace: 'ops' },
  { app: 'gateway', env: 'prod', namespace: 'edge' }, { app: 'frontend', env: 'staging', namespace: 'web' }
].map(labels => { const key = canon(labels); return { key, labels, token: streamToken(key) }; });

export const LOOKUP_STEPS = [
  ['Distributor recebe o push', 'O lote chega por HTTP. Cada stream do lote é tratado em separado.'],
  ['Identifica o stream', 'Os labels são ordenados e formam a string canônica. Ordem de chegada não importa.'],
  ['Calcula o hash', 'TokenFor = FNV-32(tenant + labels canônicos): um número entre 0 e 2³²−1.'],
  ['Posiciona no anel', 'O número vira um ângulo. O anel tem 2³² posições; cada ingester registrou tokens nele.'],
  ['Procura o dono', 'Anda no sentido horário até o primeiro token maior que o hash. O dono desse token recebe o stream.'],
  ['Replica', 'Continua andando e pula tokens de ingesters já escolhidos até reunir RF instâncias distintas. Todas recebem a mesma cópia.']
];

// ---------------------------------------------------------------------------
// Lab 4: automatic stream sharding
// Regras: pkg/distributor/distributor.go v3.7.0 — shardCountFor (sem taxa conhecida, 1 shard),
// calculateShards = ceil((taxa + push) / desired_rate) quando > 1, divideEntriesBetweenShards
// (rodízio de entradas) e createShard (label __stream_shard__ e novo TokenFor por shard).
// Limite por stream: per_stream_rate_limit 3MB e burst 15MB (balde de tokens por stream no ingester).
// Simplificações: a taxa vista pelo distributor é a do segundo anterior (o rate store atualiza
// a cada segundo, docs/sources/operations/automatic-stream-sharding.md); o tamanho do push é desprezado;
// RF=1 para mostrar a carga de cada shard sem cópias.
// ---------------------------------------------------------------------------
export const MB = 1024 * 1024;
export function calculateShards(rate, desired) {
  const shards = rate / desired;
  return shards <= 1 ? 1 : Math.ceil(shards);
}
export function shardingRun({ targetMBps = 6, rampSeconds = 6, seconds = 16, desiredMB = 1.5, limitMB = 3, burstMB = 15, enabled = true, ingesters = 6, labels = { app: 'kafka-bridge', env: 'prod' } } = {}) {
  if (!(targetMBps > 0 && desiredMB > 0 && limitMB > 0 && burstMB >= limitMB)) throw new Error('Parâmetros inválidos.');
  const ring = buildRing(INGESTER_NAMES.slice(0, ingesters), 8);
  const baseKey = canon(labels);
  const buckets = new Map();
  const frames = [];
  let prevRate = 0, totalDropped = 0, totalIn = 0;
  const shardKeyOf = n => canon({ ...labels, __stream_shard__: String(n) });
  for (let t = 0; t < seconds; t++) {
    const rate = Math.min(targetMBps, 0.5 + (targetMBps - 0.5) * Math.min(1, t / Math.max(1, rampSeconds))) * MB;
    const shards = !enabled || prevRate === 0 ? 1 : calculateShards(prevRate, desiredMB * MB);
    const keys = shards === 1 ? [baseKey] : Array.from({ length: shards }, (_, n) => shardKeyOf(n));
    const perShard = keys.map(key => {
      const token = streamToken(key);
      const ingester = lookup(ring, token, 1).replicas[0];
      const incoming = rate / shards;
      if (!buckets.has(key)) buckets.set(key, burstMB * MB);
      const tokens = buckets.get(key);
      const accepted = Math.min(incoming, tokens);
      buckets.set(key, Math.min(burstMB * MB, tokens - accepted + limitMB * MB));
      return { key, token, ingester, incoming, accepted, dropped: incoming - accepted, bucket: buckets.get(key) };
    });
    const dropped = perShard.reduce((n, s) => n + s.dropped, 0);
    totalDropped += dropped; totalIn += rate;
    const load = Object.fromEntries(ring.ids.map(id => [id, 0]));
    for (const s of perShard) load[s.ingester] += s.incoming;
    frames.push({ t, rate, observed: prevRate, shards, perShard, dropped, totalDropped, totalIn, load, streamsCreated: new Set([...buckets.keys()]).size });
    prevRate = rate;
  }
  return { ring, baseKey, frames, params: { targetMBps, desiredMB, limitMB, burstMB, enabled, ingesters } };
}

// ---------------------------------------------------------------------------
// Lab 5: label × structured metadata × linha
// Fontes: docs/sources/get-started/labels/{_index,cardinality,structured-metadata,bp-labels}.md v3.7.0.
// ---------------------------------------------------------------------------
export const FIELDS = [
  { key: 'cluster', value: 'production', card: 3, inLine: false, kind: 'origem', note: 'Poucos valores, muda raramente, todo mundo filtra por ele.' },
  { key: 'namespace', value: 'banking', card: 25, inLine: false, kind: 'origem', note: 'Dezenas de valores estáveis.' },
  { key: 'pod', value: 'banking-api-7f9d8', card: 400, inLine: false, kind: 'efêmero', note: 'Muda a cada deploy ou restart: centenas por dia.' },
  { key: 'trace_id', value: 'abc123', card: 2e6, inLine: true, kind: 'requisição', note: 'Um valor por requisição.' },
  { key: 'order_id', value: '987654', card: 3e5, inLine: true, kind: 'requisição', note: 'Um valor por pedido.' },
  { key: 'level', value: 'error', card: 5, inLine: true, kind: 'conteúdo', note: 'Poucos valores, mas já está na linha e divide streams pequenos.' }
];
export const BINS = { label: 'Label indexado', sm: 'Structured metadata', line: 'Linha do log' };
export function classify(assign, { apps = 8 } = {}) {
  const labels = FIELDS.filter(f => assign[f.key] === 'label');
  const streamsPerDay = labels.reduce((n, f) => n * f.card, apps);
  const verdicts = FIELDS.map(f => {
    const where = assign[f.key] || 'line';
    let tone, text, query;
    if (where === 'label') {
      query = '{' + f.key + '="' + f.value + '"}';
      if (f.card <= 30) { tone = 'good'; text = 'Seleciona streams pelo índice antes de ler qualquer chunk. Cardinalidade baixa: poucas séries a mais.'; }
      else if (f.card <= 1000) { tone = 'warn'; text = 'Multiplica streams por ~' + f.card + '. Cada pod novo abre streams novos e fecha os antigos por idle: chunks menores e índice maior.'; }
      else { tone = 'bad'; text = 'Cada valor cria um stream de vida curta: milhões de séries, chunks quase vazios e 429 stream_limit. Transforma o índice num índice invertido, o oposto do desenho do Loki.'; }
    } else if (where === 'sm') {
      query = '{app="banking"} | ' + f.key + '="' + f.value + '"';
      if (f.card <= 30) { tone = 'warn'; text = 'Funciona, mas não ajuda a escolher streams: todo chunk do seletor é lido. Para origem estável, label é melhor.'; }
      else if (f.inLine) { tone = 'warn'; text = 'Válido e filtrável sem parser. Mas o valor já está na linha: duplicá-lo custa bytes por entrada (conta no limite de taxa e em max_structured_metadata_size). A doc recomenda SM quando o valor não está na linha.'; }
      else { tone = 'good'; text = 'Recomendado pela documentação para valores de alta cardinalidade que não estão na linha (ex.: nomes de pod). Não cria stream, filtra sem parser e é o que os bloom filters (experimentais) indexam.'; }
    } else {
      query = f.inLine ? '{app="banking"} |= "' + f.value + '"' : '{app="banking"} |= "' + f.value + '"  (valor não existe na linha!)';
      if (!f.inLine) { tone = 'bad'; text = 'Este valor não está no texto do log: guardar "na linha" exigiria reescrever a linha (ex.: stage pack). Use SM.'; }
      else if (f.card > 1000) { tone = 'good'; text = 'Recomendação histórica e ainda válida quando o valor já está na linha: seletor estreito + filtro de linha. Custo: varre todos os chunks dos streams selecionados.'; }
      else { tone = 'good'; text = 'Fica no texto; extraia na consulta com parser se precisar agrupar.'; }
    }
    return { ...f, where, tone, text, query };
  });
  const labelCount = labels.length + 1; // + app (sempre presente no exemplo)
  return {
    verdicts, streamsPerDay, labelCount,
    overStreamLimit: streamsPerDay > LIMITS.maxGlobalStreams,
    overLabelLimit: labelCount > 15,
    smBytes: FIELDS.filter(f => assign[f.key] === 'sm').reduce((n, f) => n + f.key.length + String(f.value).length, 0)
  };
}

// ---------------------------------------------------------------------------
// Lab 6: LogQL em etapas
// Subconjunto implementado com a semântica do Loki: seletor (=, !=, =~, !~ ancorados), filtros de
// linha (|=, !=, |~, !~), parsers json e logfmt (chaves aninhadas achatadas com _), filtros de label
// sobre labels do stream, structured metadata e campos extraídos. Conflito entre campo extraído e
// label do stream vira <nome>_extracted (pkg/logql/log/parser.go, duplicateSuffix). Linha que não é JSON recebe
// __error__="JSONParserErr" e segue no pipeline.
// ---------------------------------------------------------------------------
export const logqlStreams = [
  { labels: { cluster: 'production', namespace: 'banking', app: 'banking' }, chunks: 3, lines: [
    { line: '{"level":"info","msg":"transfer accepted","trace_id":"abc123","amount":120}', sm: { trace_id: 'abc123' } },
    { line: '{"level":"error","msg":"ledger timeout","trace_id":"abc123","amount":120}', sm: { trace_id: 'abc123' } },
    { line: '{"level":"info","msg":"balance read","trace_id":"f00d42"}', sm: { trace_id: 'f00d42' } },
    { line: '{"level":"error","msg":"fraud check error","trace_id":"77aa01"}', sm: { trace_id: '77aa01' } }
  ] },
  { labels: { cluster: 'production', namespace: 'banking', app: 'payments' }, chunks: 2, lines: [
    { line: '{"level":"info","msg":"payment created","trace_id":"abc123"}', sm: {} },
    { line: '{"level":"warn","msg":"retrying gateway","trace_id":"9be001"}', sm: {} },
    { line: '{"level":"error","msg":"gateway error 503","trace_id":"9be001"}', sm: {} }
  ] },
  { labels: { cluster: 'staging', namespace: 'banking', app: 'banking' }, chunks: 1, lines: [
    { line: '{"level":"error","msg":"test error injected","trace_id":"abc123"}', sm: { trace_id: 'abc123' } },
    { line: '{"level":"info","msg":"smoke test ok","trace_id":"5e5e5e"}', sm: { trace_id: '5e5e5e' } }
  ] },
  { labels: { cluster: 'production', namespace: 'web', app: 'frontend' }, chunks: 4, lines: [
    { line: 'level=info msg="GET /home" status=200 trace_id=c0ffee', sm: {} },
    { line: 'level=error msg="GET /cart" status=500 trace_id=abc123', sm: {} },
    { line: 'level=info msg="GET /pay" status=200 trace_id=d1d1d1', sm: {} }
  ] }
].map((s, si) => ({ ...s, key: canon(s.labels), id: 's' + si, lines: s.lines.map((l, li) => ({ ...l, id: 's' + si + 'l' + li, bytes: utf8(l.line).length + Object.entries(l.sm).reduce((n, [k, v]) => n + k.length + v.length, 0) })) }));

export const LOGQL_PRESETS = [
  ['Seletor específico', '{cluster="production", app="banking"}'],
  ['Filtro de linha', '{app="banking"} |= "error"'],
  ['Parser JSON', '{app="banking"} | json'],
  ['trace_id como structured metadata', '{app="banking"} | trace_id="abc123"'],
  ['trace_id só no JSON: parser antes', '{app="payments"} | json | trace_id="abc123"'],
  ['Seletor amplo + filtro', '{namespace=~".+"} |= "abc123"'],
  ['Filtrar antes de interpretar', '{namespace="banking"} |= "error" | json | level="error"']
];

function lex(q) {
  const re = /\s*("(?:[^"\\]|\\.)*"|`[^`]*`|[a-zA-Z_][a-zA-Z0-9_]*|-?\d+(?:\.\d+)?|\|=|\|~|!=|!~|=~|>=|<=|==|[{}(),|=<>])/y;
  const out = []; let pos = 0;
  while (pos < q.length) {
    if (!q.slice(pos).trim()) break;
    re.lastIndex = pos; const m = re.exec(q);
    if (!m) throw new Error('Sintaxe não suportada perto de: ' + q.slice(pos, pos + 20));
    out.push(m[1]); pos = re.lastIndex;
  }
  return out;
}
const unq = t => t.startsWith('`') ? t.slice(1, -1) : JSON.parse(t);
const isStr = t => t && (t[0] === '"' || t[0] === '`');
const anchored = src => { try { return new RegExp('^(?:' + src + ')$'); } catch { throw new Error('Expressão regular inválida: ' + src); } };
function matcherFn(op, value) {
  if (op === '=') return v => (v ?? '') === value;
  if (op === '!=') return v => (v ?? '') !== value;
  const re = anchored(value);
  if (op === '=~') return v => re.test(v ?? '');
  if (op === '!~') return v => !re.test(v ?? '');
  throw new Error('Operador não suportado: ' + op);
}

export function parseLogQL(query) {
  const t = lex(String(query).trim());
  let i = 0;
  const peek = () => t[i];
  const take = exp => { const v = t[i++]; if (v === undefined || (exp && v !== exp)) throw new Error('Esperado ' + (exp || 'mais itens') + (v ? ', encontrado ' + v : '') + '.'); return v; };
  take('{');
  const matchers = [];
  while (peek() !== '}') {
    const name = take();
    if (!/^[a-zA-Z_]\w*$/.test(name)) throw new Error('Nome de label inválido: ' + name);
    const op = take();
    if (!['=', '!=', '=~', '!~'].includes(op)) throw new Error('Operador de seletor inválido: ' + op);
    const vt = take();
    if (!isStr(vt)) throw new Error('Valor do seletor deve estar entre aspas.');
    matchers.push({ name, op, value: unq(vt), test: matcherFn(op, unq(vt)) });
    if (peek() === ',') take(',');
    else if (peek() !== '}') throw new Error('Esperado , ou } no seletor.');
  }
  take('}');
  if (!matchers.length) throw new Error('O seletor precisa de pelo menos um matcher.');
  // O Loki recusa seletores em que todo matcher aceita o valor vazio (pkg/logql/syntax/parser.go, errAtleastOneEqualityMatcherRequired).
  if (matchers.every(m => m.test(''))) throw new Error('queries require at least one regexp or equality matcher that does not have an empty-compatible value. For instance, app=~".*" does not meet this requirement, but app=~".+" will');
  const stages = [];
  while (i < t.length) {
    const op = take();
    if (['|=', '!=', '|~', '!~'].includes(op)) {
      const vt = take(); if (!isStr(vt)) throw new Error('Filtro de linha precisa de texto entre aspas.');
      const v = unq(vt);
      const re = op.endsWith('~') ? new RegExp(v) : null;
      stages.push({ type: 'line', op, value: v, text: op + ' "' + v + '"', test: line => op === '|=' ? line.includes(v) : op === '!=' ? !line.includes(v) : op === '|~' ? re.test(line) : !re.test(line) });
    } else if (op === '|') {
      const word = take();
      if (word === 'json' || word === 'logfmt') { stages.push({ type: 'parser', parser: word, text: '| ' + word }); continue; }
      if (!/^[a-zA-Z_]\w*$/.test(word)) throw new Error('Etapa não suportada após |: ' + word);
      if (['unwrap', 'line_format', 'label_format', 'pattern', 'regexp', 'unpack', 'drop', 'keep', 'decolorize'].includes(word)) throw new Error('Etapa não suportada nesta simulação: | ' + word + '. É LogQL válido, mas o subconjunto aceita filtros de linha, | json, | logfmt e filtros de label.');
      const cmp = take();
      const vt = take();
      if (['=', '!=', '=~', '!~', '=='].includes(cmp) && isStr(vt)) {
        const fn = matcherFn(cmp === '==' ? '=' : cmp, unq(vt));
        stages.push({ type: 'label', name: word, text: '| ' + word + cmp + vt, test: fields => fn(fields[word]) });
      } else if (['>', '>=', '<', '<=', '==', '!='].includes(cmp) && /^-?\d/.test(vt)) {
        const n = Number(vt);
        const f = { '>': (a) => a > n, '>=': a => a >= n, '<': a => a < n, '<=': a => a <= n, '==': a => a === n, '!=': a => a !== n }[cmp];
        stages.push({ type: 'label', name: word, text: '| ' + word + cmp + vt, test: fields => fields[word] !== undefined && fields[word] !== '' && Number.isFinite(Number(fields[word])) && f(Number(fields[word])) });
      } else throw new Error('Filtro de label inválido perto de ' + word + '.');
    } else throw new Error('Etapa não suportada: ' + op + '. O subconjunto aceita filtros de linha, | json, | logfmt e filtros de label.');
  }
  return { matchers, stages };
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = (prefix ? prefix + '_' : '') + k.replace(/[^a-zA-Z0-9_]/g, '_');
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else if (!Array.isArray(v)) out[key] = String(v);
  }
  return out;
}
function parseLogfmt(line) {
  const out = {}; const re = /([a-zA-Z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g; let m;
  while ((m = re.exec(line))) out[m[1].replace(/\./g, '_')] = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
  return out;
}
function addExtracted(fields, streamLabels, extracted) {
  for (const [k, v] of Object.entries(extracted)) fields[k in streamLabels ? k + '_extracted' : k] = v;
}

export function runLogQL(query, streams = logqlStreams) {
  const plan = parseLogQL(query);
  const selected = streams.filter(s => plan.matchers.every(m => m.test(s.labels[m.name])));
  const totals = { streams: streams.length, chunks: streams.reduce((n, s) => n + s.chunks, 0), lines: streams.reduce((n, s) => n + s.lines.length, 0), bytes: streams.reduce((n, s) => n + s.lines.reduce((b, l) => b + l.bytes, 0), 0) };
  let rows = selected.flatMap(s => s.lines.map(l => ({ id: l.id, stream: s.id, line: l.line, bytes: l.bytes, fields: { ...s.labels, ...l.sm }, streamLabels: s.labels, sm: l.sm })));
  const stages = [{ type: 'selector', text: '{' + plan.matchers.map(m => m.name + m.op + JSON.stringify(m.value)).join(', ') + '}', kept: rows.map(r => r.id), dropped: [], streams: selected.map(s => s.id), chunks: selected.reduce((n, s) => n + s.chunks, 0), bytes: rows.reduce((n, r) => n + r.bytes, 0), note: 'Índice: ' + selected.length + ' de ' + streams.length + ' streams. Todos os chunks desses streams no intervalo serão lidos.' }];
  let parsed = 0;
  for (const st of plan.stages) {
    const before = rows;
    if (st.type === 'line') rows = rows.filter(r => st.test(r.line));
    else if (st.type === 'parser') {
      rows = rows.map(r => {
        parsed++;
        const fields = { ...r.fields };
        if (st.parser === 'json') {
          try { const obj = JSON.parse(r.line); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(); addExtracted(fields, r.streamLabels, flatten(obj)); }
          catch { fields.__error__ = 'JSONParserErr'; }
        } else addExtracted(fields, r.streamLabels, parseLogfmt(r.line));
        return { ...r, fields };
      });
    } else rows = rows.filter(r => st.test(r.fields));
    const keptIds = new Set(rows.map(r => r.id));
    stages.push({ type: st.type, text: st.text, kept: rows.map(r => r.id), dropped: before.filter(r => !keptIds.has(r.id)).map(r => r.id), errors: st.type === 'parser' ? rows.filter(r => r.fields.__error__).map(r => r.id) : [], note: stageNote(st, before.length, rows.length) });
  }
  const bloomEligible = plan.stages.findIndex(s => s.type === 'parser');
  const accel = plan.stages.filter((s, idx) => s.type === 'label' && (bloomEligible < 0 || idx < bloomEligible) && !plan.matchers.some(m => m.name === s.name)).map(s => s.name);
  return { plan, totals, selected: selected.map(s => s.id), stages, rows, parsed, bloomCandidates: accel };
}
function stageNote(st, before, after) {
  if (st.type === 'line') return 'Filtro de linha: busca de texto em cada linha, sem interpretar. ' + (before - after) + ' descartadas.';
  if (st.type === 'parser') return 'Parser ' + st.parser + ': interpreta cada uma das ' + before + ' linhas que chegaram e extrai campos. É a etapa mais cara por linha.';
  return 'Filtro de label: compara o campo nas labels do stream, structured metadata ou campos extraídos. ' + (before - after) + ' descartadas.';
}

// ---------------------------------------------------------------------------
// Lab 7: bloom filters
// Regras (Loki v3.7.0): pkg/storage/bloom/v1/tokenizer.go — para cada par de structured metadata
// o builder insere name, prefixo_do_chunk+name, name=value e prefixo_do_chunk+name=value no bloom
// do stream; o gateway testa primeiro o token sem prefixo (pula o stream inteiro) e depois o
// prefixado (pula chunks). Experimental; só filtros `| chave="valor"` em structured metadata antes
// de qualquer parser (docs/sources/query/query_acceleration.md).
// Simplificação: hash duplo (Kirsch–Mitzenmacher) com FNV; o Loki usa outro esquema de hash
// e blooms escaláveis, com taxa de falso positivo configurada no builder.
// ---------------------------------------------------------------------------
export function bloomPositions(text, m, k) {
  const h1 = fnv1a(text), h2 = (fnv1a(text, 0x9747b28c) | 1) >>> 0;
  return Array.from({ length: k }, (_, i) => (h1 + Math.imul(i, h2) >>> 0) % m);
}
export function bloomNew(m, k) { return { m, k, bits: new Uint8Array(m), n: 0 }; }
export function bloomAdd(b, text) { for (const p of bloomPositions(text, b.m, b.k)) b.bits[p] = 1; b.n++; return b; }
export function bloomTest(b, text) { return bloomPositions(text, b.m, b.k).every(p => b.bits[p] === 1); }
export const fpRate = (m, k, n) => Math.pow(1 - Math.exp(-k * n / m), k);

export function bloomScenario({ m = 128, k = 3, streams = 4, chunksPerStream = 3, idsPerChunk = 3, target = 'abc123', seed = 11, plant = [[1, 1]], extra = [] } = {}) {
  if (!(m >= 8 && m <= 1024 && k >= 1 && k <= 8)) throw new Error('Use m entre 8 e 1024 e k entre 1 e 8.');
  const r = rng(seed);
  const data = [];
  for (let s = 0; s < streams; s++) {
    const labels = { cluster: 'prod', app: ['checkout', 'payments', 'ledger', 'frontend', 'search', 'auth'][s % 6] };
    const bloom = bloomNew(m, k);
    const chunks = [];
    for (let c = 0; c < chunksPerStream; c++) {
      const ref = hex(fnv1a('chunk' + s + '-' + c), 6);
      const ids = new Set();
      while (ids.size < idsPerChunk) ids.add(hex(Math.floor(r() * U32), 6));
      for (const [ps, pc] of plant) if (ps === s && pc === c) ids.add('abc123');
      for (const e of extra) if (e.stream === s && e.chunk === c) ids.add(e.id);
      chunks.push({ ref, ids: [...ids] });
    }
    for (const ch of chunks) for (const id of ch.ids) {
      // Os quatro tokens do StructuredMetadataTokenizer.
      for (const tok of ['trace_id', ch.ref + 'trace_id', 'trace_id=' + id, ch.ref + 'trace_id=' + id]) bloomAdd(bloom, tok);
    }
    data.push({ id: 's' + s, key: canon(labels), labels, bloom, chunks });
  }
  const probe = 'trace_id=' + target;
  const results = data.map(st => {
    const streamMaybe = bloomTest(st.bloom, probe);
    const chunks = st.chunks.map(ch => {
      const chunkProbe = ch.ref + probe;
      const maybe = streamMaybe && bloomTest(st.bloom, chunkProbe);
      const present = ch.ids.includes(target);
      const verdict = !streamMaybe ? 'skip-stream' : !maybe ? 'skip-chunk' : present ? 'match' : 'false-positive';
      return { ...ch, probe: chunkProbe, positions: bloomPositions(chunkProbe, m, k), maybe, present, verdict };
    });
    return { ...st, probe, positions: bloomPositions(probe, m, k), streamMaybe, chunks, fill: st.bloom.bits.reduce((a, b) => a + b, 0) / m };
  });
  const all = results.flatMap(s => s.chunks);
  const count = v => all.filter(c => c.verdict === v).length;
  const falseNegatives = all.filter(c => c.present && !c.maybe).length;
  return {
    m, k, target, probe, streams: results,
    totals: { chunks: all.length, skipped: count('skip-stream') + count('skip-chunk'), downloaded: count('match') + count('false-positive'), matches: count('match'), falsePositives: count('false-positive'), falseNegatives },
    theoreticalFp: fpRate(m, k, results[0] ? results[0].bloom.n : 0)
  };
}

// ---------------------------------------------------------------------------
// Simulador de ingestão até o object storage (módulo 1)
// Regras: TokenFor + ring (acima); ingester mantém um chunk aberto por stream e o fecha quando
// enche ou fica ocioso (pkg/ingester/flush.go, motivos "full" e "idle"); o flush grava o chunk
// no bucket e a referência no índice TSDB (pkg/storage/stores/shipper/indexshipper/tsdb).
// Simplificações em escala: um chunk "cheio" tem `chunkLines` linhas (o real tem ~1,5 MB
// comprimido) e "ocioso" é `idleTicks` ticks sem linha nova (o real é chunk_idle_period, 30 min).
// ---------------------------------------------------------------------------
export const INGEST_SOURCES = [
  { labels: { app: 'checkout', env: 'prod' }, weight: 4, lines: ['pedido criado', 'payment timeout', 'pedido pago', 'estoque reservado'] },
  { labels: { app: 'payments', env: 'prod' }, weight: 3, lines: ['cobrança autorizada', 'gateway 503', 'estorno feito'] },
  { labels: { app: 'checkout', env: 'staging' }, weight: 1, lines: ['pedido de teste', 'smoke ok'] },
  { labels: { app: 'frontend', env: 'prod' }, weight: 2, lines: ['GET /home 200', 'GET /cart 500', 'GET /pay 200'] }
];
export function ingestRun({ ticks = 14, eventsPerTick = 3, ingesters = 3, rf = 1, chunkLines = 6, idleTicks = 4, seed = 3, extraLabel = null } = {}) {
  if (!(ingesters >= 1 && ingesters <= 5 && [1, 3].includes(rf) && chunkLines >= 2 && eventsPerTick >= 1 && eventsPerTick <= 8)) throw new Error('Parâmetros inválidos.');
  const r = rng(seed);
  const ring = buildRing(INGESTER_NAMES.slice(0, ingesters), 8);
  const weights = INGEST_SOURCES.flatMap((s, i) => Array(s.weight).fill(i));
  const streams = new Map(); // chave → { key, labels, token, owners, heads: {ing: [...]}, last }
  const bucket = [], index = [];
  const frames = [];
  let seq = 0, chunkSeq = 0, flushedNow = [];
  const snapshot = (phase, inbox, note, flushedNow = []) => ({
    phase, note, inbox: inbox.map(e => ({ ...e })), flushedNow,
    ingesters: ring.ids.map(id => ({ id, streams: [...streams.values()].filter(s => s.heads[id]).map(s => ({ key: s.key, labels: s.labels, token: s.token, lines: [...s.heads[id]], primary: s.owners[0] === id })) })),
    bucket: bucket.slice(-24).map(c => ({ ...c })), index: index.slice(-10).map(x => ({ ...x })),
    totals: { events: seq, streams: streams.size, chunks: bucket.length, objects: bucket.length * rf, index: index.length }
  });
  for (let t = 0; t < ticks; t++) {
    const inbox = [];
    for (let i = 0; i < eventsPerTick; i++) {
      const src = INGEST_SOURCES[pick(r, weights)];
      const labels = { ...src.labels };
      if (extraLabel === 'request_id') labels.request_id = 'req-' + (seq + 1);
      if (extraLabel === 'pod') labels.pod = src.labels.app + '-' + Math.floor(r() * 3);
      const key = canon(labels);
      seq++;
      inbox.push({ id: 'e' + seq, key, labels, token: streamToken(key), line: pick(r, src.lines), t });
    }
    flushedNow = [];
    frames.push(snapshot('arrive', inbox, 'Tick ' + (t + 1) + ': ' + inbox.length + ' linha(s) chegam ao distributor. Cada uma ganha a identidade do stream (labels canônicos) e o hash FNV-32.'));
    for (const e of inbox) {
      let s = streams.get(e.key);
      if (!s) { s = { key: e.key, labels: e.labels, token: e.token, owners: lookup(ring, e.token, rf).replicas, heads: {}, last: t, from: t }; streams.set(e.key, s); }
      for (const id of s.owners) (s.heads[id] ??= []).push(id === s.owners[0] ? e.id : e.id + '@' + id);
      s.last = t;
      // O corte acontece no append: o chunk nunca passa de chunkLines linhas.
      if (s.heads[s.owners[0]].length >= chunkLines) cut(s, 'full', t);
    }
    for (const s of streams.values()) {
      const head = s.heads[s.owners[0]];
      if (head && head.length && t - s.last >= idleTicks) cut(s, 'idle', t);
    }
    frames.push(snapshot('deliver', [], 'As linhas entram no chunk aberto do seu stream, no ingester dono do token' + (rf > 1 ? ' e nas réplicas' : '') + '. ' + (flushedNow.length ? flushedNow.length + ' chunk(s) fechado(s) e enviado(s) ao bucket, com referência no índice.' : 'Nenhum chunk fechou neste tick.'), flushedNow));
  }
  return { ring, frames, params: { ticks, eventsPerTick, ingesters, rf, chunkLines, idleTicks, extraLabel } };
  function cut(s, reason, t) {
      const head = s.heads[s.owners[0]];
      chunkSeq++;
      const chunk = { id: 'c' + chunkSeq, key: s.key, labels: s.labels, lines: head.length, reason, ref: TENANT + '/' + hex(s.token) + '/' + hex(chunkSeq * 7919, 4), from: s.from, through: t };
      bucket.push(chunk); index.push({ id: 'x' + chunkSeq, key: s.key, chunk: chunk.id, ref: chunk.ref });
      flushedNow.push(chunk.id);
      for (const id of s.owners) s.heads[id] = [];
      s.from = t;
  }
}
