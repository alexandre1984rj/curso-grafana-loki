// Simulação deliberadamente limitada; não executa LogQL em um servidor Loki.
export const sampleLogs = [
  { id: 1, secondsAgo: 240, labels: { app: 'checkout', env: 'lab', format: 'json' }, line: '{"level":"info","message":"pedido criado","duration_ms":45,"request_id":"req-01"}' },
  { id: 2, secondsAgo: 180, labels: { app: 'checkout', env: 'lab', format: 'json' }, line: '{"level":"error","message":"payment timeout","duration_ms":1200,"request_id":"req-02"}' },
  { id: 3, secondsAgo: 120, labels: { app: 'checkout', env: 'lab', format: 'json' }, line: '{"level":"info","message":"pedido concluido","duration_ms":85,"request_id":"req-03"}' },
  { id: 4, secondsAgo: 90, labels: { app: 'checkout', env: 'lab', format: 'json' }, line: '{"level":"error","message":"upstream timeout","duration_ms":1700,"request_id":"req-04"}' },
  { id: 5, secondsAgo: 60, labels: { app: 'checkout', env: 'lab', format: 'logfmt' }, line: 'level=info message="pedido criado" duration_ms=60 request_id=req-05' },
  { id: 6, secondsAgo: 30, labels: { app: 'checkout', env: 'lab', format: 'logfmt' }, line: 'level=error message="payment timeout" duration_ms=1400 request_id=req-06' }
];

function tokens(query) {
  if (query.length > 2000) throw new Error('Use até 2.000 caracteres nesta simulação.');
  const pattern = /\s*("(?:[^"\\]|\\.)*"|[a-zA-Z_][a-zA-Z_0-9]*|\d+(?:\.\d+)?|\|=|!=|>=|<=|[{}()[\],|=><])/gy;
  let position = 0;
  const result = [];
  while (position < query.length) {
    if (!query.slice(position).trim()) break;
    pattern.lastIndex = position;
    const match = pattern.exec(query);
    if (!match) throw new Error('Sintaxe não suportada perto de: ' + query.slice(position, position + 24));
    result.push(match[1]);
    position = pattern.lastIndex;
  }
  return result;
}

export function simulate(query, logs = sampleLogs) {
  const list = tokens(query.trim());
  let at = 0;
  const take = (expected) => {
    const value = list[at++];
    if (value === undefined || (expected !== undefined && value !== expected)) throw new Error('Esperado ' + (expected || 'um valor') + '. Consulte as operações suportadas.');
    return value;
  };
  const string = () => {
    const value = take();
    if (!value.startsWith('"')) throw new Error('Use valores de texto entre aspas duplas.');
    return JSON.parse(value);
  };
  let aggregate = null;
  if (list[at] === 'sum') { take('sum'); take('('); aggregate = take(); if (!['count_over_time','rate'].includes(aggregate)) throw new Error('Agregação suportada: sum(count_over_time(...[5m])) ou sum(rate(...[5m])).'); take('('); }
  take('{');
  const selectors = [];
  do {
    const key = take();
    if (!/^[a-zA-Z_]\w*$/.test(key)) throw new Error('Nome de label inválido.');
    take('=');
    selectors.push([key, string()]);
    if (list[at] !== ',') break;
    take(',');
  } while (true);
  take('}');
  let rows = logs.filter(row => selectors.every(([key, value]) => row.labels[key] === value)).map(row => ({ ...row, fields: { ...row.labels, __error__: '' } }));
  const candidates = rows.length;
  let parsed = 0;
  while (at < list.length && list[at] !== '[') {
    const op = take();
    if (op === '|=' || op === '!=') {
      const value = string();
      rows = rows.filter(row => op === '|=' ? row.line.includes(value) : !row.line.includes(value));
      continue;
    }
    if (op !== '|') throw new Error('Etapa não suportada. Use filtros literais, json, logfmt ou filtros de campo.');
    const stage = take();
    if (stage === 'json' || stage === 'logfmt') {
      rows = rows.map(row => {
        parsed++;
        const fields = { ...row.fields };
        try {
          let extracted;
          if (stage === 'json') {
            extracted = JSON.parse(row.line);
            if (!extracted || Array.isArray(extracted) || typeof extracted !== 'object') throw new Error('Formato inválido');
            if (Object.values(extracted).some(value => value && typeof value === 'object')) throw new Error('Esta simulação suporta JSON plano.');
          } else {
            extracted = {};
            const regex = /([A-Za-z_]\w*)=("(?:[^"\\]|\\.)*"|[^\s"]+)/gy;
            let pos = 0;
            while (pos < row.line.length) {
              while (row.line[pos] === ' ') pos++;
              if (pos === row.line.length) break;
              regex.lastIndex = pos;
              const match = regex.exec(row.line);
              if (!match) throw new Error('Formato inválido');
              extracted[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
              pos = regex.lastIndex;
            }
          }
          for (const [key,value] of Object.entries(extracted)) fields[key in row.labels ? key + '_extracted' : key] = String(value);
        } catch { fields.__error__ = stage === 'json' ? 'JSONParserErr' : 'LogfmtParserErr'; }
        return { ...row, fields };
      });
    } else {
      const comparison = take();
      if (!['=','!=','>','>=','<','<='].includes(comparison)) throw new Error('Comparação não suportada.');
      const raw = take();
      const isString = raw.startsWith('"');
      const value = isString ? JSON.parse(raw) : Number(raw);
      if (!isString && !Number.isFinite(value)) throw new Error('Valor numérico inválido.');
      if (isString && !['=','!='].includes(comparison)) throw new Error('Comparações de ordem são somente numéricas nesta simulação.');
      rows = rows.filter(row => {
        const actual = isString ? (row.fields[stage] ?? '') : Number(row.fields[stage]);
        if (!isString && !Number.isFinite(actual)) throw new Error('Conversão numérica inválida: use dados e parser compatíveis; erros de conversão completos exigem Loki real.');
        return ({ '=': actual === value, '!=': actual !== value, '>': actual > value, '>=': actual >= value, '<': actual < value, '<=': actual <= value })[comparison];
      });
    }
  }
  if (aggregate) {
    take('['); take('5'); take('m'); take(']'); take(')'); take(')');
  }
  if (at !== list.length) throw new Error('Trecho não suportado ao final da consulta.');
  return { rows, candidates, parsed, kind: aggregate || 'logs', value: aggregate === 'rate' ? rows.length / 300 : aggregate ? rows.length : null };
}

export function cardinality(apps, envs, pods, requests, includeRequests) {
  for (const value of [apps, envs, pods, requests]) if (!Number.isInteger(value) || value < 1 || value > 100000) throw new Error('Cardinalidades devem ser inteiros entre 1 e 100.000.');
  return apps * envs * pods * (includeRequests ? requests : 1);
}
