# Loki por dentro

Curso interativo de Grafana Loki em português brasileiro. Explicações progressivas, diagramas SVG clicáveis, animações controláveis, exercícios, quizzes com feedback e laboratório local.

Revisão de 2026-11-08: conteúdo reescrito a partir do código-fonte do Loki na tag `v3.7.0` (a mesma versão do laboratório). O diagnóstico da versão anterior e a proposta estão em [docs/diagnostico-e-reorganizacao.md](docs/diagnostico-e-reorganizacao.md). Não é um produto oficial da Grafana Labs.

## Executar o curso

Pré-requisito: **Node.js 22 ou superior**. Conhecimentos de containers e HTTP ajudam; cada módulo apresenta seus pré-requisitos e define os termos necessários.

~~~sh
npm run dev
~~~

Abra http://127.0.0.1:4173. O site não exige instalação de dependências para funcionar: usa HTML, CSS e módulos JavaScript nativos. Inicie por HTTP; abrir index.html diretamente em file:// não é suportado para módulos JavaScript.

~~~sh
npm run build
npm run preview
~~~

O build produz dist/. Publique seu conteúdo em uma hospedagem estática. URLs relativas também permitem hospedar em uma subpasta, como /curso-grafana-loki/. A autorização recebida foi para publicar o **código**; ativação de um serviço de hosting não foi feita.

## Trilha

O curso segue sempre o mesmo evento e a mesma consulta:

- **E1**: a linha JSON `payment timeout` do gerador, tenant `fake`, labels `{app="checkout", env="lab", format="json"}` (o Loki acrescenta `service_name="checkout"`).
- **Q1**: `sum by (app) (count_over_time({app="checkout", env="lab"} |= "timeout" | json | level="error" [5m]))` em 24 h.

| Módulo | Parte | Pergunta que o módulo responde | Dossiês | Modelo interativo |
| --- | --- | --- | --- | --- |
| 1. O mapa: onde está o trabalho | Mapa | Quando você escreve E1 e consulta Q1, quais partes do Loki trabalham e o que cada uma guarda? | — | simulador de ingestão até o bucket |
| 2. Streams, fingerprints e cardinalidade | Mapa | Quantos streams as suas escolhas de labels criam, e onde cada um custa memória, índice e chunks? | Stream e índice em memória do ingester | cardinalidade |
| 3. Coleta: do arquivo ao push | Mapa | Se o Loki responde 429 ou 500, E1 se perde, se repete ou espera, e por quanto tempo? | Cliente de envio (loki.write) | retries do Alloy |
| 4. Labels criam streams; cardinalidade decide o custo | Labels por dentro | Por que um único label a mais pode transformar 96 streams longos em milhares de streams de uma linha só? | — | Lab 1 (labels → streams), Lab 2 (cardinalidade A × B) |
| 5. Hash ring e stream sharding: para onde cada stream vai | Labels por dentro | Se o hash dos labels escolhe o ingester, o que acontece com um stream que sozinho recebe mais bytes do que um ingester aceita? | — | Lab 3 (hash ring), Lab 4 (`__stream_shard__`) |
| 6. Label, structured metadata ou linha: onde guardar cada campo | Labels por dentro | Um evento tem cluster, namespace, pod, trace_id e order_id. Qual deles vai para o índice, qual viaja ao lado da linha e qual fica no texto? | — | Lab 5 (classificação) |
| 7. Procurar uma agulha: LogQL e bloom filters | Labels por dentro | Como achar o trace_id abc123 em terabytes de logs sem transformar cada ID em label? | — | Lab 6 (LogQL por etapa), Lab 7 (bloom filters) |
| 8. Distributor e ring: quem recebe E1 | Siga a escrita | Quando o Alloy recebe 204, quantas cópias de E1 existem e onde? | Distributor, Ring | quorum de escrita |
| 9. Ingester e chunks: E1 dentro da memória | Siga a escrita | Em que estrutura E1 está um segundo depois do ACK, e o que decide quando ela muda? | Ingester, Chunks | corte de blocos e chunks |
| 10. WAL, checkpoint e flush: o que o ACK garante | Siga a escrita | Depois do 204, que falhas podem apagar E1? | WAL, Flush | durabilidade após o ACK |
| 11. TSDB e object storage: como achar E1 depois | Siga a escrita | Como um seletor de labels chega à chave do objeto que contém E1? | TSDB (índice), Object storage | label → token → chave |
| 12. Query frontend e scheduler: Q1 vira trabalho | Siga a consulta | Em quantas tarefas Q1 se transforma, quem limita quantas rodam ao mesmo tempo e onde elas esperam? | Query frontend, Query scheduler | plano de Q1 |
| 13. Querier, index gateway e caches: de onde vem cada linha | Siga a consulta | Para uma tarefa de Q1, quais componentes são consultados, em que ordem, e o que cada cache evita? | Querier, Index gateway, Caches | fontes da consulta |
| 14. Execução de LogQL: onde Q1 gasta CPU | Siga a consulta | Por que `\| json` numa janela de 24 h pode saturar a leitura, e o que muda o custo de verdade? | — | custo do parser |
| 15. Compactor e ruler: trabalho que não espera o usuário | Opere com critério | Quando o chunk de E1 é realmente apagado, e quem avalia Q1 como alerta a cada minuto? | Compactor, Ruler | linha do tempo da retenção |
| 16. Do laptop ao cluster: domínios de falha | Opere com critério | Quais garantias dos módulos anteriores mudam quando E1 roda num cluster de três zonas? | — | domínios de falha |
| 17. Investigue antes de aumentar | Opere com critério | Quando aumentar o paralelismo de Q1 ajuda e quando piora? | — | gargalo e paralelismo |
| 18. Uma decisão tem contexto | Conecte as decisões | Quais escolhas de um caso real continuam válidas à luz do mecanismo, e quais dependem de riscos aceitos? | — | — |

