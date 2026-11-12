// Modelos interativos de cada módulo. Cada um declara a pergunta que responde,
// as premissas e o que ele não representa. As regras ficam em sims.js e são testadas.
import {
  quorumOutcome, ingesterStates, createChunkModel, appendLine, chunkCompressedSize,
  durabilityStages, failureModes, durabilityOutcome, planQuery, bottleneck,
  retentionTimeline, parsingCost, retryOutcome, tokenFor, illustrativeFingerprint,
  canonicalLabels, withServiceName, chunkKey, tableFor, querySources, domainsOutcome
} from './sims.js';
import { cardinality } from './simulator.js';

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmt = (n, digits = 0) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const pct = n => fmt(n * 100, 1) + '%';

function frame(id, title, question, body, premises, limits) {
  return '<section class="interactive-section widget" data-widget="' + id + '" aria-labelledby="w-' + id + '-h">' +
    '<div class="flow-heading"><div><h2 id="w-' + id + '-h">' + esc(title) + '</h2><p class="widget-question">' + esc(question) + '</p></div><span class="simulation-label">Modelo</span></div>' +
    body +
    '<details class="premises"><summary>Premissas e limites deste modelo</summary><p><strong>Premissas:</strong> ' + esc(premises) + '</p><p><strong>O que ele não representa:</strong> ' + esc(limits) + '</p></details></section>';
}
const range = (id, label, min, max, value, step = 1, unit = '') => '<label for="' + id + '">' + esc(label) + ' <output id="' + id + '-v" for="' + id + '">' + esc(value) + unit + '</output></label><input id="' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" data-unit="' + esc(unit) + '">';
const select = (id, label, options, value) => '<label for="' + id + '">' + esc(label) + '</label><select id="' + id + '">' + options.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
const check = (id, label, checked) => '<label class="toggle-label"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
const result = id => '<div class="widget-result" id="' + id + '" role="status" aria-live="polite"></div>';

function bindInputs(root, update) {
  const sync = () => {
    root.querySelectorAll('input[type=range]').forEach(input => { const out = root.querySelector('#' + input.id + '-v'); if (out) out.textContent = input.value + (input.dataset.unit || ''); });
    update();
  };
  root.addEventListener('input', sync);
  root.addEventListener('change', sync);
  sync();
}
const val = (root, id) => root.querySelector('#' + id);
const num = (root, id) => Number(val(root, id).value);
const kv = rows => '<dl class="kv">' + rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>';
const bar = (label, value, max, cls = '') => '<div class="bar-row"><span>' + esc(label) + '</span><span class="bar ' + cls + '" aria-hidden="true"><span style="width:' + Math.max(1, Math.min(100, value / max * 100)) + '%"></span></span><span>' + fmt(value, 1) + '</span></div>';

