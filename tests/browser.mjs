import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { modules } from '../src/course.js';
import { flows } from '../src/flows.js';

const url=process.env.COURSE_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1050}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
await mkdir('artifacts',{recursive:true});
try {
  await page.goto(url);
  await page.getByRole('heading',{level:1,name:modules[0].title}).waitFor();
  await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
  const overview=flows[modules[0].flow];
  assert.equal(await page.locator('[data-node]').count(),overview.nodes.length);
  assert.equal(await page.locator('[data-edge]').count(),overview.edges.length);
  await page.getByRole('button',{name:'Avançar etapa'}).click();
  assert.equal(await page.locator('#step-count').textContent(),'2 / '+overview.steps.length);
  assert.equal(await page.locator('.flow-edge.is-current').count(),1);
  await page.getByRole('button',{name:'Voltar',exact:true}).click();
  assert.equal(await page.locator('#step-count').textContent(),'1 / '+overview.steps.length);
  await page.getByRole('button',{name:'Iniciar',exact:true}).click();
  await page.getByRole('button',{name:'Pausar',exact:true}).click();
  await page.locator('#flow-reset').click();
  assert.equal(await page.locator('#step-count').textContent(),'1 / '+overview.steps.length);
  await page.locator('[data-node="2"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#step-title').textContent(),'Alloy → Distributor');
  assert.ok((await page.locator('.flow-legend li').count())>=2);

  for(const module of modules) {
    await page.goto(url+'/#'+module.id);
    await page.getByRole('heading',{level:1,name:module.title}).waitFor();
    for(const [index,quiz] of module.quiz.entries()) {
      const wrong=(quiz.correct+1)%quiz.options.length;
      await page.locator('input[name="question-'+index+'"][value="'+wrong+'"]').check();
      assert.match(await page.locator('#quiz-'+index+' .feedback').textContent(),/^Revise/);
      await page.locator('input[name="question-'+index+'"][value="'+quiz.correct+'"]').check();
      assert.match(await page.locator('#quiz-'+index+' .feedback').textContent(),/^Correto/);
    }
    await page.locator('#complete-module').click();
    if(module.widget) assert.ok((await page.locator('[data-widget="'+module.widget+'"] .widget-result').textContent()).trim().length>20,module.id+': modelo sem resultado');
    assert.equal(await page.locator('.dossier').count(),module.dossiers.length);
    assert.equal(await page.locator('.code-refs tbody tr').count(),module.code.length);
    const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),[],module.id);
  }
  const all=modules.length+' / '+modules.length;
  assert.equal(await page.locator('#progress-count').textContent(),all);
  await page.reload();
  assert.equal(await page.locator('#progress-count').textContent(),all);
  await page.goto(url+'/#modelo-dados');
  const initial=await page.locator('#card-out').textContent();
  await page.locator('#include-requests').check();
  assert.notEqual(await page.locator('#card-out').textContent(),initial);
  assert.match(await page.locator('#card-out').textContent(),/Dentro do limite/);
  await page.locator('#requests').fill('1000');
  assert.match(await page.locator('#card-out').textContent(),/Acima do limite/);

  await page.goto(url+'/#escrita');
  assert.match(await page.locator('#q-out').textContent(),/^.*204/);
  await page.locator('#q-s0').selectOption('error');
  await page.locator('#q-s1').selectOption('error');
  assert.match(await page.locator('#q-out').textContent(),/Erro/);
  await page.locator('#q-s1').selectOption('unhealthy');
  await page.locator('#q-s2').selectOption('unhealthy');
  assert.match(await page.locator('#q-out').textContent(),/at least 2 live replicas required/);
  await page.screenshot({path:'artifacts/quorum.png',fullPage:false});

  await page.goto(url+'/#ingester');
  await page.locator('[data-c="1000"]').click();
  assert.match(await page.locator('#c-out').textContent(),/cut\(\)/);

  await page.goto(url+'/#wal-flush');
  await page.locator('#d-stage').fill('2');
  await page.locator('#d-fail').selectOption('power');
  assert.match(await page.locator('#d-out').textContent(),/Pode ser perdido/);
  await page.locator('#d-rf').selectOption('3');
  assert.match(await page.locator('#d-out').textContent(),/Sobrevive/);

  await page.goto(url+'/#armazenamento');
  assert.match(await page.locator('#ref-out').textContent(),/service_name="checkout"/);
  await page.locator('#ref-labels').fill('{app=');
  assert.match(await page.locator('#ref-out').textContent(),/formato/);

  await page.goto(url+'/#leitura');
  assert.match(await page.locator('#p-out').textContent(),/1\.536/);
  await page.screenshot({path:'artifacts/read-path.png',fullPage:true});

  await page.goto(url+'/#logql');
  assert.match(await page.locator('#query-result').textContent(),/^2 linha/);
  for(let i=0;i<5;i++) {
    await page.locator('#query-preset').selectOption(String(i));
    assert.ok(!await page.locator('#query-result').evaluate(node=>node.classList.contains('incorrect')));
  }
  await page.locator('#query-input').fill('{app="checkout"} | unwrap duration_ms');
  await page.locator('#run-query').click();
  assert.ok(await page.locator('#query-result').evaluate(node=>node.classList.contains('incorrect')));
  await page.screenshot({path:'artifacts/playground.png',fullPage:true});

  // Laboratórios de objetos: player, parâmetros, inspetor e acessibilidade em estados intermediários.
  const lab=id=>page.locator('section[data-lab="'+id+'"]');
  const metricsOf=id=>lab(id).locator('[data-role="metrics"]').textContent();
  const axeClean=async label=>{const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[],label);};
  await page.goto(url+'/#fundamentos');
  await lab('ingest').locator('[data-act="next"]').click();
  assert.match(await lab('ingest').locator('[data-role="count"]').textContent(),/^Etapa 2 de \d+/);
  await lab('ingest').locator('[data-act="prev"]').click();
  assert.match(await lab('ingest').locator('[data-role="count"]').textContent(),/^Etapa 1 de/);
  await lab('ingest').locator('[data-act="play"]').click();
  assert.equal(await lab('ingest').locator('[data-act="play"]').getAttribute('aria-pressed'),'true');
  await lab('ingest').locator('[data-act="play"]').click();
  await lab('ingest').locator('[data-act="reset"]').click();
  assert.match(await lab('ingest').locator('[data-role="count"]').textContent(),/^Etapa 1 de/);

  await page.goto(url+'/#labels-streams');
  const cardBefore=await metricsOf('lab2');
  await lab('lab2').locator('[data-p="trace_id"]').setChecked(!(await lab('lab2').locator('[data-p="trace_id"]').isChecked()));
  assert.notEqual(await metricsOf('lab2'),cardBefore,'lab2: trace_id muda os indicadores');
  const firstStream=lab('lab1').locator('.stream-head[data-inspect]').first();
  if(await firstStream.count()){await firstStream.focus();await page.keyboard.press('Enter');assert.ok((await lab('lab1').locator('[data-role="inspector"] h3').textContent()).length>0);}
  await axeClean('labels-streams após interação');

  await page.goto(url+'/#ring-sharding');
  const ringBefore=await lab('lab3').locator('.ring-units .unit').count();
  await lab('lab3').locator('[data-ring="add"]').click();
  assert.equal(await lab('lab3').locator('.ring-units .unit').count(),ringBefore+1,'lab3: ingester adicionado');
  await lab('lab3').locator('[data-ring="remove"]').click();
  assert.equal(await lab('lab3').locator('.ring-units .unit').count(),ringBefore);
  await lab('lab4').locator('[data-act="reset"]').click();
  await lab('lab4').locator('[data-act="next"]').click();
  await lab('lab4').locator('[data-p="enabled"]').uncheck();
  await axeClean('ring-sharding após interação');

  await page.goto(url+'/#onde-guardar');
  await lab('lab5').locator('[data-preset="worst"]').click();
  assert.match(await metricsOf('lab5'),/\d/);
  await lab('lab5').locator('[data-preset="rec"]').click();
  assert.match(await metricsOf('lab5'),/600/);
  await axeClean('onde-guardar após preset');

  await page.goto(url+'/#agulha');
  await lab('lab6').locator('[data-q="text"]').fill('{app="banking"} |= "error"');
  await lab('lab6').locator('[data-q="run"]').click();
  const p6=lab('lab6').locator('[data-act="next"]'); for(let i=0;i<3;i++) await p6.click();
  await axeClean('agulha com linhas descartadas');
  await lab('lab6').locator('[data-q="text"]').fill('{app=~".*"}');
  await lab('lab6').locator('[data-q="run"]').click();
  assert.match(await lab('lab6').locator('[data-role="qerror"]').textContent(),/empty-compatible/);
  const bitsBefore=await lab('lab7').locator('.bit').count();
  await lab('lab7').locator('[data-p="m"]').selectOption('256');
  assert.ok(await lab('lab7').locator('.bit').count()>bitsBefore,'lab7: m maior, mais bits');
  for(let i=0;i<3;i++) await lab('lab7').locator('[data-act="next"]').click();
  await axeClean('agulha com bloom avaliado');

  await page.locator('#reset-progress').click();
  await page.locator('#confirm-reset').click();
  assert.equal(await page.locator('#progress-count').textContent(),'0 / '+modules.length);
  await page.reload();
  assert.equal(await page.locator('#progress-count').textContent(),'0 / '+modules.length);
  await page.goto(url+'/#escrita');
  await page.locator('.flow-panel').screenshot({path:'artifacts/write-flow.png'});

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const small=await mobile.newPage();
  await small.goto(url);
  await small.getByRole('button',{name:'Abrir trilha'}).click();
  await small.locator('#module-nav a[href="#leitura"]').click();
  await small.getByRole('heading',{name:modules.find(m=>m.id==='leitura').title,exact:true}).waitFor();
  assert.equal(await small.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
  await small.getByRole('button',{name:'Abrir trilha'}).click();
  await small.keyboard.press('Escape');
  assert.equal(await small.locator('#menu-toggle').textContent(),'Abrir trilha');
  assert.ok(await small.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await small.locator('#packet').evaluate(node=>getComputedStyle(node).display),'none');
  await small.locator('.example-block pre').focus();
  if(await small.locator('.example-block pre').evaluate(node=>node.scrollWidth>node.clientWidth)) {
    await small.keyboard.press('ArrowRight');
    await small.waitForFunction(()=>document.querySelector('.example-block pre').scrollLeft>0);
  }
  assert.equal(await small.locator('.example-block pre').getAttribute('tabindex'),'0');
  await small.screenshot({path:'artifacts/mobile.png',fullPage:true});
  const mobileAxe=await new AxeBuilder({page:small}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(mobileAxe.violations.map(v=>({id:v.id,targets:v.nodes.map(node=>node.target)})),[]);
  for(const module of modules) {
    await small.goto(url+'/#'+module.id);
    await small.getByRole('heading',{level:1,name:module.title}).waitFor();
    assert.ok(await small.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),module.id);
    const audit=await new AxeBuilder({page:small}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(node=>node.target)})),[],module.id);
  }
  await mobile.close();
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/browser-results.json',JSON.stringify({modules:modules.length,quizzes:modules.reduce((n,m)=>n+m.quiz.length,0),axeViolations:0,consoleErrors:errors,viewports:['1440x1050','390x844'],checks:['labs: player, parâmetros, ring, presets, LogQL, bloom, axe em estados intermediários','navigation','typed edges','step back/forward','keyboard SVG','quiz feedback','completion','reload','reset','widgets','playground','reduced motion']},null,2));
  console.log('OK: '+modules.length+' módulos, '+modules.reduce((n,m)=>n+m.quiz.length,0)+' perguntas, diagramas, modelos, teclado, progresso, simulação, mobile e axe sem violações.');
} finally { await browser.close(); }
