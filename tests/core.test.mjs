import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { modules } from '../src/course.js';
import { simulate, sampleLogs, cardinality } from '../src/simulator.js';
import { flows, edgePath } from '../src/flows.js';
import { readProgress, saveProgress, storageKey } from '../src/progress.js';
import { eventFor } from '../labs/local/generate.mjs';

test('trilha completa tem objetivos, evidência, exercício, visual e feedback para cada alternativa', async () => {
  assert.equal(modules.length, 10);
  assert.equal(new Set(modules.map(module => module.id)).size, modules.length);
  for (const module of modules) {
    assert.ok(module.objectives.length >= 3);
    assert.ok(module.prereqs.length > 30);
    assert.ok(module.sections.length >= 3);
    assert.ok(module.exercise.task && module.exercise.solution);
    assert.ok(module.example.code && module.example.caption);
    assert.ok(flows[module.flow]);
    assert.ok(module.refs.length >= 2);
    for (const ref of module.refs) assert.equal(new URL(ref.url).protocol, 'https:');
    for (const quiz of module.quiz) {
      assert.ok(quiz.correct >= 0 && quiz.correct < quiz.options.length);
      for (const option of quiz.options) assert.ok(option.text && option.why.length > 20);
    }
  }
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
  const saved={completed:['fundamentos','inexistente','fundamentos'],answers:{fundamentos:{0:1,1:100}},last:'logql'};
  assert.equal(saveProgress(storage,saved),true);
  const result=readProgress(storage,modules);
  assert.deepEqual(result.completed,['fundamentos']);
  assert.deepEqual(result.answers.fundamentos,{0:1});
  assert.equal(result.last,'logql');
  map.set(storageKey,'invalid JSON');
  assert.equal(readProgress(storage,modules).last,'fundamentos');
  map.set(storageKey,JSON.stringify({completed:'oops',last:'invalid'}));
  assert.deepEqual(readProgress(storage,modules).completed,[]);
  assert.equal(saveProgress({setItem(){throw new Error('blocked')}},saved),false);
});
test('diagramas têm conexões para nós existentes e trajetos editáveis', () => {
  for (const flow of Object.values(flows)) {
    for (const [a,b] of flow.edges) {
      assert.ok(flow.nodes[a] && flow.nodes[b]);
      assert.match(edgePath(flow.nodes[a],flow.nodes[b]),/^M/);
    }
    for (const node of flow.nodes) assert.ok(node.title && node.detail.length > 20);
    if(flow.steps) for(let i=1;i<flow.steps.length;i++) assert.ok(flow.edges.some(([a,b])=>a===flow.steps[i-1]&&b===flow.steps[i]),'Etapa animada precisa de uma conexão real: '+flow.title);
  }
});
test('gerador produz erros e durações coerentes com exercícios', () => {
  const events=Array.from({length:12},(_,index)=>eventFor(index));
  assert.equal(events.filter(event=>event.level==='error').length,4);
  assert.ok(events.filter(event=>event.level==='error').every(event=>event.duration_ms>1000&&event.message.includes('timeout')));
});
