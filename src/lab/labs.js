// Laboratórios: cada um declara markup() e mount(root), como os modelos de widgets.js.
// Toda regra vem de engine.js; aqui só há desenho, controles e textos.
import * as E from './engine.js';
import { esc, fmt, chip, chips, metrics, labShell, flip, createPlayer, bindInspector, part } from './stage.js';

const KB = 1024;
const mb = bytes => fmt(bytes / E.MB, 2) + ' MB';
const ingIndex = id => Number(String(id).split('-')[1]);
const ingDot = id => '<span class="ing-dot" style="--c:var(--i' + ingIndex(id) + ')" aria-hidden="true"></span>';
const range = (id, label, min, max, value, step = 1, unit = '') => '<label class="ctl"><span>' + esc(label) + ' <output data-for="' + id + '">' + esc(value) + esc(unit) + '</output></span><input type="range" data-p="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" data-unit="' + esc(unit) + '"></label>';
const select = (id, label, options, value) => '<label class="ctl"><span>' + esc(label) + '</span><select data-p="' + id + '">' + options.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>';
const toggle = (id, label, checked) => '<label class="ctl ctl-toggle"><input type="checkbox" data-p="' + id + '"' + (checked ? ' checked' : '') + '> <span>' + label + '</span></label>';
function readParams(root) {
  const out = {};
  root.querySelectorAll('[data-p]').forEach(input => {
    out[input.dataset.p] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    const o = root.querySelector('output[data-for="' + input.dataset.p + '"]');
    if (o) o.textContent = input.value + (input.dataset.unit || '');
  });
  return out;
}
const onParams = (root, fn) => root.querySelector('.lab-controls')?.addEventListener('input', e => { if (e.target.matches('[data-p]')) fn(e.target); });

// ===========================================================================
// Simulador de ingestão até o object storage
// ===========================================================================
const ingest = {
  markup: () => labShell({
    id: 'ingest', n: 'Simulador · da linha ao bucket', title: 'Acompanhe linhas virando streams, chunks e objetos',
    question: 'Onde cada linha está em cada instante, e o que decide quando ela sai da memória do ingester?',
    controls: range('eventsPerTick', 'Linhas por tick', 1, 6, 3) + range('ingesters', 'Ingesters', 1, 5, 3) + select('rf', 'Fator de replicação', [[1, 'RF = 1 (laboratório)'], [3, 'RF = 3 (default)']], 1) + range('chunkLines', 'Linhas por chunk (escala)', 3, 10, 6) + select('extra', 'Label extra', [['', 'Nenhum'], ['pod', 'pod (3 por app)'], ['request_id', 'request_id (um por linha)']], ''),
    premises: 'stream = tenant + labels canônicos; token FNV-32 (<code>TokenFor</code>); dono = primeiro token maior no anel, réplicas nos próximos ingesters distintos; um chunk aberto por stream em cada réplica; fechamento por "full" ou "idle" (<code>pkg/ingester/flush.go</code>); o flush grava o chunk no bucket e a referência no índice.',
    limits: 'tamanhos e tempos estão em escala (um chunk real tem ~1,5 MB comprimido; idle real é 30 min). Não mostra WAL, blocos internos do chunk, compactação, nem o upload periódico do índice TSDB (a cada 15 min). Com RF=3 o Loki grava as três cópias no bucket; a deduplicação acontece na leitura.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    let run, frames;
    const describe = k => {
      const f = frames[player.index];
      if (k.startsWith('ing-')) { const ing = f.ingesters.find(i => i.id === k.slice(4)); return ing && { kind: 'Ingester', title: ing.id, rows: [['Streams em memória', ing.streams.length], ['Linhas no head', ing.streams.reduce((n, s) => n + s.lines.length, 0)], ['Tokens no anel', run.ring.tokensPerInstance + ' (o Loki usa 128)']], note: 'Mantém um chunk aberto por stream que recebeu. Responde consultas de dados recentes que ainda não foram para o bucket.' }; }
      if (k.startsWith('st-')) { for (const ing of f.ingesters) { const s = ing.streams.find(x => 'st-' + ing.id + '-' + E.hex(x.token) === k); if (s) return { kind: 'Stream', title: s.key, rows: [['Token (FNV-32)', '<code>0x' + E.hex(s.token) + '</code> = ' + fmt(s.token)], ['Ingester', ing.id + (s.primary ? ' (primeiro do anel)' : ' (réplica)')], ['Linhas no chunk aberto', s.lines.length + ' de ' + run.params.chunkLines]], note: 'Todas as linhas com estes labels exatos caem aqui, em qualquer instante.' }; } }
      if (k.startsWith('c')) { const c = f.bucket.find(x => x.id === k); return c && { kind: 'Chunk no object storage', title: c.ref, rows: [['Stream', '<code>' + esc(c.key) + '</code>'], ['Linhas', c.lines], ['Motivo do flush', c.reason === 'full' ? 'full: atingiu o tamanho alvo' : 'idle: ficou ocioso'], ['Intervalo', 'tick ' + (c.from + 1) + ' a ' + (c.through + 1)]], note: 'Objeto imutável. A chave real é tenant/fingerprint/início:fim:checksum.' }; }
      if (k.startsWith('e')) { const id = k.split('@')[0]; const e = frames.flatMap(fr => fr.inbox).find(x => x.id === id); return e && { kind: 'Linha de log', title: e.line, rows: [['Labels', chips(e.labels)], ['Stream', '<code>' + esc(e.key) + '</code>'], ['Token', '<code>0x' + E.hex(e.token) + '</code>']], note: k.includes('@') ? 'Cópia de réplica (RF=3): o mesmo conteúdo, em outro ingester.' : '' }; }
      return null;
    };
    const draw = (i, animate, dur) => {
      const f = frames[i];
      const html = '<div class="pipe">' +
        '<div class="pipe-col"><h3 class="zone-title zone-distributor">Distributor</h3><div class="inbox">' + (f.inbox.length ? f.inbox.map(e => '<div class="logdoc" data-k="' + e.id + '" data-inspect tabindex="0" role="button" aria-label="Linha ' + esc(e.line) + '"><span class="logdoc-line">' + esc(e.line) + '</span><span class="logdoc-chips">' + chips(e.labels) + '</span><span class="logdoc-hash">hash 0x' + E.hex(e.token) + '</span></div>').join('') : '<p class="zone-empty">Aguardando o próximo lote.</p>') + '</div></div>' +
        '<div class="pipe-col pipe-ingesters"><h3 class="zone-title zone-ingester">Ingesters</h3>' + f.ingesters.map(ing => '<div class="unit" data-k="ing-' + ing.id + '" data-inspect><div class="unit-head" data-inspect="ing-' + ing.id + '" tabindex="0" role="button" aria-label="' + ing.id + '">' + ingDot(ing.id) + esc(ing.id) + '<span class="unit-sub">' + ing.streams.length + ' stream(s)</span></div>' + (ing.streams.length ? ing.streams.map(s => '<div class="stream-row' + (s.primary ? '' : ' is-replica') + '" data-k="st-' + ing.id + '-' + E.hex(s.token) + '" data-inspect tabindex="0" role="button" aria-label="Stream ' + esc(s.key) + '"><span class="stream-id">' + chips(s.labels) + '</span><span class="head" style="--slots:' + run.params.chunkLines + '">' + s.lines.map(l => '<span class="line-dot" data-k="' + l + '"></span>').join('') + '</span></div>').join('') : '<p class="zone-empty">Sem streams.</p>') + '</div>').join('') + '</div>' +
        '<div class="pipe-col"><h3 class="zone-title zone-storage">Object storage</h3><div class="bucket">' + (f.bucket.length ? f.bucket.map(c => '<div class="chunk-block reason-' + c.reason + (f.flushedNow.includes(c.id) ? ' is-new' : '') + '" data-k="' + c.id + '" data-inspect tabindex="0" role="button" aria-label="Chunk ' + c.id + ' com ' + c.lines + ' linhas, ' + c.reason + '"><span>' + esc(c.labels.app) + '</span><small>' + c.lines + ' l · ' + c.reason + '</small></div>').join('') : '<p class="zone-empty">Vazio: nada foi descarregado ainda.</p>') + '</div>' +
        '<h3 class="zone-title zone-index">Índice TSDB</h3><ul class="index-list">' + (f.index.length ? f.index.map(x => '<li data-k="' + x.id + '"><code>' + esc(x.key) + '</code> → <code>' + esc(x.ref) + '</code></li>').join('') : '<li class="zone-empty">Sem entradas.</li>') + '</ul></div></div>';
      const apply = () => { stage.innerHTML = html; };
      if (animate) flip(stage, apply, { duration: Math.min(800, dur * 0.4) }); else apply();
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Linhas recebidas', value: fmt(f.totals.events) },
        { label: 'Streams', value: fmt(f.totals.streams), tone: f.totals.streams > 12 ? 'bad' : '', hint: 'Combinações distintas de labels.' },
        { label: 'Chunks no bucket', value: fmt(f.totals.chunks) },
        { label: 'Objetos gravados', value: fmt(f.totals.objects), hint: 'Com RF=3, cada réplica descarrega o próprio chunk.' },
        { label: 'Entradas no índice', value: fmt(f.totals.index) }
      ]);
      part(root, 'narration').textContent = f.note;
      inspector.refresh();
    };
    const rebuild = () => {
      const p = readParams(root);
      run = E.ingestRun({ eventsPerTick: p.eventsPerTick, ingesters: p.ingesters, rf: Number(p.rf), chunkLines: p.chunkLines, extraLabel: p.extra || null });
      frames = run.frames;
    };
    rebuild();
    const player = createPlayer(root, { count: () => frames.length, render: draw, baseMs: 2200 });
    const inspector = bindInspector(root, describe);
    onParams(root, () => { const at = player.index; player.stop(); rebuild(); player.show(at, false); });
    player.show(0, false);
  }
};

