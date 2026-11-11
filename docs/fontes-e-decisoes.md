# Fontes, versões e decisões editoriais

## Revisão de 2026-11-11: artigo de labels (dez/2023) contra o Loki 3.7

Artigo analisado: [The concise guide to Grafana Loki: Everything you need to know about labels](https://grafana.com/blog/the-concise-guide-to-grafana-loki-everything-you-need-to-know-about-labels/), de dezembro de 2023 (Loki 2.9). Validado contra a documentação atual (`latest` = 3.7) e o código na tag `v3.7.0`. No curso, o artigo aparece sempre com o rótulo *Histórico* e cada afirmação que mudou tem uma seção "O que mudou".

| Afirmação do artigo | Situação no Loki 3.7 | Fonte da validação |
| --- | --- | --- |
| Cada combinação única de labels é um stream; menos labels é melhor; labels devem descrever infraestrutura, ter vida longa e ser intuitivos | **Continua válida**, sem mudança | `docs/sources/get-started/labels/bp-labels.md` |
| A ordem dos labels não importa | **Válida**: o distributor ordena os labels antes do hash (`TokenFor` = FNV-32 de tenant + labels canônicos) | `pkg/util/ring/ring.go` (`TokenFor`), `pkg/distributor/distributor.go`; teste em `tests/lab.test.mjs` |
| Streams são distribuídos aos ingesters por hash consistente | **Válida**: dskit `ring`, primeiro token estritamente maior que o hash, `num_tokens` 128, RF 3 | dskit `ring/util.go` (`searchToken`), `ring/ring.go`, `configuration.md` |
| Menos de 100 mil streams ativos e menos de 1 milhão em 24 h para tenants acima de 10 TB/dia | **Orientação de 2023**, não limite de software. O limite padrão continua `max_global_streams_per_user: 5000` | `configuration.md` v3.7.0 |
| Automatic stream sharding é recente | **Mudou**: `shard_streams.enabled` é `true` por padrão, `desired_rate` 1536KB; label `__stream_shard__`. Existe também time sharding (`__time_shard__`), desligado por padrão | `pkg/distributor/distributor.go`, `pkg/distributor/ratestore.go`, `operations/automatic-stream-sharding.md` |
| Structured metadata é experimental (2.9), GA no 3.0 | **Mudou**: estável e ligado por padrão (`allow_structured_metadata: true`), exige schema v13; limites de 64KB e 128 entradas por linha | `configuration.md`, `get-started/labels/structured-metadata.md` |
| Para `pod`, indexar se ficar abaixo de ~100 mil streams/hora ou usar o stage `pack` do Promtail | **Superada**: a documentação manda usar structured metadata para `pod`, `trace_id` e similares; o curso já trata o Promtail como histórico | `structured-metadata.md` |
| Bloom filters no 3.0 vão acelerar `|= "<uuid>"` em texto livre | **Mudou**: desde o 3.3 os blooms indexam **só structured metadata**; aceleram `| chave="valor"` antes de qualquer parser. `|= "abc123"` não é acelerado. Recurso experimental, não roda em single binary, voltado a mais de 75 TB/mês | `release-notes/v3-3.md`, `pkg/storage/bloom/v1/tokenizer.go`, `pkg/bloomgateway/bloomgateway.go` |
| Seletor estreito + filtro de linha é a forma de achar uma agulha | **Válida** e continua a recomendação para a maioria dos clusters | `query/` e `bp-labels.md` |

Decisões que vieram dessa validação:

- Os laboratórios usam os defaults da 3.7 (5000 streams, 1,5 MB de chunk, 30 min de idle, 2 h de idade máxima, 3 MB/s por stream com burst de 15 MB, `desired_rate` 1536KB).
- O laboratório de bloom reproduz o tokenizador de structured metadata (nome, prefixo+nome, nome=valor, prefixo+nome=valor); não simula bloom de texto livre, porque esse comportamento não existe mais.
- O subconjunto de LogQL recusa seletores em que todo matcher aceita vazio com a mensagem exata do parser.

## Revisão de 2026-11-08: o código como fonte primária

A revisão profunda usou o **código-fonte do Loki na tag [`v3.7.0`](https://github.com/grafana/loki/tree/v3.7.0)** (commit `3361de24b692875d77bd7433cd6baa7c68dc0ef9`), a mesma versão da imagem do laboratório, e o código do **Alloy na tag [`v1.11.0`](https://github.com/grafana/alloy/tree/v1.11.0)** para o cliente de envio. Nada foi tirado do branch `main`.

- Comportamento: lido nas funções citadas em cada módulo (tabela "Onde está no código", com arquivo e linha). Um script conferiu que cada símbolo citado aparece na linha indicada.
- Defaults: `docs/sources/shared/configuration.md` da mesma tag, conferidos no código quando o valor afeta o mecanismo explicado (por exemplo, `chunk_target_size`, `remote_timeout`, `query_ingesters_within`).
- Documentação: usada para intenção e nomenclatura; rotulada *Confirmado na documentação* quando não foi rastreada no código (exemplo: o WAL opcional do `loki.write`).
- O código **não foi compilado nem executado** a partir da tag. Comportamentos são derivados da leitura; os que dependem de execução estão marcados como *Inferência*.

Achados da leitura que mudaram o conteúdo:

| Achado | Onde | Efeito no curso |
| --- | --- | --- |
| Disco do WAL acima de 90% faz `Push` retornar `ErrReadOnly` | `pkg/ingester/ingester.go` | Corrige a afirmação anterior de que disco cheio não interrompia escritas |
| `service_name` é acrescentado na ingestão a partir de `app` (lista `discover_service_name`) | `pkg/loghttp/push/push.go` | O stream de E1 tem quatro labels; o token do ring usa os quatro |
| `detected_level` vai para structured metadata | `pkg/distributor/field_detection.go` | Explica por que agrupamentos sem `by` se dividem por nível (achado já visto no laboratório) |
| No filesystem, o último segmento da chave do chunk é base64 | `pkg/storage/chunk/client/object_client.go` (`FSEncoder`) | Exercícios de inspeção de `/loki/chunks` corrigidos |
| `query_ingesters_within` vale por tarefa, depois do split | `pkg/querier/intervals.go` | Explica a lacuna de dados recentes quando a janela é menor que `max_chunk_age` |
| A posição do Alloy registra o lido, não o confirmado | Alloy `tailer.go` | Explica perda de lotes em memória quando o Alloy reinicia |
| `query_range.cache_results` é `false` por padrão | `configuration.md` v3.7.0 | O laboratório não usa cache de resultados |


## Primeira versão (2026-11-07)

Data de consulta: **2026-11-07**. O repositório remoto e o diretório local estavam vazios; não havia implementação, instruções AGENTS.md, dependências ou conteúdo anterior a preservar. A escolha de HTML/CSS/JavaScript estáticos foi confirmada pelo usuário.

## Comparação crítica

| Fonte | Contribuição | Limite e decisão |
| --- | --- | --- |
| [Workshop oficial](https://github.com/grafana/loki-workshop) | Aprender pela exploração, depois LogQL, métricas e dashboard | Sua configuração Compose usa Grafana latest e serviços remotos fornecidos pelo instrutor. Criamos ambiente independente com tags explícitas e dados próprios |
| [Deep Dive](https://taisho6339.gitbook.io/grafana-loki-deep-dive) | Explicação de ingestão, execução de consultas e filas | O autor declara Loki 2.4.1, S3, BoltDB Shipper e microserviços. Não usar seus flags, defaults ou recomendações de cache como verdade atual |
| [GO, original em japonês](https://techblog.goinc.jp/entry/2023/11/17/090000) | Caso de EKS/GKE, S3 e separação de recursos de leitura e escrita | Promtail, SSD e replicação 1 pertencem ao relato de 2023. Recuperação depende de discos e cópias disponíveis; o caso não demonstra proteção contra perda de volume |

Conceito compartilhado: distinguir seleção por labels do processamento do conteúdo. Contribuições complementares: o workshop dá tarefas ao aluno; o livro organiza o raciocínio interno; o caso oferece decisões e riscos para discutir.

Divergências não são resolvidas por popularidade. Para nomenclatura e requisitos usamos a documentação oficial compatível com o laboratório; relatos históricos continuam identificados como históricos.

## O que foi lido

Workshop: página de preparação e arquivos dos laboratórios [exploração](https://github.com/grafana/loki-workshop/blob/main/docs/docs/lab1/01-explore-logs.md), [consultas e correlação](https://github.com/grafana/loki-workshop/blob/main/docs/docs/lab1/02-query-logs.md), [métricas](https://github.com/grafana/loki-workshop/blob/main/docs/docs/lab2/01-metric-queries.md), [dashboards](https://github.com/grafana/loki-workshop/blob/main/docs/docs/lab2/02-create-dashboard.md) e compose.yaml. As categorias do site não carregaram na ferramenta; os arquivos correspondentes foram obtidos do repositório oficial.

Deep Dive: introdução para identificar a versão, [Ingestion Process](https://taisho6339.gitbook.io/grafana-loki-deep-dive/ingestion-process), [Query Process](https://taisho6339.gitbook.io/grafana-loki-deep-dive/query-process), [Query scheduling](https://taisho6339.gitbook.io/grafana-loki-deep-dive/query-process/schedule-queries-to-queriers) e [Performance Improvement](https://taisho6339.gitbook.io/grafana-loki-deep-dive/performance-improvement). As páginas Cache Strategy, What is BoltDB Shipper e Query splitting não puderam ser obtidas pela ferramenta, inclusive em tentativas Markdown. Não atribuímos conteúdo não lido a elas; usamos documentação oficial de caches e TSDB como alternativa.

GO: leitura do corpo original japonês, sem depender de tradução automática de terceiros. O módulo apresenta uma síntese crítica em PT-BR, não uma tradução integral. Não houve inspeção da infraestrutura da empresa.

## Atualização técnica

| Tema | Verificação oficial | Como aparece no curso |
| --- | --- | --- |
| Coletor | [Promtail EOL em 2026-03-02](https://grafana.com/docs/loki/latest/send-data/promtail/) | Alloy no laboratório; Promtail apenas no contexto histórico |
| Índice | [TSDB recomendado desde 2.8](https://grafana.com/docs/loki/latest/operations/storage/tsdb/) e [schema](https://grafana.com/docs/loki/latest/operations/storage/schema/) | TSDB + v13; BoltDB Shipper explicado como histórico/depreciado |
| Metadados | [Requisitos e significado](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/) | Não são labels indexados; arquivo Alloy mostra extração e atribuição |
| Deploy | [Estado dos modos](https://grafana.com/docs/loki/latest/get-started/deployment-modes/) | SSD em depreciação; remoção anunciada para 4.0, sem afirmar que já foi removido |
| Helm | [Guia oficial](https://grafana.com/docs/loki/latest/setup/install/helm/) | Chart e versão do binário são decisões distintas; documentação atual remete ao chart da comunidade |
| WAL | [Garantias e exceções](https://grafana.com/docs/loki/latest/operations/storage/wal/) | Disco íntegro e disponível é condição; WAL não é backup |
| Cache | [Caches](https://grafana.com/docs/loki/latest/operations/caching/) e [TSDB](https://grafana.com/docs/loki/latest/operations/storage/tsdb/) | Não generalizar o cache de índice do BoltDB para TSDB |
| Retenção | [Compactor e exclusão](https://grafana.com/docs/loki/latest/operations/storage/retention/) | Separar remoção de referências e exclusão assíncrona |

Também corrigimos uma ambiguidade didática do workshop: count_over_time(...[5m]) conta eventos na janela de cinco minutos, não uma taxa por minuto. Referência: [agregações LogQL](https://grafana.com/docs/loki/latest/query/metric_queries/). O curso não preserva um rótulo incorreto só por estar numa fonte oficial.

## Versões adotadas

- [Loki 3.7.0](https://github.com/grafana/loki/releases/tag/v3.7.0), release consultada e disponível.
- [Alloy 1.11.0](https://github.com/grafana/alloy/releases/tag/v1.11.0).
- [Grafana 12.2.0](https://github.com/grafana/grafana/releases/tag/v12.2.0).
- Node 22.14.0-alpine para o gerador; Node >=22 para scripts locais.
- Browser tests: Playwright 1.58.2 e axe-core/playwright 4.11.1, fixados no lockfile.

Não são promessas de versões mais recentes nem de manutenção futura. Documentação latest é mutável: esta data registra a consulta, não congela seus textos. Tags de imagem são fixas por nome, sem afirmar imutabilidade binária.

## Decisões de implementação

1. Sem framework ou dependência de produção. Módulos de conteúdo são dados, interação usa APIs nativas e build apenas copia arquivos necessários.
2. Testes de navegador e acessibilidade justificam duas dependências exclusivas de desenvolvimento.
3. Diagramas originais em SVG, editáveis por dados. Cada visual tem alternativa em texto e seleção por teclado.
4. Nenhuma imagem ou GIF de terceiros reutilizado. Fonte Newsreader autohospedada com licença OFL.
5. Simulador restrito e explícito, sem eval, sem conexão a Loki e sem sintaxe silenciosamente ignorada. Agregações só em janela fixa de cinco minutos; não implementa todo LogQL nem sua execução distribuída.
6. Laboratório monolítico com volumes, apenas localhost, uma réplica e acesso simplificado. Não demonstra HA ou capacidade de produção.
7. O curso contextualiza versões 2.9.1 e 3.0.0 quando necessário, mas a nova entrega segue o pedido de revisão na documentação atual; não vende exemplos antigos como atuais.
