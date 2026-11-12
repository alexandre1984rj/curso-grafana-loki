import { K, s, c, p, f, q, ref } from './helpers.js';

export const leitura = [
  {
    id: 'leitura',
    quizVersion: 2,
    title: 'Query frontend e scheduler: Q1 vira trabalho',
    short: 'Frontend e scheduler',
    duration: '50 min',
    part: 'Siga a consulta',
    question: 'Em quantas tarefas Q1 se transforma, quem limita quantas rodam ao mesmo tempo e onde elas esperam?',
    summary: 'Siga Q1 pela cadeia de middlewares: limites, divisão por tempo, cache de resultados, shards calculados pelo índice, semáforo de paralelismo e filas justas por tenant.',
    prereqs: 'Módulos 8 a 11. Middleware: função que envolve outra e pode alterar, dividir ou recusar uma requisição. Semáforo: contador que limita quantas operações acontecem ao mesmo tempo.',
    objectives: [
      'Calcular splits e shards para uma consulta métrica a partir de split_queries_by_interval e tsdb_max_bytes_per_shard.',
      'Separar o limite por consulta (tsdb_max_query_parallelism) do limite global (queriers × max_concurrent).',
      'Explicar por que consultas de log com limit podem terminar cedo e métricas não.',
      'Diagnosticar "too many outstanding requests" e tempo de fila alto.'
    ],
    trace: 'Q1 cobre 24 h. O frontend valida limites, consulta estatísticas do índice para estimar bytes, divide em 24 intervalos de 1 h e, para cada um, escolhe um fator de shard potência de 2. Se o checkout produz 20 GB/h, cada hora vira 64 shards (20 480 MB / 600 MB = 34,1 → 64): 1 536 tarefas. No máximo 128 delas ficam em voo para esta consulta; o resto espera no semáforo do frontend.',
    sections: [
      s('intuicao', K.inf, 'Dividir é fácil; o difícil é o que vem depois', 'O frontend transforma uma consulta grande em muitas pequenas e as distribui. Isso reduz latência quando há queriers ociosos. Mas o total de bytes a ler e interpretar não diminui: ele só é espalhado. Se todos os queriers já estão ocupados, dividir mais apenas alonga a fila.'),
      s('mecanismo', K.code, 'A cadeia para consultas métricas', '`NewMetricTripperware` monta, nesta ordem: métricas de consulta, coleta de estatísticas, `NewLimitsMiddleware` (intervalo máximo, lookback), `NewQuerySizeLimiterMiddleware` (recusa se os bytes estimados excedem `max_query_bytes_read`), `SplitByIntervalMiddleware`, cache de resultados (se `cache_results`), `NewQueryShardMiddleware` (se `parallelise_shardable_queries`) e retry. Tudo isso é envolvido por `NewLimitedRoundTripper`, que cria um semáforo com o paralelismo do tenant.'),
      s('mecanismo', K.code, 'Quantos shards', '`dynamicShardResolver.Shards` soma os bytes que o índice estima para os matchers no intervalo e chama `GuessShardFactor`: divide por `tsdb_max_bytes_per_shard` (600 MB) e arredonda para a próxima potência de 2. Fator 1 vira 0 (sem shard). Só operações listadas em `shardableOps` são candidatas: `sum`, `count`, `max`, `min`, `avg` (remapeado para sum/count) e range aggregations como `count_over_time`, `rate`, `bytes_over_time`, `sum_over_time`, `quantile_over_time`. Ser candidata não basta: cada expressão verifica `Shardable()`; uma parte não shardável impede o shard naquele nível.'),
      s('mecanismo', K.code, 'Quantas em paralelo', '`WeightedParallelism` usa `tsdb_max_query_parallelism` (128) para períodos TSDB e `max_query_parallelism` (32) para os demais, ponderados pela duração. `limitedRoundTripper.Do` adquire o semáforo para cada subrequisição. As subrequisições entram na fila (frontend v1 ou scheduler) e só executam quando algum worker de querier está livre: cada querier tem `max_concurrent` (4) workers.'),
      s('mecanismo', K.code, 'A fila', '`RequestQueue.Enqueue` incrementa o contador do tenant e recusa com `ErrTooManyRequests` acima de `max_outstanding_requests_per_tenant` (32 000 no scheduler; 2 048 no frontend v1). Workers retiram com `Dequeue`, que percorre os tenants em rodízio: um tenant com muitas tarefas não impede outros de serem atendidos. Com `max_queriers_per_tenant`, cada tenant usa só um subconjunto de queriers (shuffle sharding).'),
      s('implementacao', K.inf, 'Frontend v1, v2 e o laboratório', '`InitFrontend` usa o frontend v2 (com scheduler) quando `frontend.scheduler_address` está definido ou o ring de schedulers está em uso; caso contrário, v1, com fila própria. No laboratório (target all, sem esses ajustes) a inferência é que a fila em uso é a do frontend v1, e os workers do querier se conectam ao próprio processo.'),
      s('operacao', K.op, 'Consultas de log terminam cedo', 'Para consultas de log com `limit`, `splitByInterval.Process` envia os intervalos em ordem e para quando o limite é atingido. Uma busca por "timeout" com limit 1000 em 24 h pode terminar após a primeira hora se houver muitas linhas. Uma métrica como Q1 precisa de todas as horas.')
    ],
    code: [
      c('pkg/querier/queryrange/roundtrip.go', 984, 'NewMetricTripperware', 'Ordem dos middlewares: limites → tamanho → split → cache → shard → retry.'),
      c('pkg/querier/queryrange/roundtrip.go', 661, 'NewLogFilterTripperware', 'Cadeia equivalente para consultas de log.'),
      c('pkg/querier/queryrange/split_by_interval.go', 60, 'SplitByIntervalMiddleware', 'Divide por split_queries_by_interval e para cedo quando o limit é atingido.'),
      c('pkg/querier/queryrange/shard_resolver.go', 184, 'dynamicShardResolver.Shards', 'Bytes estimados pelo índice → fator de shard.'),
      c('pkg/storage/stores/shipper/indexshipper/tsdb/sharding/power.go', 77, 'GuessShardFactor', 'Próxima potência de 2 de bytes/maxBytesPerShard.'),
      c('pkg/querier/queryrange/limits.go', 638, 'WeightedParallelism', 'tsdb_max_query_parallelism para períodos TSDB.'),
      c('pkg/querier/queryrange/limits.go', 575, 'limitedRoundTripper.Do', 'Semáforo por consulta.'),
      c('pkg/queue/queue.go', 88, 'RequestQueue.Enqueue', 'Limite de pendências por tenant e ErrTooManyRequests.'),
      c('pkg/queue/tenant_queues.go', 333, 'shuffleConsumersForTenants', 'Subconjunto de queriers por tenant.'),
      c('pkg/querier/worker/worker.go', 263, 'querierWorker.resetConcurrency', 'max_concurrent dividido entre frontends/schedulers conectados.')
    ],
    dossiers: [
      {
        name: 'Query frontend',
        problem: 'Proteger os queriers de consultas grandes, dividir o trabalho para reduzir latência, reaproveitar resultados e garantir justiça entre tenants.',
        data: { input: 'Requisições HTTP de consulta (query, query_range, labels, series, volume, stats).', state: 'Cache de resultados (se ligado), estatísticas de consultas em andamento; no v1, a fila.', output: 'Subrequisições para a fila; resposta final mesclada.' },
        steps: ['Valida limites do tenant.', 'Estima bytes via índice e recusa se exceder o máximo configurado.', 'Divide em intervalos.', 'Para cada intervalo: busca no cache de resultados; para o que falta, decide shards.', 'Enfileira subrequisições respeitando o semáforo.', 'Mescla as respostas: soma vetores parciais (shards), concatena intervalos, ordena streams.', 'Grava no cache o que for elegível (não grava o intervalo mais recente que `max_cache_freshness_per_query`, 10 min).'],
        structures: 'Middlewares encadeados; semáforo ponderado; extents de cache por chave (tenant, consulta, step, intervalo alinhado).',
        communication: 'Cliente HTTP → frontend. Frontend → scheduler (v2) ou fila interna (v1). Frontend → índice (via querier/index gateway) para estatísticas e shards.',
        params: [
          p('limits_config.split_queries_by_interval', 'duração', '1h', 'Menor: mais subconsultas, mais paralelismo e mais overhead; também define as chaves do cache.'),
          p('limits_config.tsdb_max_query_parallelism', 'subconsultas simultâneas por consulta', '128', 'Maior: menos espera no semáforo; mais pressão por consulta sobre a fila.'),
          p('limits_config.max_query_parallelism', 'subconsultas', '32', 'Usado para períodos não TSDB.'),
          p('limits_config.tsdb_max_bytes_per_shard', 'bytes', '600MB', 'Menor: mais shards por intervalo.'),
          p('limits_config.tsdb_sharding_strategy', 'enum', 'power_of_two', 'Estratégia de cálculo dos shards.'),
          p('query_range.parallelise_shardable_queries', 'bool', 'true', 'false desliga shards.'),
          p('query_range.cache_results', 'bool', 'false', 'true liga o cache de resultados; sem backend configurado, usa embedded cache (100 MB, TTL 1 h).'),
          p('limits_config.max_cache_freshness_per_query', 'duração', '10m', 'Resultados mais recentes que isso não vão ao cache.'),
          p('limits_config.max_query_bytes_read', 'bytes', '0B (sem limite)', 'Recusa consultas cuja estimativa passa do valor.'),
          p('limits_config.query_timeout', 'duração', '1m', 'Tempo máximo por consulta.'),
          p('frontend.max_outstanding_per_tenant', 'requisições', '2048', 'Fila do frontend v1.'),
          p('query_range.max_retries', 'tentativas', '5', 'Retries de subrequisições.')
        ],
        guarantees: ['Uma consulta métrica shardada produz o mesmo resultado que a não shardada, para as operações reescritas (sum de parciais, etc.).'],
        breaks: ['Agregações aproximadas (`approx_topk`) e operações não shardáveis seguem regras próprias.', 'Cache ligado com dados que chegam atrasados: o intervalo recente não é cacheado por max_cache_freshness_per_query; dados muito atrasados podem ficar fora de um resultado cacheado.'],
        failures: [
          f('Consultas recusadas com 429 "too many outstanding requests"', 'Métricas `*_discarded_requests_total` e `*_queue_length` por tenant', 'Uma consulta gerou milhares de subrequisições; reduza janela, aumente split ou limite paralelismo.'),
          f('Consulta lenta com queriers ociosos', 'Tempo no semáforo nos logs de estatísticas', 'tsdb_max_query_parallelism baixo para o tenant.')
        ],
        example: 'Q1 em 24 h com 20 GB/h: 24 splits × 64 shards = 1 536 subrequisições, até 128 em voo. Com 4 queriers × 4 workers = 16 slots, só 16 executam por vez; 112 esperam na fila; o restante, no semáforo.',
        exercise: { task: 'Você muda split_queries_by_interval de 1h para 30m em Q1 (20 GB/h). O número de tarefas muda?', answer: 'Splits dobram (48), mas cada um tem 10 GB → 17,1 → 32 shards: 48 × 32 = 1 536. O total é igual porque o shard compensa; o que muda é o cache (chaves por 30 min) e o overhead por split.' }
      },
      {
        name: 'Query scheduler',
        problem: 'Tirar a fila do frontend para que frontends e queriers escalem de forma independente e a fila não fique presa a uma réplica do frontend.',
        data: { input: 'Subrequisições dos frontends v2.', state: 'Fila hierárquica por tenant (até `max_queue_hierarchy_levels` = 3), conexões de frontends e queriers.', output: 'Tarefas entregues a queriers; o resultado volta do querier direto ao frontend.' },
        steps: ['Frontend v2 envia a subrequisição ao scheduler (escolhido por DNS ou pelo ring).', 'Enqueue no tenant; recusa acima do limite.', 'Workers de querier mantêm streams gRPC abertos e pedem a próxima tarefa.', 'Dequeue em rodízio entre tenants.', 'O querier executa e envia o resultado ao frontend de origem.'],
        structures: 'Árvore de filas (tenant → subfila); mutex + variável de condição; shuffle sharding de consumidores por tenant.',
        communication: 'Frontend → scheduler (gRPC); querier → scheduler (pull, gRPC); querier → frontend (resultado).',
        params: [
          p('query_scheduler.max_outstanding_requests_per_tenant', 'requisições', '32000', 'Teto de pendências por tenant.'),
          p('query_scheduler.use_scheduler_ring', 'bool', 'false', 'Descoberta dos schedulers pelo ring em vez de DNS.'),
          p('frontend.scheduler_address', 'endereço', '""', 'Habilita o frontend v2.'),
          p('frontend.scheduler_worker_concurrency', 'conexões', '5', 'Conexões do frontend com cada scheduler.'),
          p('limits_config.max_queriers_per_tenant', 'queriers', '0 (todos)', 'Isola tenants em subconjuntos de queriers.'),
          p('querier.max_concurrent', 'workers por querier', '4', 'Slots de execução de cada querier.')
        ],
        guarantees: ['Justiça por tenant no dequeue, não por consulta: duas consultas do mesmo tenant competem na mesma fila.'],
        breaks: ['Um tenant com max_queriers_per_tenant pequeno pode esperar mesmo com outros queriers livres.', 'Um scheduler reiniciado perde a fila em memória; frontends reenviam conforme retry.'],
        failures: [
          f('Tempo de fila alto para um só tenant', 'Histograma de duração em fila do scheduler por tenant', 'Uma consulta gigante; shuffle sharding pequeno; limite de paralelismo alto demais.')
        ],
        example: 'Num cluster com scheduler, as 128 subrequisições em voo de Q1 ficam na fila do tenant; 16 slots consomem em rodízio com outros tenants.',
        exercise: { task: 'Por que aumentar tsdb_max_query_parallelism de 128 para 1024 pode piorar a experiência de outros usuários do mesmo tenant?', answer: 'A fila é por tenant. Uma consulta com 1024 tarefas pendentes ocupa a fila do tenant; outras consultas do mesmo tenant entram atrás. O rodízio é entre tenants, não entre consultas.' }
      }
    ],
    widget: 'queryplan',
    flow: 'read',
    example: {
      language: 'Cálculo • Q1 com premissas',
      code: 'janela      = 24h\nsplit       = 1h        → 24 intervalos\nbytes/h     = 20 GB     → 20 480 MB por intervalo\nshard       = 2^ceil(log2(20480/600)) = 2^6 = 64\ntarefas     = 24 × 64 = 1 536 (≈320 MB cada)\nsemáforo    = tsdb_max_query_parallelism = 128\nslots       = 4 queriers × max_concurrent 4 = 16\nondas       = ceil(1536 / 16) = 96',
      caption: 'Premissas: bytes uniformes no tempo e sem cache. O Loki calcula bytes pelo índice para cada intervalo; os números reais variam.'
    },
    exercise: {
      task: 'No laboratório, execute Q1 no Explore com 1 h e com 24 h e abra o Query inspector (estatísticas). Compare "total bytes processed", "queue time" e número de subconsultas. Depois explique por que o laboratório não mostra shards.',
      solution: 'O volume do laboratório (alguns KB/h) fica muito abaixo de 600 MB por intervalo: GuessShardFactor retorna 0. Só há splits por hora. O tempo de fila é quase zero porque há poucos pedidos.'
    },
    refs: [
      ref('Código: roundtrip.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/querier/queryrange/roundtrip.go'),
      ref('Código: queue.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/queue/queue.go'),
      ref('Documentação: query frontend', 'https://grafana.com/docs/loki/latest/operations/query-frontend/'),
      ref('Documentação: query acceleration e sharding', 'https://grafana.com/docs/loki/latest/operations/query-acceleration/'),
      ref('Deep Dive: scheduling (2.4.1, histórico)', 'https://taisho6339.gitbook.io/grafana-loki-deep-dive/query-process/schedule-queries-to-queriers')
    ],
    quiz: [
      q('Q1 gera 1 536 tarefas; há 64 slots de querier livres e tsdb_max_query_parallelism=32. Quantas tarefas de Q1 executam ao mesmo tempo?', 0, [
        ['32, limitadas pelo semáforo da consulta.', 'O semáforo do frontend limita a consulta, mesmo com slots livres.'],
        ['64, limitadas pelos slots.', 'O semáforo é menor que os slots.'],
        ['1 536, porque a fila aceita até 32 000.', 'A fila aceitar não significa executar.']
      ]),
      q('Uma consulta de log `{app="checkout"} |= "timeout"` com limit 100 em 7 dias termina em 1 s; a métrica equivalente demora 2 min. Por quê?', 2, [
        ['O cache de resultados guarda só logs.', 'Cache de resultados vale também para métricas e está desligado por padrão.'],
        ['Consultas de log não fazem split.', 'As duas passam por split_by_interval; a diferença está na saída antecipada.'],
        ['A de log para ao atingir 100 linhas nos intervalos mais recentes; a métrica precisa processar todos os intervalos.', 'splitByInterval.Process sai cedo para logs com limit.']
      ]),
      q('O índice estima 700 MB num intervalo. Quantos shards?', 1, [
        ['1, porque 700 MB é pouco.', '700/600 = 1,17; arredonda para 2.'],
        ['2.', 'Próxima potência de 2 acima de 1,17.'],
        ['3.', 'O fator é sempre potência de 2 na estratégia padrão.']
      ])
    ]
  },
  {
    id: 'querier',
    quizVersion: 1,
    title: 'Querier, index gateway e caches: de onde vem cada linha',
    short: 'Querier e caches',
    duration: '45 min',
    part: 'Siga a consulta',
    question: 'Para uma tarefa de Q1, quais componentes são consultados, em que ordem, e o que cada cache evita?',
    summary: 'Veja como o querier decide entre ingesters e store, por que pergunta a todos os ingesters, como o index gateway e o cache de chunks entram e como réplicas são deduplicadas.',
    prereqs: 'Módulos 10 a 12. Iterador: estrutura que entrega um item por vez, permitindo processar dados maiores que a memória. Heap: estrutura que mantém o menor elemento acessível em O(log n), usada para mesclar listas ordenadas.',
    objectives: [
      'Aplicar query_ingesters_within para decidir quais fontes uma tarefa usa.',
      'Explicar por que o querier envia a parte recente a todos os ingesters e como o quorum de leitura funciona.',
      'Distinguir cache de resultados, de chunks, de estatísticas/volume e cache local de índices TSDB.',
      'Explicar a deduplicação de réplicas e seu custo.'
    ],
    trace: 'Uma tarefa de Q1 cobre a última hora. Ela está dentro de `query_ingesters_within` (3 h): o querier consulta todos os ingesters e também o store para o mesmo intervalo. No store, pede ao índice os ChunkRefs de `{app="checkout", env="lab"}`; busca os chunks no cache de chunks e, na falta, no bucket; descomprime blocos que tocam a hora e executa o pipeline. Com RF=3, a mesma linha pode chegar até 3 vezes de ingesters e mais vezes de chunks replicados; o merge descarta as idênticas.',
    sections: [
      s('intuicao', K.inf, 'Dois lugares, cópias repetidas', 'Dados recentes estão nos ingesters; dados antigos no bucket. Entre eles há uma faixa em que ambos têm a mesma linha. O querier pergunta aos dois e remove duplicatas, porque é mais barato do que saber exatamente o que já foi descarregado.'),
      s('mecanismo', K.code, 'Escolha das fontes', '`SelectLogs` chama `BuildQueryIntervalsWithLookback`. Se o fim da consulta é mais recente que agora − `query_ingesters_within` (3 h), há consulta aos ingesters. Sem `query_store_max_look_back_period`, ingesters e store recebem o intervalo inteiro; com ele, o store é limitado. `query_store_only` e `query_ingester_only` forçam uma das fontes.'),
      s('mecanismo', K.code, 'Todos os ingesters', 'O querier não sabe quais streams casam com os matchers sem consultar o índice de cada ingester. `forAllIngesters` obtém o conjunto de leitura de todo o ring e chama todos em paralelo com `DoUntilQuorum`: espera respostas suficientes por zona/réplica para cobrir todos os streams, tolerando falhas dentro do RF. Só com `querier.query_partition_ingesters` (caminho de ingestão por partições/Kafka) o querier restringe a consulta ao subanel do tenant.'),
      s('mecanismo', K.code, 'Store, índice e chunks', 'No store, o querier pede ao índice os ChunkRefs (direto do TSDB baixado ou via index gateway). O fetcher busca primeiro no cache de chunks (`chunk_store_config.chunk_cache_config`) e depois no bucket. Os iteradores de entradas de cada fonte são mesclados por timestamp; entradas com mesmo timestamp e conteúdo são removidas.'),
      s('implementacao', K.code, 'Cache embutido quando nada é configurado', '`applyEmbeddedCacheConfig` liga o embedded cache (100 MB, TTL 1 h) para chunks e para os caches de resultados, estatísticas, volume, séries, labels e métricas instantâneas quando nenhum backend (memcached, redis) foi configurado. O cache de resultados só é usado se `query_range.cache_results` for true. O laboratório não liga cache_results.'),
      s('operacao', K.op, 'Monolítico × microsserviços', 'No target all (laboratório) não há index gateway: o querier lê os arquivos TSDB do cache local, sincronizado com o store. Em microsserviços, o index gateway concentra esse download e evita que cada querier mantenha cópias de todos os índices.')
    ],
    code: [
      c('pkg/querier/querier.go', 153, 'SingleTenantQuerier.SelectLogs', 'Monta iteradores de ingesters e do store e mescla.'),
      c('pkg/querier/intervals.go', 9, 'BuildQueryIntervalsWithLookback', 'Regra de query_ingesters_within e query_store_max_look_back_period.'),
      c('pkg/querier/ingester_querier.go', 168, 'IngesterQuerier.forAllIngesters', 'Consulta a todo o ring de leitura com DoUntilQuorum.'),
      c('pkg/ingester/instance.go', 480, 'instance.Query', 'Lado do ingester: índice invertido em memória e iteradores dos chunks.'),
      c('pkg/indexgateway/gateway.go', 214, 'Gateway.GetChunkRef', 'Resolve matchers para ChunkRefs.'),
      c('pkg/indexgateway/gateway.go', 421, 'Gateway.GetShards', 'Shards por bytes para o frontend.'),
      c('pkg/indexgateway/config.go', 49, 'SimpleMode / RingMode', 'Um gateway atende tudo ou o ring distribui tenants.'),
      c('pkg/storage/chunk/fetcher/fetcher.go', 128, 'Fetcher.FetchChunks', 'Cache de chunks antes do object storage.'),
      c('pkg/loki/config_wrapper.go', 741, 'applyEmbeddedCacheConfig', 'Liga embedded cache onde não há backend.'),
      c('pkg/storage/chunk/cache/embeddedcache.go', 107, 'NewEmbeddedCache', 'LRU em memória por processo, com tamanho e TTL.')
    ],
    dossiers: [
      {
        name: 'Querier',
        problem: 'Executar LogQL sobre dados que estão em dois lugares, com réplicas, sem que o cliente precise saber disso.',
        data: { input: 'Tarefas da fila (subconsultas com intervalo e, às vezes, shard).', state: 'Sem estado durável; caches locais e índices baixados (no monolítico).', output: 'Streams ou vetores/matrizes parciais para o frontend.' },
        steps: ['Valida limites (max_query_series, max_entries_limit_per_query, max_querier_bytes_read).', 'Decide fontes por intervalo.', 'Ingesters: Query em todos; store: índice → chunks → blocos.', 'Mescla iteradores com heap por timestamp; deduplica.', 'Aplica pipeline e agregação.', 'Retorna o parcial.'],
        structures: 'Iteradores com heap (k-way merge); pipelines por stream; pools de buffers.',
        communication: 'Fila (pull) → querier → ingesters (gRPC), index gateway (gRPC) ou TSDB local, cache de chunks, bucket.',
        params: [
          p('querier.query_ingesters_within', 'duração', '3h', 'Deve cobrir max_chunk_age + tempo até o índice estar no store; menor pode esconder dados recentes.'),
          p('querier.max_concurrent', 'workers', '4', 'Mais slots: mais memória e CPU simultâneas.'),
          p('querier.query_store_only', 'bool', 'false', 'Ignora ingesters (útil para queriers dedicados a histórico).'),
          p('ingester.query_store_max_look_back_period', 'duração', '0s', 'Limita o store quando os ingesters retêm dados por mais tempo.'),
          p('limits_config.max_query_series', 'séries', '500', 'Recusa métricas com mais séries de saída.'),
          p('limits_config.max_entries_limit_per_query', 'linhas', '5000', 'Teto do limit em consultas de log.'),
          p('limits_config.max_querier_bytes_read', 'bytes', '150GB', 'Recusa subconsultas que leriam mais que isso.'),
          p('limits_config.max_chunks_per_query', 'chunks', '2000000', 'Teto de chunks referenciados.')
        ],
        guarantees: ['Se o quorum de leitura de ingesters é atingido e o store responde, todo dado aceito com quorum aparece pelo menos uma vez.'],
        breaks: ['query_ingesters_within menor que o tempo até o índice ser enviado cria uma janela em que o dado não está em nenhuma fonte consultada.', 'Deduplicação só remove entradas idênticas (timestamp e linha): se dois envios divergiram, ambos aparecem.'],
        failures: [
          f('OOM em queriers com consultas amplas', 'Memória por pod e `max_concurrent`', 'Parsers e streams demais por tarefa; reduza concorrência ou seletores.'),
          f('Linhas recentes faltando', 'Compare com `query_ingester_only`', 'query_ingesters_within curto ou ingester fora do quorum de leitura.')
        ],
        example: 'A tarefa de Q1 da última hora consulta o ingester do laboratório e o filesystem. As linhas já descarregadas aparecem nas duas fontes e são removidas no merge.',
        exercise: { task: 'Com max_chunk_age=2h, a rotação do TSDB de 15 min e query_ingesters_within=1h, uma linha de 1 h e 30 min atrás pode sumir das consultas? Explique.', answer: 'Sim. O chunk pode continuar só no ingester por até 2 h (e o índice por mais ~15 min). A regra vale por tarefa: o frontend divide a consulta por hora, e a tarefa que cobre de 2 h a 1 h atrás termina antes de agora − 1 h, então não pergunta aos ingesters; o store ainda não tem o chunk ou o índice. Uma tarefa que termina agora pergunta aos ingesters pelo intervalo inteiro dela, mas só cobre a última hora. Por isso o default (3 h) é maior que max_chunk_age mais o envio do índice.' }
      },
      {
        name: 'Index gateway',
        problem: 'Evitar que cada querier e ruler baixe e mantenha todos os arquivos de índice; centralizar consultas de índice e estatísticas.',
        data: { input: 'GetChunkRef, GetSeries, LabelNames/Values, GetStats, GetVolume, GetShards.', state: 'Cópias locais de arquivos TSDB (cache_location).', output: 'ChunkRefs, séries, estatísticas e shards.' },
        steps: ['Sincroniza arquivos do bucket.', 'Recebe matchers e intervalo.', 'Interseção de postings, filtragem por intervalo e shard.', 'Retorna referências ou somas.'],
        structures: 'Arquivos TSDB mapeados; no modo ring, distribuição de tenants por hash.',
        communication: 'Queriers, frontend (via querier) e rulers → gateway (gRPC); gateway ← bucket.',
        params: [
          p('index_gateway.mode', 'enum', 'simple', 'ring distribui tenants entre gateways; requer KV.'),
          p('index_gateway.ring.replication_factor', 'réplicas', '3', 'Gateways por tenant no modo ring.'),
          p('storage_config.tsdb_shipper.index_gateway_client.server_address', 'endereço', '""', 'Endereço do gateway para os clientes; vazio faz o querier ler o índice direto.')
        ],
        guarantees: ['Respostas equivalentes às de ler o índice localmente, com o atraso de sincronização.'],
        breaks: ['Indisponível: queriers que dependem dele não conseguem localizar chunks históricos.'],
        failures: [f('Consultas históricas lentas ou com erro de índice', 'Latência gRPC do gateway; disco do cache', 'Gateway com cache frio após reinício ou disco pequeno.')],
        example: 'No laboratório não há gateway. Em microsserviços, a tarefa de Q1 chamaria GetChunkRef no gateway responsável pelo tenant fake.',
        exercise: { task: 'Por que o frontend precisa do índice antes de enviar tarefas aos queriers?', answer: 'Para estimar bytes (limite de tamanho e shards). Sem isso, não saberia em quantas partes dividir nem se deve recusar a consulta.' }
      },
      {
        name: 'Caches',
        problem: 'Evitar repetir leituras caras do bucket e cálculos já feitos.',
        data: { input: 'Chaves: resultado por consulta/intervalo; chunk por chave de objeto; estatísticas/volume por matchers e intervalo.', state: 'Embedded cache por processo ou memcached/redis compartilhado.', output: 'Hits que pulam trabalho; misses que seguem adiante.' },
        steps: ['Resultados: o frontend procura extents; calcula só o que falta.', 'Chunks: o fetcher procura cada chave; busca no bucket os faltantes e grava no cache.', 'Estatísticas e volume: o frontend reusa estimativas.'],
        structures: 'LRU com TTL (embedded); cliente de memcached com consistent hashing entre servidores.',
        communication: 'Processos → servidor de cache.',
        params: [
          p('query_range.cache_results', 'bool', 'false', 'Liga o cache de resultados.'),
          p('query_range.results_cache.cache.embedded_cache.max_size_mb', 'MB', '100', 'Tamanho do embedded cache de resultados.'),
          p('chunk_store_config.chunk_cache_config.embedded_cache.max_size_mb', 'MB', '100', 'Tamanho do cache de chunks embutido.'),
          p('chunk_store_config.chunk_cache_config.embedded_cache.ttl', 'duração', '1h', 'Validade de entradas do cache de chunks.')
        ],
        guarantees: ['Cache é otimização: um miss não muda o resultado.'],
        breaks: ['Embedded cache é por processo: 10 queriers têm 10 caches independentes, e o hit rate cai com mais réplicas.', 'Cache de resultados não ajuda consultas novas nem a parte recente.'],
        failures: [f('Hit rate baixo', 'Métricas de hits/misses do cache por nome', 'Cache pequeno, TTL curto, consultas sempre diferentes, embedded em muitas réplicas.')],
        example: 'Executar Q1 duas vezes no laboratório não usa cache de resultados (desligado), mas pode usar o cache de chunks embutido para as horas já descarregadas.',
        exercise: { task: 'Em produção, o cache de chunks tem 95% de hits, mas Q1 continua lenta e os queriers estão com CPU em 100%. O que isso indica?', answer: 'O gargalo é processamento (descompressão e parser), não leitura do bucket. Mais cache não ajuda; reduza linhas processadas (seletor, filtro antes do parser, janela) ou aumente CPU.' }
      }
    ],
    widget: 'sources',
    flow: 'read',
    example: {
      language: 'YAML • ligando o cache de resultados (não está no laboratório)',
      code: 'query_range:\n  cache_results: true           # default false em 3.7.0\n  results_cache:\n    cache:\n      embedded_cache:\n        enabled: true             # aplicado automaticamente se nenhum backend existir\n        max_size_mb: 100\nquerier:\n  query_ingesters_within: 3h      # default; mantenha > max_chunk_age',
      caption: 'Exemplo para estudo. Antes de aplicar, verifique memória por processo: cada réplica tem seu embedded cache.'
    },
    exercise: {
      task: 'No laboratório, execute `{app="checkout"} |= "timeout"` na última 1 h com o Query inspector aberto. Depois force um flush e repita. O total de linhas muda? E as estatísticas de chunks do store e do ingester?',
      solution: 'O total de linhas retornadas não muda (deduplicação). As estatísticas passam a mostrar chunks lidos do store além dos do ingester, porque, dentro de 3 h, as duas fontes são consultadas.'
    },
    refs: [
      ref('Código: querier.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/querier/querier.go'),
      ref('Código: intervals.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/querier/intervals.go'),
      ref('Documentação: caching', 'https://grafana.com/docs/loki/latest/operations/caching/'),
      ref('Documentação: componentes', 'https://grafana.com/docs/loki/latest/get-started/components/')
    ],
    quiz: [
      q('Uma tarefa cobre das 48 h às 47 h atrás. Quais fontes ela usa?', 1, [
        ['Ingesters e store.', 'Fora de query_ingesters_within (3 h), ingesters não são consultados.'],
        ['Apenas o store (índice + chunks).', 'O fim da tarefa é mais antigo que agora − 3 h.'],
        ['Apenas ingesters.', 'Ingesters não guardam dados tão antigos.']
      ]),
      q('Por que a parte recente de uma consulta vai a todos os ingesters, e não só às réplicas do stream?', 0, [
        ['Porque o querier não sabe quais streams casam com os matchers antes de perguntar.', 'A seleção depende do índice invertido de cada ingester.'],
        ['Porque o ring não funciona na leitura.', 'O ring é usado para montar o conjunto de leitura.'],
        ['Para medir a latência de cada ingester.', 'A chamada busca dados; latência é medida por métricas, não por fan-out.']
      ]),
      q('Dez queriers usam embedded cache de chunks de 100 MB cada. O que é verdade?', 2, [
        ['Há um cache compartilhado de 1 GB.', 'Embedded cache não é compartilhado.'],
        ['O cache só funciona com memcached.', 'Embedded funciona por processo.'],
        ['Cada querier tem 100 MB próprios; a mesma chave pode estar em vários e o hit depende de qual recebe a tarefa.', 'Por isso memcached compartilhado costuma ter hit rate maior com muitas réplicas.']
      ])
    ]
  },
  {
    id: 'logql',
    quizVersion: 2,
    title: 'Execução de LogQL: onde Q1 gasta CPU',
    short: 'Execução de LogQL',
    duration: '50 min',
    part: 'Siga a consulta',
    question: 'Por que `| json` numa janela de 24 h pode saturar a leitura, e o que muda o custo de verdade?',
    summary: 'Siga uma linha pelo pipeline: descompressão do bloco, filtro de linha, parser com ou sem hints, filtro de label e agregação. Pratique na bancada e estime o custo em janelas longas.',
    prereqs: 'Módulos 11 a 13. Pipeline: sequência de estágios aplicada a cada linha. Hint: informação que o planejador passa ao parser sobre quais campos são necessários.',
    objectives: [
      'Ordenar o trabalho por linha: descompressão, filtro, parser, filtro de label, extração de amostra.',
      'Explicar por que um filtro de linha reduz parsing mas não descompressão.',
      'Explicar parser hints e por que | json extrai menos numa métrica que numa consulta de log.',
      'Estimar o volume processado por Q1 em 24 h e propor reduções que preservem a semântica.'
    ],
    trace: 'Para cada chunk candidato de Q1, o querier descomprime os blocos da hora. Cada linha passa por `|= "timeout"` (busca de bytes); só as que contêm a sequência seguem ao `json`. Como Q1 é métrica e agrupa por app, os hints dizem ao parser que só `level` é necessário: ele interrompe a varredura do objeto ao encontrá-lo. `level="error"` descarta o resto, e `count_over_time` conta por janela de 5 min.',
    sections: [
      s('intuicao', K.inf, 'Todo byte do intervalo passa pela CPU pelo menos uma vez', 'O índice escolhe chunks; dentro deles não há atalhos. Cada linha de cada bloco que toca o intervalo é descomprimida e testada. Filtros e parsers decidem quanto trabalho extra cada linha recebe.'),
      s('mecanismo', K.code, 'Ordem do pipeline', 'Os estágios executam na ordem escrita. Filtros de linha (`|=`, `!=`, `|~`) operam sobre bytes da linha descomprimida. O parser `json` usa `jsonparser.ObjectEach` e grava campos no `LabelsBuilder`; erro de parse adiciona `__error__=JSONParserErr` sem descartar a linha. Filtros de label posteriores usam os campos extraídos.'),
      s('mecanismo', K.code, 'Hints do parser', 'Em consultas métricas, `NewParserHint` recebe os labels exigidos pela agregação, pelos agrupamentos e pelos filtros; o parser pode extrair apenas esses e parar cedo (`errFoundAllLabels`), ou descartar a linha assim que um filtro falha (`errLabelDoesNotMatch`). Em consultas de log, o pipeline cria hints sem labels exigidos: o parser extrai todas as chaves, pois o resultado devolve labels.'),
      s('mecanismo', K.inf, 'Por que 24 h com json pesa', 'Q1 em 24 h a 2 000 linhas/s e 400 bytes por linha toca ≈ 172,8 milhões de linhas e ≈ 64 GB não comprimidos. Sem filtro, todas são interpretadas. Com `|= "timeout"` seletivo (2%), o parser recebe ≈ 3,5 milhões, mas os 64 GB continuam sendo descomprimidos e varridos. Multiplique pela concorrência de usuários e dashboards com refresh automático.'),
      s('implementacao', K.code, 'Erros e cardinalidade da saída', 'Campos extraídos viram labels da amostra. `sum by (app)` reduz a saída a uma série por app; sem `by`, cada combinação de campos extraídos vira série distinta e pode exceder `max_query_series` (500). Use `| json level` (extração seletiva), `drop` e agrupamento explícito.'),
      s('operacao', K.op, 'Reduções que preservam a semântica', '1) Labels mais seletivos (menos chunks). 2) Filtro de linha antes do parser quando ele não exclui linhas válidas. 3) Extração seletiva. 4) Janela menor ou recording rule (módulo 15) para dashboards. 5) Structured metadata para campos de filtro frequentes, evitando o parser. Valide cada mudança comparando resultados no mesmo intervalo.')
    ],
    code: [
      c('pkg/logql/log/parser.go', 74, 'JSONParser.Process', 'ObjectEach com hints; erro vira __error__.'),
      c('pkg/logql/log/parser_hints.go', 145, 'NewParserHint', 'Calcula labels exigidos e filtros aplicáveis durante o parse.'),
      c('pkg/logql/log/metrics_extraction.go', 68, 'NewParserHint em extractores', 'Métricas passam labels exigidos e agrupamentos.'),
      c('pkg/logql/log/pipeline.go', 169, 'NewParserHint(nil, …)', 'Consultas de log não restringem campos.')
    ],
    dossiers: [],
    widget: 'parsing',
    playground: true,
    flow: 'query',
    example: {
      language: 'LogQL • Q1 e variações para comparar no Loki real',
      code: '# Q1\nsum by (app) (count_over_time({app="checkout", env="lab"} |= "timeout" | json | level="error" [5m]))\n\n# Q1 com extração seletiva (mesmo resultado, menos campos extraídos)\nsum by (app) (count_over_time({app="checkout", env="lab"} |= "timeout" | json level | level="error" [5m]))\n\n# Q1 sem filtro de linha: interpreta todas as linhas JSON\nsum by (app) (count_over_time({app="checkout", env="lab", format="json"} | json | level="error" [5m]))',
      caption: 'A primeira e a segunda devem retornar o mesmo valor. A terceira conta todos os erros, não só timeouts: não é equivalente. Compare valores e estatísticas antes de afirmar ganho.'
    },
    exercise: {
      task: 'No simulador, encontre apenas erros em JSON. Depois, no Grafana do laboratório, execute as três variações de Q1 em 1 h com o Query inspector e compare valores e "lines processed".',
      solution: 'Simulação: `{app="checkout", format="json"} | json | level="error"` retorna 2 linhas. No Loki real, a primeira e a segunda variações têm o mesmo valor; a terceira é maior, pois inclui erros sem "timeout". As linhas processadas são iguais nas três (mesmos chunks); o trabalho de parser muda.'
    },
    refs: [
      ref('Código: parser.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/logql/log/parser.go'),
      ref('Código: parser_hints.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/logql/log/parser_hints.go'),
      ref('Documentação: log queries', 'https://grafana.com/docs/loki/latest/query/log_queries/'),
      ref('Documentação: metric queries', 'https://grafana.com/docs/loki/latest/query/metric_queries/'),
      ref('Documentação: boas práticas de consulta', 'https://grafana.com/docs/loki/latest/query/bp-query/')
    ],
    quiz: [
      q('Adicionar `|= "timeout"` antes de `| json` reduz quais custos?', 1, [
        ['Descompressão e parsing.', 'A linha precisa estar descomprimida para o filtro testar seus bytes.'],
        ['Parsing e filtros posteriores; a descompressão continua igual.', 'O filtro opera depois da descompressão do bloco.'],
        ['Só o número de chunks buscados.', 'Filtros de linha não alteram a seleção pelo índice.']
      ]),
      q('`{app="checkout"} | json | level="error"` como consulta de log e como `count_over_time(...)`. Em qual o parser faz menos trabalho por linha?', 0, [
        ['Na métrica, porque os hints restringem os campos a level.', 'Consultas de log extraem todas as chaves.'],
        ['Na de log, porque retorna menos dados.', 'O parser extrai mais na consulta de log.'],
        ['São iguais.', 'Os hints diferem entre os dois caminhos.']
      ]),
      q('count_over_time(...[5m]) retorna qual grandeza?', 2, [
        ['Eventos por segundo.', 'Essa é a taxa calculada por rate.'],
        ['Eventos por minuto.', 'A janela não transforma contagem em taxa por minuto.'],
        ['Quantidade de eventos em cada janela de cinco minutos.', 'A unidade é eventos naquela janela.']
      ])
    ]
  }
];