// ===========================================================================
// Lab 1: labels criam streams
// ===========================================================================
const lab1 = {
  markup: () => labShell({
    id: 'lab1', n: 'Laboratório 1', title: 'Como os labels criam streams',
    question: 'Quais logs acabam no mesmo stream quando você muda as chaves promovidas a label?',
    controls: '<fieldset class="ctl-group"><legend>Chaves promovidas a label</legend>' + E.LAB1_KEYS.map(k => toggle('k_' + k, '<code>' + k + '</code>', k === 'app' || k === 'env')).join('') + '</fieldset>' +
      '<fieldset class="ctl-group"><legend>Inserir evento</legend>' + select('n_app', 'app', [['checkout', 'checkout'], ['payments', 'payments'], ['frontend', 'frontend']], 'checkout') + select('n_host', 'host', [['srv-a', 'srv-a'], ['srv-b', 'srv-b'], ['srv-c', 'srv-c']], 'srv-a') + select('n_env', 'env', [['prod', 'prod'], ['staging', 'staging']], 'prod') + select('n_level', 'level', [['info', 'info'], ['warn', 'warn'], ['error', 'error']], 'error') + '<button type="button" class="secondary" data-add>Enviar evento</button></fieldset>',
    premises: 'stream = conjunto exato de pares chave=valor, ordenado por nome antes do hash (<code>parseStreamLabels</code>); a ordem em que os labels chegam não importa; o token do ring é FNV-32 de tenant + labels canônicos.',
    limits: 'o Loki 3.7 acrescenta <code>service_name</code> copiado de <code>app</code> (não muda a contagem aqui, porque copia um valor já presente) e pode gravar <code>detected_level</code> como structured metadata. Campos não promovidos continuam na linha ou em structured metadata.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    const events = E.lab1Events.map(e => ({ ...e, labels: { ...e.labels } }));
    let keys, grouped;
    const rebuild = () => { const p = readParams(root); keys = E.LAB1_KEYS.filter(k => p['k_' + k]); grouped = E.groupStreams(events, keys); };
    const describe = k => {
      if (k.startsWith('ev')) { const e = events.find(x => 'ev' + x.id === k); const step = grouped.steps.find(s => s.event === e.id); return { kind: 'Evento', title: e.line, rows: [['Chegou com', '<code>' + esc(Object.keys(e.labels).join(', ')) + '</code>'], ['Labels do stream', keys.length ? '<code>' + esc(step.stream) + '</code>' : '<code>{}</code> (nenhum label: o Loki recusaria)'], ['Fica fora do índice', '<code>' + esc(Object.keys(e.labels).filter(x => !keys.includes(x)).join(', ') || '—') + '</code>']], note: 'A ordem de chegada dos labels é descartada: o distributor ordena por nome.' }; }
      const s = grouped.streams.find(x => 'str' + x.order === k);
      return s && { kind: 'Stream', title: s.key, rows: [['Token do ring', '<code>0x' + E.hex(s.token) + '</code>'], ['Eventos', s.events.map(id => '#' + id).join(', ')], ['Chunk', 'um chunk aberto próprio no ingester dono']], note: 'Um stream nasce na primeira linha com esta combinação e recebe todas as seguintes.' };
    };
    const draw = (i, animate, dur) => {
      const done = grouped.steps.slice(0, i);
      const doneIds = new Set(done.map(s => s.event));
      const visible = new Set(done.map(s => s.stream));
      const current = grouped.steps[i - 1];
      const card = (e, compact) => '<div class="logdoc' + (compact ? ' is-compact' : '') + (current && current.event === e.id ? ' is-current' : '') + '" data-k="ev' + e.id + '" data-inspect tabindex="0" role="button" aria-label="Evento ' + e.id + ': ' + esc(e.line) + '"><span class="logdoc-line">#' + e.id + ' ' + esc(e.line) + '</span><span class="logdoc-chips">' + Object.entries(e.labels).map(([k, v]) => chip(k, v, keys.includes(k) ? 'label' : 'muted')).join('') + '</span></div>';
      const html = '<div class="lab1-grid"><div><h3 class="zone-title">Fila de eventos</h3><div class="queue">' + (events.filter(e => !doneIds.has(e.id)).map(e => card(e, false)).join('') || '<p class="zone-empty">Todos os eventos foram agrupados.</p>') + '</div></div>' +
        '<div><h3 class="zone-title zone-stream">Streams</h3><div class="stream-field">' + grouped.streams.filter(s => visible.has(s.key)).map(s => '<div class="stream-box' + (current && current.stream === s.key && current.isNew ? ' is-new' : '') + '" data-k="str' + s.order + '" data-inspect><div class="stream-head" data-inspect="str' + s.order + '" tabindex="0" role="button" aria-label="Stream ' + esc(s.key) + '">' + (keys.length ? chips(s.labels) : '<code>{}</code>') + '</div><div class="stream-body">' + s.events.filter(id => doneIds.has(id)).map(id => card(events.find(e => e.id === id), true)).join('') + '</div></div>').join('') + '</div></div></div>';
      const apply = () => { stage.innerHTML = html; };
      if (animate) flip(stage, apply, { duration: Math.min(800, dur * 0.4) }); else apply();
      const shown = grouped.streams.filter(s => visible.has(s.key));
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Eventos agrupados', value: done.length + ' / ' + events.length },
        { label: 'Streams', value: shown.length, tone: shown.length > 6 ? 'warn' : '' },
        { label: 'Labels por stream', value: keys.length },
        { label: 'Eventos por stream', value: shown.length ? fmt(done.length / shown.length, 1) : '—', hint: 'Quanto maior, mais longos e mais cheios ficam os chunks.' }
      ]);
      part(root, 'narration').textContent = !current ? 'Escolha as chaves promovidas a label e avance. Cada evento será colocado no stream da sua combinação exata.' :
        '#' + current.event + ' → ' + (keys.length ? current.stream : '{}') + (current.isNew ? ': combinação nova, um stream novo nasce.' : ': combinação já vista, entra no stream existente.') + (events.find(e => e.id === current.event).labels && Object.keys(events.find(e => e.id === current.event).labels)[0] !== 'app' ? ' Os labels chegaram em outra ordem, mas a forma canônica é a mesma.' : '');
      inspector.refresh();
    };
    rebuild();
    const player = createPlayer(root, { count: () => events.length + 1, render: draw, baseMs: 2000 });
    const inspector = bindInspector(root, describe);
    onParams(root, t => { if (t.dataset.p.startsWith('k_')) { const at = player.index; player.stop(); rebuild(); player.show(at, true); } });
    root.querySelector('[data-add]').addEventListener('click', () => {
      const p = readParams(root);
      events.push({ id: events.length + 1, labels: { app: p.n_app, host: p.n_host, env: p.n_env, level: p.n_level }, line: p.n_level === 'error' ? 'falha inserida pelo aluno' : 'evento inserido pelo aluno' });
      rebuild(); player.stop(); player.show(events.length, true);
    });
    player.show(0, false);
  }
};

