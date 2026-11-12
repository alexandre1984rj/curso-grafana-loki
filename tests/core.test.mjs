import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { modules } from '../src/course.js';
import { simulate, sampleLogs, cardinality } from '../src/simulator.js';
import { flows, edgeGeometry, edgeKinds } from '../src/flows.js';
import { readProgress, saveProgress, storageKey } from '../src/progress.js';
import { widgets } from '../src/widgets.js';
import { labs } from '../src/lab/labs.js';
import { layers, evidenceKinds } from '../src/course.js';
import * as sims from '../src/sims.js';
import { eventFor } from '../labs/local/generate.mjs';

test('trilha completa tem pergunta, camadas, evidência, código, exercício, visual e feedback para cada alternativa', async () => {
  assert.equal(modules.length, 18);
  assert.equal(new Set(modules.map(module => module.id)).size, modules.length);
  // IDs da versão anterior preservados para não perder progresso salvo.
  for (const id of ['fundamentos','modelo-dados','coleta','escrita','leitura','logql','armazenamento','implantacao','desempenho','caso-go']) assert.ok(modules.some(m => m.id === id), id);
  const kinds = new Set(Object.values(evidenceKinds));
  for (const module of modules) {
    assert.ok(module.question.endsWith('?'), module.id);
    assert.ok(module.trace.length > 80, module.id);
    assert.ok(Number.isInteger(module.quizVersion) && module.quizVersion >= 1, module.id);
    assert.ok(module.objectives.length >= 3);
    assert.ok(module.prereqs.length > 30);
    assert.ok(module.sections.length >= 5, module.id);
    for (const section of module.sections) { assert.ok(layers[section.layer], module.id + ': ' + section.title); assert.ok(kinds.has(section.kind), module.id + ': ' + section.kind); assert.ok(section.text.length > 60); }
    for (const layer of ['intuicao','mecanismo','operacao']) assert.ok(module.sections.some(s => s.layer === layer), module.id + ' sem camada ' + layer);
    assert.ok(module.exercise.task && module.exercise.solution);
    assert.ok(module.example.code && module.example.caption);
    assert.ok(module.flow || module.widget || module.labs?.length, module.id);
    for (const id of module.labs || []) assert.ok(labs[id], module.id + ': lab ' + id);
    if (module.flow) assert.ok(flows[module.flow], module.id);
    if (module.widget) assert.ok(widgets[module.widget], module.id + ': widget ' + module.widget);
    for (const ref of module.code) { assert.ok(ref.file && Number.isInteger(ref.line) && ref.line > 0 && ref.symbol && ref.explains, module.id); }
    assert.ok(module.refs.length >= 2);
    for (const ref of module.refs) assert.equal(new URL(ref.url).protocol, 'https:');
    assert.ok(module.quiz.length >= 2);
    for (const quiz of module.quiz) {
      assert.ok(quiz.correct >= 0 && quiz.correct < quiz.options.length);
      for (const option of quiz.options) assert.ok(option.text && option.why.length > 20);
    }
    for (const d of module.dossiers) {
      for (const key of ['name','problem','structures','communication','example']) assert.ok(typeof d[key] === 'string' && d[key].length > (key === 'name' ? 2 : 10), module.id + '/' + d.name + ': ' + key);
      assert.ok(d.data.input && d.data.state && d.data.output);
      assert.ok(d.steps.length >= 3 && d.params.length >= 2 && d.guarantees.length && d.breaks.length && d.failures.length);
      for (const param of d.params) assert.ok(param.yaml && param.unit && param.def && param.effect, d.name + ': ' + param.yaml);
      for (const failure of d.failures) assert.ok(failure.symptom && failure.observe && failure.investigate);
      assert.ok(d.exercise.task && d.exercise.answer.length > 40);
    }
  }
  // Os 14 componentes pedidos têm dossiê.
  const names = modules.flatMap(m => m.dossiers.map(d => d.name)).join(' | ');
  for (const component of ['Distributor','Ingester','Query frontend','Query scheduler','Querier','Index gateway','Compactor','Ruler','Ring','WAL','Chunks','TSDB','Caches','Object storage']) assert.ok(names.includes(component), component);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const [,path] of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) await access(new URL('../'+path, import.meta.url));
});
test('filtros e parsers retornam as entradas esperadas', () => {
  assert.deepEqual(simulate('{app="checkout",format="json"} | json | level="error"').rows.map(row=>row.id), [2,4]);
  assert.deepEqual(simulate('{format="logfmt"} | logfmt | level="error"').rows.map(row=>row.id), [6]);
  assert.equal(simulate('{app="checkout"} |= "timeout"').rows.length, 3);
  assert.equal(simulate('{format="json"} != "timeout"').rows.length, 2);
  assert.equal(simulate('{format="json"} | json | duration_ms >= 1200').rows.length, 2);
  assert.equal(simulate('{app="ausente"}').rows.length, 0);
});
test('filtro anterior ao parser reduz parsing sem inventar redução de candidatos', () => {
  const before=simulate('{format="json"} |= "timeout" | json | level="error"');
  const after=simulate('{format="json"} | json | level="error" |= "timeout"');
  assert.deepEqual(before.rows.map(row=>row.id),after.rows.map(row=>row.id));
  assert.equal(before.candidates,4);
  assert.equal(after.candidates,4);
  assert.equal(before.parsed,2);
  assert.equal(after.parsed,4);
});
test('contagem e taxa respeitam unidade da janela fixa de cinco minutos', () => {
  assert.equal(simulate('sum(count_over_time({app="checkout"} |= "timeout" [5m]))').value,3);
  assert.equal(simulate('sum(rate({app="checkout"} |= "timeout" [5m]))').value,0.01);
});
test('sintaxe fora do conjunto suportado é rejeitada, sem resultados falsos', () => {
  for (const query of ['{app=~".*"}','{app="checkout"} | unwrap duration_ms','{app="checkout"} garbage','sum(rate({app="checkout"}[24h]))','{}','{app="checkout"} | json | duration_ms > banana','{app="checkout"} |= "timeout" trailing']) assert.throws(()=>simulate(query),undefined,query);
  assert.throws(()=>simulate('x'.repeat(2001)));
  assert.throws(()=>simulate('{format="logfmt"} | json | duration_ms > 1'));
});
test('strings escapadas, pipe em texto e erros do parser não quebram a gramática', () => {
  assert.equal(simulate('{app="checkout"} |= "a|b"').rows.length,0);
  assert.equal(simulate('{app="checkout"} |= "a\\"b"').rows.length,0);
  assert.equal(simulate('{format="logfmt"} | json | __error__=""').rows.length,0);
  assert.equal(simulate('{format="json"} | logfmt | __error__!=""').rows.length,4);
  assert.equal(sampleLogs.length,6);
});
test('cardinalidade é combinatória e valida limites', () => {
  assert.equal(cardinality(3,2,4,100,false),24);
  assert.equal(cardinality(3,2,4,100,true),2400);
  assert.throws(()=>cardinality(0,2,4,100,false));
  assert.throws(()=>cardinality(3.5,2,4,100,false));
});
test('progresso resiste a dados inválidos, indisponibilidade e restaura respostas', () => {
  const map=new Map();
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  assert.deepEqual(readProgress(storage,modules).completed,[]);
  const ingester=modules.find(m=>m.id==='ingester');
  const saved={completed:['fundamentos','inexistente','fundamentos'],answers:{ingester:{0:1,1:100}},quizVersions:{ingester:ingester.quizVersion},last:'logql'};
  assert.equal(saveProgress(storage,saved),true);
  const result=readProgress(storage,modules);
  assert.deepEqual(result.completed,['fundamentos']);
  assert.deepEqual(result.answers.ingester,{0:1});
  assert.equal(result.last,'logql');
  map.set(storageKey,'invalid JSON');
  assert.equal(readProgress(storage,modules).last,'fundamentos');
  map.set(storageKey,JSON.stringify({completed:'oops',last:'invalid'}));
  assert.deepEqual(readProgress(storage,modules).completed,[]);
  assert.equal(saveProgress({setItem(){throw new Error('blocked')}},saved),false);
});
test('respostas da versão anterior não são aplicadas a perguntas novas, e conclusões são mantidas', () => {
  const map=new Map();
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  // Formato salvo pela versão anterior: sem quizVersions.
  map.set(storageKey,JSON.stringify({completed:['fundamentos','escrita'],answers:{fundamentos:{0:1,1:0},escrita:{0:2}},last:'escrita'}));
  const result=readProgress(storage,modules);
  assert.deepEqual(result.completed,['fundamentos','escrita']);
  assert.equal(result.answers.fundamentos,undefined);
  assert.equal(result.answers.escrita,undefined);
  assert.equal(result.last,'escrita');
  assert.equal(result.quizVersions.fundamentos,modules[0].quizVersion);
});
test('diagramas: arestas tipadas entre nós existentes, etapas válidas e notas', () => {
  for (const [name, flow] of Object.entries(flows)) {
    for (const edge of flow.edges) {
      assert.ok(flow.nodes[edge.from] && flow.nodes[edge.to], name);
      assert.ok(edgeKinds[edge.kind], name + ': tipo ' + edge.kind);
      const g = edgeGeometry(flow, edge);
      assert.match(g.d, /^M\d/);
      for (const [x, y] of g.points) assert.ok(x >= 0 && x <= 890 && y >= 0 && y <= 420, name + ': ponto fora do quadro');
    }
    for (const node of flow.nodes) assert.ok(node.title && node.detail.length > 20, name + ': ' + node.title);
    assert.ok(flow.steps.length >= flow.nodes.length - 2, name);
    for (const step of flow.steps) {
      assert.ok(step.note && step.note.length > 20, name);
      assert.ok(step.edge !== undefined ? flow.edges[step.edge] : flow.nodes[step.node], name + ': etapa aponta para algo inexistente');
    }
  }
  for (const name of ['write', 'read']) {
    const kinds = new Set(flows[name].edges.map(edge => edge.kind));
    for (const kind of ['data', 'control', 'failure']) assert.ok(kinds.has(kind), name + ' sem ' + kind);
  }
  assert.ok(flows.write.edges.some(edge => edge.kind === 'ack'));
});
test('gerador produz erros e durações coerentes com exercícios', () => {
  const events=Array.from({length:12},(_,index)=>eventFor(index));
  assert.equal(events.filter(event=>event.level==='error').length,4);
  assert.ok(events.filter(event=>event.level==='error').every(event=>event.duration_ms>1000&&event.message.includes('timeout')));
});

