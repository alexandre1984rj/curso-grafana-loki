import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { modules } from '../src/course.js';

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
  assert.equal(await page.locator('[data-node]').count(),4);
  await page.getByRole('button',{name:'Avançar etapa'}).click();
  assert.equal(await page.locator('#step-count').textContent(),'2 / 4');
  await page.getByRole('button',{name:'Iniciar',exact:true}).click();
  await page.getByRole('button',{name:'Pausar',exact:true}).click();
  await page.locator('#flow-reset').click();
  assert.equal(await page.locator('#step-count').textContent(),'1 / 4');
  await page.locator('[data-node="2"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#step-title').textContent(),'Loki');

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
    const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),[],module.id);
  }
  assert.equal(await page.locator('#progress-count').textContent(),'10 / 10');
  await page.reload();
  assert.equal(await page.locator('#progress-count').textContent(),'10 / 10');
  await page.goto(url+'/#modelo-dados');
  const initial=await page.locator('#stream-count').textContent();
  await page.locator('#include-requests').check();
  assert.notEqual(await page.locator('#stream-count').textContent(),initial);

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

  await page.locator('#reset-progress').click();
  await page.locator('#confirm-reset').click();
  assert.equal(await page.locator('#progress-count').textContent(),'0 / 10');
  await page.reload();
  assert.equal(await page.locator('#progress-count').textContent(),'0 / 10');
  await page.goto(url+'/#leitura');
  await page.screenshot({path:'artifacts/read-path.png',fullPage:true});

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const small=await mobile.newPage();
  await small.goto(url);
  await small.getByRole('button',{name:'Abrir trilha'}).click();
  await small.locator('#module-nav a[href="#leitura"]').click();
  await small.getByRole('heading',{name:modules[4].title,exact:true}).waitFor();
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
  await writeFile('artifacts/browser-results.json',JSON.stringify({modules:modules.length,quizzes:20,axeViolations:0,consoleErrors:errors,viewports:['1440x1050','390x844'],checks:['navigation','animation','keyboard SVG','quiz feedback','completion','reload','reset','cardinality','playground','reduced motion']},null,2));
  console.log('OK: navegação, 20 perguntas, animação, teclado, progresso, simulação, mobile e axe sem violações.');
} finally { await browser.close(); }