// ===========================================================================
// Lab 2: o perigo da alta cardinalidade
// ===========================================================================
const lab2 = {
  markup: () => labShell({
    id: 'lab2', n: 'Laboratório 2', title: 'O perigo da alta cardinalidade',
    question: 'O que acontece com streams, chunks e índice quando um identificador por requisição vira label?',
    controls: '<fieldset class="ctl-group"><legend>Dimensões estáveis (cenários A e B)</legend>' + range('clusters', 'cluster', 1, 4, 2) + range('namespaces', 'namespace', 1, 10, 4) + range('apps', 'app', 1, 12, 6) + range('envs', 'environment', 1, 3, 2) + '</fieldset>' +
      '<fieldset class="ctl-group"><legend>Só no cenário B: promover a label</legend>' + toggle('pod', '<code>pod</code> (6 por app)', true) + toggle('trace_id', '<code>trace_id</code> (1 a cada 4 linhas)', true) + toggle('order_id', '<code>order_id</code> (1 a cada 12 linhas)', false) + range('eventsPerMin', 'Volume (linhas/min)', 60, 1200, 300, 60) + '</fieldset>',
    premises: 'mesmo fluxo de linhas sorteado com semente fixa nos dois cenários; stream novo além de <code>max_global_streams_per_user</code> (5000) é recusado com 429 <code>stream_limit</code>; chunk fecha por <code>chunk_idle_period</code> 30 min, <code>max_chunk_age</code> 2 h ou tamanho alvo 1,5 MB comprimido (defaults v3.7.0).',
    limits: 'linhas de 300 bytes e compressão 5× são premissas; "entradas de índice" = séries + referências de chunk (simplificação do TSDB). O limite real é aplicado por ingester (global ÷ ingesters × RF); aqui é aplicado ao tenant inteiro. Memória e custo do bucket não são calculados.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    let run, sample;
    const rebuild = () => {
      const p = readParams(root);
      run = E.cardinalityRun({ clusters: p.clusters, namespaces: p.namespaces, apps: p.apps, envs: p.envs, eventsPerMin: p.eventsPerMin, pod: p.pod, trace_id: p.trace_id, order_id: p.order_id, minutes: 60 });
      sample = run.frames.filter(f => f.minute === 1 || f.minute % 5 === 0);
    };
    const field = (snap, prev, cls, max) => {
      const sizes = snap.sizes;
      const from = prev ? Math.min(prev.sizes.length, sizes.length) : sizes.length;
      return '<div class="tile-field ' + cls + '" aria-hidden="true">' + sizes.map((n, i) => '<span class="tile' + (i >= from ? ' is-new' : '') + '" style="--s:' + (0.22 + 0.78 * Math.sqrt(Math.min(1, n / max))).toFixed(3) + '"></span>').join('') + '</div><p class="tile-caption">' + (snap.streams > sizes.length ? 'Mostrando os ' + fmt(sizes.length) + ' streams mais recentes de ' + fmt(snap.streams) + '.' : fmt(snap.streams) + ' streams; o tamanho do quadrado acompanha as linhas recebidas.') + '</p>';
    };
    const panel = (name, title, labelsText, snap, prev, max) => '<div class="scenario scenario-' + name + '"><div class="scenario-head"><h3>' + title + '</h3><code>' + esc(labelsText) + '</code></div>' + field(snap, prev, 'field-' + name, max) +
      '<dl class="scenario-stats"><div><dt>Streams criados</dt><dd>' + fmt(snap.streams) + '</dd></div><div><dt>Ativos agora</dt><dd>' + fmt(snap.active) + '</dd></div><div><dt>Chunks</dt><dd>' + fmt(snap.chunks) + '</dd></div><div><dt>Entradas de índice</dt><dd>' + fmt(snap.index) + '</dd></div><div><dt>Linhas por stream</dt><dd>' + fmt(snap.avgLinesPerStream, 1) + '</dd></div><div><dt>Tamanho médio do chunk</dt><dd>' + fmt(snap.avgChunkKB, 2) + ' KB</dd></div><div class="' + (snap.rejected ? 'is-bad' : '') + '"><dt>Linhas recusadas (429)</dt><dd>' + fmt(snap.rejected) + '</dd></div></dl>' +
      '<div class="gauge" title="Streams ativos frente ao limite de 5000"><span style="width:' + Math.min(100, snap.active / E.LIMITS.maxGlobalStreams * 100).toFixed(1) + '%"></span></div><p class="gauge-label">' + fmt(snap.active) + ' de 5.000 streams ativos permitidos</p></div>';
    const draw = i => {
      const f = sample[i], prev = sample[i - 1];
      const base = 'cluster, namespace, app, environment';
      // Escala comum aos dois cenários: o mesmo número de linhas tem o mesmo tamanho nos dois painéis.
      const max = Math.max(1, ...run.frames.at(-1).A.sizes, ...run.frames.at(-1).B.sizes);
      stage.innerHTML = '<div class="scenarios">' + panel('A', 'Cenário A', '{' + base + '}', f.A, prev?.A, max) + panel('B', 'Cenário B', '{' + base + (run.highKeys.length ? ', ' + run.highKeys.join(', ') : '') + '}', f.B, prev?.B, max) + '</div>';
      const ratio = f.A.streams ? f.B.streams / f.A.streams : 0;
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Minuto', value: f.minute + ' / 60' },
        { label: 'Teto de A (produto)', value: fmt(run.ceiling), hint: 'cluster × namespace × app × environment' },
        { label: 'Streams B ÷ A', value: fmt(ratio, 1) + '×', tone: ratio > 20 ? 'bad' : ratio > 2 ? 'warn' : '' },
        { label: 'Índice B ÷ A', value: fmt(f.A.index ? f.B.index / f.A.index : 0, 1) + '×', tone: f.B.index > 10 * f.A.index ? 'bad' : '' },
        { label: 'Chunk médio B', value: fmt(f.B.avgChunkKB, 2) + ' KB', tone: f.B.avgChunkKB < 1 ? 'bad' : '' }
      ]);
      part(root, 'narration').textContent = !run.highKeys.length ? 'Sem labels de alta cardinalidade, A e B são idênticos.' :
        f.B.rejected ? 'Minuto ' + f.minute + ': B atingiu o limite de streams ativos. Linhas novas de streams novos recebem 429 e se perdem se o cliente desistir de reenviar. A continua com ' + fmt(f.A.streams) + ' streams longos.' :
        'Minuto ' + f.minute + ': cada valor novo de ' + run.highKeys.join(' / ') + ' abre um stream com chunk próprio. Em B cada stream tem ' + fmt(f.B.avgLinesPerStream, 1) + ' linha(s) em média; em A, ' + fmt(f.A.avgLinesPerStream, 0) + '.' + (f.minute >= 30 ? ' Depois de 30 min sem linhas, esses chunks minúsculos são descarregados por idle.' : '');
      part(root, 'inspector').innerHTML = '<p class="inspector-kind">O que observar</p><h3>Mesmo volume, outra forma</h3><p>Os dois cenários recebem exatamente as mesmas linhas. Só muda o que é label.</p><ul class="plain"><li>Cada quadrado é um stream; o tamanho mostra quantas linhas ele recebeu.</li><li>Em B, quadrados minúsculos = chunks quase vazios, cada um com entrada própria no índice e um objeto no bucket.</li><li>O teto de streams é o <strong>produto</strong> dos valores possíveis; com um ID por requisição ele é ilimitado.</li><li>Guia histórico do artigo (2023), para tenants com mais de 10 TB/dia: menos de 100 mil streams ativos e 1 milhão por dia. O default do Loki 3.7 é 5000 ativos por tenant.</li></ul>';
    };
    rebuild();
    const player = createPlayer(root, { count: () => sample.length, render: draw, baseMs: 1600 });
    onParams(root, () => { const at = player.index; player.stop(); rebuild(); player.show(at, false); });
    player.show(sample.length - 1, false);
  }
};

