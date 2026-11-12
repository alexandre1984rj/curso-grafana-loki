import { modules, consultedAt, versions, layers, evidenceKinds } from './course.js';
import { flows, edgeGeometry, edgeKinds, NODE_W, NODE_H } from './flows.js';
import { sampleLogs, simulate } from './simulator.js';
import { readProgress, saveProgress, emptyProgress } from './progress.js';
import { widgets } from './widgets.js';
import { labs } from './lab/labs.js';
import { sourceUrl, sourceLabel } from './modules/helpers.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// Texto com `código`, **negrito** e *ênfase*; tudo é escapado antes.
const rich = value => escape(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('Indisponível'); } }; }
let progress = readProgress(storage, modules);
let current;
let step = 0;
let timer = null;
let flow;
let flowSpeed = 1;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const icons = {
  play: '<path d="m9 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  next: '<path d="m6 5 9 7-9 7M19 5v14"/>',
  prev: '<path d="m18 5-9 7 9 7M5 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>'
};
const icon = name => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' + icons[name] + '</svg>';
const kindClass = kind => ({ [evidenceKinds.code]: 'ev-code', [evidenceKinds.doc]: 'ev-doc', [evidenceKinds.simp]: 'ev-simp', [evidenceKinds.inf]: 'ev-inf', [evidenceKinds.op]: 'ev-op', [evidenceKinds.nv]: 'ev-nv', [evidenceKinds.hist]: 'ev-hist' })[kind] || 'ev-doc';

function persist() {
  $('#storage-status').textContent = saveProgress(storage, progress) ? '' : 'Armazenamento indisponível: o progresso dura apenas nesta visita.';
}
function nav() {
  let part = '';
  $('#module-nav').innerHTML = modules.map((module, index) => {
    const heading = module.part !== part ? '<p class="nav-part">' + escape(part = module.part) + '</p>' : '';
    const done = progress.completed.includes(module.id);
    return heading + '<a class="module-link' + (current?.id === module.id ? ' active' : '') + '" href="#' + module.id + '" ' + (current?.id === module.id ? 'aria-current="page"' : '') + '><span class="module-number">' + String(index + 1).padStart(2, '0') + '</span><span>' + escape(module.short) + '</span><span class="completion" aria-label="' + (done ? 'Concluído' : 'Não concluído') + '">' + (done ? '✓' : '') + '</span></a>';
  }).join('');
  $('#progress-count').textContent = progress.completed.length + ' / ' + modules.length;
  $('#course-progress').max = modules.length;
  $('#course-progress').value = progress.completed.length;
}
function stop() {
  clearInterval(timer);
  timer = null;
  $('#flow-svg')?.classList.remove('playing');
  const button = $('#flow-play');
  if (button) { button.innerHTML = icon('play') + 'Iniciar'; button.setAttribute('aria-pressed', 'false'); }
}

// ---------------------------------------------------------------- quiz
function quizMarkup(quiz, index) {
  const answer = progress.answers[current.id]?.[index];
  const answered = Number.isInteger(answer);
  return '<fieldset class="quiz-question" id="quiz-' + index + '"><legend><span>' + String(index + 1).padStart(2, '0') + '</span> ' + rich(quiz.question) + '</legend><div class="quiz-options">' + quiz.options.map((option, i) => '<label class="quiz-option' + (answer === i ? ' selected' : '') + '"><input type="radio" name="question-' + index + '" value="' + i + '" data-quiz="' + index + '" ' + (answer === i ? 'checked' : '') + '><span>' + rich(option.text) + '</span></label>').join('') + '</div><p class="feedback ' + (answered ? (answer === quiz.correct ? 'correct' : 'incorrect') : '') + '" role="status">' + (answered ? '<strong>' + (answer === quiz.correct ? 'Correto. ' : 'Revise. ') + '</strong>' + rich(quiz.options[answer].why) : 'Escolha uma alternativa para receber uma explicação.') + '</p></fieldset>';
}
function mastered() { return current.quiz.every((quiz, index) => progress.answers[current.id]?.[index] === quiz.correct); }
function completeState() {
  const button = $('#complete-module');
  button.disabled = !mastered();
  button.textContent = progress.completed.includes(current.id) ? 'Módulo concluído' : 'Concluir módulo';
  $('#complete-help').textContent = mastered() ? 'Você pode concluir este módulo e seguir na trilha.' : 'Responda corretamente às ' + current.quiz.length + ' perguntas para registrar a conclusão. Você pode navegar livremente.';
}

