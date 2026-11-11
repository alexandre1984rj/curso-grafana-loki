import { K, s, c, p, f, q, ref } from './helpers.js';

export const operacao = [
  {
    id: 'compactor-ruler',
    quizVersion: 1,
    title: 'Compactor e ruler: trabalho que não espera o usuário',
    short: 'Compactor e ruler',
    duration: '45 min',
    part: 'Opere com critério',
    question: 'Quando o chunk de E1 é realmente apagado, e quem avalia Q1 como alerta a cada minuto?',
    summary: 'Veja o compactor fundir índices por tenant, marcar chunks expirados e apagá-los depois de um atraso; e o ruler transformar consultas como Q1 em alertas e recording rules.',
    prereqs: 'Módulos 11 a 14. Marcador de exclusão: arquivo que registra quais chunks podem ser apagados. Recording rule: consulta avaliada periodicamente cujo resultado é gravado como série métrica.',
    objectives: [
      'Ordenar compactação, marcação, atraso e exclusão de um chunk expirado.',
      'Explicar por que retention_period sozinho não apaga nada e por que lifecycle do bucket é perigoso.',
      'Comparar avaliação local e remota no ruler e prever o efeito de uma regra pesada.',
      'Diagnosticar retenção parada e alertas atrasados.'
    ],
    trace: 'No laboratório, E1 expira após 24 h (`retention_period: 24h`, `retention_enabled: true`). Na primeira compactação depois disso (a cada 10 min), o compactor percorre o índice do tenant fake, encontra o ChunkMeta de E1 expirado, remove a referência do índice reescrito e grava a chave do chunk num arquivo de marcadores local. Duas horas depois (`retention_delete_delay`), o sweeper apaga o objeto. Se Q1 fosse uma regra de alerta, o ruler a avaliaria a cada `evaluation_interval` (1 min).',
    sections: [
      s('intuicao', K.inf, 'Apagar em duas fases', 'Primeiro se apaga a referência; depois o objeto. Assim, um querier que já tinha a referência em cache ainda encontra o objeto por algum tempo, e um erro na marcação pode ser percebido antes da perda definitiva.'),
      s('mecanismo', K.code, 'Compactação de índices', 'Os ingesters enviam arquivos TSDB multi-tenant a cada 15 min. A cada `compaction_interval` (10 min), o compactor baixa os arquivos de cada tabela (dia), separa por tenant, funde e envia um arquivo por tenant, removendo os anteriores. Só uma instância compacta cada tabela; em microsserviços, o ring do compactor escolhe o responsável.'),
      s('mecanismo', K.code, 'Retenção', 'Com `retention_enabled: true`, a compactação aplica retenção (a cada execução, se `apply_retention_interval` é 0). `markForDelete` percorre séries e chunks; o `ExpirationChecker` compara o fim do chunk com `retention_period` do tenant ou de `retention_stream`. Chunks expirados saem do índice e suas chaves vão para marcadores em `<working_directory>/retention/<store>/markers` (ou no bucket com `deletion_marker_object_store_prefix`). O sweeper processa só arquivos de marcadores mais antigos que `retention_delete_delay` (2 h), com `retention_delete_worker_count` (150) workers.'),
      s('mecanismo', K.code, 'Ruler', 'O ruler carrega grupos de regras (`ruler.storage`, local no laboratório), e a cada `evaluation_interval` avalia cada regra. Em `evaluation.mode: local` (default), usa um engine LogQL próprio que lê ingesters e store diretamente, sem frontend: sem split, shard ou cache. Em `remote`, envia a consulta ao query frontend (`evaluation.query_frontend.address`) e herda splits, shards e filas. Alertas vão ao Alertmanager; recording rules são gravadas via remote_write num backend Prometheus, com WAL próprio.'),
      s('implementacao', K.code, 'O que fica em disco local', 'Marcadores de retenção ficam por padrão no disco do compactor. Perdê-los significa chunks removidos do índice que nunca serão apagados (custo, não perda de dados). O WAL do ruler (`ruler.wal.dir`) guarda amostras de recording rules ainda não enviadas.'),
      s('operacao', K.op, 'Lifecycle do bucket', 'Se uma política do bucket apaga objetos antes de o compactor removê-los do índice, consultas encontram referências para objetos inexistentes. Se usar lifecycle, ele deve ser mais longo que a retenção mais longa de qualquer tenant somada ao atraso de exclusão.')
    ],
    code: [
      c('pkg/compactor/compactor.go', 67, 'MarkersFolder = "markers"', 'Marcadores no disco local por padrão.'),
      c('pkg/compactor/retention/retention.go', 218, 'markForDelete', 'Percorre o índice e marca chunks expirados.'),
      c('pkg/compactor/retention/marker.go', 350, 'markerProcessor.availableFiles', 'Ignora arquivos mais novos que o atraso.'),
      c('pkg/compactor/retention/retention.go', 393, 'NewSweeper', 'Workers que apagam os objetos marcados.'),
      c('pkg/ruler/evaluator_local.go', 42, 'LocalEvaluator.Eval', 'Engine local: sem frontend.'),
      c('pkg/ruler/evaluator_remote.go', 150, 'RemoteEvaluator.Eval', 'Delegação ao query frontend.')
    ],
    dossiers: [
      {
        name: 'Compactor',
        problem: 'Manter o índice com poucos arquivos por tenant e dia, e aplicar retenção e pedidos de exclusão sem bloquear escrita ou leitura.',
        data: { input: 'Arquivos TSDB multi-tenant e por tenant; pedidos de exclusão (API).', state: 'Diretório de trabalho, marcadores, banco de pedidos de exclusão (`delete_request_store`).', output: 'Índices compactados; chunks apagados; chunks reescritos (exclusão parcial por filtro).' },
        steps: ['A cada 10 min: lista tabelas.', 'Para cada tabela: baixa, separa por tenant, funde.', 'Se retenção ativa: marca expirados e remove do índice.', 'Envia novos arquivos e remove antigos.', 'Sweeper: lê marcadores com idade ≥ atraso e apaga objetos.'],
        structures: 'Fila de tabelas, locks por tabela (`table_locker`), marcadores em arquivos com chaves de chunk.',
        communication: 'Compactor ↔ bucket. Queriers consultam pedidos de exclusão para filtrar resultados enquanto a exclusão não ocorreu.',
        params: [
          p('compactor.compaction_interval', 'duração', '10m', 'Frequência de compactação (e de retenção quando apply_retention_interval=0).'),
          p('compactor.retention_enabled', 'bool', 'false', 'Sem true, retention_period não apaga nada.'),
          p('compactor.retention_delete_delay', 'duração', '2h', 'Atraso entre marcar e apagar.'),
          p('compactor.retention_delete_worker_count', 'workers', '150', 'Concorrência de exclusões no bucket.'),
          p('compactor.apply_retention_interval', 'duração', '0s', '0: aplica em toda compactação.'),
          p('compactor.delete_request_store', 'store', '""', 'Obrigatório com retenção habilitada.'),
          p('compactor.working_directory', 'caminho', '/var/loki/compactor', 'Precisa ser persistente (marcadores).'),
          p('limits_config.retention_period', 'duração', '0s', '0 = sem expiração por tempo (com retenção ligada, nada expira por período).')
        ],
        guarantees: ['Um chunk só é apagado depois de removido do índice e após o atraso.'],
        breaks: ['Compactor parado: nada expira e o índice cresce em arquivos.', 'Marcadores perdidos: objetos órfãos ficam no bucket.', 'Duas instâncias compactando a mesma tabela (configuração errada do ring) podem gerar conflitos.'],
        failures: [
          f('Bucket crescendo além do esperado', 'Logs do compactor; métricas de chunks marcados e apagados', 'retention_enabled false, compactor sem permissão de exclusão, marcadores perdidos.')
        ],
        example: 'Com retention 24 h no laboratório: E1 expira em 24 h, é marcada em até 10 min e apagada ~2 h depois. Não espere ver isso em minutos.',
        exercise: { task: 'Lifecycle do bucket configurado para 1 dia e retenção do Loki em 30 dias. O que o usuário vê numa consulta de 3 dias atrás?', answer: 'O índice ainda referencia chunks que o bucket já apagou: a consulta falha ou retorna incompleta com erros de objeto não encontrado. A retenção deve ser controlada pelo Loki; lifecycle, se existir, mais longo.' }
      },
      {
        name: 'Ruler',
        problem: 'Avaliar consultas continuamente para alertas e para pré-calcular métricas, sem depender de um dashboard aberto.',
        data: { input: 'Grupos de regras por tenant.', state: 'Estado de alertas (pending/firing), WAL de remote_write.', output: 'Notificações ao Alertmanager e séries via remote_write.' },
        steps: ['Carrega regras a cada poll_interval.', 'Para cada grupo, a cada evaluation_interval, avalia as regras em sequência.', 'Alertas: aplica for, envia notificações.', 'Recording: grava amostras no WAL e envia.'],
        structures: 'Manager por tenant (derivado do Prometheus), ring para distribuir grupos quando `enable_sharding`.',
        communication: 'Ruler → ingesters/store (local) ou → frontend (remote); → Alertmanager; → remote_write.',
        params: [
          p('ruler.evaluation_interval', 'duração', '1m', 'Frequência de avaliação.'),
          p('ruler.poll_interval', 'duração', '1m', 'Frequência de recarga das regras.'),
          p('ruler.evaluation.mode', 'enum', 'local', 'remote envia ao frontend.'),
          p('ruler.enable_sharding', 'bool', 'false', 'Distribui grupos entre rulers pelo ring.'),
          p('ruler.for_grace_period', 'duração', '10m', 'Tolerância de for após reinício.'),
          p('ruler.remote_write.enabled', 'bool', 'false', 'Necessário para recording rules.')
        ],
        guarantees: ['Avaliações são periódicas; não há garantia de execução exatamente no instante.'],
        breaks: ['Uma regra de 24 h com json a cada minuto repete o custo de Q1 1 440 vezes por dia; em modo local, sem shard.', 'Ruler sem acesso a ingesters (modo local) não vê dados recentes.'],
        failures: [f('Alertas atrasados ou pulados', 'Métricas de avaliação do grupo (duração e falhas)', 'Grupo cuja avaliação dura mais que o intervalo; divida em grupos ou use recording rules com janelas curtas.')],
        example: 'Transformar Q1 em alerta: `sum by (app) (count_over_time({app="checkout"} |= "timeout" | json | level="error" [5m])) > 10` com `for: 5m`. A janela de 5 min torna cada avaliação barata; a regra não precisa de 24 h.',
        exercise: { task: 'Por que uma regra com `[24h]` avaliada a cada minuto é cara mesmo que o resultado mude pouco?', answer: 'Cada avaliação relê 24 h inteiras. Prefira uma recording rule de janela curta (5 min) e agregue no backend de métricas.' }
      }
    ],
    widget: 'retention',
    flow: 'storage',
    example: {
      language: 'YAML • laboratório',
      code: 'compactor:\n  working_directory: /loki/compactor   # marcadores ficam aqui\n  retention_enabled: true\n  delete_request_store: filesystem\nlimits_config:\n  retention_period: 24h                # mínimo didático\n# defaults relevantes: compaction_interval 10m, retention_delete_delay 2h',
      caption: 'O laboratório mantém o diretório do compactor no volume persistente.'
    },
    exercise: {
      task: 'No laboratório, após 25 h de execução, liste `/loki/compactor/retention` e os chunks mais antigos. Antes disso, explique em que ordem os eventos devem acontecer e quanto tempo cada um leva.',
      solution: 'Expira em 24 h; marcação na compactação seguinte (≤ 10 min); exclusão após 2 h do marcador. Os marcadores aparecem em retention/<store>/markers e somem após o sweep.'
    },
    refs: [
      ref('Código: compactor.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/compactor/compactor.go'),
      ref('Código: retention.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/compactor/retention/retention.go'),
      ref('Documentação: retenção', 'https://grafana.com/docs/loki/latest/operations/storage/retention/'),
      ref('Documentação: ruler', 'https://grafana.com/docs/loki/latest/alert/')
    ],
    quiz: [
      q('retention_period: 7d, retention_enabled: false. O que acontece com chunks de 10 dias?', 0, [
        ['Permanecem: sem retenção habilitada, o compactor não marca nada.', 'retention_period é usado pelo mecanismo, que está desligado.'],
        ['São apagados pelos ingesters.', 'Ingesters não aplicam retenção no store.'],
        ['Deixam de aparecer nas consultas, mas ficam no bucket.', 'Sem marcação, continuam no índice.']
      ]),
      q('Um ruler em modo local avalia uma regra de 6 h com json. O que ele não aproveita?', 2, [
        ['Os ingesters.', 'O modo local consulta ingesters.'],
        ['O índice.', 'Usa o índice para encontrar chunks.'],
        ['Split, shards, filas e cache do frontend.', 'Só o modo remote passa pelo frontend.']
      ])
    ]
  },
  {
    id: 'implantacao',
    quizVersion: 2,
    title: 'Do laptop ao cluster: domínios de falha',
    short: 'Deploy e disponibilidade',
    duration: '40 min',
    part: 'Opere com critério',
    question: 'Quais garantias dos módulos anteriores mudam quando E1 roda num cluster de três zonas?',
    summary: 'Compare monolítico, Simple Scalable e microsserviços pelo que cada um isola, e ligue réplicas, zonas, volumes e KV às garantias de escrita e leitura.',
    prereqs: 'Módulos 8 a 15. Domínio de falha: conjunto de recursos que falham juntos (nó, disco, zona). Anti-affinity: regra que impede dois pods no mesmo nó.',
    objectives: [
      'Comparar topologias pelos componentes que compartilham processo e recursos.',
      'Relacionar RF, zone awareness e domínio de falha com o resultado de quorum.',
      'Listar o que exige volume persistente e por quê.',
      'Planejar autenticação, tenants e rollout de ingesters.'
    ],
    trace: 'Em produção, E1 seria enviada a três ingesters em três zonas (zone awareness), cada um com WAL em disco persistente próprio. A perda de uma zona inteira deixa duas cópias e o quorum de escrita continua; a leitura deduplica. Q1 passaria por frontends e schedulers separados e queriers sem estado.',
    sections: [
      s('intuicao', K.inf, 'Separar é escolher o que falha junto', 'No monolítico, uma consulta pesada compete por CPU com a ingestão no mesmo processo. Separar leitura e escrita evita isso, mas cria rede, descoberta e mais coisas para operar.'),
      s('mecanismo', K.code, 'Targets em 3.7.0', '`target: all` inclui query scheduler, frontend, querier, ingester, distributor, ruler, compactor (e pattern ingester e UI), mas não index gateway. `read` = frontend + querier; `write` = ingester + distributor; `backend` = scheduler, ruler, compactor, index gateway (e componentes de bloom). Microsserviços usam um target por componente.'),
      s('mecanismo', K.doc, 'Estado do Simple Scalable', 'A documentação consultada em 2026-11-07 marca SSD (read/write/backend) como em depreciação, com remoção anunciada para 4.0. Ele continua útil para entender instalações 2.9 e 3.x.'),
      s('implementacao', K.inf, 'O que precisa de disco persistente', 'Ingesters (WAL, head TSDB e arquivos ainda não enviados), compactor (marcadores e trabalho), ruler (WAL de remote_write), index gateways (cache, recuperável). Queriers, frontends, schedulers e distributors não têm estado durável.'),
      s('operacao', K.op, 'Rollout de ingesters', 'Reinicie um ingester por vez (ou uma zona por vez com zone awareness) e espere ACTIVE: o replay do WAL acontece antes de entrar no ring. Reiniciar dois de três ao mesmo tempo, sem zonas, derruba o quorum de escrita para streams que caem neles.'),
      s('operacao', K.op, 'Acesso', 'Loki não autentica usuários. Coloque um gateway que autentique e injete `X-Scope-OrgID`, com `auth_enabled: true`. Sem isso, qualquer cliente escolhe o tenant.')
    ],
    code: [
      c('pkg/loki/loki.go', 866, 'deps All/Read/Write/Backend', 'Quais módulos cada target inicia.'),
      c('pkg/loki/modules.go', 214, 'InjectOrgID("fake")', 'Com auth desligado, todo tráfego vai ao tenant fake.')
    ],
    dossiers: [],
    flow: 'deploy',
    widget: 'domains',
    example: {
      language: 'YAML • esboço de zonas (não é default)',
      code: 'common:\n  replication_factor: 3\ningester:\n  lifecycler:\n    availability_zone: zone-a        # por pod\n    ring:\n      zone_awareness_enabled: true\nmemberlist:\n  join_members: [loki-memberlist]\nauth_enabled: true                   # gateway injeta X-Scope-OrgID',
      caption: 'Esboço para estudo. Valores reais dependem do chart/operador, da versão e dos requisitos.'
    },
    exercise: {
      task: 'Desenhe uma implantação para 50 MB/s de ingestão e consultas de 24 h frequentes. Indique domínios de falha, RF, o que tem disco persistente e como fará rollout de ingesters.',
      solution: 'RF=3 com zone awareness em três zonas; ingesters com volumes persistentes por pod; queriers sem estado escalados pela fila; scheduler separado; index gateways; compactor único com disco. Rollout uma zona por vez, esperando ACTIVE. Valide com carga e falha de zona; não há contagem universal de réplicas.'
    },
    refs: [
      ref('Documentação: modos de implantação', 'https://grafana.com/docs/loki/latest/get-started/deployment-modes/'),
      ref('Documentação: zone awareness', 'https://grafana.com/docs/loki/latest/operations/zone-ingesters/'),
      ref('Documentação: autenticação', 'https://grafana.com/docs/loki/latest/operations/authentication/'),
      ref('Documentação: Helm', 'https://grafana.com/docs/loki/latest/setup/install/helm/')
    ],
    quiz: [
      q('RF=3, zone awareness, três zonas. Uma zona inteira cai. O que acontece com escritas?', 0, [
        ['Continuam: cada stream tem uma réplica por zona e as duas restantes atingem minSuccess=2.', 'É o objetivo de distribuir réplicas por zona.'],
        ['Param até a zona voltar.', 'Só param se duas zonas caírem.'],
        ['Continuam com RF=2 permanentemente.', 'O RF configurado não muda; a zona volta e reassume.']
      ]),
      q('O laboratório com replication_factor: 1 demonstra HA?', 1, [
        ['Sim, porque usa WAL.', 'WAL não cobre perda do volume.'],
        ['Não: um processo e um volume são o único domínio de falha.', 'Um único domínio de falha não é HA.'],
        ['Sim, porque usa Docker.', 'Containers não criam réplicas.']
      ])
    ]
  },
  {
    id: 'desempenho',
    quizVersion: 2,
    title: 'Investigue antes de aumentar',
    short: 'Desempenho e incidentes',
    duration: '45 min',
    part: 'Opere com critério',
    question: 'Quando aumentar o paralelismo de Q1 ajuda e quando piora?',
    summary: 'Use um modelo de teto para separar fila, CPU, IO e memória; relacione cada recurso a parâmetros concretos e a métricas que confirmam a hipótese.',
    prereqs: 'Módulos 12 a 14. Throughput: trabalho por unidade de tempo. Saturação: recurso no limite, onde mais demanda vira espera.',
    objectives: [
      'Identificar o recurso que limita uma consulta com base em números de CPU, IO e concorrência.',
      'Explicar por que max_concurrent acima dos núcleos não aumenta throughput e aumenta memória.',
      'Montar uma hipótese testável para lentidão de Q1 e escolher a métrica que a confirma.',
      'Propor mudanças reversíveis e ordenadas.'
    ],
    trace: 'Q1 lê ≈ 480 GB não comprimidos em 24 h (20 GB/h). Com 4 queriers de 4 núcleos e max_concurrent 4, o teto é o menor entre CPU (4 × 4 × 150 MB/s = 2,4 GB/s, premissa) e IO (4 × 400 MB/s = 1,6 GB/s, premissa): 1,6 GB/s → ≈ 5 min. Subir max_concurrent para 16 não muda o teto, mas quadruplica a memória por querier.',
    sections: [
      s('intuicao', K.inf, 'Paralelismo só ajuda quem tem folga', 'Dividir o trabalho reduz o tempo enquanto existir recurso ocioso. Depois do ponto de saturação, mais tarefas simultâneas só disputam o mesmo recurso, aumentam memória e trocas de contexto.'),
      s('mecanismo', K.simp, 'Modelo de teto usado no simulador', 'Throughput = mínimo entre (queriers × min(max_concurrent, núcleos) × vazão por núcleo) e (min(queriers × IO por querier, banda do bucket)). Memória por querier = max_concurrent × memória por tarefa. Tempo ≈ trabalho / throughput. Ignora caches, variações de tamanho de tarefa, GC e rede entre componentes.'),
      s('mecanismo', K.code, 'Onde cada limite mora', 'Fila: `max_outstanding_requests_per_tenant`. Paralelismo por consulta: `tsdb_max_query_parallelism`. Slots: `querier.max_concurrent` × réplicas. Tamanho de tarefa: `split_queries_by_interval` e `tsdb_max_bytes_per_shard`. Proteções: `max_query_bytes_read`, `max_querier_bytes_read`, `query_timeout`.'),
      s('operacao', K.op, 'Método', '1) Separe tempo de fila e de execução nas estatísticas da consulta. 2) Fila alta e queriers ociosos: limite de paralelismo ou de queriers por tenant. 3) Fila alta e queriers saturados: capacidade ou consultas demais; reduza trabalho, não aumente paralelismo. 4) Execução alta com CPU alta: parsing/descompressão. 5) Execução alta com CPU baixa: IO/bucket/cache. 6) OOM: concorrência × tamanho de tarefa. Mude uma coisa por vez e compare no mesmo intervalo.'),
      s('operacao', K.op, 'Mudanças reversíveis, em ordem', 'Reduzir a janela de dashboards e a frequência de refresh; adicionar filtro de linha seletivo; extração seletiva; labels melhores para o caso; recording rules; só então capacidade (mais queriers). Aumentar limites de paralelismo é a última opção e precisa de evidência de recurso ocioso.')
    ],
    code: [
      c('pkg/querier/queryrange/limits.go', 575, 'limitedRoundTripper.Do', 'Semáforo por consulta.'),
      c('pkg/querier/worker/worker.go', 263, 'querierWorker.resetConcurrency', 'max_concurrent repartido entre alvos.'),
      c('pkg/queue/queue.go', 88, 'RequestQueue.Enqueue', 'Recusa acima do limite.')
    ],
    dossiers: [],
    widget: 'bottleneck',
    flow: 'read',
    example: {
      language: 'LogQL • comparar no mesmo intervalo',
      code: '# A: interpreta todas as candidatas\n{app="checkout", format="json"} | json | level="error"\n\n# B: só equivalente se ERROR estiver em toda linha-alvo\n{app="checkout", format="json"} |= "ERROR" | json | level="error"',
      caption: 'B não é uma otimização automaticamente correta. No gerador, level é minúsculo e ERROR não aparece: B perde resultados.'
    },
    exercise: {
      task: 'Incidente: às 10h, dashboards com Q1 em 48 h atualizam a cada 30 s. Fila do scheduler cresce, CPU dos queriers em 100%, ingestão normal. Proponha duas hipóteses, a métrica que distingue cada uma e uma mudança reversível.',
      solution: 'H1: excesso de consultas (refresh) — métrica: taxa de consultas por tenant/dashboard e tempo de fila; mudança: refresh para 5 min e janela de 6 h. H2: custo por consulta (parser sem filtro) — métrica: lines processed/bytes por consulta; mudança: filtro de linha e extração seletiva validados. Não aumente max_concurrent: a CPU já está saturada.'
    },
    refs: [
      ref('Documentação: boas práticas de consulta', 'https://grafana.com/docs/loki/latest/query/bp-query/'),
      ref('Documentação: investigação de consultas', 'https://grafana.com/docs/loki/latest/query/troubleshoot-query/'),
      ref('Deep Dive: desempenho (2.4.1, histórico)', 'https://taisho6339.gitbook.io/grafana-loki-deep-dive/performance-improvement')
    ],
    quiz: [
      q('Queriers com 4 núcleos, CPU em 100%. Você sobe max_concurrent de 4 para 16. O que esperar?', 2, [
        ['Throughput 4× maior.', 'Não há núcleos ociosos.'],
        ['Nada muda.', 'Muda a memória e a disputa.'],
        ['Throughput igual ou pior, memória até 4× maior e risco de OOM.', 'Mais tarefas competem pelos mesmos núcleos.']
      ]),
      q('Tempo de fila alto, queriers com CPU em 20%. Qual hipótese investigar primeiro?', 0, [
        ['Limite de paralelismo por consulta ou de queriers por tenant.', 'Há recurso ocioso que a consulta não alcança.'],
        ['Parser caro.', 'Parser caro aumentaria CPU.'],
        ['Bucket lento.', 'Afetaria execução, não fila.']
      ])
    ]
  },
  {
    id: 'caso-go',
    quizVersion: 1,
    title: 'Uma decisão tem contexto',
    short: 'Estudo de caso GO',
    duration: '30 min',
    part: 'Conecte as decisões',
    question: 'Quais escolhas de um caso real continuam válidas à luz do mecanismo, e quais dependem de riscos aceitos?',
    summary: 'Leia uma experiência real com os mecanismos do curso: entenda as escolhas e revise o que não deve ser copiado.',
    prereqs: 'Disponibilidade, retenção e leitura. Este estudo é histórico; não é uma auditoria da infraestrutura atual da empresa.',
    objectives: [
      'Separar relato e recomendação.',
      'Revisar os riscos de replicação 1 com o modelo de durabilidade do módulo 10.',
      'Produzir uma proposta de arquitetura com justificativas e testes.'
    ],
    trace: 'Aplique E1 e Q1 ao cenário do artigo: com replicação 1, o ACK de E1 vale uma cópia; perder o volume de um ingester perde tudo que não foi descarregado e o índice ainda não enviado. Q1 em 24 h competiria com a ingestão se leitura e escrita compartilhassem recursos, o que motivou a separação de pools.',
    sections: [
      s('intuicao', K.hist, 'O relato de 2023', 'O artigo japonês descreve Loki num cluster de observabilidade, recebendo logs de EKS e GKE, com S3 e Promtail. A empresa separou pools de leitura e escrita para acomodar perfis de recursos e reduzir interferência.'),
      s('mecanismo', K.hist, 'O que exige crítica', 'A GO adotou replicação 1, o codec de compressão snappy e ajustes de leitura por razões de custo e operação. O relato de recuperação não prova proteção contra perda do volume. Não transplante números ou chaves de Helm para outra versão.'),
      s('operacao', K.inf, 'Reavaliando com o mecanismo', 'Snappy reduz CPU de compressão e aumenta tamanho (o default de 3.7.0 é gzip). Replicação 1 elimina o custo de três cópias em memória, mas transforma qualquer perda de disco ou nó em perda dos dados ainda não descarregados (até max_chunk_age). Separar leitura e escrita evita que Q1 dispute CPU com o distributor/ingester.'),
      s('implementacao', K.code, 'Onde cada decisão aparece no código', 'Replicação 1: `defaultReplicationStrategy.Filter` calcula minSuccess=1 e maxErrors=0, então o ACK de E1 vale uma cópia (módulo 8). Codec: `ingester.chunk_encoding` escolhe o compressor de `MemChunk` em `pkg/chunkenc`; snappy troca CPU por bytes no bucket e na leitura (módulo 9). Separação de pools: os alvos `read`, `write` e `backend` em `pkg/loki/loki.go` ligam conjuntos diferentes de módulos (módulo 16). Recuperação: o replay do WAL em `Ingester.starting` cobre reinício com disco preservado, não perda de volume (módulo 10).'),
      s('operacao', K.op, 'Projeto final', 'Defina volume, consultas, retenção, isolamento e objetivo de recuperação. Desenhe escrita e leitura, justifique labels e explique como validará a capacidade.')
    ],
    code: [],
    dossiers: [],
    flow: 'deploy',
    example: {
      language: 'Proposta para preencher',
      code: 'Carga e picos: ...\nConsultas e concorrência: ...\nRetenção e tenants: ...\nTopologia e armazenamento: ...\nFalhas toleradas e recuperação: ...\nEvidências de capacidade: ...',
      caption: 'O cenário e os números devem ser definidos por você. Nenhum benchmark do curso representa a infraestrutura da GO.'
    },
    exercise: {
      task: 'Entregue um desenho de arquitetura e um registro de decisão: você adotaria replicação 1? Declare o risco aceito, o objetivo de recuperação e como testaria a hipótese.',
      solution: 'Uma resposta consistente quantifica a janela de perda (dados não descarregados, até max_chunk_age, e índice ainda não enviado), relaciona com a perda aceitável e descreve testes de perda de volume, não só reinício. Use o roteiro em docs/projeto-final.md.'
    },
    refs: [
      ref('GO: artigo original em japonês', 'https://techblog.goinc.jp/entry/2023/11/17/090000'),
      ref('WAL: garantias e limites', 'https://grafana.com/docs/loki/latest/operations/storage/wal/'),
      ref('Situação atual dos deploys', 'https://grafana.com/docs/loki/latest/get-started/deployment-modes/')
    ],
    quiz: [
      q('O uso de replicação 1 pela GO torna essa escolha universalmente segura?', 1, [
        ['Sim, porque uma empresa a utilizou.', 'Um caso não demonstra que seus requisitos e falhas são iguais.'],
        ['Não; é preciso quantificar a janela de perda e compará-la com a perda aceitável.', 'A decisão depende de requisitos e de recuperação demonstrável.'],
        ['Sim, se a retenção for longa.', 'Retenção não cria redundância dos dados recentes.']
      ]),
      q('Qual entrega demonstra compreensão de arquitetura?', 2, [
        ['Copiar o YAML histórico.', 'Versões e requisitos diferentes podem invalidar chaves e decisões.'],
        ['Escolher a maior máquina disponível.', 'Isso não explica garantias nem capacidade necessária.'],
        ['Justificar escolhas, limites e testes de recuperação.', 'A arquitetura precisa relacionar requisitos a evidências.']
      ])
    ]
  }
];