// ===========================================================================
// Lab 3: hash ring
// ===========================================================================
const angle = token => token / E.U32 * 360 - 90;
const pos = (token, r = 44) => { const a = angle(token) * Math.PI / 180; return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) }; };
function arcPath(fromToken, toToken, r = 44) {
  const a = pos(fromToken, r), b = pos(toToken, r);
  const span = ((toToken - fromToken) + E.U32) % E.U32;
  return 'M' + a.x + ' ' + a.y + ' A' + r + ' ' + r + ' 0 ' + (span > E.U32 / 2 ? 1 : 0) + ' 1 ' + b.x + ' ' + b.y;
}
const lab3 = {
  markup: () => labShell({
    id: 'lab3', n: 'Laboratório 3', title: 'Hash ring: quem recebe cada stream',
    question: 'Por que um stream vai sempre para os mesmos ingesters, e o que muda quando um ingester entra ou sai?',
    controls: '<div class="ctl-group"><span class="ctl-legend">Ingesters</span><div class="button-row"><button type="button" class="secondary" data-ring="add">+ Ingester</button><button type="button" class="secondary" data-ring="remove">− Ingester</button></div></div>' + range('tokens', 'Tokens por ingester (visíveis)', 1, 16, 4) + select('rf', 'Fator de replicação', [[1, 'RF = 1'], [3, 'RF = 3 (default)']], 3) + select('stream', 'Stream acompanhado', E.ringStreams.map((s, i) => [i, s.key]), 7),
    premises: 'token = FNV-32(tenant + labels canônicos) (<code>pkg/util/ring/ring.go</code>, TokenFor); dono = primeiro token <strong>maior</strong> que o hash, voltando ao início no fim do anel (<code>dskit ring/util.go</code>, searchToken); réplicas = próximos tokens de ingesters ainda não escolhidos até RF (<code>findInstancesForKey</code>).',
    limits: 'cada ingester real registra 128 tokens (<code>num_tokens</code>); aqui são poucos para caber na tela, por isso a distribuição fica mais desigual. Zone awareness, estados JOINING/LEAVING e a transferência de dados na saída (flush no shutdown) não são simulados.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    let count = 4, prevOwners = null, moved = new Set();
    let ring, rf, stream, res, dist;
    const rebuild = (track = false) => {
      const p = readParams(root);
      rf = Number(p.rf);
      const old = dist;
      ring = E.buildRing(E.INGESTER_NAMES.slice(0, count), p.tokens);
      stream = E.ringStreams[Number(p.stream)];
      res = E.lookup(ring, stream.token, rf);
      dist = E.distribute(ring, E.ringStreams, rf);
      moved = new Set();
      if (track && old) for (const s of E.ringStreams) if (old.owners[s.key]?.[0] !== dist.owners[s.key][0]) moved.add(s.key);
      prevOwners = old;
    };
    const describe = k => {
      if (k.startsWith('tok-')) { const [, id, i] = k.match(/^tok-(.+)-(\d+)$/); const t = ring.tokens.filter(x => x.owner === id)[Number(i)]; return t && { kind: 'Token no anel', title: id, rows: [['Posição', fmt(t.token) + ' (0x' + E.hex(t.token) + ')'], ['Ângulo', fmt(angle(t.token) + 90, 1) + '°']], note: 'Este token é dono do arco que vai do token anterior até ele (sentido horário).' }; }
      if (k.startsWith('unit-')) { const id = k.slice(5); const o = E.ownership(ring)[id]; return { kind: 'Ingester', title: id, rows: [['Fração do anel', fmt(o * 100, 1) + '%'], ['Streams como primeiro dono', dist.load[id].primary], ['Cópias de réplica', dist.load[id].replica]], note: 'Com RF=3, cada stream fica em memória em três ingesters; a perda de um não perde dados confirmados pelo quorum.' }; }
      if (k === 'marker') return { kind: 'Stream', title: stream.key, rows: [['Hash (FNV-32)', '<code>0x' + E.hex(stream.token) + '</code> = ' + fmt(stream.token)], ['Réplicas', res.replicas.join(', ')]], note: 'Mesmos labels e mesmo tenant: mesmo hash, sempre.' };
      return null;
    };
    const draw = (step, animate, dur) => {
      const show = n => step >= n;
      const tokensHtml = ring.ids.flatMap(id => ring.tokens.filter(t => t.owner === id).map((t, i) => {
        const p = pos(t.token); const w = res.walk.find(x => x.token === t.token);
        const cls = show(4) && w ? (w.taken ? (res.replicas[0] === id ? ' is-owner' : (show(5) ? ' is-replica' : ' is-walked')) : (show(5) ? ' is-skipped' : '')) : '';
        return '<span class="ring-token' + cls + '" data-k="tok-' + id + '-' + i + '" data-inspect tabindex="0" role="button" aria-label="Token de ' + id + '" style="left:' + p.x + '%;top:' + p.y + '%;--c:var(--i' + ingIndex(id) + ')"></span>';
      })).join('');
      const mp = pos(stream.token, 44);
      const last = res.walk[res.walk.length - 1];
      const firstOwner = res.walk.find(x => x.taken);
      const arcTo = show(5) ? last : firstOwner;
      const svg = '<svg class="ring-svg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="ring-track"/>' + (show(4) && arcTo ? '<path class="ring-arc' + (show(5) ? ' is-replication' : '') + '" d="' + arcPath(stream.token, arcTo.token) + '"/>' : '') + '</svg>';
      const marker = show(3) ? '<span class="ring-marker" data-k="marker" data-inspect tabindex="0" role="button" aria-label="Posição do stream no anel" style="left:' + mp.x + '%;top:' + mp.y + '%"></span>' : '';
      const center = '<div class="ring-center">' + (show(2) ? '<span class="ring-hash">0x' + E.hex(stream.token) + '</span><span class="ring-hash-sub">' + fmt(stream.token) + '</span>' : show(1) ? '<code class="ring-canon">' + esc(stream.key) + '</code>' : '<span class="ring-hash-sub">2³² posições</span>') + '</div>';
      const units = '<div class="ring-units">' + ring.ids.map(id => { const r = res.replicas.indexOf(id); const hold = show(4) && r === 0 || show(5) && r > 0; return '<div class="unit unit-compact' + (moved.size && E.ringStreams.some(s => moved.has(s.key) && dist.owners[s.key][0] === id) ? ' has-moved' : '') + '" data-k="unit-' + id + '" data-inspect tabindex="0" role="button" aria-label="' + id + '"><div class="unit-head">' + ingDot(id) + esc(id) + '<span class="unit-sub">' + fmt(E.ownership(ring)[id] * 100, 0) + '% do anel</span></div><div class="unit-slot">' + (hold ? '<span class="copy' + (r > 0 ? ' is-replica' : '') + '" data-k="copy-' + id + '">' + (r === 0 ? 'stream' : 'réplica ' + r) + '</span>' : '') + '</div><div class="unit-bar" title="Streams como primeiro dono e réplicas"><span class="b-primary" style="width:' + dist.load[id].primary / E.ringStreams.length * 100 + '%"></span><span class="b-replica" style="width:' + dist.load[id].replica / E.ringStreams.length * 100 + '%"></span></div></div>'; }).join('') + '</div>';
      const packet = step === 0 ? '<div class="ring-inbox"><div class="logdoc is-compact" data-k="pkt"><span class="logdoc-chips">' + chips(stream.labels) + '</span></div></div>' : '';
      const html = '<div class="ring-layout"><div class="ring-wrap"><div class="ring">' + svg + tokensHtml + marker + center + '</div>' + packet + '</div>' + units + '</div>';
      const apply = () => { stage.innerHTML = html; };
      if (animate) flip(stage, apply, { duration: Math.min(800, dur * 0.4) }); else apply();
      const own = E.ownership(ring); const vals = Object.values(own);
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Ingesters', value: count },
        { label: 'Tokens no anel', value: ring.tokens.length },
        { label: 'Maior fatia ÷ menor', value: fmt(Math.max(...vals) / Math.max(1e-9, Math.min(...vals)), 1) + '×', hint: 'Com 128 tokens por ingester, a razão fica perto de 1.', tone: Math.max(...vals) / Math.min(...vals) > 3 ? 'warn' : '' },
        { label: 'Streams que mudaram de dono', value: moved.size + ' / ' + E.ringStreams.length, tone: moved.size ? 'warn' : '' }
      ]);
      part(root, 'narration').innerHTML = '<strong>' + esc(E.LOOKUP_STEPS[step][0]) + '.</strong> ' + esc(E.LOOKUP_STEPS[step][1]) + (step === 4 && firstOwner ? ' Aqui: token 0x' + E.hex(firstOwner.token) + ' de ' + esc(firstOwner.owner) + '.' : '') + (step === 5 ? ' Aqui: ' + esc(res.replicas.join(', ')) + (res.walk.some(w => !w.taken) ? '; tokens de ingesters já escolhidos foram pulados.' : '.') + ' Distribuição decide quem é dono; replicação decide quantas cópias.' : '');
      inspector.refresh();
    };
    rebuild();
    const player = createPlayer(root, { count: () => E.LOOKUP_STEPS.length, render: draw, baseMs: 2600 });
    const inspector = bindInspector(root, describe);
    onParams(root, t => { const at = player.index; player.stop(); rebuild(t.dataset.p !== 'stream'); player.show(t.dataset.p === 'stream' ? 0 : at, true); });
    root.querySelector('.lab-controls').addEventListener('click', e => {
      const b = e.target.closest('[data-ring]'); if (!b) return;
      const next = b.dataset.ring === 'add' ? Math.min(8, count + 1) : Math.max(1, count - 1);
      if (next === count) return;
      count = next; player.stop(); rebuild(true); player.show(5, true);
      part(root, 'narration').innerHTML += ' <strong>' + moved.size + ' de ' + E.ringStreams.length + ' streams mudaram de primeiro dono.</strong> Os outros continuam onde estavam: só os arcos vizinhos aos tokens que entraram ou saíram mudam de dono.';
    });
    player.show(0, false);
  }
};