Cada módulo tem quatro camadas (**intuição → mecanismo interno → implementação → operação**), e cada seção é rotulada pela natureza da evidência: *Confirmado no código* (com arquivo e linha na tag usada pelo laboratório), *Confirmado na documentação*, *Simplificação didática*, *Inferência*, *Recomendação operacional*, *Fonte histórica* ou *Não verificado*.

Cada componente pedido (distributor, ingester, query frontend, query scheduler, querier, index gateway, compactor, ruler, ring, WAL, chunks, TSDB, caches e object storage) tem um dossiê com dez itens: problema, dados recebidos/mantidos/produzidos, funcionamento passo a passo, estruturas e concorrência, comunicação, parâmetros (YAML completo, unidade, default verificado em 3.7.0 e efeito), garantias e quando deixam de valer, falhas (sintoma, como observar, como investigar), exemplo de ponta a ponta e exercício com resposta explicada.

A conclusão de um módulo depende de acertar todas as perguntas dele, mas a navegação é livre. O progresso fica apenas no localStorage deste navegador, sem conta ou envio ao servidor. Conclusões salvas pela versão anterior são preservadas; respostas de questionários que mudaram são descartadas (campo `quizVersion`), para que uma resposta antiga não seja aplicada a uma pergunta nova. O botão de reinício pede confirmação.

## Interações

- Diagramas com **quatro tipos de seta**: dados, controle, confirmação (ACK) e falha, com legenda, etapas narradas (avançar, voltar, reproduzir) e alternativa em texto. Componentes selecionáveis por mouse ou teclado; movimento reduzido respeitado.
- Doze modelos interativos, cada um com a pergunta que responde e um bloco de **premissas e limites**. As regras ficam em `src/sims.js` e têm testes próprios; nenhum deles mede desempenho real.
- Bancada LogQL com seis eventos fixos e cinco exercícios guiados.
- Tabelas "Onde está no código" com links para a tag `v3.7.0` do Loki (e `v1.11.0` do Alloy).

**A bancada é uma simulação**, sem conexão a Loki. Implementa um subconjunto explícito: seletores com igualdade, filtros literais, JSON plano, logfmt simples, filtros de campo e duas agregações em uma janela fixa de cinco minutos. Rejeita funcionalidades não suportadas. Execute consultas completas no laboratório real.

## Laboratórios de objetos (parte "Labels por dentro")

Oito simulações em que logs aparecem como documentos, labels como etiquetas, streams como grupos, chunks como blocos, ingesters como unidades, o hash ring como anel de tokens e o object storage como bucket. Todas compartilham a mesma moldura: controles de parâmetro, palco, métricas ao vivo, inspetor lateral (clique ou Enter num objeto), narração, player (reproduzir/pausar, avançar, voltar, reiniciar, velocidade e linha do tempo) e um bloco de **premissas, regras e limites**.

- **Ingestão até o bucket** (módulo 1): distributor → ingester (chunk aberto por stream) → bucket + índice; RF, tamanho do chunk e um label extra (`pod` ou `request_id`).
- **Lab 1**: ligar e desligar chaves de label e inserir eventos; a ordem das chaves não muda o stream.
- **Lab 2**: cenário A (labels de baixa cardinalidade) contra B (com `pod`, `trace_id`, `order_id`); streams, streams ativos contra `max_global_streams_per_user`, chunks, tamanho médio de chunk e rejeições.
- **Lab 3**: hash ring com `TokenFor` (FNV-32), busca do primeiro token maior, réplicas distintas, adicionar/remover ingesters e ver quais streams mudam de dono.
- **Lab 4**: stream sharding automático, `calculateShards`, atraso do rate store e `__stream_shard__`; com o sharding desligado, 429 depois do burst.
- **Lab 5**: arrastar ou escolher, campo a campo, entre label, structured metadata e linha.
- **Lab 6**: LogQL executado etapa por etapa, com descarte, `__error__`, `_extracted` e recusa de seletores que aceitam vazio.
- **Lab 7**: bloom filters por stream: pular com segurança, verificar obrigatoriamente, falso positivo e ausência de falso negativo.

As regras ficam em `src/lab/engine.js`, sem DOM, e têm testes em `tests/lab.test.mjs`. Mesmos parâmetros produzem sempre os mesmos frames. Nenhuma simulação mede desempenho real.