export const widgets = {
  cardinality: {
    markup: () => frame('cardinality', 'Quantos streams cabem nas suas escolhas?', 'Multiplique as dimensões e veja quando um identificador por requisição explode o número de streams.',
      '<div class="widget-grid"><div class="controls">' + range('apps', 'Aplicações', 1, 20, 3) + range('envs', 'Ambientes', 1, 5, 2) + range('pods', 'Pods por aplicação/ambiente', 1, 40, 4) + range('requests', 'IDs distintos por combinação', 1, 1000, 100) + check('include-requests', 'Promover request_id a label', false) + range('ingesters', 'Ingesters saudáveis', 1, 30, 6) + '</div>' + result('card-out') + '</div>',
      'Todas as combinações ocorrem; streams distribuídos uniformemente; RF=3, uma zona; limite max_global_streams_per_user = 5000 (default).',
      'Memória por stream, custo de índice e de bucket, nem os streams criados pelo service_name (que não multiplica, porque copia app).'),
    mount(root) {
      bindInputs(root, () => {
        const [a, e, p, r] = ['apps', 'envs', 'pods', 'requests'].map(id => num(root, id));
        const include = val(root, 'include-requests').checked;
        const count = cardinality(a, e, p, r, include);
        const perIngester = Math.ceil(count * 3 / num(root, 'ingesters'));
        const localLimit = Math.floor(5000 / num(root, 'ingesters') * 3);
        val(root, 'card-out').innerHTML = kv([
          ['Teto de streams', '<strong>' + fmt(count) + '</strong> = ' + [a, e, p].join(' × ') + (include ? ' × ' + r : '')],
          ['Streams por ingester (RF=3)', fmt(perIngester)],
          ['Limite local do tenant', fmt(localLimit) + ' (5000 ÷ ' + num(root, 'ingesters') + ' × 3)'],
          ['Resultado', count > 5000 ? '<span class="bad">Acima do limite: novos streams recebem 429 stream_limit.</span>' : '<span class="good">Dentro do limite default.</span>']
        ]) + '<p>' + (include ? 'Cada request_id novo cria um stream com chunk próprio, quase vazio, fechado por chunk_idle_period.' : 'Com request_id em structured metadata, o número de streams depende só da origem.') + '</p>';
      });
    }
  },

  retry: {
    markup: () => frame('retry', 'O Alloy reenvia, espera ou descarta?', 'Escolha a resposta do Loki e a duração da indisponibilidade.',
      '<div class="widget-grid"><div class="controls">' + select('r-status', 'Resposta do Loki', [[503, '503 (indisponível)'], [500, '500 (erro de quorum)'], [429, '429 (limite do tenant)'], [0, 'Sem resposta (conexão recusada)'], [400, '400 (linha inválida)']], 503) + range('r-outage', 'Duração da falha', 5, 900, 180, 5, ' s') + range('r-retries', 'max_backoff_retries', 1, 20, 10) + check('r-429', 'retry_on_http_429', true) + '</div>' + result('r-out') + '</div>',
      'Defaults do loki.write no Alloy v1.11.0: min_backoff_period 500 ms, max_backoff_period 5 min. A falha começa no primeiro envio e termina de uma vez. Duração das requisições desprezada.',
      'O WAL opcional do loki.write, falhas parciais (400 com parte aceita), o atraso da leitura do arquivo enquanto o laço está bloqueado, nem duplicatas no Loki.'),
    mount(root) {
      bindInputs(root, () => {
        const r = retryOutcome({ status: num(root, 'r-status'), outageSeconds: num(root, 'r-outage'), maxRetries: num(root, 'r-retries'), retryOn429: val(root, 'r-429').checked });
        const rows = r.attempts.map(([lo, hi], i) => '<li>Envio ' + (i + 1) + ': entre ' + fmt(lo / 1000, 1) + ' s e ' + fmt(hi / 1000, 1) + ' s</li>').join('');
        val(root, 'r-out').innerHTML = '<p class="' + (r.outcome === 'delivered' ? 'good' : r.outcome === 'dropped' ? 'bad' : 'warn') + '"><strong>' + ({ delivered: 'Entregue', dropped: 'Descartado', depends: 'Depende do sorteio' })[r.outcome] + '.</strong> ' + esc(r.text) + '</p><ol class="timeline">' + rows + '</ol><p>Enquanto houver retry, o laço do cliente não envia outros lotes, nem de outros tenants.</p>';
      });
    }
  },

  quorum: {
    markup: () => frame('quorum', 'Quando o cliente recebe ACK?', 'Escolha o estado de cada réplica do stream de E1.',
      '<div class="widget-grid"><div class="controls">' + select('q-rf', 'Fator de replicação', [[1, 'RF = 1 (laboratório)'], [3, 'RF = 3 (default do ring)'], [5, 'RF = 5']], 3) + '<div id="q-replicas"></div>' + range('q-timeout', 'ingester_client.remote_timeout', 100, 5000, 5000, 100, ' ms') + '</div>' + result('q-out') + '</div>',
      'Regras de dskit Filter (minSuccess = RF/2+1, instâncias sem heartbeat removidas mas contadas) e do PushTracker do distributor. Latências fixas por estado: ok 8 ms, lento 900 ms, erro 12 ms.',
      'Rede real, vários streams por lote (o ACK espera todos), mudanças no ring durante o push nem zone awareness.'),
    mount(root) {
      const states = ['ok', 'ok', 'slow', 'ok', 'ok'];
      const draw = () => {
        const rf = num(root, 'q-rf');
        val(root, 'q-replicas').innerHTML = Array.from({ length: rf }, (_, i) => select('q-s' + i, 'Ingester ' + (i + 1), Object.entries(ingesterStates).map(([k, v]) => [k, v.label]), states[i])).join('');
      };
      draw();
      root.addEventListener('change', event => { if (event.target.id === 'q-rf') draw(); if (event.target.id?.startsWith('q-s')) states[Number(event.target.id.slice(3))] = event.target.value; });
      bindInputs(root, () => {
        const rf = num(root, 'q-rf');
        const list = Array.from({ length: rf }, (_, i) => val(root, 'q-s' + i)?.value || 'ok');
        const r = quorumOutcome(list, { remoteTimeoutMs: num(root, 'q-timeout') });
        val(root, 'q-out').innerHTML = kv([['minSuccess', r.minSuccess], ['maxErrors', r.maxErrors], ['Saudáveis no ring', r.healthy + ' de ' + r.replicationFactor]]) +
          '<p class="' + (r.status === 'acked' ? 'good' : 'bad') + '"><strong>' + (r.status === 'acked' ? '204' : r.status === 'failed' ? 'Erro' : 'Recusado antes do envio') + '.</strong> ' + esc(r.message) + '</p><ol class="timeline">' + r.events.map(ev => '<li><span>' + fmt(ev.t) + ' ms</span> ' + esc(ev.text) + '</li>').join('') + '</ol>';
      });
    }
  },

  chunk: {
    markup: () => frame('chunk', 'Quando um bloco e um chunk são cortados?', 'Acrescente linhas ao stream de E1 e veja o head block, os blocos comprimidos e o fechamento do chunk.',
      '<div class="widget-grid"><div class="controls">' + range('c-size', 'Tamanho de cada linha', 0.1, 64, 1, 0.1, ' KB') + range('c-ratio', 'Razão de compressão', 2, 12, 6, 1, '×') + range('c-minute', 'Timestamp da próxima linha', 0, 240, 0, 1, ' min') +
      '<div class="button-row"><button type="button" class="secondary" data-c="1">+1 linha</button><button type="button" class="secondary" data-c="100">+100 linhas</button><button type="button" class="secondary" data-c="1000">+1000 linhas</button><button type="button" class="text-button" data-c="reset">Recomeçar</button></div></div>' + result('c-out') + '</div>',
      'Regras de MemChunk.Append e SpaceFor (bloco 256 KB, alvo 1536 KB comprimido) e da janela de ordenação do stream (maior timestamp − max_chunk_age/2, com max_chunk_age 2 h). Compressão com razão fixa escolhida por você.',
      'Fechamento por chunk_idle_period ou max_chunk_age (eles dependem do relógio, não das linhas), duplicatas, limite de taxa por stream nem o formato real dos blocos.'),
    mount(root) {
      let model = createChunkModel();
      const draw = () => {
        const comp = chunkCompressedSize(model);
        val(root, 'c-out').innerHTML = bar('Head não comprimido (KB)', model.head, 256) + bar('Blocos comprimidos (KB)', comp, 1536) +
          kv([['Blocos no chunk aberto', model.blocks.length], ['Chunks fechados', model.closedChunks.length + (model.closedChunks.length ? ' (último: ' + model.closedChunks.at(-1).compressed + ' KB)' : '')], ['Maior timestamp', model.highestMin === null ? '—' : model.highestMin + ' min'], ['Linhas recusadas', model.rejected]]) +
          '<ol class="timeline">' + model.log.slice(0, 5).map(t => '<li>' + esc(t) + '</li>').join('') + '</ol>';
      };
      root.addEventListener('click', event => {
        const b = event.target.closest('[data-c]'); if (!b) return;
        if (b.dataset.c === 'reset') model = createChunkModel({ ratio: num(root, 'c-ratio') });
        else {
          if (model.ratio !== num(root, 'c-ratio')) model = { ...model, ratio: num(root, 'c-ratio') };
          for (let i = 0; i < Number(b.dataset.c); i++) model = appendLine(model, { sizeKB: num(root, 'c-size'), minute: num(root, 'c-minute') });
        }
        draw();
      });
      bindInputs(root, draw);
    }
  },

  durability: {
    markup: () => frame('durability', 'O que sobrevive a cada falha depois do ACK?', 'Escolha até onde E1 avançou e o que falha.',
      '<div class="widget-grid"><div class="controls">' + range('d-stage', 'Etapa', 0, durabilityStages.length - 1, 2) + '<p id="d-stage-name" class="stage-name"></p>' + select('d-fail', 'Falha', Object.entries(failureModes).map(([k, v]) => [k, v.label]), 'power') + select('d-rf', 'Réplicas', [[1, 'RF = 1 (laboratório)'], [3, 'RF = 3']], 1) + range('d-aff', 'Réplicas atingidas pela mesma falha', 1, 3, 1) + '</div>' + result('d-out') + '</div>',
      'WAL escrito sem fsync por requisição (fsync ao trocar de segmento ou no Close); flush por motivo full, idle ou max_age; índice no bucket só após rotação de 15 min e upload. Falhas das réplicas independentes salvo as marcadas como atingidas.',
      'Checkpoint, corrupção parcial de segmento, recuperação do bucket, nem o intervalo exato entre etapas.'),
    mount(root) {
      bindInputs(root, () => {
        const stage = num(root, 'd-stage');
        const rf = num(root, 'd-rf');
        const aff = val(root, 'd-aff');
        aff.max = String(rf); if (Number(aff.value) > rf) aff.value = String(rf);
        val(root, 'd-aff-v').textContent = aff.value;
        const s = durabilityStages[stage];
        val(root, 'd-stage-name').textContent = (stage + 1) + '. ' + s.title + ' — ' + s.where;
        const r = durabilityOutcome({ stage, failure: val(root, 'd-fail').value, replicationFactor: rf, affected: Number(aff.value) });
        val(root, 'd-out').innerHTML = '<ol class="stages">' + durabilityStages.map((st, i) => '<li class="' + (i <= stage ? 'done' : '') + '">' + esc(st.title) + '</li>').join('') + '</ol><p class="' + (r.survives === true ? 'good' : r.survives === false ? 'bad' : 'warn') + '"><strong>' + (r.acked ? (r.survives ? 'Sobrevive.' : 'Pode ser perdido.') : 'Antes do ACK.') + '</strong> ' + esc(r.reason) + '</p><p class="small-note">' + esc(s.evidence) + '</p>';
      });
    }
  },

  reference: {
    markup: () => frame('reference', 'Como uma label vira chave de objeto?', 'Mude os labels de E1 e veja o token do ring, a tabela de índice e a chave do chunk.',
      '<div class="widget-grid"><div class="controls"><label for="ref-tenant">Tenant</label><input id="ref-tenant" type="text" value="fake" spellcheck="false"><label for="ref-labels">Labels enviados</label><input id="ref-labels" type="text" value=\'{format="json", app="checkout", env="lab"}\' spellcheck="false">' + range('ref-age', 'Idade do chunk (início)', 0, 72, 2, 1, ' h') + '</div>' + result('ref-out') + '</div>',
      'TokenFor = FNV-1 32 de tenant + string canônica (exato). Tabela = prefixo index_ + dias desde 1970 (período 24 h). Chave v12+ = tenant/fp/from:through:checksum em hexadecimal; chunk de 2 h; checksum ilustrativo.',
      'O fingerprint real é xxhash64 calculado no ingester (aqui, FNV-1 64 só para mostrar o formato), o mapeamento de colisões e shards de stream (__stream_shard__).'),
    mount(root) {
      bindInputs(root, () => {
        try {
          const tenant = val(root, 'ref-tenant').value.trim() || 'fake';
          const canon = canonicalLabels(val(root, 'ref-labels').value);
          const stored = withServiceName(canon);
          const fp = illustrativeFingerprint(stored);
          const from = Date.now() - num(root, 'ref-age') * 3600e3;
          const through = from + 2 * 3600e3;
          val(root, 'ref-out').innerHTML = kv([
            ['String canônica', '<code>' + esc(canon) + '</code>'],
            ['Depois de ParseRequest', '<code>' + esc(stored) + '</code>' + (stored !== canon ? ' <span class="warn">service_name acrescentado</span>' : '')],
            ['TokenFor (ring)', '<code>' + tokenFor(tenant, stored) + '</code>'],
            ['Fingerprint (ilustrativo)', '<code>' + fp.toString(16) + '</code>'],
            ['Tabela de índice', '<code>' + tableFor(from) + '</code>'],
            ['Chave do chunk', '<code>' + esc(chunkKey({ tenant, fingerprint: fp, fromMs: from, throughMs: through, checksum: tokenFor('', stored + from) })) + '</code>'],
            ['No filesystem do laboratório', '<code>/loki/chunks/' + esc(tenant) + '/' + fp.toString(16) + '/' + btoa(Math.trunc(from).toString(16) + ':' + Math.trunc(through).toString(16) + ':' + (tokenFor('', stored + from) >>> 0).toString(16)) + '</code> (último segmento em base64, FSEncoder)']
          ]);
        } catch (error) { val(root, 'ref-out').innerHTML = '<p class="bad">' + esc(error.message) + '</p>'; }
      });
    }
  },

  queryplan: {
    markup: () => frame('queryplan', 'Em quantas tarefas Q1 vira, e quem limita?', 'Ajuste o volume, a divisão e a capacidade dos queriers.',
      '<div class="widget-grid"><div class="controls">' + range('p-range', 'Intervalo da consulta', 1, 168, 24, 1, ' h') + range('p-split', 'split_queries_by_interval', 15, 240, 60, 15, ' min') + range('p-gb', 'Volume do seletor', 0.1, 100, 20, 0.1, ' GB/h') + range('p-q', 'Queriers', 1, 64, 4) + range('p-mc', 'querier.max_concurrent', 1, 32, 4) + range('p-tsdb', 'tsdb_max_query_parallelism', 8, 512, 128, 8) + check('p-shard', 'Consulta shardable (sum, count, rate…)', true) + '</div>' + result('p-out') + '</div>',
      'Bytes uniformes no tempo; um frontend; shards = próxima potência de 2 de bytes ÷ tsdb_max_bytes_per_shard (600 MB), 1 vira 0; cada tarefa leva o mesmo tempo (2 s).',
      'Cache de resultados, consultas de log com limite (saem cedo), tarefas desiguais, vários tenants disputando a fila nem a filtragem por bloom.'),
    mount(root) {
      bindInputs(root, () => {
        const r = planQuery({ rangeHours: num(root, 'p-range'), splitMinutes: num(root, 'p-split'), gbPerHour: num(root, 'p-gb'), queriers: num(root, 'p-q'), maxConcurrent: num(root, 'p-mc'), tsdbMaxQueryParallelism: num(root, 'p-tsdb'), shardable: val(root, 'p-shard').checked });
        val(root, 'p-out').innerHTML = kv([
          ['Subconsultas por tempo', fmt(r.splits) + ' × ' + fmt(r.bytesPerSplitMB) + ' MB'],
          ['Shards por subconsulta', r.factor ? fmt(r.factor) : '1 (sem sharding)'],
          ['Tarefas', '<strong>' + fmt(r.tasks) + '</strong> de ~' + fmt(r.bytesPerTaskMB) + ' MB'],
          ['Slots nos queriers', fmt(r.querierSlots)],
          ['Concorrência efetiva', fmt(r.effectiveConcurrency) + ' — ' + esc(r.limiter)],
          ['Ondas', fmt(r.waves) + ' (≈ ' + fmt(r.estimatedSeconds) + ' s no modelo)'],
          ['Na fila esperando slot', fmt(r.queued)]
        ]) + (r.bytesPerTaskMB > 1200 ? '<p class="warn">Tarefas grandes: cada uma descomprime mais de 1 GB; a memória do querier vira o risco.</p>' : '');
      });
    }
  },

  sources: {
    markup: () => frame('sources', 'De onde vem cada pedaço da resposta?', 'Escolha o intervalo de uma tarefa e a janela dos ingesters.',
      '<div class="widget-grid"><div class="controls">' + range('s-start', 'Início da tarefa (horas atrás)', 1, 48, 1, 0.25, ' h') + range('s-end', 'Fim da tarefa (horas atrás)', 0, 47, 0, 0.25, ' h') + range('s-qiw', 'querier.query_ingesters_within', 0, 6, 3, 0.25, ' h') + range('s-mca', 'ingester.max_chunk_age', 0.5, 4, 2, 0.25, ' h') + '</div>' + result('s-out') + '</div>',
      'Regra de BuildQueryIntervalsWithLookback com query_store_max_look_back_period = 0 (default). Dado mais antigo que max_chunk_age + 16 min (rotação de 15 min + upload) está garantidamente no store.',
      'Chunks fechados antes de max_chunk_age (que chegam ao store mais cedo), cache de chunks e resultados, nem falhas de ingester.'),
    mount(root) {
      bindInputs(root, () => {
        let start = num(root, 's-start'), end = num(root, 's-end');
        if (end >= start) { end = Math.max(0, start - 0.25); val(root, 's-end').value = String(end); val(root, 's-end-v').textContent = end + ' h'; }
        const r = querySources({ startHoursAgo: start, endHoursAgo: end, queryIngestersWithinH: num(root, 's-qiw'), maxChunkAgeH: num(root, 's-mca') });
        val(root, 's-out').innerHTML = kv([
          ['Ingesters', r.ingesters ? 'consultados de ' + r.ingesters[0] + ' h a ' + r.ingesters[1] + ' h atrás (todos os do ring)' : 'não consultados: a tarefa termina antes de agora − query_ingesters_within'],
          ['Store (índice + chunks)', 'consultado de ' + r.store[0] + ' h a ' + r.store[1] + ' h atrás'],
          ['Dado só no ingester', 'até ' + fmt(r.onlyInIngesterH, 2) + ' h de idade, no pior caso']
        ]) + (r.touchesGap ? '<p class="bad"><strong>Lacuna.</strong> Esta tarefa cobre dados de ' + fmt(Math.max(r.gapRange[0], end), 2) + ' a ' + fmt(Math.min(r.gapRange[1], start), 2) + ' h atrás que podem estar só nos ingesters, que ela não consulta. Linhas somem sem erro.</p>' : r.gap ? '<p class="warn">query_ingesters_within é menor que o tempo máximo só no ingester: tarefas que terminam antes de ' + r.gapRange[0] + ' h atrás podem perder dados.</p>' : '<p class="good">Sem lacuna para esta configuração.</p>');
      });
    }
  },

  parsing: {
    markup: () => frame('parsing', 'Por que | json em 24 h pesa?', 'Compare quanto é descomprimido, quanto passa pelo parser e quantos campos são extraídos.',
      '<div class="widget-grid"><div class="controls">' + range('x-lps', 'Linhas por segundo no seletor', 10, 50000, 2000, 10) + range('x-bytes', 'Tamanho médio da linha', 50, 4000, 400, 10, ' B') + range('x-hours', 'Intervalo', 1, 168, 24, 1, ' h') + range('x-sel', 'Fração que passa no filtro |=', 0, 100, 2, 0.5, ' %') + check('x-filter', 'Filtro de linha antes do parser', true) + select('x-kind', 'Tipo de consulta', [['metric', 'Métrica (count_over_time, sum…)'], ['log', 'Log (retorna linhas)']], 'metric') + range('x-fields', 'Campos por linha', 1, 60, 12) + '</div>' + result('x-out') + '</div>',
      'Todo byte do seletor no intervalo é descomprimido; o filtro de linha opera sobre linhas já descomprimidas; numa consulta métrica o parser recebe a lista de campos exigidos (NewParserHint) e extrai só eles; numa consulta de log extrai todos.',
      'Custo por byte de cada etapa, bloom filters, structured metadata, cache, nem a saída antecipada de consultas de log com limit.'),
    mount(root) {
      bindInputs(root, () => {
        const metric = val(root, 'x-kind').value === 'metric';
        const r = parsingCost({ linesPerSecond: num(root, 'x-lps'), avgLineBytes: num(root, 'x-bytes'), hours: num(root, 'x-hours'), selectivity: num(root, 'x-sel') / 100, lineFilter: val(root, 'x-filter').checked, metric, fieldsPerLine: num(root, 'x-fields'), requiredFields: 1 });
        val(root, 'x-out').innerHTML = kv([
          ['Linhas no intervalo', fmt(r.lines)],
          ['Bytes descomprimidos', '<strong>' + fmt(r.bytesGB, 1) + ' GB</strong> (independe do filtro)'],
          ['Linhas interpretadas pelo parser', fmt(r.parsedLines)],
          ['Campos extraídos', fmt(r.fieldsExtracted) + ' (' + r.fieldsPerParsedLine + ' por linha)']
        ]) + bar('Linhas lidas', r.lines, r.lines) + bar('Linhas no parser', r.parsedLines, r.lines, 'alt') + '<p>' + (val(root, 'x-filter').checked ? 'O filtro |= reduz o parser, não a descompressão.' : 'Sem filtro antes, cada linha passa pelo parser.') + (metric ? '' : ' Consulta de log: o parser extrai todos os campos de cada linha.') + '</p>';
      });
    }
  },

  retention: {
    markup: () => frame('retention', 'Quando um chunk é realmente apagado?', 'Escolha a retenção, a idade do chunk e o atraso de exclusão.',
      '<div class="widget-grid"><div class="controls">' + range('t-ret', 'retention_period', 24, 720, 168, 24, ' h') + range('t-age', 'Fim do chunk (through) há', 0, 720, 160, 1, ' h') + range('t-delay', 'retention_delete_delay', 0.5, 24, 2, 0.5, ' h') + range('t-comp', 'compaction_interval', 5, 60, 10, 5, ' min') + range('t-life', 'Regra de ciclo de vida no bucket', 0, 60, 0, 1, ' dias') + '</div>' + result('t-out') + '</div>',
      'retention_enabled = true; um ciclo de compactação a cada compaction_interval que marca chunks expirados; o sweeper apaga marcadores mais velhos que retention_delete_delay; nenhuma fila atrasada.',
      'Pedidos de exclusão por API, retenção por stream, marcadores compartilhados no bucket, nem a duração real de um ciclo em tabelas grandes.'),
    mount(root) {
      bindInputs(root, () => {
        const r = retentionTimeline({ retentionHours: num(root, 't-ret'), chunkThroughHoursAgo: num(root, 't-age'), compactionMinutes: num(root, 't-comp'), deleteDelayHours: num(root, 't-delay'), lifecycleDays: num(root, 't-life') });
        val(root, 't-out').innerHTML = kv([
          ['Expira em', fmt(r.expiresIn, 2) + ' h'],
          ['Marcado em até', fmt(r.markedIn, 2) + ' h (próximo ciclo)'],
          ['Apagado em até', '<strong>' + fmt(r.deletedIn, 2) + ' h</strong>'],
          ['Ainda visível em consultas', 'até ser marcado: a marcação também retira a referência do índice']
        ]) + (r.conflict ? '<p class="bad">A regra do bucket apaga o objeto antes do compactor: o índice continua apontando para um chunk inexistente e consultas falham ao buscá-lo.</p>' : r.lifecycleHours !== null ? '<p class="good">A regra do bucket atua depois do compactor.</p>' : '');
      });
    }
  },

  bottleneck: {
    markup: () => frame('bottleneck', 'Quando mais paralelismo piora?', 'Aumente max_concurrent e veja qual teto aparece primeiro.',
      '<div class="widget-grid"><div class="controls">' + range('b-work', 'Bytes a ler', 1, 2000, 480, 1, ' GB') + range('b-q', 'Queriers', 1, 64, 4) + range('b-cores', 'Núcleos por querier', 1, 32, 4) + range('b-mc', 'querier.max_concurrent', 1, 64, 4) + range('b-mem', 'Memória por querier', 2, 64, 8, 1, ' GB') + '</div>' + result('b-out') + '</div>',
      'Teto (roofline): cada núcleo processa ~150 MB/s de linhas descomprimidas; cada querier lê até 400 MB/s do store; o store entrega até 4 GB/s no total; cada tarefa em voo ocupa ~700 MB.',
      'Números medidos: as taxas são hipóteses para comparar cenários. Também não representa GC, contenção, latência de cauda nem caches.'),
    mount(root) {
      bindInputs(root, () => {
        const r = bottleneck({ workGB: num(root, 'b-work'), queriers: num(root, 'b-q'), coresPerQuerier: num(root, 'b-cores'), maxConcurrent: num(root, 'b-mc'), memPerQuerierGB: num(root, 'b-mem') });
        const max = Math.max(r.cpuMBps, r.ioMBps);
        val(root, 'b-out').innerHTML = bar('Teto de CPU (MB/s)', r.cpuMBps, max) + bar('Teto de IO (MB/s)', r.ioMBps, max, 'alt') + kv([
          ['Trabalhadores', fmt(r.workers)], ['Vazão', fmt(r.throughput) + ' MB/s'], ['Gargalo', esc(r.limiting)], ['Tempo no modelo', fmt(r.seconds) + ' s'],
          ['Memória exigida', fmt(r.memoryNeededGB, 1) + ' GB por querier']
        ]) + (r.oomRisk ? '<p class="bad">Mais tarefas em voo que a memória comporta: risco de OOM; o querier reinicia e as tarefas são refeitas.</p>' : num(root, 'b-mc') > num(root, 'b-cores') ? '<p class="warn">max_concurrent acima dos núcleos: o tempo não cai, só a memória sobe.</p>' : '');
      });
    }
  },

  domains: {
    markup: () => frame('domains', 'Domínios de falha × réplicas', 'Escolha a topologia e o que falha. Veja quantos streams perdem o quorum de escrita.',
      '<div class="widget-grid"><div class="controls">' + select('z-rf', 'Fator de replicação', [[1, 'RF = 1'], [3, 'RF = 3']], 3) + select('z-zones', 'Zonas', [[1, '1 zona'], [3, '3 zonas']], 3) + range('z-ipz', 'Ingesters por zona', 1, 10, 3) + check('z-aware', 'zone_awareness_enabled', true) + select('z-fail', 'Falha', [['node', '1 ingester'], ['two-nodes', '2 ingesters da mesma zona'], ['zone', 'Zona inteira']], 'zone') + '</div>' + result('z-out') + '</div>',
      'minSuccess = RF/2+1; com zone awareness, uma réplica por zona; sem ela, réplicas tratadas como amostra uniforme de ingesters distintos.',
      'O percurso real dos tokens, ingesters LEAVING, leitura (que exige quorum por zona) nem a recuperação pelo WAL.'),
    mount(root) {
      bindInputs(root, () => {
        try {
          const r = domainsOutcome({ replicationFactor: num(root, 'z-rf'), zones: num(root, 'z-zones'), ingestersPerZone: num(root, 'z-ipz'), zoneAware: val(root, 'z-aware').checked, failure: val(root, 'z-fail').value });
          val(root, 'z-out').innerHTML = kv([
            ['Ingesters', fmt(r.total) + ' (' + fmt(r.failed) + ' falham)'], ['Zone awareness efetivo', r.aware ? 'sim' : 'não'], ['Falhas toleradas por stream', r.tolerated],
            ['Streams sem quorum de escrita', '<strong>' + pct(r.lostFraction) + '</strong>'],
            ['Streams com todas as cópias no domínio perdido', pct(r.dataAtRisk)]
          ]) + '<p>' + (r.lostFraction === 0 ? 'Todas as escritas continuam.' : 'Esses streams recebem 5xx até os ingesters voltarem.') + (r.dataAtRisk > 0 ? ' Se o domínio perdeu o disco, linhas ainda não enviadas ao bucket desses streams são perdidas.' : '') + '</p>';
        } catch (error) { val(root, 'z-out').innerHTML = '<p class="bad">' + esc(error.message) + '</p>'; }
      });
    }
  }
};
