// Componentes de apresentação reutilizados por todas as simulações.
// - flip(): anima objetos com a mesma chave (data-k) entre dois estados do DOM.
// - createPlayer(): play/pause, passo, voltar, reiniciar, velocidade e linha do tempo.
// - labShell(): moldura comum (cabeçalho, controles, palco, métricas, inspetor, narração, premissas).
// A lógica de cada simulação fica em engine.js; aqui só desenhamos frames já calculados.

export const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const fmt = (n, digits = 0) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const icons = {
  play: '<path d="m9 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  next: '<path d="m6 5 9 7-9 7M19 5v14"/>',
  prev: '<path d="m18 5-9 7 9 7M5 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>'
};
export const icon = name => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">' + icons[name] + '</svg>';

// Chips de label (indexado), structured metadata e campo extraído. As cores são tokens do tema.
export const chip = (k, v, kind = 'label', extra = '') => '<span class="chip chip-' + kind + '"' + extra + '><span class="chip-k">' + esc(k) + '</span>' + (v === undefined ? '' : '<span class="chip-v">' + esc(v) + '</span>') + '</span>';
export const chips = (labels, kind = 'label') => Object.entries(labels).map(([k, v]) => chip(k, v, kind)).join('');

export function metrics(list) {
  return '<dl class="metrics">' + list.map(m => '<div class="metric' + (m.tone ? ' tone-' + m.tone : '') + '"' + (m.hint ? ' title="' + esc(m.hint) + '"' : '') + '><dt>' + esc(m.label) + '</dt><dd>' + m.value + (m.sub ? '<span class="metric-sub">' + m.sub + '</span>' : '') + '</dd></div>').join('') + '</dl>';
}

export function labShell({ id, n, title, question, controls = '', premises, limits, player = true, alt = '' }) {
  return '<section class="lab" data-lab="' + id + '" aria-labelledby="lab-' + id + '-h">' +
    '<header class="lab-head"><div><p class="lab-eyebrow">' + esc(n) + '</p><h2 id="lab-' + id + '-h">' + esc(title) + '</h2><p class="lab-question">' + esc(question) + '</p></div><span class="simulation-label" title="Mesmos parâmetros produzem sempre o mesmo resultado; nenhuma chamada a um Loki real.">Simulação determinística</span></header>' +
    (controls ? '<div class="lab-controls">' + controls + '</div>' : '') +
    '<div class="lab-body"><div class="lab-main"><div class="lab-metrics" data-role="metrics"></div><div class="lab-stage" data-role="stage"></div>' +
    '<p class="lab-narration" data-role="narration" aria-live="polite"></p></div>' +
    '<aside class="lab-inspector" data-role="inspector" aria-label="Detalhes técnicos" aria-live="polite"><p class="inspector-empty">Clique ou use Tab num objeto do palco para ver os detalhes técnicos.</p></aside></div>' +
    (player ? playerMarkup(id) : '') +
    '<details class="premises"><summary>Premissas, regras e limites desta simulação</summary><p><strong>Regras do Loki reproduzidas:</strong> ' + premises + '</p><p><strong>O que ela não representa:</strong> ' + limits + '</p></details>' +
    (alt ? '<details class="text-alternative"><summary>Descrição em texto</summary>' + alt + '</details>' : '') +
    '</section>';
}

function playerMarkup(id) {
  return '<div class="player" data-role="player"><div class="player-buttons">' +
    '<button type="button" class="secondary" data-act="prev" aria-label="Etapa anterior">' + icon('prev') + '<span>Voltar</span></button>' +
    '<button type="button" class="primary" data-act="play" aria-pressed="false">' + icon('play') + '<span>Reproduzir</span></button>' +
    '<button type="button" class="secondary" data-act="next" aria-label="Próxima etapa">' + icon('next') + '<span>Avançar</span></button>' +
    '<button type="button" class="text-button" data-act="reset">' + icon('reset') + '<span>Reiniciar</span></button></div>' +
    '<label class="player-speed">Velocidade <select data-act="speed"><option value="0.5">0,5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>' +
    '<label class="player-scrub"><span class="sr-only">Linha do tempo</span><input type="range" min="0" max="0" value="0" data-act="scrub" aria-label="Linha do tempo da simulação"></label>' +
    '<output class="player-count" data-role="count" aria-live="off"></output></div>';
}

