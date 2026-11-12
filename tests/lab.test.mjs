import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/lab/engine.js';
import { tokenFor } from '../src/sims.js';
import { labs } from '../src/lab/labs.js';

test('identidade do stream: labels canônicos, ordem irrelevante, token = TokenFor', () => {
  assert.equal(E.canon({ env: 'prod', app: 'checkout' }), '{app="checkout", env="prod"}');
  assert.equal(E.canon({ app: 'checkout', env: 'prod' }), E.canon({ env: 'prod', app: 'checkout' }));
  assert.equal(E.streamToken({ app: 'a' }), tokenFor('fake', '{app="a"}'));
  const two = E.groupStreams(E.lab1Events, ['app', 'env']);
  const four = E.groupStreams(E.lab1Events, ['app', 'host', 'env', 'level']);
  assert.ok(four.streams.length > two.streams.length, 'mais chaves, mais streams');
  // Eventos 1 e 5 chegam com labels em ordem diferente e caem no mesmo stream.
  assert.equal(four.steps.find(s => s.event === 1).stream, four.steps.find(s => s.event === 5).stream);
  assert.equal(two.streams.reduce((n, s) => n + s.events.length, 0), E.lab1Events.length);
});

test('hash ring: primeiro token estritamente maior, volta ao início e réplicas distintas', () => {
  const ring = { ids: ['a', 'b', 'c'], tokens: [{ token: 10, owner: 'a' }, { token: 20, owner: 'b' }, { token: 30, owner: 'a' }, { token: 40, owner: 'c' }] };
  assert.equal(E.searchToken(ring.tokens, 5), 0);
  assert.equal(E.searchToken(ring.tokens, 20), 2, 'empate avança, como no dskit');
  assert.equal(E.searchToken(ring.tokens, 45), 0, 'passou do fim, volta ao início');
  assert.deepEqual(E.lookup(ring, 15, 3).replicas, ['b', 'a', 'c']);
  const walk = E.lookup(ring, 25, 3);
  assert.deepEqual(walk.replicas, ['a', 'c', 'b']);
  assert.ok(walk.walk.some(w => !w.taken) === false || walk.walk.length >= 3);
  assert.deepEqual(E.lookup(ring, 15, 5).replicas.length, 3, 'RF maior que instâncias: todas');
  const real = E.buildRing(E.INGESTER_NAMES.slice(0, 5), 16);
  const own = Object.values(E.ownership(real)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(own - 1) < 1e-9, 'as fatias somam o anel inteiro');
});

test('hash consistente: ao entrar um ingester, só ele recebe streams que mudaram de dono', () => {
  for (const tokens of [1, 4, 16]) {
    const before = E.distribute(E.buildRing(E.INGESTER_NAMES.slice(0, 4), tokens), E.ringStreams, 1);
    const after = E.distribute(E.buildRing(E.INGESTER_NAMES.slice(0, 5), tokens), E.ringStreams, 1);
    for (const s of E.ringStreams) if (before.owners[s.key][0] !== after.owners[s.key][0]) assert.equal(after.owners[s.key][0], 'ingester-4');
  }
});

test('stream sharding: calculateShards e reação atrasada do rate store', () => {
  assert.equal(E.calculateShards(1.5 * E.MB, 1.5 * E.MB), 1);
  assert.equal(E.calculateShards(6 * E.MB, 1.5 * E.MB), 4);
  assert.equal(E.calculateShards(6.1 * E.MB, 1.5 * E.MB), 5);
  const on = E.shardingRun({ targetMBps: 6 });
  assert.equal(on.frames[0].shards, 1, 'sem taxa conhecida, 1 shard');
  assert.equal(on.frames.at(-1).shards, 4);
  assert.equal(on.frames.at(-1).totalDropped, 0);
  for (const s of on.frames.at(-1).perShard) assert.match(s.key, /__stream_shard__="\d"/);
  assert.equal(new Set(on.frames.at(-1).perShard.map(s => s.token)).size, 4, 'cada shard tem token próprio');
  const off = E.shardingRun({ targetMBps: 8, enabled: false });
  assert.ok(off.frames.every(f => f.shards === 1));
  assert.ok(off.frames.at(-1).dropped > 4 * E.MB, 'acima de 3MB/s, depois do burst, descarta');
  assert.equal(off.frames[3].dropped, 0, 'o burst de 15MB absorve o começo');
});

test('cardinalidade: A respeita o teto; B fragmenta e bate no limite de streams', () => {
  const r = E.cardinalityRun({ trace_id: true });
  const last = r.frames.at(-1);
  assert.ok(last.A.streams <= r.ceiling);
  assert.ok(last.B.streams > 20 * last.A.streams);
  assert.ok(last.B.active <= E.LIMITS.maxGlobalStreams);
  assert.ok(last.B.rejected > 0);
  assert.ok(last.B.avgChunkKB < last.A.avgChunkKB);
  assert.deepEqual(E.cardinalityRun({ trace_id: true }).frames.at(-1).B.streams, last.B.streams, 'determinístico');
  const same = E.cardinalityRun({});
  assert.equal(same.frames.at(-1).A.streams, same.frames.at(-1).B.streams, 'sem labels de alta cardinalidade, A = B');
});