// ===========================================================================
// Lab 4: automatic stream sharding
// ===========================================================================
const lab4 = {
  markup: () => labShell({
    id: 'lab4', n: 'Laboratório 4', title: 'Automatic stream sharding',
    question: 'O que acontece com um stream que recebe mais bytes por segundo do que um ingester aceita para ele?',
    controls: range('rate', 'Volume do stream', 0.5, 12, 6, 0.5, ' MB/s') + select('desired', 'shard_streams.desired_rate', [[0.5, '512KB'], [1, '1MB'], [1.5, '1536KB (default)'], [3, '3MB']], 1.5) + toggle('enabled', '<code>shard_streams.enabled</code> (default: true)', true) + range('ingesters', 'Ingesters', 3, 8, 6),
    premises: 'shards = 1 até haver taxa conhecida; depois <code>ceil((taxa + push) ÷ desired_rate)</code> (<code>calculateShards</code>); entradas divididas em rodízio entre os shards; cada shard ganha <code>__stream_shard__="n"</code> e um token próprio, portanto outro lugar no anel (<code>createShard</code>, <code>pkg/distributor/distributor.go</code>); limite por stream no ingester: <code>per_stream_rate_limit</code> 3MB com burst 15MB.',
    limits: 'a taxa vista pelo distributor é a do segundo anterior (o rate store atualiza a cada 1 s, por isso o sharding sempre reage atrasado); o tamanho do push é desprezado; RF = 1 para mostrar a carga sem cópias; o time sharding (<code>__time_shard__</code>, desligado por padrão) não é simulado.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    let run;
    const rebuild = () => { const p = readParams(root); run = E.shardingRun({ targetMBps: p.rate, desiredMB: Number(p.desired), enabled: p.enabled, ingesters: p.ingesters }); };
    const describe = k => {
      const f = run.frames[player.index];
      const s = f.perShard.find(x => 'sh-' + E.hex(x.token) === k);
      if (s) return { kind: 'Stream (shard)', title: s.key, rows: [['Token', '<code>0x' + E.hex(s.token) + '</code>'], ['Ingester', s.ingester], ['Recebe', mb(s.incoming) + '/s'], ['Aceito', mb(s.accepted) + '/s'], ['Descartado', mb(s.dropped) + '/s'], ['Balde do limitador', mb(s.bucket)]], note: 'Para o índice, cada shard é um stream comum: conta no limite de streams e tem chunks próprios.' };
      if (k.startsWith('iu-')) { const id = k.slice(3); return { kind: 'Ingester', title: id, rows: [['Carga deste stream', mb(f.load[id]) + '/s']] }; }
      return null;
    };
    const draw = (i, animate, dur) => {
      const f = run.frames[i];
      const limit = 3 * E.MB;
      const shardPill = s => '<div class="shard' + (s.dropped > 1 ? ' is-dropping' : '') + '" data-k="sh-' + E.hex(s.token) + '" data-inspect tabindex="0" role="button" aria-label="Stream ' + esc(s.key) + '" style="--w:' + Math.min(100, s.incoming / limit * 100).toFixed(1) + '%"><span class="shard-label">' + (f.shards > 1 ? chip('__stream_shard__', s.key.match(/__stream_shard__="(\d+)"/)[1], 'shard') : chip('stream', 'original', 'label')) + '</span><span class="shard-meter"><span></span><i class="limit-mark" title="per_stream_rate_limit 3MB"></i></span><span class="shard-rate">' + mb(s.incoming) + '/s</span>' + (s.dropped > 1 ? '<span class="drop-badge">429 · ' + mb(s.dropped) + '/s perdidos</span>' : '') + '</div>';
      const html = '<div class="shard-layout">' +
        '<div class="shard-src"><h3 class="zone-title">Produtor</h3><div class="producer"><span class="producer-rate">' + mb(f.rate) + '/s</span><code>' + esc(run.baseKey) + '</code></div>' +
        '<div class="calc"><span class="calc-k">Distributor</span><span>taxa vista: ' + mb(f.observed) + '/s</span><span>' + (run.params.enabled ? (f.observed ? 'ceil(' + fmt(f.observed / E.MB, 2) + ' ÷ ' + fmt(run.params.desiredMB, 2) + ') = <strong>' + f.shards + '</strong> shard(s)' : 'sem taxa conhecida: 1 shard') : 'sharding desligado: 1 stream') + '</span></div></div>' +
        '<div class="shard-ings">' + run.ring.ids.map(id => { const mine = f.perShard.filter(s => s.ingester === id); return '<div class="unit unit-compact" data-k="iu-' + id + '" data-inspect><div class="unit-head" data-inspect="iu-' + id + '" tabindex="0" role="button" aria-label="' + id + '">' + ingDot(id) + esc(id) + '<span class="unit-sub">' + mb(f.load[id]) + '/s</span></div>' + (mine.length ? mine.map(shardPill).join('') : '<p class="zone-empty">Nenhum shard deste stream.</p>') + '</div>'; }).join('') + '</div></div>';
      const apply = () => { stage.innerHTML = html; };
      if (animate) flip(stage, apply, { duration: Math.min(800, dur * 0.4) }); else apply();
      const perShard = f.rate / f.shards;
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Segundo', value: (f.t + 1) + ' / ' + run.frames.length },
        { label: 'Shards', value: f.shards },
        { label: 'Taxa por shard', value: mb(perShard) + '/s', tone: perShard > limit ? 'bad' : perShard > run.params.desiredMB * E.MB ? 'warn' : '', hint: 'Acima de desired_rate enquanto o sharding ainda não reagiu.' },
        { label: 'Descartado agora', value: mb(f.dropped) + '/s', tone: f.dropped > 1 ? 'bad' : '' },
        { label: 'Total descartado', value: mb(f.totalDropped), tone: f.totalDropped > 1 ? 'bad' : '' },
        { label: 'Streams criados', value: f.streamsCreated, hint: 'Cada valor de __stream_shard__ é um stream no índice.' }
      ]);
      part(root, 'narration').textContent = !run.params.enabled ? (f.dropped > 1 ? 'Sem sharding, todo o volume cai num stream e num ingester. O burst de 15MB acabou: o excedente acima de 3MB/s recebe 429 (per stream rate limit).' : 'Sem sharding, um stream e um ingester. Por enquanto o limite (3MB/s com burst de 15MB) ainda absorve.') :
        f.shards === 1 ? 'Abaixo de desired_rate, o stream segue inteiro.' : 'O distributor dividiu o stream em ' + f.shards + ' shards com __stream_shard__. Cada um tem token próprio e cai em outro ponto do anel, espalhando a carga. A divisão usa a taxa do segundo anterior, então durante a subida cada shard fica acima de desired_rate.';
      inspector.refresh();
    };
    rebuild();
    const player = createPlayer(root, { count: () => run.frames.length, render: draw, baseMs: 1700 });
    const inspector = bindInspector(root, describe);
    onParams(root, () => { const at = player.index; player.stop(); rebuild(); player.show(at, false); });
    player.show(0, false);
  }
};