// ---------------------------------------------------------------- diagrama
// Objetos que percorrem os canais: documento (dados), losango (controle), pílula (ACK) e falha.
const packetShapes = {
  data: '<rect x="-10" y="-13" width="20" height="26" rx="3"/><path d="M-5 -5h10M-5 0h10M-5 5h7"/>',
  control: '<rect x="-9" y="-9" width="18" height="18" rx="2" transform="rotate(45)"/><path d="M-3 -2a3 3 0 1 1 3 3v2M0 6v.5"/>',
  ack: '<rect x="-17" y="-10" width="34" height="20" rx="10"/><text y="4" text-anchor="middle">ACK</text>',
  failure: '<circle r="11"/><path d="M-5 -5l10 10M5 -5l-10 10"/>'
};
let packetFrame = null;
function flowMarkup() {
  const nodes = flow.nodes;
  const height = Math.max(...nodes.map(node => node.y)) + NODE_H + 40;
  const used = [...new Set(flow.edges.map(edge => edge.kind))];
  const legend = '<ul class="flow-legend" aria-label="Legenda dos objetos">' + used.map(kind => '<li><svg width="38" height="30" viewBox="-19 -15 38 30" aria-hidden="true"><g class="packet-obj packet-' + kind + '">' + packetShapes[kind] + '</g></svg>' + escape(edgeKinds[kind].label) + ': ' + escape(edgeKinds[kind].description) + '</li>').join('') + '</ul>';
  const edges = flow.edges.map((edge, i) => {
    const g = edgeGeometry(flow, edge);
    return '<g class="flow-edge edge-' + edge.kind + '" data-edge="' + i + '"><path d="' + g.d + '"/>' + (edge.label ? '<text x="' + g.label.x + '" y="' + g.label.y + '" text-anchor="' + g.label.anchor + '">' + escape(edge.label) + '</text>' : '') + '</g>';
  }).join('');
  const nodeMarkup = nodes.map((node, i) => '<g class="flow-node" data-node="' + i + '" role="button" tabindex="0" aria-label="' + escape(node.title) + ': ' + escape(node.detail) + '"><rect x="' + node.x + '" y="' + node.y + '" width="' + NODE_W + '" height="' + NODE_H + '" rx="8"/><text x="' + (node.x + NODE_W / 2) + '" y="' + (node.y + NODE_H / 2 + 5) + '" text-anchor="middle">' + escape(node.title) + '</text></g>').join('');
  const stepsText = flow.steps.map(s => '<li>' + (s.edge !== undefined ? escape(nodes[flow.edges[s.edge].from].title) + ' → ' + escape(nodes[flow.edges[s.edge].to].title) + ' [' + escape(edgeKinds[flow.edges[s.edge].kind].label) + ']' : escape(nodes[s.node].title)) + ': ' + rich(s.note) + '</li>').join('');
  return '<div class="flow-heading"><div><h2>' + escape(flow.title) + '</h2><p>Siga as etapas ou clique num componente. O objeto que se move mostra o que trafega: um log, uma decisão de controle, uma confirmação ou uma falha.</p></div><span class="simulation-label">Esquema</span></div>' + legend +
    '<div class="diagram-scroll" tabindex="0" role="region" aria-label="Diagrama interativo; use Tab para selecionar componentes"><svg id="flow-svg" viewBox="0 0 890 ' + height + '" role="group" aria-label="' + escape(flow.title) + '">' + edges + nodeMarkup + '<g id="packet" class="packet-obj" aria-hidden="true"></g></svg></div>' +
    '<p class="small-note">Em telas pequenas, deslize o diagrama na horizontal ou use as etapas e a descrição em texto.</p>' +
    '<div class="flow-controls"><button id="flow-prev" class="secondary">' + icon('prev') + 'Voltar</button><button id="flow-play" class="primary" aria-pressed="false">' + icon('play') + 'Iniciar</button><button id="flow-next" class="secondary">' + icon('next') + 'Avançar etapa</button><button id="flow-reset" class="text-button">' + icon('reset') + 'Reiniciar</button><label class="flow-speed">Velocidade <select id="flow-speed"><option value="0.5">0,5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label><span id="step-count"></span></div>' +
    '<div class="flow-description" aria-live="polite" aria-atomic="true"><strong id="step-title"></strong> <span id="step-kind" class="step-kind"></span><p id="step-detail"></p></div>' +
    (reducedMotion.matches ? '<p class="small-note">Movimento reduzido: o objeto aparece direto no destino, sem deslocamento.</p>' : '') +
    '<details class="text-alternative"><summary>Ver o diagrama em texto</summary><ol>' + stepsText + '</ol><p>Esquema lógico: não representa latências, todas as chamadas de rede nem todos os componentes opcionais.</p></details>';
}
function movePacket(edge, edgeIndex) {
  const packet = $('#packet');
  cancelAnimationFrame(packetFrame);
  if (!edge) { packet.style.display = 'none'; packet.dataset.state = 'hidden'; return; }
  packet.style.display = '';
  packet.setAttribute('class', 'packet-obj packet-' + edge.kind);
  packet.innerHTML = packetShapes[edge.kind];
  const path = $('#flow-svg').querySelector('[data-edge="' + edgeIndex + '"] path');
  const length = path.getTotalLength();
  const place = t => { const pt = path.getPointAtLength(t * length); packet.setAttribute('transform', 'translate(' + pt.x + ' ' + pt.y + ')'); };
  if (reducedMotion.matches) { place(1); packet.dataset.state = 'static'; return; }
  packet.dataset.state = 'moving';
  const duration = 1300 / flowSpeed;
  const start = performance.now();
  const frame = now => {
    const t = Math.min(1, (now - start) / duration);
    place(t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    if (t < 1) packetFrame = requestAnimationFrame(frame); else packet.dataset.state = 'arrived';
  };
  packetFrame = requestAnimationFrame(frame);
}
function updateStep() {
  if (!flow) return;
  const s = flow.steps[step];
  const edge = s.edge !== undefined ? flow.edges[s.edge] : null;
  const focusNode = edge ? edge.to : s.node;
  document.querySelectorAll('.flow-node').forEach(element => {
    const n = Number(element.dataset.node);
    const selected = n === focusNode || Boolean(edge && n === edge.from);
    element.classList.toggle('is-current', n === focusNode);
    element.classList.toggle('is-source', Boolean(edge) && n === edge.from);
    element.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('.flow-edge').forEach(element => element.classList.toggle('is-current', edge !== null && Number(element.dataset.edge) === s.edge));
  $('#step-count').textContent = (step + 1) + ' / ' + flow.steps.length;
  $('#step-title').textContent = edge ? flow.nodes[edge.from].title + ' → ' + flow.nodes[edge.to].title : flow.nodes[s.node].title;
  $('#step-kind').textContent = edge ? edgeKinds[edge.kind].label : 'Componente';
  $('#step-kind').className = 'step-kind ' + (edge ? 'kind-' + edge.kind : '');
  $('#step-detail').innerHTML = rich(s.note);
  const region = $('#flow-svg').parentElement;
  const selected = $('#flow-svg').querySelector('[data-node="' + focusNode + '"]');
  const bounds = selected.getBoundingClientRect();
  const viewport = region.getBoundingClientRect();
  if (bounds.left < viewport.left || bounds.right > viewport.right) region.scrollTo({ left: region.scrollLeft + bounds.left - viewport.left - (viewport.width - bounds.width) / 2, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  movePacket(edge, s.edge);
}
function advance() {
  if (step >= flow.steps.length - 1) { stop(); return; }
  step++;
  updateStep();
  if (step === flow.steps.length - 1) stop();
}

// ---------------------------------------------------------------- conteúdo
function sectionsMarkup(only) {
  return Object.entries(layers).filter(([key]) => !only || only.includes(key)).map(([key, title]) => {
    const list = current.sections.filter(section => section.layer === key);
    if (!list.length) return '';
    return '<section class="layer layer-' + key + '" aria-labelledby="layer-' + key + '"><h2 id="layer-' + key + '"><span class="layer-index">' + (Object.keys(layers).indexOf(key) + 1) + '</span>' + escape(title) + '</h2>' + list.map(section => '<article class="lesson-section"><h3>' + escape(section.title) + '</h3><span class="evidence-type ' + kindClass(section.kind) + '">' + escape(section.kind) + '</span><p>' + rich(section.text) + '</p></article>').join('') + '</section>';
  }).join('');
}
// Sequência didática: intuição → visual → simulação → técnica → configuração → exercício → teste.
function methodMarkup(hasFlow, hasSim) {
  const steps = [['Intuição', '#layer-intuicao', true], ['Visual', hasFlow ? '.flow-panel' : '.lab', hasFlow || Boolean(current.labs)], ['Simulação', current.labs ? '.lab' : '.widget, .interactive-section', hasSim], ['Técnica', '#layer-mecanismo', true], ['Configuração', '.example-block', true], ['Exercício', '.exercise-section', true], ['Teste', '.quiz-section', true]].filter(x => x[2]);
  return '<nav class="method" aria-label="Etapas do módulo"><ol>' + steps.map(([label, target], i) => '<li><button type="button" class="method-step" data-jump="' + target + '"><span>' + (i + 1) + '</span>' + label + '</button></li>').join('') + '</ol></nav>';
}
function codeMarkup() {
  if (!current.code?.length) return '';
  return '<section class="code-refs" aria-labelledby="code-h"><h2 id="code-h">Onde está no código</h2><p>Links fixados na tag usada pelo laboratório: Loki ' + escape(versions.lokiSource) + ' (commit ' + escape(versions.lokiCommit.slice(0, 8)) + ')' + (current.code.some(r => r.file.startsWith('alloy:')) ? ' e Alloy ' + escape(versions.alloySource) : '') + '.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Referências ao código; role na horizontal se necessário"><table><thead><tr><th scope="col">Arquivo e linha</th><th scope="col">Símbolo</th><th scope="col">O que explica</th></tr></thead><tbody>' + current.code.map(r => '<tr><td><a href="' + escape(sourceUrl(r.file, r.line)) + '" target="_blank" rel="noopener noreferrer"><code>' + escape(sourceLabel(r.file)) + ':' + r.line + '</code><span class="sr-only"> (abre em nova aba)</span></a></td><td><code>' + escape(r.symbol) + '</code></td><td>' + rich(r.explains) + '</td></tr>').join('') + '</tbody></table></div></section>';
}
const dossierItems = [
  ['problem', 'Problema que resolve'], ['data', 'Dados que recebe, mantém e produz'], ['steps', 'Funcionamento passo a passo'],
  ['structures', 'Estruturas, algoritmos e concorrência'], ['communication', 'Comunicação com outros componentes'], ['params', 'Parâmetros'],
  ['guarantees', 'Garantias e quando deixam de valer'], ['failures', 'Falhas: sintoma, como observar, como investigar'], ['example', 'Exemplo de ponta a ponta'], ['exercise', 'Exercício de raciocínio']
];
function dossierBody(d, key) {
  switch (key) {
    case 'data': return '<dl class="kv"><div><dt>Recebe</dt><dd>' + rich(d.data.input) + '</dd></div><div><dt>Mantém</dt><dd>' + rich(d.data.state) + '</dd></div><div><dt>Produz</dt><dd>' + rich(d.data.output) + '</dd></div></dl>';
    case 'steps': return '<ol>' + d.steps.map(x => '<li>' + rich(x) + '</li>').join('') + '</ol>';
    case 'params': return '<div class="table-scroll" tabindex="0" role="region" aria-label="Parâmetros de ' + escape(d.name) + '"><table><thead><tr><th scope="col">YAML</th><th scope="col">Unidade</th><th scope="col">Default em ' + escape(versions.loki) + '</th><th scope="col">Efeito de alterar</th></tr></thead><tbody>' + d.params.map(x => '<tr><td><code>' + escape(x.yaml) + '</code></td><td>' + escape(x.unit) + '</td><td><code>' + escape(x.def) + '</code></td><td>' + rich(x.effect) + '</td></tr>').join('') + '</tbody></table></div>';
    case 'guarantees': return '<p><strong>Garante:</strong></p><ul>' + d.guarantees.map(x => '<li>' + rich(x) + '</li>').join('') + '</ul><p><strong>Deixa de valer quando:</strong></p><ul>' + d.breaks.map(x => '<li>' + rich(x) + '</li>').join('') + '</ul>';
    case 'failures': return '<div class="table-scroll" tabindex="0" role="region" aria-label="Falhas de ' + escape(d.name) + '"><table><thead><tr><th scope="col">Sintoma</th><th scope="col">Como observar</th><th scope="col">Como investigar</th></tr></thead><tbody>' + d.failures.map(x => '<tr><td>' + rich(x.symptom) + '</td><td>' + rich(x.observe) + '</td><td>' + rich(x.investigate) + '</td></tr>').join('') + '</tbody></table></div>';
    case 'exercise': return '<p>' + rich(d.exercise.task) + '</p><details><summary>Resposta explicada</summary><p>' + rich(d.exercise.answer) + '</p></details>';
    default: return '<p>' + rich(d[key]) + '</p>';
  }
}
function dossiersMarkup() {
  if (!current.dossiers?.length) return '';
  return '<section class="dossiers" aria-labelledby="dossiers-h"><h2 id="dossiers-h">Dossiê dos componentes</h2><p>Dez perguntas para cada componente. Abra o item que precisar.</p>' + current.dossiers.map((d, di) => '<article class="dossier"><h3>' + escape(d.name) + '</h3>' + dossierItems.map(([key, title], i) => '<details class="dossier-item" id="d' + di + '-' + key + '"' + (i === 0 ? ' open' : '') + '><summary><span class="dossier-n">' + (i + 1) + '</span>' + escape(title) + '</summary>' + dossierBody(d, key) + '</details>').join('') + '</article>').join('') + '</section>';
}

// ---------------------------------------------------------------- bancada LogQL
const presets = [
  ['Erros em JSON', '{app="checkout", format="json"} | json | level="error"', '2 linhas: IDs 2 e 4.'],
  ['Filtrar antes de interpretar', '{app="checkout", format="json"} |= "timeout" | json | duration_ms > 1000', '2 linhas; o parser recebe 2, em vez das 4 candidatas JSON.'],
  ['Erros em logfmt', '{app="checkout", format="logfmt"} | logfmt | level="error"', '1 linha: ID 6.'],
  ['Contagem em cinco minutos', 'sum(count_over_time({app="checkout"} |= "timeout" [5m]))', '3 eventos na janela fixa de cinco minutos.'],
  ['Taxa por segundo', 'sum(rate({app="checkout"} |= "timeout" [5m]))', '0,01 evento por segundo: 3 / 300.']
];
function playgroundMarkup() {
  return '<section class="interactive-section" aria-labelledby="playground-heading"><div class="flow-heading"><div><h2 id="playground-heading">Uma bancada para LogQL</h2><p>Seis entradas fixas, cinco minutos, nenhuma chamada a um Loki real.</p></div><span class="simulation-label">Simulação</span></div><label for="query-preset">Exercício guiado</label><select id="query-preset">' + presets.map(([title], i) => '<option value="' + i + '">' + escape(title) + '</option>').join('') + '</select><label for="query-input">Consulta</label><textarea id="query-input" rows="3" spellcheck="false">' + escape(presets[0][1]) + '</textarea><button id="run-query" class="primary">Executar simulação</button><p id="query-result" role="status"></p><div id="query-lines" class="sample-output" tabindex="0" role="region" aria-label="Resultados da simulação; use as setas para rolar"></div><details><summary>Resultado esperado e explicação</summary><p id="query-expected">' + escape(presets[0][2]) + '</p><p>Um filtro anterior ao parser pode reduzir as linhas interpretadas. Esta bancada conta operações sobre a amostra; não mede CPU, latência, downloads ou custos do Loki.</p></details><details><summary>Dados de exemplo e limites da simulação</summary><p>Suporta seletores com igualdade em aspas duplas; filtros literais |= e !=; JSON plano; logfmt simples; filtros de campo =, !=, &gt;, &gt;=, &lt; e &lt;=; __error__; sum(count_over_time(...[5m])) e sum(rate(...[5m])).</p><p>Não suporta regex, intervalos arbitrários, by/without, unwrap, templates, metadados estruturados, execução distribuída ou todas as regras de erros do Loki. Sintaxe fora desse conjunto é rejeitada. A amostra inteira está nos cinco minutos anteriores a um instante fictício.</p><pre tabindex="0" role="region" aria-label="Código e dados; use as setas para rolar">' + escape(sampleLogs.map(row => '#' + row.id + ' há ' + row.secondsAgo + 's ' + JSON.stringify(row.labels) + '\n' + row.line).join('\n\n')) + '</pre></details></section>';
}
function runQuery() {
  const result = $('#query-result');
  try {
    const response = simulate($('#query-input').value);
    result.className = 'feedback correct';
    result.textContent = response.kind === 'logs' ? response.rows.length + ' linha(s). ' + response.candidates + ' candidatas; ' + response.parsed + ' operações de parsing na simulação.' : response.value.toLocaleString('pt-BR', { maximumFractionDigits: 5 }) + (response.kind === 'rate' ? ' evento(s)/segundo.' : ' evento(s) em cinco minutos.');
    $('#query-lines').innerHTML = response.rows.length ? response.rows.map(row => '<div class="log-row"><span>#' + row.id + '</span><code>' + escape(row.line) + '</code>' + (row.fields.__error__ ? '<small>' + escape(row.fields.__error__) + '</small>' : '') + '</div>').join('') : '<p>Nenhuma linha corresponde aos filtros.</p>';
  } catch (error) {
    result.className = 'feedback incorrect'; result.textContent = error.message;
    $('#query-lines').replaceChildren();
  }
}

// ---------------------------------------------------------------- página
function render(focus = false) {
  stop();
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
  current = modules.find(module => module.id === id) || modules.find(module => module.id === progress.last) || modules[0];
  const index = modules.indexOf(current);
  progress.last = current.id;
  persist();
  document.title = current.short + ' — Loki por dentro';
  flow = current.flow ? flows[current.flow] : null;
  step = 0;
  const widget = current.widget ? widgets[current.widget] : null;
  $('#lesson').innerHTML = '<div class="lesson-meta"><span>Módulo ' + String(index + 1).padStart(2, '0') + ' de ' + modules.length + '</span><span>' + escape(current.part) + '</span><span>' + escape(current.duration) + ' de estudo</span></div>' +
    '<header class="lesson-header"><h1>' + escape(current.title) + '</h1><p class="lead">' + rich(current.summary) + '</p></header>' +
    '<aside class="module-question" aria-label="Pergunta do módulo"><span>Pergunta do módulo</span><p>' + rich(current.question) + '</p></aside>' +
    '<div class="lesson-grid"><div class="objectives"><h2>Ao final deste módulo você consegue</h2><ul>' + current.objectives.map(item => '<li>' + rich(item) + '</li>').join('') + '</ul></div><details class="prerequisites"><summary>Antes de começar</summary><p>' + rich(current.prereqs) + '</p></details></div>' +
    '<section class="trace" aria-labelledby="trace-h"><h2 id="trace-h">E1 e Q1 neste módulo</h2><p>' + rich(current.trace) + '</p></section>' +
    methodMarkup(Boolean(flow), Boolean(current.labs || widget || current.playground)) +
    (flow ? '<section class="flow-panel" aria-label="Exploração visual">' + flowMarkup() + '</section>' : '') +
    (current.labs ? '<div class="lesson-copy">' + sectionsMarkup(['intuicao']) + '</div><div class="labs">' + current.labs.map(id => labs[id].markup()).join('') + '</div><div class="lesson-copy">' + sectionsMarkup(['mecanismo', 'implementacao', 'operacao']) + '</div>' : '<div class="lesson-copy">' + sectionsMarkup() + '</div>') +
    (widget ? widget.markup() : '') +
    codeMarkup() + dossiersMarkup() +
    '<section class="example-block"><div class="example-heading"><h2>Leia o exemplo</h2><span>' + escape(current.example.language) + '</span><button class="text-button" id="copy-example">Copiar</button></div><pre tabindex="0" role="region" aria-label="Código e dados; use as setas para rolar"><code>' + escape(current.example.code) + '</code></pre><p>' + rich(current.example.caption) + '</p><span id="copy-status" role="status"></span></section>' +
    (current.playground ? playgroundMarkup() : '') +
    '<section class="exercise-section"><h2>Coloque em prática</h2><p>' + rich(current.exercise.task) + '</p><details><summary>Conferir raciocínio esperado</summary><p>' + rich(current.exercise.solution) + '</p></details><a href="./labs/local/README.md">Abrir roteiro do laboratório real</a>' + (current.id === 'caso-go' ? ' · <a href="./docs/projeto-final.md">Roteiro do projeto final</a>' : '') + '</section>' +
    '<section class="quiz-section" aria-labelledby="quiz-heading"><h2 id="quiz-heading">Teste seu raciocínio</h2><p>As alternativas erradas são erros plausíveis. O feedback explica cada escolha. Você pode tentar novamente.</p>' + current.quiz.map(quizMarkup).join('') + '</section>' +
    '<section class="references"><h2>Para conferir e aprofundar</h2><ul>' + current.refs.map(reference => '<li><a href="' + escape(reference.url) + '" target="_blank" rel="noopener noreferrer">' + escape(reference.title) + ' <span class="sr-only">(abre em nova aba)</span></a></li>').join('') + '</ul><p>Revisão editorial: ' + consultedAt + '. Código lido na tag ' + escape(versions.lokiSource) + ' do Loki e ' + escape(versions.alloySource) + ' do Alloy. Laboratório: Loki ' + versions.loki + ', Alloy ' + versions.alloy + ', Grafana ' + versions.grafana + '. Fontes históricas são identificadas no texto.</p></section>' +
    '<div class="module-finish"><div><button id="complete-module" class="primary">Concluir módulo</button><p id="complete-help"></p></div><nav aria-label="Navegação entre módulos">' + (index > 0 ? '<a class="secondary" href="#' + modules[index - 1].id + '">Anterior</a>' : '') + (index < modules.length - 1 ? '<a class="secondary" href="#' + modules[index + 1].id + '">Próximo módulo <span aria-hidden="true">→</span></a>' : '<a class="secondary" href="#fundamentos">Voltar ao início</a>') + '</nav></div>';
  nav(); completeState();
  if (flow) updateStep();
  if (widget) widget.mount($('[data-widget="' + current.widget + '"]'));
  for (const id of current.labs || []) labs[id].mount($('[data-lab="' + id + '"]'));
  if (current.playground) runQuery();
  $('#course-nav').classList.remove('mobile-open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); $('#menu-toggle').textContent = 'Abrir trilha';
  if (focus) { $('#lesson').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button, [data-node]');
  if (!target) return;
  if (target.dataset.jump) { const dest = document.querySelector(target.dataset.jump); if (dest) { dest.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' }); dest.setAttribute('tabindex', '-1'); dest.focus({ preventScroll: true }); } return; }
  if (target.dataset.node !== undefined) {
    stop();
    const n = Number(target.dataset.node);
    let found = flow.steps.findIndex(s => s.node === n);
    if (found < 0) found = flow.steps.findIndex(s => s.edge !== undefined && flow.edges[s.edge].to === n);
    if (found < 0) found = flow.steps.findIndex(s => s.edge !== undefined && flow.edges[s.edge].from === n);
    step = Math.max(0, found); updateStep(); return;
  }
  switch (target.id) {
    case 'flow-play':
      if (timer) stop();
      else {
        if (step === flow.steps.length - 1) step = 0;
        updateStep(); target.innerHTML = icon('pause') + 'Pausar'; target.setAttribute('aria-pressed', 'true');
        $('#flow-svg').classList.add('playing'); timer = setInterval(advance, 3500 / flowSpeed);
      } break;
    case 'flow-next': stop(); advance(); break;
    case 'flow-prev': stop(); step = Math.max(0, step - 1); updateStep(); break;
    case 'flow-reset': stop(); step = 0; updateStep(); break;
    case 'complete-module':
      if (mastered()) {
        if (!progress.completed.includes(current.id)) progress.completed.push(current.id);
        persist(); nav(); completeState();
        $('#complete-help').textContent = 'Conclusão salva. Continue pelo próximo módulo quando quiser.';
      } break;
    case 'copy-example':
      try { await navigator.clipboard.writeText(current.example.code); $('#copy-status').textContent = 'Exemplo copiado.'; }
      catch { $('#copy-status').textContent = 'Não foi possível copiar automaticamente. Selecione o texto do exemplo.'; } break;
    case 'run-query': runQuery(); break;
    case 'theme-toggle': {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('loki-por-dentro:theme', next); } catch { /* preferência só nesta visita */ }
      themeButton(); break;
    }
    case 'menu-toggle': {
      const open = $('#course-nav').classList.toggle('mobile-open'); target.setAttribute('aria-expanded', String(open)); target.textContent = open ? 'Fechar trilha' : 'Abrir trilha'; break;
    }
    case 'reset-progress': $('#reset-confirm').hidden = false; $('#confirm-reset').focus(); break;
    case 'cancel-reset': $('#reset-confirm').hidden = true; $('#reset-progress').focus(); break;
    case 'confirm-reset': progress = emptyProgress(modules, current.id); persist(); $('#reset-confirm').hidden = true; render(); $('#reset-progress').focus(); break;
  }
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.quiz !== undefined) {
    const index = Number(input.dataset.quiz); const answer = Number(input.value);
    progress.answers[current.id] ??= {}; progress.answers[current.id][index] = answer;
    progress.quizVersions[current.id] = current.quizVersion || 1;
    persist();
    const fieldset = $('#quiz-' + index);
    fieldset.querySelectorAll('.quiz-option').forEach(label => label.classList.toggle('selected', label.contains(input)));
    const feedback = fieldset.querySelector('.feedback');
    feedback.className = 'feedback ' + (answer === current.quiz[index].correct ? 'correct' : 'incorrect');
    feedback.innerHTML = '<strong>' + (answer === current.quiz[index].correct ? 'Correto. ' : 'Revise. ') + '</strong>' + rich(current.quiz[index].options[answer].why);
    completeState();
  }
  if (input.id === 'flow-speed') {
    flowSpeed = Number(input.value);
    if (timer) { clearInterval(timer); timer = setInterval(advance, 3500 / flowSpeed); }
  }
  if (input.id === 'query-preset') {
    const preset = presets[Number(input.value)];
    $('#query-input').value = preset[1]; $('#query-expected').textContent = preset[2]; runQuery();
  }
});
document.addEventListener('keydown', event => {
  if (event.target.matches('[data-node]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  if (event.key === 'Escape' && $('#course-nav').classList.contains('mobile-open')) { $('#course-nav').classList.remove('mobile-open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); $('#menu-toggle').textContent = 'Abrir trilha'; $('#menu-toggle').focus(); }
});
function themeButton() {
  const light = document.documentElement.dataset.theme === 'light';
  const b = $('#theme-toggle');
  b.textContent = light ? 'Tema escuro' : 'Tema claro';
  b.setAttribute('aria-pressed', String(light));
  document.querySelector('meta[name="theme-color"]').setAttribute('content', light ? '#123c35' : '#111217');
}
themeButton();
window.addEventListener('hashchange', () => render(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
reducedMotion.addEventListener('change', () => { stop(); render(); });
render();
