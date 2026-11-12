# Validação da entrega

## Revisão de 2026-11-11 (laboratórios de objetos e parte "Labels por dentro")

Execução em ambiente Linux na nuvem, Node 22, Chromium pré-instalado com Playwright 1.58.2 e axe-core/playwright. Sem Docker neste ambiente; o laboratório real não foi reexecutado (nada nele mudou).

| Verificação | Resultado observado |
| --- | --- |
| `npm test` | 32 testes passaram. Os 10 novos (`tests/lab.test.mjs`) cobrem: identidade canônica do stream e `TokenFor`; `searchToken` (empate avança, volta ao início) e réplicas distintas; hash consistente (ao entrar um ingester, só ele recebe streams que mudaram de dono, com 1, 4 e 16 tokens); `calculateShards` e atraso do rate store; cardinalidade A × B, teto de streams e determinismo; classificação label/SM/linha (600 streams/dia na recomendação); LogQL (etapas, SM, `_extracted`, `__error__`, recusa de seletores que aceitam vazio); bloom sem falso negativo em 60 combinações de m, k e IDs por chunk; ingestão (chunks nunca passam do tamanho configurado, índice acompanha o bucket, RF 3 triplica objetos); todos os laboratórios têm markup e mount |
| `npm run build` | `dist/` gerado, incluindo `src/lab/` |
| `tests/browser.mjs` (desktop 1440 × 1050) | 18 módulos e 52 perguntas (erro e acerto), conclusão e reload; laboratórios: player (avançar, voltar, reproduzir, pausar, reiniciar), lab 2 muda indicadores ao alternar `trace_id`, inspetor por teclado, lab 3 adiciona e remove ingester, lab 4 com sharding desligado, lab 5 presets (600 streams/dia), lab 6 com linhas descartadas e erro de seletor vazio, lab 7 com m = 256 |
| Acessibilidade automatizada | axe (WCAG 2 A/AA e 2.1 AA): zero violações nos 18 módulos no tema escuro (desktop e 390 px) e no tema claro, e em estados intermediários dos laboratórios |
| Mobile (390 × 844, movimento reduzido) | Sem rolagem horizontal nos 18 módulos |
| Erros de console | Nenhum |
| Inspeção visual | Capturas de todos os laboratórios em 1440 px e 390 px examinadas |

Não executado: leitor de tela real; teste em Safari/Firefox; laboratório Docker (inalterado).

## Revisão de 2026-11-08 (conteúdo a partir do código v3.7.0)

Execução em ambiente Linux na nuvem, Node 22, Chromium pré-instalado com Playwright 1.58.2 e axe-core/playwright 4.11.1. Sem Docker neste ambiente.

### Executado e aprovado

| Verificação | Resultado observado |
| --- | --- |
| Testes de lógica e conteúdo (`npm test`) | 22 testes passaram: estrutura dos 14 módulos (pergunta, quatro camadas, rótulo de evidência, referências ao código, dossiês com 10 itens para os 14 componentes), simulador LogQL, progresso e migração por `quizVersion`, diagramas com arestas tipadas e etapas válidas, e os modelos de `src/sims.js` (quorum, chunks, durabilidade, plano de consulta, gargalo, retenção, parsing, retries do Alloy, FNV-1 32 do `TokenFor` com vetores conhecidos, fontes da consulta e domínios de falha) |
| Citações de código | Script auxiliar conferiu, para cada referência `arquivo:linha`, que o arquivo existe na tag v3.7.0 (ou Alloy v1.11.0) e que o símbolo citado aparece na linha. Três avisos foram falsos positivos (nome do símbolo com grafia diferente na linha) |
| Build (`npm run build`) | `dist/` gerado |
| Navegador desktop (1440 × 1050) | 14 módulos e 37 perguntas exercitados (erro e acerto); conclusão; contagem 14/14 após reload; reinício; diagrama com etapas para frente e para trás e teclado; quorum, chunk, durabilidade, chave do objeto, plano de consulta e cardinalidade interagidos; cada modelo mostrou resultado; bancada LogQL |
| Navegador mobile (390 × 844, movimento reduzido) | Menu, Escape, ausência de rolagem horizontal da página nos 14 módulos, pacote animado oculto |
| Acessibilidade automatizada | axe (WCAG 2 A/AA e 2.1 AA): zero violações nos 14 módulos em desktop e em mobile |
| Erros de console | Nenhum |
| Inspeção visual | Capturas dos diagramas de escrita, leitura e visão geral e de três modelos examinadas; sobreposições de rótulos corrigidas |