// ===========================================================================
// Lab 5: label × structured metadata × linha
// ===========================================================================
const RECOMMENDED = { cluster: 'label', namespace: 'label', pod: 'sm', trace_id: 'line', order_id: 'line', level: 'line' };
const WORST = { cluster: 'label', namespace: 'label', pod: 'label', trace_id: 'label', order_id: 'label', level: 'label' };
const lab5 = {
  markup: () => labShell({
    id: 'lab5', n: 'Laboratório 5', title: 'Label, structured metadata ou linha?',
    question: 'Onde guardar cada campo, e o que essa escolha muda em cardinalidade, índice, armazenamento e consulta?',
    player: false,
    controls: '<div class="button-row"><button type="button" class="secondary" data-preset="rec">Aplicar recomendação da documentação</button><button type="button" class="secondary" data-preset="worst">Tudo como label</button><button type="button" class="text-button" data-preset="reset">Recomeçar</button></div><p class="small-note">Arraste os campos entre as colunas, ou use o seletor de cada campo (teclado e toque).</p>',
    premises: 'labels compõem o stream e entram no índice (limite <code>max_label_names_per_series</code> 15); structured metadata viaja com cada entrada no chunk, não entra no índice, é filtrável com <code>| chave="valor"</code> sem parser e é a única coisa que os bloom filters indexam desde o 3.3; a linha só é pesquisável por filtro de linha ou parser. Recomendações de <code>docs/sources/get-started/labels/</code> v3.7.0.',
    limits: 'cardinalidades estimadas para um banco digital com 8 aplicações; o cálculo de streams é o teto combinatório por dia. Não modela OTLP (que decide sozinho o que vira label), nem limites por política.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    let assign = {};
    const reset = () => { assign = Object.fromEntries(E.FIELDS.map(f => [f.key, null])); };
    reset();
    const fieldChip = f => '<div class="field-chip" draggable="true" data-field="' + f.key + '"><span class="chip chip-' + ({ label: 'label', sm: 'sm', line: 'line' }[assign[f.key]] || 'muted') + '"><span class="chip-k">' + f.key + '</span><span class="chip-v">' + esc(f.value) + '</span></span><label class="sr-only" for="fsel-' + f.key + '">Onde guardar ' + f.key + '</label><select id="fsel-' + f.key + '" data-fsel="' + f.key + '"><option value="">Escolher…</option>' + Object.entries(E.BINS).map(([v, t]) => '<option value="' + v + '"' + (assign[f.key] === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>';
    const draw = () => {
      const pending = E.FIELDS.filter(f => !assign[f.key]);
      const done = !pending.length;
      const r = E.classify(Object.fromEntries(E.FIELDS.map(f => [f.key, assign[f.key] || 'line'])));
      const bins = Object.entries(E.BINS).map(([bin, title]) => '<div class="bin bin-' + bin + '" data-bin="' + bin + '"><h3>' + title + '</h3><p class="bin-sub">' + ({ label: 'índice · escolhe streams', sm: 'no chunk, ao lado da linha · sem índice', line: 'texto · filtro ou parser' })[bin] + '</p>' + E.FIELDS.filter(f => assign[f.key] === bin).map(fieldChip).join('') + '</div>').join('');
      const v = Object.fromEntries(r.verdicts.map(x => [x.key, x]));
      const ts = '2026-11-11T14:03:22Z';
      const lineText = '{"level":"error","msg":"transfer failed","trace_id":"abc123","order_id":"987654"}';
      const record = '<div class="record"><div class="record-index"><span class="record-tag">Índice (TSDB)</span><code>{app="banking-api"' + E.FIELDS.filter(f => assign[f.key] === 'label').map(f => ', ' + f.key + '="' + esc(f.value) + '"').join('') + '}</code></div><div class="record-chunk"><span class="record-tag">Entrada no chunk</span><span class="rec-ts">' + ts + '</span><code class="rec-line">' + esc(lineText) + '</code><span class="rec-sm">' + (E.FIELDS.filter(f => assign[f.key] === 'sm').map(f => chip(f.key, f.value, 'sm')).join('') || '<em>sem structured metadata</em>') + '</span></div></div>';
      stage.innerHTML = '<div class="pool" data-bin=""><h3>Campos de um evento <code>banking-api</code></h3>' + (pending.map(fieldChip).join('') || '<p class="zone-empty">Todos classificados.</p>') + '</div><div class="bins">' + bins + '</div>' +
        '<h3 class="zone-title">Como o evento fica armazenado</h3>' + record +
        (done ? '<div class="verdicts">' + E.FIELDS.map(f => '<article class="verdict tone-' + v[f.key].tone + '"><h4>' + chip(f.key, f.value, { label: 'label', sm: 'sm', line: 'line' }[assign[f.key]]) + ' <span>' + E.BINS[assign[f.key]] + '</span></h4><p>' + esc(v[f.key].text) + '</p><p class="verdict-q">Consulta: <code>' + esc(v[f.key].query) + '</code></p><p class="verdict-card">Cardinalidade estimada: ~' + fmt(f.card) + ' valores/dia · ' + esc(f.note) + '</p></article>').join('') + '</div>' : '<p class="lab-hint">Classifique os ' + pending.length + ' campo(s) restantes para ver as consequências de cada escolha.</p>');
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Streams por dia (teto)', value: fmt(r.streamsPerDay), tone: r.overStreamLimit ? 'bad' : r.streamsPerDay > 500 ? 'warn' : 'good', hint: '8 aplicações × valores de cada label' },
        { label: 'Labels no índice', value: r.labelCount + ' / 15', tone: r.overLabelLimit ? 'bad' : '' },
        { label: 'Bytes de SM por linha', value: fmt(r.smBytes), hint: 'Conta no limite de taxa de ingestão; máximo 64KB e 128 pares por linha.' },
        { label: 'Limite de 5000 streams ativos', value: r.overStreamLimit ? 'estourado' : 'ok', tone: r.overStreamLimit ? 'bad' : 'good' }
      ]);
      part(root, 'narration').textContent = done ? (r.overStreamLimit ? 'Com essas escolhas o teto passa de ' + fmt(r.streamsPerDay) + ' streams por dia: o Loki recusaria streams novos com 429 e o índice viraria um índice invertido de IDs.' : 'Teto de ' + fmt(r.streamsPerDay) + ' streams por dia, dentro do que o Loki foi desenhado para suportar.') : 'Arraste cada campo para uma coluna.';
      part(root, 'inspector').innerHTML = '<p class="inspector-kind">Regra da documentação 3.7</p><h3>Três perguntas por campo</h3><ol class="plain"><li><strong>Descreve a origem e tem poucos valores estáveis?</strong> Label.</li><li><strong>É de alta cardinalidade e não está na linha?</strong> Structured metadata (ex.: nome do pod, IDs vindos do OTel).</li><li><strong>Já está na linha?</strong> Deixe lá; filtre com <code>|=</code> ou extraia com parser.</li></ol><p>trace_id e order_id já estão no JSON deste evento, por isso a recomendação é a linha. Se viessem só como atributo OTel, iriam para structured metadata, e uma busca <code>| trace_id="abc123"</code> antes de qualquer parser poderia usar bloom filters (experimentais).</p>';
    };
    stage.addEventListener('dragstart', e => { const c = e.target.closest('[data-field]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.field); e.dataTransfer.effectAllowed = 'move'; c.classList.add('is-dragging'); } });
    stage.addEventListener('dragend', e => e.target.closest?.('[data-field]')?.classList.remove('is-dragging'));
    stage.addEventListener('dragover', e => { const b = e.target.closest('[data-bin]'); if (b) { e.preventDefault(); b.classList.add('is-over'); } });
    stage.addEventListener('dragleave', e => e.target.closest?.('[data-bin]')?.classList.remove('is-over'));
    stage.addEventListener('drop', e => { const b = e.target.closest('[data-bin]'); if (!b) return; e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k in assign) { assign[k] = b.dataset.bin || null; draw(); } });
    stage.addEventListener('change', e => { const k = e.target.dataset.fsel; if (k) { assign[k] = e.target.value || null; draw(); root.querySelector('#fsel-' + k)?.focus(); } });
    root.querySelector('.lab-controls').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (!b) return; if (b.dataset.preset === 'rec') assign = { ...RECOMMENDED }; else if (b.dataset.preset === 'worst') assign = { ...WORST }; else reset(); draw(); });
    draw();
  }
};

// ===========================================================================
// Lab 6: LogQL em etapas
// ===========================================================================
const lab6 = {
  markup: () => labShell({
    id: 'lab6', n: 'Laboratório 6', title: 'LogQL: o que cada etapa descarta',
    question: 'Quantos streams, chunks e linhas cada parte da consulta faz o Loki ler?',
    controls: '<label class="ctl ctl-wide"><span>Exemplo</span><select data-q="preset">' + E.LOGQL_PRESETS.map(([t], i) => '<option value="' + i + '">' + esc(t) + '</option>').join('') + '</select></label><label class="ctl ctl-wide"><span>Consulta LogQL</span><textarea data-q="text" rows="2" spellcheck="false">' + esc(E.LOGQL_PRESETS[0][1]) + '</textarea></label><button type="button" class="primary" data-q="run">Executar</button><p class="lab-error" data-role="qerror" role="status"></p>',
    premises: 'seletores <code>= != =~ !~</code> ancorados; filtros de linha <code>|= != |~ !~</code>; parsers <code>json</code> e <code>logfmt</code> (linha inválida recebe <code>__error__</code> e segue); filtros de label consultam labels do stream, structured metadata e campos extraídos; campo extraído com nome de label do stream vira <code>_extracted</code>; seletor só com matchers que aceitam vazio é recusado.',
    limits: '14 linhas em 4 streams; "bytes lidos" é a soma das linhas dos streams selecionados (o Loki lê chunks inteiros do intervalo). Não implementa métricas, line_format, unwrap, decolorize, nem execução distribuída. Valide consultas reais no laboratório local.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    let result = E.runLogQL(E.LOGQL_PRESETS[0][1]);
    const all = E.logqlStreams.flatMap(s => s.lines.map(l => [l.id, l]));
    const lineById = Object.fromEntries(all);
    const describe = k => {
      const s = E.logqlStreams.find(x => 'q' + x.id === k);
      if (s) return { kind: 'Stream', title: s.key, rows: [['Chunks no intervalo', s.chunks], ['Linhas', s.lines.length], ['Selecionado', result.selected.includes(s.id) ? 'sim' : 'não: nenhum byte lido']] };
      const l = lineById[k.slice(1)];
      if (l) { const row = result.rows.find(r => r.id === l.id); return { kind: 'Linha', title: l.line, rows: [['Structured metadata', Object.keys(l.sm).length ? chips(l.sm, 'sm') : '—'], ['Bytes', l.bytes], ['Campos no fim do pipeline', row ? Object.entries(row.fields).filter(([key]) => !(key in E.logqlStreams.find(x => x.id === row.stream).labels) && !(key in l.sm)).map(([a, b]) => chip(a, b, 'field')).join('') || '—' : 'descartada']] }; }
      return null;
    };
    const draw = (i, animate, dur) => {
      const st = result.stages[i];
      const kept = new Set(st.kept);
      const droppedHere = new Set(st.dropped || []);
      const errors = new Set(st.errors || []);
      const parsedBy = result.stages.slice(1, i + 1).some(s => s.type === 'parser');
      const fieldsOf = id => { const row = result.rows.find(r => r.id === id); return row && parsedBy ? Object.entries(row.fields).filter(([k]) => !(k in E.logqlStreams.find(x => x.id === row.stream).labels) && !(k in row.sm)).slice(0, 4) : []; };
      const html = '<div class="q-pipeline">' + result.stages.map((s, n) => '<span class="q-stage' + (n === i ? ' is-current' : n < i ? ' is-done' : '') + '"><code>' + esc(s.text) + '</code><small>' + s.kept.length + ' linha(s)</small></span>').join('') + '</div>' +
        '<div class="q-streams">' + E.logqlStreams.map(s => { const sel = result.selected.includes(s.id); return '<div class="q-stream' + (sel ? '' : ' is-out') + '" data-k="q' + s.id + '" data-inspect><div class="stream-head" data-inspect="q' + s.id + '" tabindex="0" role="button" aria-label="Stream ' + esc(s.key) + (sel ? ', selecionado' : ', fora do seletor') + '">' + chips(s.labels) + '<span class="q-chunks">' + Array.from({ length: s.chunks }, () => '<span class="mini-chunk"></span>').join('') + '</span></div>' + (sel ? s.lines.map(l => { const alive = kept.has(l.id); const dead = !alive; const dropNow = droppedHere.has(l.id); return '<div class="q-line' + (dead ? ' is-dropped' : '') + (dropNow ? ' is-dropping' : '') + '" data-k="L' + l.id + '" data-inspect tabindex="0" role="button" aria-label="Linha ' + esc(l.line) + (dead ? ', descartada' : '') + '"><code>' + esc(l.line) + '</code><span class="q-meta">' + (Object.keys(l.sm).length ? chips(l.sm, 'sm') : '') + fieldsOf(l.id).map(([a, b]) => chip(a, b, 'field')).join('') + (errors.has(l.id) ? chip('__error__', 'JSONParserErr', 'error') : '') + (dropNow ? '<span class="drop-tag">descartada em ' + esc(st.text) + '</span>' : '') + '</span></div>'; }).join('') : '<p class="zone-empty">Fora do seletor: nenhum chunk lido.</p>') + '</div>'; }).join('') + '</div>';
      const apply = () => { stage.innerHTML = html; };
      if (animate) flip(stage, apply, { duration: Math.min(700, dur * 0.4) }); else apply();
      const sel = result.stages[0];
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Streams selecionados', value: result.selected.length + ' / ' + result.totals.streams },
        { label: 'Chunks lidos', value: sel.chunks + ' / ' + result.totals.chunks, tone: sel.chunks === result.totals.chunks ? 'warn' : '' },
        { label: 'Bytes lidos', value: fmt(sel.bytes) + ' B', sub: fmt(sel.bytes / result.totals.bytes * 100, 0) + '% do tenant' },
        { label: 'Linhas interpretadas', value: result.parsed, tone: result.parsed > 6 ? 'warn' : '' },
        { label: 'Linhas nesta etapa', value: st.kept.length },
        { label: 'Retornadas', value: result.rows.length }
      ]);
      part(root, 'narration').innerHTML = esc(st.note) + (i === result.stages.length - 1 && result.bloomCandidates.length ? ' Com bloom filters habilitados (experimental), o filtro <code>' + esc(result.bloomCandidates.join(', ')) + '</code> antes de qualquer parser poderia pular chunks que certamente não têm o valor.' : '');
      inspector.refresh();
    };
    const runQuery = (text) => {
      const err = part(root, 'qerror');
      try { result = E.runLogQL(text); err.textContent = ''; player.stop(); player.show(0, false); }
      catch (e) { err.textContent = e.message; }
    };
    const player = createPlayer(root, { count: () => result.stages.length, render: draw, baseMs: 2400 });
    const inspector = bindInspector(root, describe);
    const ta = root.querySelector('[data-q="text"]');
    root.querySelector('[data-q="preset"]').addEventListener('change', e => { ta.value = E.LOGQL_PRESETS[Number(e.target.value)][1]; runQuery(ta.value); });
    root.querySelector('[data-q="run"]').addEventListener('click', () => runQuery(ta.value));
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runQuery(ta.value); });
    player.show(0, false);
  }
};

