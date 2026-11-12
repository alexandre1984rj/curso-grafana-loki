// Vocabulário de evidência usado em todo o curso.
export const K = {
  code: 'Confirmado no código',
  doc: 'Confirmado na documentação',
  simp: 'Simplificação didática',
  inf: 'Inferência',
  op: 'Recomendação operacional',
  nv: 'Não verificado',
  hist: 'Fonte histórica'
};

export const layers = {
  intuicao: 'Intuição',
  mecanismo: 'Mecanismo interno',
  implementacao: 'Implementação',
  operacao: 'Operação'
};

export const lokiTag = 'v3.7.0';
export const lokiCommit = '3361de24b692875d77bd7433cd6baa7c68dc0ef9';
export const alloyTag = 'v1.11.0';
// Arquivos prefixados com "alloy:" vêm do repositório do Alloy na tag usada no laboratório.
export const sourceUrl = (file, line) => {
  const alloy = file.startsWith('alloy:');
  const base = alloy ? 'https://github.com/grafana/alloy/blob/' + alloyTag + '/' : 'https://github.com/grafana/loki/blob/' + lokiTag + '/';
  return base + (alloy ? file.slice(6) : file) + (line ? '#L' + line : '');
};
export const sourceLabel = file => file.startsWith('alloy:') ? 'Alloy ' + alloyTag + ' · ' + file.slice(6) : file;

// Seção de texto: título, natureza da evidência, camada didática e texto.
export const s = (layer, kind, title, text) => ({ layer, kind, title, text });
// Referência ao código: arquivo e linha na tag, símbolo e o que ele explica.
export const c = (file, line, symbol, explains) => ({ file, line, symbol, explains });
// Parâmetro: caminho YAML completo, unidade, default na versão e efeito de alterar.
export const p = (yaml, unit, def, effect) => ({ yaml, unit, def, effect });
// Falha: sintoma, como observar e como investigar.
export const f = (symptom, observe, investigate) => ({ symptom, observe, investigate });
export const q = (question, correct, options) => ({ question, correct, options: options.map(([text, why]) => ({ text, why })) });
export const ref = (title, url) => ({ title, url });