test('quorum segue dskit Filter e o PushTracker', () => {
  const a = sims.quorumOutcome(['ok','error','slow']);
  assert.equal(a.minSuccess, 2); assert.equal(a.maxErrors, 1); assert.equal(a.status, 'acked'); assert.equal(a.ackAtMs, 900);
  assert.equal(sims.quorumOutcome(['ok','error','error']).status, 'failed');
  const r = sims.quorumOutcome(['ok','unhealthy','unhealthy']);
  assert.equal(r.status, 'rejected-before-send'); assert.match(r.message, /at least 2 live replicas required/);
  const b = sims.quorumOutcome(['ok','ok','unhealthy']);
  assert.equal(b.maxErrors, 0); assert.equal(b.status, 'acked');
  assert.equal(sims.quorumOutcome(['error']).status, 'failed');
  assert.equal(sims.quorumOutcome(['ok','ok','timeout'], { remoteTimeoutMs: 5000 }).late, 1);
  assert.equal(sims.quorumOutcome(['ok','slow','slow'], { remoteTimeoutMs: 500 }).status, 'failed');
});
test('chunk: corte de bloco, fechamento por SpaceFor e janela de ordenação', () => {
  let m = sims.createChunkModel();
  for (let i = 0; i < 256; i++) m = sims.appendLine(m, { sizeKB: 1, minute: 10 });
  assert.equal(m.blocks.length, 1); assert.equal(m.head, 0);
  for (let i = 0; i < 256 * 40; i++) m = sims.appendLine(m, { sizeKB: 1, minute: 10 });
  assert.ok(m.closedChunks.length >= 1);
  for (const chunk of m.closedChunks) assert.ok(chunk.compressed < 1536);
  m = sims.appendLine(m, { sizeKB: 1, minute: 200 });
  const before = m.rejected;
  m = sims.appendLine(m, { sizeKB: 1, minute: 139 });
  assert.equal(m.rejected, before + 1);
  m = sims.appendLine(m, { sizeKB: 1, minute: 140 });
  assert.equal(m.rejected, before + 1);
  assert.ok(m.log.length <= 20);
});
test('durabilidade: ACK não equivale a dado no bucket', () => {
  assert.equal(sims.durabilityOutcome({ stage: 1, failure: 'power' }).acked, false);
  assert.equal(sims.durabilityOutcome({ stage: 2, failure: 'process', replicationFactor: 1 }).survives, true);
  assert.equal(sims.durabilityOutcome({ stage: 2, failure: 'power', replicationFactor: 1 }).survives, false);
  assert.equal(sims.durabilityOutcome({ stage: 3, failure: 'power', replicationFactor: 1 }).survives, true);
  assert.equal(sims.durabilityOutcome({ stage: 2, failure: 'power', replicationFactor: 3, affected: 1 }).survives, true);
  assert.equal(sims.durabilityOutcome({ stage: 2, failure: 'power', replicationFactor: 3, affected: 3 }).survives, false);
  const orphan = sims.durabilityOutcome({ stage: 5, failure: 'disk', replicationFactor: 1 });
  assert.equal(orphan.survives, false); assert.match(orphan.reason, /head TSDB/);
  assert.equal(sims.durabilityOutcome({ stage: 6, failure: 'disk', replicationFactor: 1 }).survives, true);
  assert.throws(() => sims.durabilityOutcome({ stage: 9, failure: 'disk' }));
});
test('planejamento de Q1: splits, shards e limite de paralelismo', () => {
  assert.equal(sims.guessShardFactor(700, 600), 2);
  assert.equal(sims.guessShardFactor(500, 600), 0);
  assert.equal(sims.guessShardFactor(20480, 600), 64);
  const plan = sims.planQuery({ rangeHours: 24, splitMinutes: 60, gbPerHour: 20 });
  assert.equal(plan.splits, 24); assert.equal(plan.shardsPerSplit, 64); assert.equal(plan.tasks, 1536);
  assert.equal(plan.effectiveConcurrency, 16); assert.equal(plan.waves, 96);
  const halfSplit = sims.planQuery({ rangeHours: 24, splitMinutes: 30, gbPerHour: 20 });
  assert.equal(halfSplit.tasks, 1536);
  assert.equal(sims.planQuery({ rangeHours: 24, splitMinutes: 60, gbPerHour: 20, shardable: false }).tasks, 24);
  assert.match(sims.planQuery({ rangeHours: 24, splitMinutes: 60, gbPerHour: 20, queriers: 64, maxConcurrent: 4 }).limiter, /tsdb_max_query_parallelism/);
});
test('gargalo: concorrência acima dos núcleos não aumenta vazão e aumenta memória', () => {
  const a = sims.bottleneck({ workGB: 100, queriers: 4, coresPerQuerier: 4, maxConcurrent: 4 });
  const b = sims.bottleneck({ workGB: 100, queriers: 4, coresPerQuerier: 4, maxConcurrent: 16 });
  assert.equal(a.throughput, b.throughput);
  assert.ok(b.memoryNeededGB > a.memoryNeededGB); assert.equal(b.oomRisk, true);
});
test('retenção e custo de parsing seguem as premissas declaradas', () => {
  const r = sims.retentionTimeline({ retentionHours: 168, chunkThroughHoursAgo: 160 });
  assert.equal(r.expiresIn, 8); assert.equal(r.deletedIn, r.markedIn + 2);
  assert.equal(sims.retentionTimeline({ retentionHours: 168, chunkThroughHoursAgo: 160, lifecycleDays: 6 }).conflict, true);
  const metric = sims.parsingCost({ linesPerSecond: 1000, avgLineBytes: 400, hours: 24, selectivity: 0.02, metric: true });
  const log = sims.parsingCost({ linesPerSecond: 1000, avgLineBytes: 400, hours: 24, selectivity: 0.02, metric: false });
  assert.equal(metric.decompressedGB, log.decompressedGB);
  assert.equal(metric.parsedLines, 86400000 * 0.02);
  assert.ok(log.fieldsExtracted > metric.fieldsExtracted);
  assert.equal(sims.parsingCost({ linesPerSecond: 1000, avgLineBytes: 400, hours: 24, selectivity: 0.02, lineFilter: false }).parsedLines, 86400000);
});
test('retries do Alloy: backoff do dskit e regra de status', () => {
  const { attempts, waits } = sims.backoffBounds();
  assert.equal(attempts.length, 10); assert.equal(waits.length, 9);
  assert.deepEqual(attempts.at(-1), [255500, 511000]);
  assert.equal(sims.retryOutcome({ status: 400 }).outcome, 'dropped');
  assert.equal(sims.retryOutcome({ status: 429, retryOn429: false }).outcome, 'dropped');
  assert.equal(sims.retryOutcome({ status: 503, outageSeconds: 180 }).outcome, 'delivered');
  assert.equal(sims.retryOutcome({ status: 0, outageSeconds: 400 }).outcome, 'depends');
  assert.equal(sims.retryOutcome({ status: 503, outageSeconds: 720 }).outcome, 'dropped');
});
test('do label à chave: TokenFor é FNV-1 32, service_name e formato da chave v12+', () => {
  // Vetores conhecidos de FNV-1 32 (hash/fnv New32 do Go).
  assert.equal(sims.tokenFor('', ''), 0x811c9dc5);
  assert.equal(sims.tokenFor('', 'a'), 0x050c5d7e);
  assert.equal(sims.tokenFor('fa', 'ke'), sims.tokenFor('fake', ''));
  const canon = sims.canonicalLabels('{format="json", app="checkout", env="lab"}');
  assert.equal(canon, '{app="checkout", env="lab", format="json"}');
  assert.equal(sims.withServiceName(canon), '{app="checkout", env="lab", format="json", service_name="checkout"}');
  assert.equal(sims.withServiceName('{env="lab"}'), '{env="lab", service_name="unknown_service"}');
  assert.equal(sims.withServiceName('{app="x", service_name="y"}'), '{app="x", service_name="y"}');
  assert.throws(() => sims.canonicalLabels('{app="a", app="b"}'));
  assert.throws(() => sims.canonicalLabels('app=checkout'));
  assert.equal(sims.tableFor(Date.UTC(2026, 10, 8, 14)), 'index_20765');
  assert.equal(sims.chunkKey({ tenant: 'fake', fingerprint: 255n, fromMs: 16, throughMs: 32, checksum: 10 }), 'fake/ff/10:20:a');
});
test('fontes da consulta seguem BuildQueryIntervalsWithLookback', () => {
  const recent = sims.querySources({ startHoursAgo: 24, endHoursAgo: 0 });
  assert.deepEqual(recent.ingesters, [24, 0]); assert.deepEqual(recent.store, [24, 0]); assert.equal(recent.gap, false);
  const old = sims.querySources({ startHoursAgo: 10, endHoursAgo: 4 });
  assert.equal(old.ingesters, null);
  const gap = sims.querySources({ startHoursAgo: 2, endHoursAgo: 1.25, queryIngestersWithinH: 1 });
  assert.equal(gap.touchesGap, true);
  assert.equal(sims.querySources({ startHoursAgo: 2, endHoursAgo: 0, queryIngestersWithinH: 1 }).touchesGap, false);
});
test('domínios de falha: zone awareness mantém o quorum ao perder uma zona', () => {
  assert.equal(sims.domainsOutcome({ replicationFactor: 3, zones: 3, ingestersPerZone: 3, zoneAware: true, failure: 'zone' }).lostFraction, 0);
  const noAware = sims.domainsOutcome({ replicationFactor: 3, zones: 3, ingestersPerZone: 3, zoneAware: false, failure: 'zone' });
  assert.ok(Math.abs(noAware.lostFraction - 19 / 84) < 1e-9);
  assert.equal(sims.domainsOutcome({ replicationFactor: 3, zones: 3, ingestersPerZone: 3, failure: 'node' }).lostFraction, 0);
  assert.equal(sims.domainsOutcome({ replicationFactor: 1, zones: 1, ingestersPerZone: 1, failure: 'node' }).lostFraction, 1);
});
test('fontes: o conteúdo cita só arquivos que existem no formato esperado', async () => {
  for (const module of modules) for (const ref of module.code) assert.match(ref.file, /^(alloy:)?[a-z0-9_./-]+\.go$/i, module.id + ': ' + ref.file);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  for (const module of modules) assert.ok(readme.includes(module.title), 'README sem o módulo ' + module.title);
});
