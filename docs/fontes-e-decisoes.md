# Fontes, versões e decisões editoriais

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