// Anima objetos que existem antes e depois de `update`. Filhos descontam o deslocamento do
// ancestral animado para não se moverem duas vezes.
export function flip(container, update, { duration = 650 } = {}) {
  const before = new Map();
  if (!reduced()) container.querySelectorAll('[data-k]').forEach(el => before.set(el.dataset.k, el.getBoundingClientRect()));
  update();
  if (reduced() || typeof Element.prototype.animate !== 'function') return;
  const deltas = new Map();
  container.querySelectorAll('[data-k]').forEach(el => {
    const b = before.get(el.dataset.k);
    const a = el.getBoundingClientRect();
    if (b) deltas.set(el, { dx: b.left - a.left, dy: b.top - a.top });
    else el.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: duration * 0.7, easing: 'cubic-bezier(.2,.8,.2,1)', delay: duration * 0.25, fill: 'backwards' });
  });
  for (const [el, d] of deltas) {
    const parent = el.parentElement?.closest('[data-k]');
    const pd = parent && deltas.get(parent);
    const dx = d.dx - (pd ? pd.dx : 0), dy = d.dy - (pd ? pd.dy : 0);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
}

// Controlador de linha do tempo sobre frames pré-calculados.
export function createPlayer(root, { count, render, baseMs = 2400 }) {
  const el = sel => root.querySelector('[data-act="' + sel + '"]');
  const out = root.querySelector('[data-role="count"]');
  let index = 0, timer = null, speed = 1;
  const playBtn = el('play');
  const scrub = el('scrub');
  const setPlaying = on => {
    if (!playBtn) return;
    playBtn.innerHTML = icon(on ? 'pause' : 'play') + '<span>' + (on ? 'Pausar' : 'Reproduzir') + '</span>';
    playBtn.setAttribute('aria-pressed', String(on));
    root.classList.toggle('is-playing', on);
  };
  const stop = () => { clearInterval(timer); timer = null; setPlaying(false); };
  const show = (i, animate = true) => {
    const n = count();
    index = Math.max(0, Math.min(n - 1, i));
    if (scrub) { scrub.max = String(Math.max(0, n - 1)); scrub.value = String(index); }
    if (out) out.textContent = 'Etapa ' + (index + 1) + ' de ' + n;
    render(index, animate, baseMs / speed);
  };
  const tick = () => { if (index >= count() - 1) { stop(); return; } show(index + 1); if (index >= count() - 1) stop(); };
  const play = () => { if (index >= count() - 1) show(0); setPlaying(true); timer = setInterval(tick, baseMs / speed); };
  root.addEventListener('click', event => {
    const b = event.target.closest('[data-act]');
    if (!b || !root.contains(b) || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const act = b.dataset.act;
    if (act === 'play') { if (timer) stop(); else play(); }
    if (act === 'next') { stop(); show(index + 1); }
    if (act === 'prev') { stop(); show(index - 1); }
    if (act === 'reset') { stop(); show(0); }
  });
  el('speed')?.addEventListener('change', e => { speed = Number(e.target.value); if (timer) { clearInterval(timer); timer = setInterval(tick, baseMs / speed); } });
  scrub?.addEventListener('input', e => { stop(); show(Number(e.target.value)); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('hashchange', stop, { once: true });
  return { show, stop, get index() { return index; }, end: () => show(count() - 1, false) };
}

// Inspetor: objetos com data-inspect mostram detalhes técnicos ao clicar ou ao pressionar Enter.
// Contêineres com objetos focáveis dentro (ingester, stream) recebem o foco no cabeçalho:
// o cabeçalho leva data-inspect="<chave do contêiner>", sem repetir data-k (que é da animação).
const keyOf = el => el.dataset.inspect || el.dataset.k;
export function bindInspector(root, describe) {
  const panel = root.querySelector('[data-role="inspector"]');
  let current = null;
  const showFor = key => {
    const d = key && describe(key);
    root.querySelectorAll('[data-inspect].is-selected').forEach(x => x.classList.remove('is-selected'));
    if (!d) { current = null; return; }
    current = key;
    root.querySelectorAll('[data-inspect]').forEach(x => { if (keyOf(x) === key) x.classList.add('is-selected'); });
    panel.innerHTML = '<p class="inspector-kind">' + esc(d.kind || 'Objeto') + '</p><h3>' + esc(d.title) + '</h3>' + (d.rows ? '<dl class="kv">' + d.rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>' : '') + (d.note ? '<p>' + d.note + '</p>' : '');
  };
  const activate = target => { const t = target.closest('[data-inspect]'); if (t && root.contains(t)) showFor(keyOf(t)); };
  root.addEventListener('click', e => activate(e.target));
  root.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-inspect]')) { e.preventDefault(); activate(e.target); } });
  return { refresh: () => { if (current) showFor(current); }, show: showFor };
}

export const part = (root, role) => root.querySelector('[data-role="' + role + '"]');
