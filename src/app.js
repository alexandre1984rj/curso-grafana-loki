import { modules, consultedAt, versions } from './course.js';
import { flows, edgePath } from './flows.js';
import { sampleLogs, simulate, cardinality } from './simulator.js';
import { readProgress, saveProgress } from './progress.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('Indisponível'); } }; }
let progress = readProgress(storage, modules);
let current;
let step = 0;
let timer = null;
let flow;
let sequence;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const icons = {
  play: '<path d="m9 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  next: '<path d="m6 5 9 7-9 7M19 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>'
};
const icon = name => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'+icons[name]+'</svg>';
function persist() {
  $('#storage-status').textContent = saveProgress(storage, progress) ? '' : 'Armazenamento indisponível: o progresso dura apenas nesta visita.';
}
function nav() {
  $('#module-nav').innerHTML = modules.map((module,index) => '<a class="module-link'+(current?.id===module.id?' active':'')+'" href="#'+module.id+'" '+(current?.id===module.id?'aria-current="page"':'')+'><span class="module-number">'+String(index+1).padStart(2,'0')+'</span><span>'+escape(module.short)+'</span><span class="completion" aria-label="'+(progress.completed.includes(module.id)?'Concluído':'Não concluído')+'">'+(progress.completed.includes(module.id)?'✓':'')+'</span></a>').join('');
  $('#progress-count').textContent = progress.completed.length+' / '+modules.length;
  $('#course-progress').value = progress.completed.length;
}
function stop() {
  clearInterval(timer);
  timer=null;
  $('#flow-svg')?.classList.remove('playing');
  const button=$('#flow-play');
  if (button) { button.innerHTML=icon('play')+'Iniciar'; button.setAttribute('aria-pressed','false'); }
}
function quizMarkup(quiz,index) {
  const answer=progress.answers[current.id]?.[index];
  const answered=Number.isInteger(answer);
  return '<fieldset class="quiz-question" id="quiz-'+index+'"><legend><span>'+String(index+1).padStart(2,'0')+'</span> '+escape(quiz.question)+'</legend><div class="quiz-options">'+quiz.options.map((option,i)=>'<label class="quiz-option'+(answer===i?' selected':'')+'"><input type="radio" name="question-'+index+'" value="'+i+'" data-quiz="'+index+'" '+(answer===i?'checked':'')+'><span>'+escape(option.text)+'</span></label>').join('')+'</div><p class="feedback '+(answered?(answer===quiz.correct?'correct':'incorrect'):'')+'" role="status">'+(answered?'<strong>'+(answer===quiz.correct?'Correto. ':'Revise. ')+'</strong>'+escape(quiz.options[answer].why):'Escolha uma alternativa para receber uma explicação.')+'</p></fieldset>';
}
function mastered() { return current.quiz.every((quiz,index)=>progress.answers[current.id]?.[index]===quiz.correct); }
function completeState() {
  const button=$('#complete-module');
  button.disabled=!mastered();
  button.textContent=progress.completed.includes(current.id)?'Módulo concluído':'Concluir módulo';
  $('#complete-help').textContent=mastered()?'Você pode concluir este módulo e seguir na trilha.':'Responda corretamente às duas perguntas para registrar a conclusão. Você pode navegar livremente.';
}
function flowMarkup() {
  const nodes=flow.nodes;
  const height=Math.max(...nodes.map(node=>node.y))+105;
  return '<div class="flow-heading"><div><h2>'+escape(flow.title)+'</h2><p>Simulação didática. Clique nos componentes ou avance pelas etapas.</p></div><span class="simulation-label">Simulação</span></div><div class="diagram-scroll" tabindex="0" role="region" aria-label="Diagrama interativo; use Tab para selecionar componentes"><svg id="flow-svg" viewBox="0 0 920 '+height+'" role="group" aria-label="'+escape(flow.title)+'"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9" fill="none" stroke="currentColor" stroke-width="1.5"/></marker></defs>'+flow.edges.map(([a,b])=>'<g class="flow-edge"><path d="'+edgePath(nodes[a],nodes[b])+'" marker-end="url(#arrow)"/>'+(flow.labels?.[a+'-'+b]?'<text x="'+(nodes[a].x===nodes[b].x?nodes[a].x+90+(nodes[a].y<nodes[b].y?-55:55):(nodes[a].x+nodes[b].x)/2+90)+'" y="'+(nodes[a].y===nodes[b].y?nodes[a].y-8:(nodes[a].y+nodes[b].y)/2+(nodes[a].x===nodes[b].x?34:nodes[a].y<nodes[b].y?5:55))+'">'+escape(flow.labels[a+'-'+b])+'</text>':'')+'</g>').join('')+nodes.map((node,i)=>'<g class="flow-node" data-node="'+i+'" role="button" tabindex="0" aria-label="'+escape(node.title)+': '+escape(node.detail)+'"><rect x="'+node.x+'" y="'+node.y+'" width="180" height="68" rx="4"/><text x="'+(node.x+90)+'" y="'+(node.y+39)+'" text-anchor="middle">'+escape(node.title)+'</text></g>').join('')+'<circle id="packet" r="5" class="packet" aria-hidden="true"/></svg></div><p class="small-note">Em telas pequenas, deslize o diagrama na horizontal ou use as etapas e a descrição.</p><div class="flow-controls"><button id="flow-play" class="primary" aria-pressed="false">'+icon('play')+'Iniciar</button><button id="flow-next" class="secondary">'+icon('next')+'Avançar etapa</button><button id="flow-reset" class="text-button">'+icon('reset')+'Reiniciar</button><span id="step-count"></span></div><div class="flow-description" aria-live="polite" aria-atomic="true"><strong id="step-title"></strong><p id="step-detail"></p></div>'+(reducedMotion.matches?'<p class="small-note">Movimento reduzido: etapas indicadas sem deslocamento animado.</p>':'')+'<details class="text-alternative"><summary>Ver conexões em texto</summary><ul>'+flow.edges.map(([a,b])=>'<li>'+escape(nodes[a].title)+' → '+escape(nodes[b].title)+(flow.labels?.[a+'-'+b]?' ('+escape(flow.labels[a+'-'+b])+')':'')+'</li>').join('')+'</ul><p>Esquema lógico: não representa latências, todas as chamadas de rede ou todos os componentes opcionais.</p></details>';
}
function updateStep() {
  const nodeIndex=sequence[step];
  const node=flow.nodes[nodeIndex];
  document.querySelectorAll('.flow-node').forEach(element=>{
    const selected=Number(element.dataset.node)===nodeIndex;
    element.classList.toggle('is-current',selected);
    element.setAttribute('aria-pressed',String(selected));
  });
  $('#step-count').textContent=(step+1)+' / '+sequence.length;
  $('#step-title').textContent=node.title;
  $('#step-detail').textContent=step===sequence.length-1 && current.flow==='read' ? 'Frontend reúne as respostas e devolve o resultado. Dados recentes e históricos podem participar da mesma consulta.' : node.detail;
  const region=$('#flow-svg').parentElement;
  const selected=$('#flow-svg').querySelector('[data-node="'+nodeIndex+'"]');
  const bounds=selected.getBoundingClientRect();
  const viewport=region.getBoundingClientRect();
  if(bounds.left<viewport.left||bounds.right>viewport.right) region.scrollTo({left:region.scrollLeft+bounds.left-viewport.left-(viewport.width-bounds.width)/2,behavior:reducedMotion.matches?'instant':'smooth'});
  const previous=sequence[Math.max(0,step-1)];
  const edge=flow.edges.find(([a,b])=>a===previous&&b===nodeIndex);
  const packet=$('#packet');
  packet.style.display=edge&&!reducedMotion.matches?'':'none';
  if(edge) packet.style.offsetPath='path("'+edgePath(flow.nodes[edge[0]],flow.nodes[edge[1]])+'")';
}
function advance() {
  if(step>=sequence.length-1) { stop(); return; }
  step++;
  updateStep();
  if(step===sequence.length-1) stop();
}
function cardinalityMarkup() {
  return '<section class="interactive-section" aria-labelledby="cardinality-heading"><h2 id="cardinality-heading">Quantos streams cabem nas suas escolhas?</h2><p>Explore o teto de combinações. Ele supõe que todas as combinações ocorram; não estima memória nem custo em dinheiro.</p><div class="cardinality-layout"><div class="sliders"><label for="apps">Aplicações <output id="apps-value">3</output></label><input id="apps" type="range" min="1" max="20" value="3"><label for="envs">Ambientes <output id="envs-value">2</output></label><input id="envs" type="range" min="1" max="5" value="2"><label for="pods">Pods por aplicação / ambiente <output id="pods-value">4</output></label><input id="pods" type="range" min="1" max="40" value="4"><label for="requests">IDs distintos por combinação <output id="requests-value">100</output></label><input id="requests" type="range" min="1" max="1000" value="100"><label class="toggle-label"><input type="checkbox" id="include-requests"> Indexar request_id como label</label></div><div class="stream-result" aria-live="polite"><svg id="stream-grid" viewBox="0 0 240 140" role="img" aria-label="Representação das combinações"></svg><p id="stream-count"></p><p id="stream-formula"></p><p id="stream-warning"></p></div></div></section>';
}
function updateCardinality() {
  const values=['apps','envs','pods','requests'].map(id=>{
    const value=Number($('#'+id).value); $('#'+id+'-value').textContent=value; return value;
  });
  const include=$('#include-requests').checked;
  const count=cardinality(...values,include);
  $('#stream-count').textContent=count.toLocaleString('pt-BR')+' streams possíveis';
  $('#stream-formula').textContent=values.slice(0,3).join(' × ')+(include?' × '+values[3]:'')+' = '+count.toLocaleString('pt-BR');
  $('#stream-warning').textContent=include?'Cada novo request_id pode fragmentar a origem em mais streams.':'request_id pode continuar no conteúdo ou em metadados estruturados.';
  $('#stream-grid').innerHTML=Array.from({length:Math.min(count,96)},(_,i)=>'<rect x="'+((i%12)*19+5)+'" y="'+(Math.floor(i/12)*16+5)+'" width="13" height="10" rx="1"/>').join('');
  $('#stream-grid').setAttribute('aria-label','Até 96 marcadores ilustram '+count+' combinações possíveis; um marcador não representa um custo medido.');
}
const presets=[
  ['Erros em JSON','{app="checkout", format="json"} | json | level="error"','2 linhas: IDs 2 e 4.'],
  ['Filtrar antes de interpretar','{app="checkout", format="json"} |= "timeout" | json | duration_ms > 1000','2 linhas; o parser recebe 2, em vez das 4 candidatas JSON.'],
  ['Erros em logfmt','{app="checkout", format="logfmt"} | logfmt | level="error"','1 linha: ID 6.'],
  ['Contagem em cinco minutos','sum(count_over_time({app="checkout"} |= "timeout" [5m]))','3 eventos na janela fixa de cinco minutos.'],
  ['Taxa por segundo','sum(rate({app="checkout"} |= "timeout" [5m]))','0,01 evento por segundo: 3 / 300.']
];
function playgroundMarkup() {
  return '<section class="interactive-section" aria-labelledby="playground-heading"><div class="flow-heading"><div><h2 id="playground-heading">Uma bancada para LogQL</h2><p>Seis entradas fixas, cinco minutos, nenhuma chamada a um Loki real.</p></div><span class="simulation-label">Simulação</span></div><label for="query-preset">Exercício guiado</label><select id="query-preset">'+presets.map(([title],i)=>'<option value="'+i+'">'+escape(title)+'</option>').join('')+'</select><label for="query-input">Consulta</label><textarea id="query-input" rows="3" spellcheck="false">'+escape(presets[0][1])+'</textarea><button id="run-query" class="primary">Executar simulação</button><p id="query-result" role="status"></p><div id="query-lines" class="sample-output"></div><details><summary>Resultado esperado e explicação</summary><p id="query-expected">'+escape(presets[0][2])+'</p><p>Um filtro anterior ao parser pode reduzir as linhas interpretadas. Esta bancada conta operações sobre a amostra; não mede CPU, latência, downloads ou custos do Loki.</p></details><details><summary>Dados de exemplo e limites da simulação</summary><p>Suporta seletores com igualdade em aspas duplas; filtros literais |= e !=; JSON plano; logfmt simples; filtros de campo =, !=, &gt;, &gt;=, &lt; e &lt;=; __error__; sum(count_over_time(...[5m])) e sum(rate(...[5m])).</p><p>Não suporta regex, intervalos arbitrários, by/without, unwrap, templates, metadados estruturados, execução distribuída ou todas as regras de erros do Loki. Sintaxe fora desse conjunto é rejeitada. A amostra inteira está nos cinco minutos anteriores a um instante fictício.</p><pre>'+escape(sampleLogs.map(row=>'#'+row.id+' há '+row.secondsAgo+'s '+JSON.stringify(row.labels)+'\n'+row.line).join('\n\n'))+'</pre></details></section>';
}
function runQuery() {
  const result=$('#query-result');
  try {
    const response=simulate($('#query-input').value);
    result.className='feedback correct';
    result.textContent=response.kind==='logs'?response.rows.length+' linha(s). '+response.candidates+' candidatas; '+response.parsed+' operações de parsing na simulação.':response.value.toLocaleString('pt-BR',{maximumFractionDigits:5})+(response.kind==='rate'?' evento(s)/segundo.':' evento(s) em cinco minutos.');
    $('#query-lines').innerHTML=response.rows.length?response.rows.map(row=>'<div class="log-row"><span>#'+row.id+'</span><code>'+escape(row.line)+'</code>'+(row.fields.__error__?'<small>'+escape(row.fields.__error__)+'</small>':'')+'</div>').join(''):'<p>Nenhuma linha corresponde aos filtros.</p>';
  } catch(error) {
    result.className='feedback incorrect';result.textContent=error.message;
    $('#query-lines').replaceChildren();
  }
}
function render(focus=false) {
  stop();
  let id;
  try { id=decodeURIComponent(location.hash.slice(1)); } catch { id=''; }
  current=modules.find(module=>module.id===id)||modules.find(module=>module.id===progress.last)||modules[0];
  const index=modules.indexOf(current);
  progress.last=current.id;
  persist();
  document.title=current.short+' — Loki por dentro';
  flow=flows[current.flow];
  sequence=flow.steps || flow.nodes.map((_,i)=>i);
  step=0;
  $('#lesson').innerHTML='<div class="lesson-meta"><span>Módulo '+String(index+1).padStart(2,'0')+' de '+modules.length+'</span><span>'+escape(current.duration)+' de estudo</span></div><header class="lesson-header"><h1>'+escape(current.title)+'</h1><p class="lead">'+escape(current.summary)+'</p></header><div class="lesson-grid"><div class="objectives"><h2>Ao final desta aula</h2><ul>'+current.objectives.map(item=>'<li>'+escape(item)+'</li>').join('')+'</ul></div><details class="prerequisites"><summary>Antes de começar</summary><p>'+escape(current.prereqs)+'</p></details></div><section class="flow-panel" aria-label="Exploração visual">'+flowMarkup()+'</section><article class="lesson-copy">'+current.sections.map(section=>'<section><h2>'+escape(section.title)+'</h2><span class="evidence-type">'+escape(section.kind)+'</span><p>'+escape(section.text)+'</p></section>').join('')+'</article><section class="example-block"><div class="example-heading"><h2>Leia o exemplo</h2><span>'+escape(current.example.language)+'</span><button class="text-button" id="copy-example">Copiar</button></div><pre><code>'+escape(current.example.code)+'</code></pre><p>'+escape(current.example.caption)+'</p><span id="copy-status" role="status"></span></section>'+(current.id==='modelo-dados'?cardinalityMarkup():'')+(current.id==='logql'?playgroundMarkup():'')+'<section class="exercise-section"><h2>Coloque em prática</h2><p>'+escape(current.exercise.task)+'</p><details><summary>Conferir raciocínio esperado</summary><p>'+escape(current.exercise.solution)+'</p></details><a href="./labs/local/README.md">Abrir roteiro do laboratório real</a>'+(current.id==='caso-go'?' · <a href="./docs/projeto-final.md">Roteiro do projeto final</a>':'')+'</section><section class="quiz-section" aria-labelledby="quiz-heading"><h2 id="quiz-heading">Teste seu entendimento</h2><p>O feedback explica cada escolha. Você pode tentar novamente.</p>'+current.quiz.map(quizMarkup).join('')+'</section><section class="references"><h2>Para conferir e aprofundar</h2><ul>'+current.refs.map(reference=>'<li><a href="'+escape(reference.url)+'" target="_blank" rel="noopener noreferrer">'+escape(reference.title)+' <span class="sr-only">(abre em nova aba)</span></a></li>').join('')+'</ul><p>Consulta editorial: '+consultedAt+'. Laboratório: Loki '+versions.loki+', Alloy '+versions.alloy+', Grafana '+versions.grafana+'. Fontes históricas são identificadas no texto.</p></section><div class="module-finish"><div><button id="complete-module" class="primary">Concluir módulo</button><p id="complete-help"></p></div><nav aria-label="Navegação entre aulas">'+(index>0?'<a class="secondary" href="#'+modules[index-1].id+'">Anterior</a>':'')+(index<modules.length-1?'<a class="secondary" href="#'+modules[index+1].id+'">Próxima aula <span aria-hidden="true">→</span></a>':'<a class="secondary" href="#fundamentos">Voltar ao início</a>')+'</nav></div>';
  nav();completeState();updateStep();
  if(current.id==='modelo-dados') updateCardinality();
  if(current.id==='logql') runQuery();
  $('#course-nav').classList.remove('mobile-open');$('#menu-toggle').setAttribute('aria-expanded','false');$('#menu-toggle').textContent='Abrir trilha';
  if(focus) { $('#lesson').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'}); }
}
document.addEventListener('click', async event=>{
  const target=event.target.closest('button, [data-node]');
  if(!target) return;
  if(target.dataset.node!==undefined) {
    stop();const node=Number(target.dataset.node);step=sequence.indexOf(node);
    if(step<0) step=0;updateStep();return;
  }
  switch(target.id) {
    case 'flow-play':
      if(timer) stop();
      else {
        if(step===sequence.length-1) step=0;
        updateStep();target.innerHTML=icon('pause')+'Pausar';target.setAttribute('aria-pressed','true');
        $('#flow-svg').classList.add('playing');timer=setInterval(advance,2200);
      } break;
    case 'flow-next': stop();advance();break;
    case 'flow-reset': stop();step=0;updateStep();break;
    case 'complete-module':
      if(mastered()) {
        if(!progress.completed.includes(current.id)) progress.completed.push(current.id);
        persist();nav();completeState();
        $('#complete-help').textContent='Conclusão salva. Continue pela próxima aula quando quiser.';
      } break;
    case 'copy-example':
      try { await navigator.clipboard.writeText(current.example.code);$('#copy-status').textContent='Exemplo copiado.'; }
      catch { $('#copy-status').textContent='Não foi possível copiar automaticamente. Selecione o texto do exemplo.'; } break;
    case 'run-query':runQuery();break;
    case 'menu-toggle':{
      const open=$('#course-nav').classList.toggle('mobile-open');target.setAttribute('aria-expanded',String(open));target.textContent=open?'Fechar trilha':'Abrir trilha';break;
    }
    case 'reset-progress':$('#reset-confirm').hidden=false;$('#confirm-reset').focus();break;
    case 'cancel-reset':$('#reset-confirm').hidden=true;$('#reset-progress').focus();break;
    case 'confirm-reset':progress={completed:[],answers:{},last:current.id};persist();$('#reset-confirm').hidden=true;render();$('#reset-progress').focus();break;
  }
});
document.addEventListener('change',event=>{
  const input=event.target;
  if(input.dataset.quiz!==undefined) {
    const index=Number(input.dataset.quiz);const answer=Number(input.value);
    progress.answers[current.id]??={};progress.answers[current.id][index]=answer;
    persist();
    const fieldset=$('#quiz-'+index);
    fieldset.querySelectorAll('.quiz-option').forEach(label=>label.classList.toggle('selected',label.contains(input)));
    const feedback=fieldset.querySelector('.feedback');
    feedback.className='feedback '+(answer===current.quiz[index].correct?'correct':'incorrect');
    feedback.textContent=(answer===current.quiz[index].correct?'Correto. ':'Revise. ')+current.quiz[index].options[answer].why;
    completeState();
  }
  if(input.id==='include-requests') updateCardinality();
  if(input.id==='query-preset') {
    const preset=presets[Number(input.value)];
    $('#query-input').value=preset[1];$('#query-expected').textContent=preset[2];runQuery();
  }
});
document.addEventListener('input',event=>{if(['apps','envs','pods','requests'].includes(event.target.id))updateCardinality();});
document.addEventListener('keydown',event=>{
  if(event.target.matches('[data-node]')&&['Enter',' '].includes(event.key)) {event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
  if(event.key==='Escape'&&$('#course-nav').classList.contains('mobile-open')) {$('#course-nav').classList.remove('mobile-open');$('#menu-toggle').setAttribute('aria-expanded','false');$('#menu-toggle').textContent='Abrir trilha';$('#menu-toggle').focus();}
});
window.addEventListener('hashchange',()=>render(true));
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
reducedMotion.addEventListener('change',()=>{stop();render();});
render();