### Não executado nesta revisão

- **Laboratório real na nuvem:** não havia Docker no ambiente; o laboratório foi executado depois no Windows do usuário (subseção abaixo). Os novos comandos do roteiro (ring, métricas, index/stats, `/flush`, listagem de `/loki/wal`, `/loki/tsdb-index` e `/loki/chunks`, push com timestamp antigo) foram conferidos contra o código e a configuração do laboratório, não executados.
- **Código do Loki:** lido, não compilado nem executado. Comportamentos são derivados da leitura.
- **Modelos interativos:** reproduzem regras do código com premissas declaradas; números de vazão, memória e compressão são hipóteses, não medições.
- axe não substitui avaliação com leitor de tela.

### Laboratório executado no Windows do usuário

Executado em 2026-11-09 (UTC): Windows 11 Pro, Docker Desktop, Git Bash, Node 22.22.1. Imagens: `grafana/loki:3.7.0`, `grafana/alloy:v1.11.0`, `grafana/grafana:12.2.0`, `node:22.14.0-alpine`. O volume `loki-curso_loki-data` já existia com dados de 2026-11-07 (o projeto Compose tinha sido apagado, mas os volumes ficaram), então esta não foi uma subida com o disco vazio.

| Verificação | Resultado observado |
| --- | --- |
| `docker compose config --quiet`, `up -d`, `ps` | Passou: 4 serviços `Up` (loki, alloy, grafana, generator), portas em 127.0.0.1 |
| `node verify.mjs` | Passou |
| `node verify-restart.mjs`, depois `node verify.mjs` | Passou nas duas: o mesmo timestamp e a mesma linha foram recuperados depois do reinício |
| `/ring` | Uma instância `ACTIVE`; `?tokens=true` mostrou 128 tokens |
| Métricas de escrita | `loki_distributor_bytes_received_total` = 9582, `loki_ingester_memory_streams` = 2, `loki_ingester_wal_records_logged_total` = 17. `loki_ingester_chunks_flushed_total` **não aparece** antes do primeiro flush, porque a série só passa a existir no primeiro incremento |
| `index/stats` com `{app="checkout", env="lab"}` | `{"streams":4,"chunks":4,"bytes":38912,"entries":286}` |
| `/labels` | `app, env, filename, format, service_name`: `service_name` aparece |
| `docker compose exec loki ls ...` | **Falhou**: `exec: "ls": executable file not found in $PATH` (e o mesmo erro para `sh`). A imagem `grafana/loki:3.7.0` não tem shell. A listagem foi feita com `docker run --rm -v loki-curso_loki-data:/loki:ro node:22.14.0-alpine ls ...`: `/loki/wal` com segmentos `00000370` a `00000373` e `checkpoint.000369`; `/loki/tsdb-index` com `multitenant`, `per_tenant`, `scratch`, `uploader` e `wal`; `/loki/chunks` com `fake` (2 fingerprints) e `index` (`delete_requests`, `index_20765`, `index_20766`) |
| `POST /flush` | HTTP 204; em seguida `loki_ingester_chunks_flushed_total{reason="forced"} 2`, e um arquivo novo apareceu em cada fingerprint |
| Nome do arquivo de chunk | Confirmado como base64 de `from:through:checksum`: `MWExYmQ5YzUyYjM6MWExYmRkMTlhYmQ6MzA4NDY3NDE=` vira `1a1bd9c52b3:1a1bdd19abd:30846741`. `from` e `through` são milissegundos Unix em hexadecimal (2026-11-09 00:01:41 e 00:59:52 UTC); o checksum também está em hexadecimal |
| Push com timestamp de 14 dias | HTTP 400: `timestamp too old ... oldest acceptable timestamp is: 2026-11-02T01:00:37Z`; `loki_discarded_samples_total{reason="greater_than_max_sample_age"} 1`. A mensagem mostra o stream com `service_name="checkout"` acrescentado pelo distributor |
| Retries do Alloy (Loki parado 30 s) | `loki_write_batch_retries_total` foi de 2 para 7; `loki_write_dropped_entries_total` ficou em 0 para todas as razões; `loki_write_sent_entries_total` foi de 380 para 532. Os 2 retries iniciais vieram do reinício feito por `verify-restart.mjs` |
| `npm ci`, `npm test` | 22 testes passaram, 0 vulnerabilidades |