O tema padrão é escuro; o botão no topo alterna para o claro e a escolha fica no localStorage.

## Laboratório real

O [roteiro completo](labs/local/README.md) explica início, ingestão, consultas, erros comuns, recuperação e encerramento.

~~~sh
cd labs/local
docker compose config --quiet
docker compose up -d
node verify.mjs
~~~

Versões fixas: **Loki 3.7.0**, **Alloy 1.11.0**, **Grafana 12.2.0** e **Node 22.14.0-alpine** no gerador. Loki usa TSDB e schema v13. A datasource do Grafana já está provisionada.

Os serviços são vinculados a localhost; há uma única réplica, filesystem e acesso simplificado. **Essa configuração não é uma implantação de produção.** O roteiro identifica as diferenças.

## Fontes e versões

Revisão editorial: **8 de novembro de 2026**. Fonte primária para comportamento: o **código do Loki na tag [`v3.7.0`](https://github.com/grafana/loki/tree/v3.7.0)** (commit `3361de24b692875d77bd7433cd6baa7c68dc0ef9`) e, para o coletor, o código do Alloy na tag [`v1.11.0`](https://github.com/grafana/alloy/tree/v1.11.0). Nenhuma afirmação sobre comportamento foi tirada do branch `main`. Defaults vêm de `docs/sources/shared/configuration.md` da mesma tag e, quando relevante, do código que os registra.

- [Workshop oficial](https://github.com/grafana/loki-workshop), incluindo seus laboratórios de exploração, LogQL, métricas e dashboards.
- [Grafana Loki Deep Dive](https://taisho6339.gitbook.io/grafana-loki-deep-dive), contextualizado em Loki 2.4.1.
- [Artigo original japonês da GO, de 2023](https://techblog.goinc.jp/entry/2023/11/17/090000), tratado como caso histórico.
- [Documentação oficial atual](https://grafana.com/docs/loki/latest/), para revisão das recomendações.

A [análise crítica das fontes](docs/fontes-e-decisoes.md) registra contribuições, divergências, limitações de acesso, versões e decisões. Promtail é apresentado como histórico, TSDB como índice recomendado e Simple Scalable com seu estado de depreciação. O pedido de implementação atual amplia o escopo da conversa anterior, que estudava 2.9.1 e 3.0.0; exemplos antigos não são aplicados silenciosamente ao laboratório novo.

## Verificar o projeto

Testes de lógica e conteúdo e build não precisam de dependências:

~~~sh
npm test
npm run build
~~~

Os únicos pacotes de desenvolvimento são Playwright e axe para testes de navegador e acessibilidade; nenhum pacote é servido ao aluno.

~~~sh
npm ci
npx playwright install chromium
npm run dev
# Em outro terminal:
npm run test:browser
~~~

Para usar um Chromium já instalado, defina CHROMIUM_PATH com o caminho do executável. COURSE_URL permite testar uma hospedagem ou subpasta diferente. Os testes verificam os 18 módulos, todas as perguntas, diagramas, modelos interativos, teclado, progresso após reload, reinício, simulação, mobile e regras automatizadas WCAG A/AA. Eles não substituem uma avaliação completa com tecnologia assistiva.

A CI executa testes, build, navegador e laboratório real, preservando resultados em artifacts. Consulte [VALIDACAO.md](docs/VALIDACAO.md) para o que foi efetivamente executado nesta entrega.

## Estrutura

~~~text
src/modules/        Conteúdo dos 18 módulos (mapa, labels, escrita, leitura, operação) e vocabulário de evidência
src/course.js       Agrega os módulos, versões e E1/Q1
src/sims.js         Modelos didáticos testáveis (quorum, chunks, durabilidade, plano de consulta…)
src/widgets.js      Interface dos modelos interativos
src/lab/engine.js   Modelos puros dos laboratórios (streams, ring, sharding, cardinalidade, LogQL, bloom, ingestão)
src/lab/stage.js    Componentes de apresentação reutilizáveis (moldura, player, FLIP, inspetor, chips)
src/lab/labs.js     Os oito laboratórios: markup e montagem sobre frames pré-calculados
src/flows.js        Diagramas: nós, arestas tipadas e etapas narradas
src/app.js          Renderização, navegação, quizzes e progresso
src/simulator.js    Subconjunto didático de LogQL
src/progress.js     Persistência local com versão de questionário
src/style.css       Interface responsiva e movimento reduzido
public/             Ícone original e fonte com licença
labs/local/         Compose, configurações, gerador e verificação real
docs/               Diagnóstico, fontes, projeto final e evidências de validação
scripts/            Servidor HTTP e build com biblioteca padrão do Node
tests/              Testes de lógica, conteúdo e navegador
~~~

## Atribuição

Conteúdo e diagramas foram escritos para este curso, sem copiar imagens dos artigos. As referências permanecem nos módulos. O workshop usa Apache-2.0; sua licença não é presumida para as demais fontes. Não há redistribuição de screenshots ou tradução integral do artigo japonês. A fonte Newsreader é distribuída sob SIL Open Font License; sua licença acompanha o arquivo em public/fonts/OFL.txt.