// ===========================================================================
// Lab 7: bloom filters
// ===========================================================================
const BLOOM_STEPS = [
  ['Índice de labels', 'O seletor {cluster="prod"} escolhe os streams pelo índice TSDB. Todos os chunks deles no intervalo são candidatos. O bloom não participa desta etapa.'],
  ['Bloom do stream', 'O bloom gateway testa o token trace_id=<valor> no bloom de cada stream. Se algum bit testado é 0, o valor certamente não está em nenhum chunk do stream: o stream inteiro é descartado com segurança.'],
  ['Bloom do chunk', 'Para os streams que passaram, testa o token prefixado pela referência do chunk. Bit 0 descarta aquele chunk.'],
  ['Download e verificação', 'Os chunks restantes são baixados e lidos linha a linha. Alguns têm o valor; outros eram falsos positivos: todos os bits estavam em 1 por coincidência.']
];
const lab7 = {
  markup: () => labShell({
    id: 'lab7', n: 'Laboratório 7', title: 'Bloom filters: o que dá para pular com segurança',
    question: 'Como procurar um trace_id em muitos chunks sem transformar cada ID em label?',
    controls: select('m', 'Bits por bloom (m)', [[32, '32'], [64, '64'], [128, '128'], [256, '256']], 64) + range('k', 'Funções de hash (k)', 1, 6, 3) + range('ids', 'trace_ids por chunk', 1, 6, 3) + select('target', 'Procurar', [['abc123', 'trace_id="abc123" (existe em 1 chunk)'], ['ffffff', 'trace_id="ffffff" (não existe)'], ['5e5e5e', 'trace_id="5e5e5e" (não existe)']], 'abc123'),
    premises: 'para cada par de structured metadata, o builder insere <code>nome</code>, <code>nome=valor</code> e as duas versões prefixadas pela referência do chunk no bloom do stream (<code>pkg/storage/bloom/v1/tokenizer.go</code>); o gateway testa primeiro o token sem prefixo (pula o stream) e depois o prefixado (pula o chunk); só <code>| chave="valor"</code> sobre structured metadata, antes de qualquer parser, é acelerado (<code>docs/sources/query/query_acceleration.md</code>).',
    limits: 'blooms minúsculos para caber na tela, com hash duplo FNV; o Loki usa blooms escaláveis com taxa de falso positivo configurada. <strong>Experimental no 3.7</strong>: exige bloom planner, builder e gateway, não roda em single binary e é indicado para quem ingere mais de 75 TB/mês. Blooms são construídos a partir de chunks já no bucket, por isso dados recentes nos ingesters não são filtrados por eles.'
  }),
  mount(root) {
    const stage = part(root, 'stage');
    let sc;
    const rebuild = () => { const p = readParams(root); sc = E.bloomScenario({ m: Number(p.m), k: p.k, idsPerChunk: p.ids, target: p.target }); };
    const describe = k => {
      const s = sc.streams.find(x => 'b' + x.id === k);
      if (s) return { kind: 'Bloom do stream', title: s.key, rows: [['Itens inseridos', s.bloom.n + ' tokens'], ['Bits em 1', fmt(s.fill * 100, 0) + '%'], ['Posições testadas', s.positions.join(', ')], ['Resultado', s.streamMaybe ? 'talvez contenha' : 'certamente não contém']] };
      for (const st of sc.streams) { const c = st.chunks.find(x => 'ch' + x.ref === k); if (c) return { kind: 'Chunk', title: c.ref, rows: [['trace_ids reais', c.ids.map(id => '<code>' + id + '</code>').join(' ')], ['Token testado', '<code>' + esc(c.ref) + 'trace_id=' + esc(sc.target) + '</code>'], ['Veredito', ({ 'skip-stream': 'descartado pelo bloom do stream', 'skip-chunk': 'descartado pelo bloom do chunk', match: 'baixado: contém o valor', 'false-positive': 'baixado: falso positivo' })[c.verdict]]] }; }
      return null;
    };
    const draw = (i, animate, dur) => {
      const bits = (b, positions, show) => '<div class="bits" style="--m:' + b.m + '">' + Array.from(b.bits, (v, n) => '<span class="bit' + (v ? ' on' : '') + (show && positions.includes(n) ? (v ? ' probe' : ' probe miss') : '') + '"></span>').join('') + '</div>';
      const verdictClass = c => i < 1 ? '' : c.verdict === 'skip-stream' ? ' v-skip' : i < 2 ? '' : c.verdict === 'skip-chunk' ? ' v-skip' : i < 3 ? ' v-maybe' : c.verdict === 'match' ? ' v-match' : ' v-fp';
      const html = '<div class="bloom-grid">' + sc.streams.map(s => '<div class="bloom-stream' + (i >= 1 && !s.streamMaybe ? ' is-skipped' : '') + '" data-k="b' + s.id + '" data-inspect><div class="stream-head" data-inspect="b' + s.id + '" tabindex="0" role="button" aria-label="Bloom do stream ' + esc(s.key) + '">' + chips(s.labels) + (i >= 1 ? '<span class="bloom-verdict">' + (s.streamMaybe ? 'talvez' : 'certamente não') + '</span>' : '') + '</div>' + bits(s.bloom, i === 1 ? s.positions : i === 2 ? s.chunks.flatMap(c => c.positions) : [], i === 1 || i === 2) +
        '<div class="bloom-chunks">' + s.chunks.map(c => '<div class="bchunk' + verdictClass(c) + '" data-k="ch' + c.ref + '" data-inspect tabindex="0" role="button" aria-label="Chunk ' + c.ref + '"><span class="bchunk-ref">' + c.ref + '</span><span class="bchunk-state">' + (i < 1 ? 'candidato' : c.verdict === 'skip-stream' ? 'pulado' : i < 2 ? 'candidato' : c.verdict === 'skip-chunk' ? 'pulado' : i < 3 ? 'baixar' : c.verdict === 'match' ? 'contém' : 'falso positivo') + '</span></div>').join('') + '</div></div>').join('') + '</div>';
      const apply = () => { stage.innerHTML = html; };
      if (animate) flip(stage, apply, { duration: Math.min(700, dur * 0.4) }); else apply();
      const t = sc.totals;
      part(root, 'metrics').innerHTML = metrics([
        { label: 'Chunks candidatos', value: t.chunks },
        { label: 'Pulados com segurança', value: i >= 2 ? t.skipped : i === 1 ? sc.streams.filter(s => !s.streamMaybe).reduce((n, s) => n + s.chunks.length, 0) : 0, tone: 'good' },
        { label: 'Baixados', value: i >= 2 ? t.downloaded : '—' },
        { label: 'Falsos positivos', value: i >= 3 ? t.falsePositives : '—', tone: i >= 3 && t.falsePositives ? 'warn' : '' },
        { label: 'Falsos negativos', value: i >= 3 ? t.falseNegatives : '—', tone: 'good', hint: 'Um bloom bem construído nunca diz "não" para algo inserido.' },
        { label: 'FP teórico por teste', value: fmt(sc.theoreticalFp * 100, 1) + '%', hint: '(1 − e^(−k·n/m))^k' }
      ]);
      part(root, 'narration').innerHTML = '<strong>' + BLOOM_STEPS[i][0] + '.</strong> ' + esc(BLOOM_STEPS[i][1]) + (i === 3 ? ' Resultado: ' + t.matches + ' chunk(s) com o valor, ' + t.falsePositives + ' falso(s) positivo(s), ' + t.falseNegatives + ' falso negativo.' : '');
      inspector.refresh();
    };
    rebuild();
    const player = createPlayer(root, { count: () => BLOOM_STEPS.length, render: draw, baseMs: 2800 });
    const inspector = bindInspector(root, describe);
    onParams(root, () => { const at = player.index; player.stop(); rebuild(); player.show(at, false); });
    player.show(0, false);
  }
};

export const labs = { ingest, lab1, lab2, lab3, lab4, lab5, lab6, lab7 };