Divergências encontradas com `labs/local/README.md`, já corrigidas no roteiro: os comandos `docker compose exec loki ls ...` e `docker compose exec loki sh -c ...` não funcionam com essa imagem (o roteiro agora monta o volume num container `node:22.14.0-alpine` somente leitura), e `loki_ingester_chunks_flushed_total` só aparece no grep depois do primeiro flush (o roteiro agora avisa).

## Primeira versão (2026-11-07)

Data: **2026-11-07**. Execução local em Windows, com containers Linux no Docker Desktop.

## Executado e aprovado

| Verificação | Resultado observado |
| --- | --- |
| Testes de lógica e conteúdo | 10 testes passaram: trilha, simulador, rejeição de sintaxe, unidades, cardinalidade, persistência, diagramas e gerador |
| Build estático | npm run build produziu dist/ |
| Navegador desktop | Chromium, 1440 × 1050; dez módulos e vinte perguntas exercitados |
| Navegador mobile | Chromium, 390 × 844; navegação, ausência de overflow da página, teclado e movimento reduzido |
| Quizzes | Alternativas erradas e corretas produziram feedback; conclusão e navegação funcionaram |
| Progresso | Conclusões e respostas preservadas após reload; reinício confirmado e persistido |
| Simulação LogQL | Cinco consultas guiadas aprovadas; sintaxe fora do subconjunto rejeitada |
| Acessibilidade automatizada | axe com regras WCAG A/AA e 2.1 AA: zero violações nos dez módulos desktop e nos dez módulos mobile |
| Inspeção visual | Capturas desktop/mobile examinadas; correções de botões e conectores aplicadas |
| Revisão independente | Três achados estáticos corrigidos: continuidade de percursos, rótulos de arestas e botão após Escape |
| Docker Compose | docker compose config --quiet passou; quatro serviços iniciaram |
| Ingestão real | Alloy enviou JSON e logfmt; erros foram consultados por parsing no Loki |
| Consultas métricas reais | Contagem positiva e média agrupada verificadas |
| Metadados reais | request_id filtrado sem parser JSON |
| Grafana | /api/health informou database=ok e versão 12.2.0; datasource respondeu Data source successfully connected |
| Recuperação | verify-restart.mjs reencontrou exatamente o timestamp e a linha capturados antes do reinício do Loki, preservando volumes |

O teste real revelou que detected_level separava a média em duas séries. O exemplo foi corrigido com agrupamento explícito por app, env e format. Não se declarou correto o resultado anterior.

As capturas e os resultados brutos locais ficam em artifacts/, ignorado pelo Git. A CI preserva seus próprios artifacts quando executada no GitHub. Não incluímos imagens geradas, dependências ou volumes de laboratório no commit.

## Limites

- axe não substitui revisão completa com leitor de tela e usuários.
- A verificação visual cobriu desktop e celular; não é uma matriz de todos os navegadores e dispositivos.
- O detector auxiliar de design funcionou em modo reduzido, sem seus parsers opcionais; sua ausência de achados não foi usada como prova de contraste. A auditoria executada no navegador é registrada acima.
- O laboratório é monolítico, sem autenticação Loki e com acesso administrativo anônimo no Grafana, vinculado a localhost. Não é produção.
- Não foram medidos throughput, desempenho de queries de 24 h, custos, HA, múltiplas zonas ou object storage S3/GCS.
- O reinício preservou volumes. Não simulou perda de disco e não prova ausência de perda em outros cenários.
- Retenção de 24 h foi configurada; não esperamos um dia para comprovar exclusão física. O processo é assíncrono.
- As limitações de acesso às fontes históricas estão em fontes-e-decisoes.md.
- A execução local da CI não implica que o GitHub já tenha executado o workflow. O resultado remoto deve ser consultado nos checks do commit.

## Ambiente de CI

A primeira execução remota confirmou testes de lógica e build. O runner ubuntu-latest selecionou Ubuntu 26.04, incompatível com a versão fixada do Playwright. O workflow foi corrigido para ubuntu-24.04 nos dois jobs; o resultado da nova execução deve ser conferido nos checks do commit.

Na execução seguinte, o laboratório real passou no GitHub. O Chromium Linux detectou que blocos de código com rolagem no celular precisavam de foco explícito. Os blocos receberam tabindex, nome acessível e foco visível; o teste passou a exercitar rolagem com ArrowRight quando existe overflow. A regra axe permaneceu habilitada.

A auditoria local ampliada aos dez módulos em mobile também passou, mantendo zero violações nas regras axe verificadas e sem erros de console. A execução remota posterior cobre essa mesma suíte.