test('classificação: recomendação da documentação fica em 600 streams/dia', () => {
  const rec = E.classify({ cluster: 'label', namespace: 'label', pod: 'sm', trace_id: 'line', order_id: 'line', level: 'line' });
  assert.equal(rec.streamsPerDay, 600);
  assert.equal(rec.overStreamLimit, false);
  const bad = E.classify(Object.fromEntries(E.FIELDS.map(f => [f.key, 'label'])));
  assert.equal(bad.overStreamLimit, true);
  assert.equal(bad.verdicts.find(v => v.key === 'trace_id').tone, 'bad');
});

test('LogQL: etapas, structured metadata, _extracted e seletores recusados', () => {
  const ids = q => E.runLogQL(q).rows.map(r => r.id);
  assert.deepEqual(E.runLogQL('{cluster="production", app="banking"}').selected, ['s0']);
  assert.equal(ids('{app="banking"} |= "error"').length, 3);
  assert.deepEqual(ids('{app="banking"} | trace_id="abc123"'), ['s0l0', 's0l1', 's2l0'], 'só linhas com SM trace_id');
  assert.deepEqual(ids('{app="payments"} | trace_id="abc123"'), [], 'sem parser, campo do JSON não existe');
  assert.deepEqual(ids('{app="payments"} | json | trace_id="abc123"'), ['s1l0']);
  const parsed = E.runLogQL('{app="frontend"} | json');
  assert.ok(parsed.rows.every(r => r.fields.__error__ === 'JSONParserErr'), 'logfmt não é JSON: __error__ e segue');
  assert.equal(E.runLogQL('{app="frontend"} | logfmt | status>=500').rows.length, 1);
  const conflict = E.runLogQL('{app="banking"} | json', [{ ...E.logqlStreams[0], lines: [{ id: 'x', line: '{"app":"outro"}', sm: {}, bytes: 15 }] }]);
  assert.equal(conflict.rows[0].fields.app_extracted, 'outro');
  assert.throws(() => E.runLogQL('{app=~".*"}'), /empty-compatible/);
  assert.throws(() => E.runLogQL('{app!="x"}'), /empty-compatible/);
  assert.doesNotThrow(() => E.runLogQL('{namespace=~".+"} |= "abc123"'));
  assert.throws(() => E.runLogQL('{app="x"} | unwrap y'), /inválido|não suportad/);
  for (const [, q] of E.LOGQL_PRESETS) assert.doesNotThrow(() => E.runLogQL(q), q);
  assert.deepEqual(E.runLogQL('{app="banking"} | trace_id="abc123"').bloomCandidates, ['trace_id']);
  assert.deepEqual(E.runLogQL('{app="banking"} | json | trace_id="abc123"').bloomCandidates, [], 'depois de parser não acelera');
});

test('bloom filter: nunca há falso negativo; falso positivo cai com mais bits', () => {
  for (const m of [16, 32, 64, 128, 256]) for (const k of [1, 2, 3, 5]) for (const ids of [1, 3, 6]) {
    const sc = E.bloomScenario({ m, k, idsPerChunk: ids });
    assert.equal(sc.totals.falseNegatives, 0, m + '/' + k + '/' + ids);
    assert.equal(sc.totals.matches, 1, 'o chunk plantado é sempre baixado');
    for (const s of sc.streams) for (const c of s.chunks) for (const id of c.ids) assert.ok(E.bloomTest(s.bloom, 'trace_id=' + id) && E.bloomTest(s.bloom, c.ref + 'trace_id=' + id));
  }
  assert.equal(E.bloomScenario({ target: 'ffffff' }).totals.matches, 0);
  assert.ok(E.fpRate(32, 3, 36) > E.fpRate(256, 3, 36));
  assert.ok(E.bloomScenario({ m: 32 }).totals.falsePositives >= E.bloomScenario({ m: 256 }).totals.falsePositives);
});

test('ingestão: linhas viram chunks no tamanho configurado e o índice acompanha o bucket', () => {
  const r = E.ingestRun({ ticks: 20 });
  const last = r.frames.at(-1);
  assert.equal(r.frames.length, 40);
  assert.equal(last.totals.chunks, last.totals.index);
  assert.ok(last.bucket.every(c => c.lines <= 6 && ['full', 'idle'].includes(c.reason)));
  const rf3 = E.ingestRun({ rf: 3 }).frames.at(-1);
  assert.equal(rf3.totals.objects, rf3.totals.chunks * 3);
  assert.ok(E.ingestRun({ extraLabel: 'request_id' }).frames.at(-1).totals.streams > E.ingestRun({}).frames.at(-1).totals.streams * 5);
  assert.deepEqual(E.ingestRun({}).frames.at(-1).totals, E.ingestRun({}).frames.at(-1).totals);
});

test('todos os laboratórios têm markup e mount', () => {
  for (const [id, lab] of Object.entries(labs)) {
    assert.equal(typeof lab.mount, 'function', id);
    const html = lab.markup();
    assert.match(html, new RegExp('data-lab="' + id + '"'));
    assert.match(html, /Premissas, regras e limites/);
  }
});
