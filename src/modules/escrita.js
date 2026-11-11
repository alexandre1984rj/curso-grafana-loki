import { K, s, c, p, f, q, ref } from './helpers.js';

export const escrita = [
  {
    id: 'escrita',
    quizVersion: 2,
    title: 'Distributor e ring: quem recebe E1',
    short: 'Distributor e ring',
    duration: '50 min',
    part: 'Siga a escrita',
    question: 'Quando o Alloy recebe 204, quantas cópias de E1 existem e onde?',
    summary: 'Acompanhe E1 pela validação, pelos limites, pelo hash do stream, pela escolha das réplicas no ring e pela regra de quorum que decide o ACK.',
    prereqs: 'Módulos 1 a 3. Hash consistente: cada instância possui tokens num anel de 0 a 2³²−1 e uma chave pertence às próximas instâncias no sentido horário. Quorum: maioria mínima de confirmações (n/2+1). Heartbeat: atualização periódica que prova que uma instância está viva.',
    objectives: [
      'Calcular minSuccess e maxErrors para um conjunto de réplicas e prever o resultado de um push.',
      'Explicar por que o token depende só do tenant e da string de labels, e o que isso implica para hot streams.',
      'Ligar os erros 400, 429 e 5xx a funções concretas do distributor e decidir o que o cliente deve fazer.',
      'Diagnosticar "at least 2 live replicas required" a partir do estado do ring.'
    ],
    trace: 'E1 chega num lote do Alloy. O distributor do laboratório valida labels e tamanho, aplica o limite do tenant fake, já recebe de `ParseRequest` os labels com `service_name=\\"checkout\\"` acrescentado (copiado de `app` por `discover_service_name`), calcula `TokenFor("fake", "{app=\\"checkout\\", env=\\"lab\\", format=\\"json\\", service_name=\\"checkout\\"}")` e pede ao ring as réplicas. No laboratório, RF=1: uma única confirmação basta e uma única cópia existe.',
    sections: [
      s('intuicao', K.inf, 'O distributor é um roteador com regras', 'Ele não guarda logs. Recebe lotes, recusa o que viola regras do tenant e decide, para cada stream, quais ingesters o recebem. Como um stream sempre vai para as mesmas réplicas enquanto o ring não muda, cada ingester consegue montar chunks contínuos daquele stream. O preço é que um único stream muito quente sobrecarrega sempre as mesmas instâncias.'),
      s('mecanismo', K.code, 'Do lote ao ACK, em ordem', '1) `PushWithResolver` analisa cada stream: labels válidos (até 15 nomes por série, nome ≤ 1024 bytes, valor ≤ 2048), linha ≤ `max_line_size` e idade dentro de `reject_old_samples_max_age`. Erros de validação viram HTTP 400 parcial: as linhas válidas seguem. 2) O limitador global do tenant (`ingestionRateLimiter.AllowN`) recebe o total de bytes do lote; se não houver tokens, o lote inteiro recebe 429. 3) Com `shard_streams.enabled`, um stream acima de `desired_rate` é dividido em sub-streams com o label `__stream_shard__`. 4) Para cada stream, `TokenFor` calcula FNV-32 de tenant+labels. 5) `ingestersRing.Get(token, WriteNoExtend)` devolve o conjunto de réplicas e, via `Filter`, `MaxErrors`. 6) Os streams são agrupados por ingester e cada grupo vira uma tarefa para o pool de `push_worker_count` goroutines. 7) Cada resposta incrementa contadores atômicos; o primeiro stream a falhar além do tolerado ou o último a atingir quorum decide a resposta.'),
      s('mecanismo', K.code, 'A regra de quorum', 'Em `defaultReplicationStrategy.Filter`, minSuccess = (RF/2)+1, usando o maior entre RF e o tamanho do conjunto. Instâncias sem heartbeat dentro de `heartbeat_timeout` são removidas, mas continuam contando no cálculo; se sobrarem menos que minSuccess, o push falha antes de enviar qualquer coisa. Com RF=3: minSuccess=2 e maxErrors=1. Com RF=1: minSuccess=1 e maxErrors=0, ou seja, qualquer erro do único ingester vira erro para o cliente.'),
      s('mecanismo', K.code, 'O que continua depois do ACK', 'O contexto de cada envio é criado com `context.WithoutCancel` e `remote_timeout`. O distributor responde assim que o quorum fecha, mas a terceira réplica continua recebendo o push em segundo plano. Se ela falhar, ninguém repara: o stream fica com uma cópia a menos até ser lido, e a leitura não detecta a ausência porque deduplica réplicas.'),
      s('implementacao', K.code, 'Limite global dividido por distributors', 'Com `ingestion_rate_strategy: global` (default), `globalStrategy.Limit` divide `ingestion_rate_mb` pelo número de distributors saudáveis no ring de distributors. Com 4 MB/s e 4 distributors, cada um aceita 1 MB/s daquele tenant. Se o balanceador não distribui o tráfego de forma uniforme, o tenant recebe 429 abaixo do limite total.'),
      s('operacao', K.op, 'Lendo os erros do cliente', '400: a linha nunca será aceita como está; reenviar não resolve (veja `loki_discarded_samples_total{reason}`). 429: o cliente deve recuar e reenviar; aumentar o limite só é correto se a capacidade dos ingesters suportar. 5xx: falha de réplicas ou de quorum; o cliente reenvia e pode gerar duplicatas, das quais o ingester só descarta as idênticas à última linha do stream.'),
      s('operacao', K.simp, 'O que este módulo omite', 'O caminho via Kafka (`distributor.kafka_writes_enabled`, desligado por padrão), limites de stream no distributor (`ingest_limits`), políticas por stream e o pipeline OTLP. Eles alteram onde a escrita é confirmada; não estão no laboratório.')
    ],
    code: [
      c('pkg/distributor/distributor.go', 562, 'Distributor.PushWithResolver', 'Validação, rate limit, sharding e envio às réplicas na mesma função.'),
      c('pkg/distributor/distributor.go', 793, 'ingestionRateLimiter.AllowN', 'Um lote inteiro recebe 429 quando os bytes excedem o balde do tenant.'),
      c('pkg/util/ring/ring.go', 12, 'TokenFor', 'FNV-32 de tenant + string de labels: o conteúdo da linha não influencia o destino.'),
      c('pkg/distributor/distributor.go', 880, 'ingestersRing.Get(stream.HashKey, ring.WriteNoExtend, …)', 'Conjunto de réplicas e erros tolerados por stream.'),
      c('vendor/github.com/grafana/dskit/ring/replication_strategy.go', 33, 'defaultReplicationStrategy.Filter', 'minSuccess = RF/2+1; remove instâncias sem heartbeat; recusa cedo sem maioria viva.'),
      c('pkg/distributor/distributor.go', 904, 'context.WithTimeout(context.WithoutCancel(ctx), RemoteTimeout)', 'Envios continuam mesmo depois que o cliente recebeu resposta.'),
      c('pkg/distributor/distributor.go', 1229, 'Distributor.sendStreams', 'Contadores atômicos por stream decidem sucesso ou falha.'),
      c('pkg/distributor/distributor.go', 523, 'PushTracker.doneWithResult', 'Canal bufferizado: só o primeiro erro ou o fim de todos os streams é entregue.'),
      c('pkg/distributor/distributor.go', 1426, 'calculateShards', 'Shards = ceil((taxa + tamanho do push) / desired_rate).'),
      c('pkg/distributor/ingestion_rate_strategy.go', 42, 'globalStrategy.Limit', 'Limite do tenant dividido pelos distributors saudáveis.')
    ],
    dossiers: [
      {
        name: 'Distributor',
        problem: 'Separar a aceitação de dados do armazenamento: validar e limitar perto da borda, sem estado durável, e espalhar streams por ingesters de forma determinística. Sem ele, cada cliente precisaria conhecer o ring e as regras de cada tenant.',
        data: { input: 'PushRequest (protobuf+snappy ou JSON) com streams: labels, entradas (timestamp, linha, structured metadata).', state: 'Nenhum dado de log. Mantém limitadores por tenant em memória, cache de rates de streams (`rate_store`) e clientes gRPC para ingesters.', output: 'Um PushRequest por ingester com os streams que cabem a ele; HTTP 204, 400, 429 ou 5xx ao cliente.' },
        steps: ['Decodifica e identifica o tenant (`X-Scope-OrgID`; com `auth_enabled: false`, o tenant é `fake`).', 'Valida cada stream e cada entrada; separa as inválidas e conta `loki_discarded_samples_total{reason}`.', 'Soma os bytes válidos e consulta o rate limiter do tenant.', 'Divide hot streams em shards quando `shard_streams` está habilitado.', 'Calcula o token e obtém as réplicas; agrupa streams por ingester.', 'Envia em paralelo pelo pool de workers; responde quando todos os streams atingiram quorum ou quando um falhou além do tolerado.'],
        structures: 'Rate limiter de balde de tokens por tenant (`limiter.RateLimiter`, recalcula o limite a cada 10 s); `streamTracker` com `atomic.Int32` para sucessos e falhas; `PushTracker` com canais de capacidade 1; mapa `streamsByIngester`. A concorrência evita locks no caminho quente: cada goroutine só incrementa contadores.',
        communication: 'HTTP/gRPC do cliente → distributor. Distributor lê o ring de ingesters (KV via memberlist, consul, etcd ou inmemory) e chama `Push` gRPC nos ingesters. Consulta ingesters periodicamente para obter taxas de streams (`rate_store`), usadas no sharding.',
        params: [
          p('limits_config.ingestion_rate_mb', 'MB/s por tenant', '4', 'Maior: aceita mais volume antes de 429; a pressão vai para memória e flush dos ingesters.'),
          p('limits_config.ingestion_burst_size_mb', 'MB', '6', 'Tamanho do balde. Precisa caber o maior lote do cliente; lotes maiores que o burst nunca passam.'),
          p('limits_config.ingestion_rate_strategy', 'enum', 'global', 'global divide o limite pelos distributors saudáveis; local aplica o valor inteiro em cada um.'),
          p('limits_config.max_line_size', 'bytes', '256KB', 'Linhas maiores são descartadas (400) a menos que `max_line_size_truncate` seja true.'),
          p('limits_config.reject_old_samples_max_age', 'duração', '1w', 'Entradas mais antigas são recusadas. Não confunda com a janela de ordenação do ingester.'),
          p('limits_config.shard_streams.enabled', 'bool', 'true', 'Divide streams que excedem a taxa desejada; cria labels `__stream_shard__` e mais streams.'),
          p('limits_config.shard_streams.desired_rate', 'bytes/s', '1536KB', 'Menor: mais shards por stream, chunks menores e mais entradas no índice.'),
          p('distributor.push_worker_count', 'goroutines', '256', 'Limita envios simultâneos aos ingesters por distributor.'),
          p('ingester_client.remote_timeout', 'duração', '5s', 'Tempo máximo por envio a um ingester; afeta quando uma réplica lenta conta como falha.')
        ],
        guarantees: ['Se o cliente recebe 204, cada stream do lote foi aceito por pelo menos minSuccess ingesters (em memória e no WAL escrito, ver módulo 10).', 'Linhas inválidas recebem 400 mesmo quando outras do mesmo lote foram aceitas.'],
        breaks: ['Com RF=1, não há segunda cópia: uma confirmação vale uma cópia.', 'Se o ring muda durante o push (ingester entrando ou saindo), streams podem ir para réplicas diferentes da leitura anterior; a deduplicação na leitura compensa, mas chunks ficam menores.', 'Um 5xx não garante que nada foi gravado: réplicas que responderam OK mantêm a linha.'],
        failures: [
          f('Muitos 429 com tráfego abaixo do limite somado', 'Taxa por distributor (`loki_distributor_bytes_received_total` por pod) e número de distributors saudáveis', 'Verifique balanceamento: o limite global é dividido por instância.'),
          f('Muitos 400', '`loki_discarded_samples_total{reason="line_too_long|greater_than_max_sample_age|..."}`', 'O motivo nomeia a regra; corrija o cliente, não o Loki.'),
          f('5xx "at least 2 live replicas required"', 'Página `/ring` do distributor ou ingester: instâncias UNHEALTHY ou LEAVING', 'Heartbeats atrasados (CPU, rede, KV) ou ingesters removidos sem `forget`.')
        ],
        example: 'E1 tem 115 bytes de linha mais metadados. O limite do tenant fake no laboratório é 4 MB/s com um distributor: passa. Não há shard (taxa muito abaixo de 1,5 MB/s). TokenFor gera um uint32; o ring inmemory tem um ingester; minSuccess=1. O push ao ingester retorna OK e o Alloy recebe 204.',
        exercise: { task: 'Um tenant tem `ingestion_rate_mb: 10` e 5 distributors atrás de um balanceador que envia 60% do tráfego a um deles. Envio total: 8 MB/s. Haverá 429? Em qual distributor?', answer: 'Sim. Cada distributor aceita 10/5 = 2 MB/s. O distributor com 60% recebe 4,8 MB/s e recusa o excedente; os outros recebem 0,8 MB/s cada e sobram. O total está abaixo de 10, mas o limite é aplicado por instância. Corrija o balanceamento ou use `local` conscientemente.' }
      },
      {
        name: 'Ring',
        problem: 'Permitir que processos sem coordenador concordem sobre quem é responsável por cada stream, tolerando entrada e saída de instâncias com movimento mínimo de dados.',
        data: { input: 'Registro e heartbeat de cada instância: endereço, estado (JOINING, ACTIVE, LEAVING), zona e tokens.', state: 'Desc do ring replicado no KV store e cache local em cada cliente do ring.', output: 'ReplicationSet para uma chave: instâncias e quantos erros tolerar.' },
        steps: ['Cada ingester gera `num_tokens` tokens aleatórios e os publica no KV.', 'Clientes (distributors, queriers) observam o KV e mantêm o anel ordenado em memória.', 'Para uma chave, busca binária encontra o primeiro token ≥ chave e percorre o anel até reunir RF instâncias distintas (e zonas distintas com zone awareness).', '`Filter` remove instâncias cujo último heartbeat é mais antigo que `heartbeat_timeout` e calcula o quorum.'],
        structures: 'Vetor ordenado de tokens com índice para instância; busca binária O(log n). O KV é eventualmente consistente com memberlist (gossip): dois distributors podem ver versões diferentes por alguns segundos.',
        communication: 'Plano de controle. Nenhuma linha de log passa pelo ring. Ingesters escrevem heartbeat; distributors e queriers só leem.',
        params: [
          p('ingester.lifecycler.ring.replication_factor', 'réplicas', '3', 'No modo monolítico, o laboratório força 1 via `common.replication_factor`. Maior: mais cópias, mais memória e mais tráfego de escrita.'),
          p('ingester.lifecycler.num_tokens', 'tokens', '128', 'Mais tokens: distribuição mais uniforme e ring maior.'),
          p('ingester.lifecycler.heartbeat_period', 'duração', '5s', 'Frequência de atualização no KV.'),
          p('ingester.lifecycler.ring.heartbeat_timeout', 'duração', '1m', 'Menor: detecta falhas mais rápido e aumenta falsos positivos sob carga.'),
          p('ingester.lifecycler.ring.zone_awareness_enabled', 'bool', 'false', 'true: réplicas em zonas distintas; exige `availability_zone` em cada ingester.')
        ],
        guarantees: ['Com o mesmo ring, a mesma chave produz o mesmo conjunto de réplicas.', 'Com zone awareness, RF=3 e três zonas, uma zona inteira pode falhar sem perder quorum de escrita.'],
        breaks: ['Sem zone awareness, as três réplicas podem cair no mesmo nó ou zona.', 'Ingester morto sem sair do ring continua contando no RF até ser esquecido (`autoforget_unhealthy` é false por padrão).', 'Vistas divergentes do KV durante mudanças.'],
        failures: [
          f('Escritas falham depois de reinícios em massa', '`/ring`: várias instâncias UNHEALTHY', 'Rolling restart rápido demais: aguarde ACTIVE antes do próximo (o ingester só entra no ring depois de repetir o WAL).'),
          f('Ingesters com carga desigual', '`loki_ingester_memory_streams` por instância', 'Hot stream (um token) ou poucos tokens; considere shard_streams.')
        ],
        example: 'No laboratório, `store: inmemory` e uma instância: o anel tem 128 tokens do mesmo ingester; qualquer token aponta para ele. Em produção com 3 ingesters por zona e zone awareness, o token de E1 seleciona um ingester de cada zona.',
        exercise: { task: 'RF=3, sem zone awareness. Um nó com dois dos três ingesters de E1 perde energia. A escrita de E1 continua?', answer: 'Não. As duas instâncias deixam de mandar heartbeat; depois de heartbeat_timeout, Filter remove ambas e sobra 1 < minSuccess=2: o push falha antes de enviar. Antes do timeout, os envios para elas falham e excedem maxErrors=1. Zone awareness (ou anti-affinity) evita colocar réplicas no mesmo domínio de falha.' }
      }
    ],
    widget: 'quorum',
    flow: 'write',
    example: {
      language: 'YAML • laboratório × produção',
      code: 'common:\n  replication_factor: 1      # laboratório: 1 cópia, minSuccess=1, maxErrors=0\n  ring:\n    kvstore:\n      store: inmemory        # um processo; sem gossip\n# Em produção (ilustração, não default):\n# common.replication_factor: 3     → minSuccess=2, maxErrors=1\n# ingester.lifecycler.ring.zone_awareness_enabled: true\n# memberlist.join_members: [loki-memberlist]',
      caption: 'O laboratório escolhe RF=1 explicitamente; o default do ring de ingesters é 3. Leia o efeito de cada linha sobre minSuccess.'
    },
    exercise: {
      task: 'No laboratório, abra http://localhost:3100/ring e http://localhost:3100/metrics. Encontre o estado do ingester, o número de tokens e `loki_distributor_bytes_received_total`. Depois envie uma linha com timestamp de duas semanas atrás pela API e explique a resposta.',
      solution: 'O ring mostra uma instância ACTIVE com 128 tokens. A linha antiga recebe 400 (greater_than_max_sample_age), porque `reject_old_samples_max_age` é 1w; `loki_discarded_samples_total{reason="greater_than_max_sample_age"}` aumenta. Reenviar não resolve: o erro é de validação, não de capacidade.'
    },
    refs: [
      ref('Código: distributor.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/distributor/distributor.go'),
      ref('Código: replication_strategy.go (dskit vendorizado em v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/vendor/github.com/grafana/dskit/ring/replication_strategy.go'),
      ref('Referência de configuração v3.7.0', 'https://github.com/grafana/loki/blob/v3.7.0/docs/sources/shared/configuration.md'),
      ref('Componentes (documentação)', 'https://grafana.com/docs/loki/latest/get-started/components/'),
      ref('Deep Dive: ingestão (Loki 2.4.1, histórico)', 'https://taisho6339.gitbook.io/grafana-loki-deep-dive/ingestion-process')
    ],
    quiz: [
      q('RF=3. Ingester A responde OK em 8 ms, B retorna erro em 10 ms, C responde OK em 900 ms. Quando o cliente recebe a resposta e qual é?', 1, [
        ['Erro em 10 ms, porque uma réplica falhou.', 'maxErrors=1 tolera uma falha; o erro de B não fecha a requisição.'],
        ['204 em 900 ms, quando C completa a segunda confirmação.', 'minSuccess=2: A conta 1, B falha dentro do tolerado, C fecha o quorum.'],
        ['204 em 8 ms, porque A respondeu.', 'Uma confirmação não atinge minSuccess=2.']
      ]),
      q('Duas linhas com o mesmo tenant e labels, uma com "timeout" e outra com "ok". Para quais ingesters vão?', 0, [
        ['Para o mesmo conjunto de réplicas, porque o token só depende de tenant e labels.', 'TokenFor recebe userID e a string de labels; o conteúdo não entra no hash.'],
        ['Para conjuntos diferentes, porque o hash inclui a linha.', 'A linha não participa do hash; se participasse, um stream ficaria espalhado.'],
        ['Para todos os ingesters, porque o distributor faz broadcast.', 'O broadcast acontece na leitura recente (querier → todos), não na escrita.']
      ]),
      q('Com RF=3, um ingester sem heartbeat há 2 minutos. O que acontece com escritas para streams que incluem esse ingester?', 2, [
        ['Falham sempre, porque o conjunto ficou incompleto.', 'Duas instâncias saudáveis ainda atingem minSuccess=2.'],
        ['Passam a usar RF=2, recalculando minSuccess=2/2+1=2.', 'O cálculo usa RF=3; o resultado coincide aqui, mas a instância ausente continua contando no RF.'],
        ['Seguem para as duas saudáveis e precisam que ambas confirmem.', 'Filter remove a instância sem heartbeat; maxErrors vira 0 para esse stream.']
      ])
    ]
  },
  {
    id: 'ingester',
    quizVersion: 1,
    title: 'Ingester e chunks: E1 dentro da memória',
    short: 'Ingester e chunks',
    duration: '50 min',
    part: 'Siga a escrita',
    question: 'Em que estrutura E1 está um segundo depois do ACK, e o que decide quando ela muda?',
    summary: 'Veja o mapa de streams, o lock por stream, o head block, o corte de blocos comprimidos e o fechamento do chunk, além das regras que recusam linhas fora de ordem.',
    prereqs: 'Módulo 8. Mutex: trava que garante acesso exclusivo; RWMutex permite muitos leitores ou um escritor. Compressão por bloco: comprimir um conjunto de linhas de uma vez, em vez de cada linha.',
    objectives: [
      'Descrever as camadas instance → stream → chunkDesc → MemChunk → blocos e head block.',
      'Prever quando um bloco é cortado e quando um chunk fecha, usando chunk_block_size e chunk_target_size.',
      'Explicar a janela de escrita fora de ordem e calcular se uma linha atrasada será aceita.',
      'Relacionar labels de alta cardinalidade com memória do ingester e chunks pequenos.'
    ],
    trace: 'O ingester recebe E1 para o tenant fake. `instance.Push` procura o stream pelas labels; se não existe, cria (e registra a série no WAL). Trava `chunkMtx` do stream, valida a linha (rate por stream, duplicata, janela de ordem) e a acrescenta ao head block do chunk aberto. Enquanto não houver flush, E1 está aqui, descomprimida, e só aqui é consultável.',
    sections: [
      s('intuicao', K.inf, 'Um caderno por stream', 'Cada stream tem um caderno aberto (o chunk). Linhas novas vão para a página de rascunho (head block). Quando a página enche, ela é comprimida e arquivada no caderno (bloco). Quando o caderno chega ao tamanho alvo, fica fechado e aguarda envio ao armazenamento. Muitos streams pequenos significam muitos cadernos quase vazios.'),
      s('mecanismo', K.code, 'Estruturas e travas', '`Ingester` → `instance` por tenant → `streams` (mapa por labels e por fingerprint) → `stream` com `chunkMtx sync.RWMutex` → `[]chunkDesc` (o último aberto) → `MemChunk` com `blocks []block` (comprimidos) e `head HeadBlock` (não comprimido). Pushes para o mesmo stream são serializados pelo `chunkMtx`; streams diferentes evoluem em paralelo. Leituras usam `RLock` e não bloqueiam umas às outras, mas competem com pushes daquele stream.'),
      s('mecanismo', K.code, 'Corte de bloco e de chunk', '`MemChunk.Append` acrescenta ao head; quando o tamanho não comprimido do head chega a `chunk_block_size` (262144 bytes), `cut()` comprime o head num bloco. Antes de cada linha, `storeEntries` pergunta `SpaceFor`: soma o tamanho comprimido dos blocos cortados, o head não comprimido e a nova linha; se não for menor que `chunk_target_size` (1572864 bytes comprimidos), `cutChunk` fecha o chunk atual e abre outro. Como o head entra sem compressão nessa conta, chunks reais ficam abaixo do alvo.'),
      s('mecanismo', K.code, 'Ordem das linhas', 'Com `unordered_writes: true` (default), o head block é uma range tree que aceita timestamps fora de ordem. O limite é por stream: uma linha é recusada (`entry too far behind`) se for mais antiga que o maior timestamp já aceito menos `max_chunk_age/2` (1 h com o default de 2 h). Linhas com mesmo timestamp, mesmo conteúdo e mesmos metadados que a última aceita são descartadas silenciosamente como duplicata.'),
      s('implementacao', K.code, 'Limite por stream', 'Cada stream tem um limitador de `per_stream_rate_limit` (3 MB/s, burst 15 MB). Excedê-lo gera 429 só para aquele stream. Com `shard_streams` habilitado, o limitador é aplicado ao stream inteiro (`rateLimitWholeStream`): ou o lote do stream passa, ou é recusado inteiro.'),
      s('operacao', K.op, 'O custo da cardinalidade aparece aqui', 'Cada stream ativo custa estruturas, um head block e pelo menos um chunk aberto. 10 000 streams com uma linha por minuto produzem 10 000 chunks pequenos que fecharão por inatividade (30 min) e gerarão 10 000 objetos e entradas de índice. Observe `loki_ingester_memory_streams`, `loki_ingester_memory_chunks` e o histograma `loki_ingester_chunk_utilization` antes de culpar o object storage.')
    ],
    code: [
      c('pkg/ingester/instance.go', 231, 'instance.Push', 'LoadOrStoreNew do stream, push sob chunkMtx, depois um registro WAL por requisição.'),
      c('pkg/ingester/stream.go', 51, 'stream.chunkMtx', 'RWMutex por stream: serializa pushes, permite leituras concorrentes.'),
      c('pkg/ingester/stream.go', 401, 'stream.validateEntries', 'Duplicata, rate limit por stream e janela de ordem, nessa ordem.'),
      c('pkg/ingester/stream.go', 442, 'cutoff := highestTs.Add(-MaxChunkAge / 2)', 'A janela de escrita fora de ordem.'),
      c('pkg/ingester/stream.go', 339, 'stream.storeEntries', 'SpaceFor decide cortar o chunk antes de cada linha.'),
      c('pkg/ingester/stream.go', 513, 'stream.cutChunk', 'Fecha o chunk (Close comprime o head) e abre outro.'),
      c('pkg/chunkenc/memchunk.go', 121, 'MemChunk', 'blocks comprimidos + head não comprimido + symbolizer de metadados.'),
      c('pkg/chunkenc/memchunk.go', 804, 'MemChunk.SpaceFor', 'Compara blocos comprimidos + head não comprimido com o alvo comprimido.'),
      c('pkg/chunkenc/memchunk.go', 868, 'MemChunk.Append', 'Corta bloco quando o head atinge blockSize.'),
      c('pkg/chunkenc/unordered.go', 56, 'unorderedHeadBlock', 'Range tree: inserção O(log n) para aceitar fora de ordem.')
    ],
    dossiers: [
      {
        name: 'Ingester',
        problem: 'Agrupar linhas de cada stream em chunks grandes e comprimidos antes de gravar no object storage, onde cada objeto custa uma operação e latência. Também serve os dados recentes que ainda não estão no bucket.',
        data: { input: 'PushRequest dos distributors; requisições Query, Tail, Label e Series dos queriers.', state: 'Streams por tenant, chunks abertos e fechados ainda não descarregados, índice invertido em memória das labels (`index_shards`), WAL e checkpoint em disco, head TSDB do índice.', output: 'Chunks e referências de índice para o store; respostas de consulta para dados recentes; registros WAL.' },
        steps: ['Recusa se estiver em modo somente leitura ou se o disco do WAL estiver acima do limite.', 'Obtém ou cria a instância do tenant.', 'Para cada stream: LoadOrStoreNew; cria série no WAL se nova; trava chunkMtx.', 'Valida e acrescenta as linhas; corta blocos e chunks conforme os tamanhos.', 'Destrava; ao final, grava um registro WAL com as séries novas e as entradas.', 'Responde ao distributor. O flush loop roda separadamente (módulo 10).'],
        structures: 'Mapa concorrente de streams (`streamsMap`) com lock próprio; índice invertido sharded para encontrar streams por matcher; MemChunk com blocos; range tree no head; pools de registros WAL para reduzir alocação.',
        communication: 'Recebe gRPC dos distributors (escrita) e queriers (leitura recente). Envia chunks ao object storage e referências ao head TSDB. Publica heartbeat no ring.',
        params: [
          p('ingester.chunk_block_size', 'bytes não comprimidos', '262144', 'Menor: mais blocos, leitura mais granular por tempo, pior compressão.'),
          p('ingester.chunk_target_size', 'bytes comprimidos', '1572864', 'Maior: menos objetos e mais memória por stream; 0 volta a 10 blocos fixos.'),
          p('ingester.chunk_encoding', 'codec', 'gzip', 'snappy: menos CPU e chunks maiores; zstd/lz4 trocam CPU por tamanho de forma diferente.'),
          p('ingester.max_chunk_age', 'duração', '2h', 'Também define a janela de ordem (metade). Maior: chunks mais longos, mais memória e mais dados só no ingester.'),
          p('limits_config.unordered_writes', 'bool', 'true', 'false volta à exigência de ordem estrita por stream.'),
          p('limits_config.per_stream_rate_limit', 'bytes/s', '3MB', 'Limite por stream; hot streams devem ser divididos, não liberados.'),
          p('limits_config.per_stream_rate_limit_burst', 'bytes', '15MB', 'Rajada permitida por stream.'),
          p('limits_config.max_global_streams_per_user', 'streams', '5000', 'Teto de streams ativos do tenant, dividido entre ingesters conforme RF.'),
          p('ingester.index_shards', 'shards', '32', 'Partições do índice invertido em memória; precisa ser compatível com o fator de shard das consultas.')
        ],
        guarantees: ['Linhas aceitas de um stream ficam no chunk aberto ou num chunk fechado até o flush e a remoção.', 'Leituras recentes enxergam linhas assim que o push termina, sem esperar flush.'],
        breaks: ['Uma linha mais antiga que maior_ts − max_chunk_age/2 do stream é recusada, mesmo que tenha menos de uma semana.', 'Entre o append e o registro WAL não há durabilidade local: um panic nesse intervalo perde a requisição, mas também não houve ACK.', 'Streams removidos por inatividade perdem o estado de deduplicação: o mesmo reenvio pode ser aceito duas vezes.'],
        failures: [
          f('OOM dos ingesters após deploy de nova aplicação', '`loki_ingester_memory_streams` e `loki_ingester_memory_chunks` subindo; `chunk_utilization` baixa', 'Label nova com valores sem limite. Compare `/loki/api/v1/series` e a cardinalidade das labels.'),
          f('Clientes recebem "entry too far behind"', '`loki_discarded_samples_total{reason="too_far_behind"}`', 'Cliente reenviando lotes antigos depois de uma linha mais nova já aceita no mesmo stream; relógio errado num host.'),
          f('429 com "per stream rate limit"', '`loki_discarded_samples_total{reason="per_stream_rate_limit"}`', 'Hot stream: confirme se shard_streams está ativo; não eleve só o limite.')
        ],
        example: 'E1 (≈150 bytes com metadados) entra no head do chunk aberto do stream `{app="checkout", env="lab", format="json"}`. O gerador escreve 1 linha/s nesse stream: o head chega a 256 KB em cerca de 30 min, o que coincide com `chunk_idle_period`; na prática o chunk fecha por max_age (2 h) ou idle, nunca por tamanho, com poucos blocos.',
        exercise: { task: 'Um stream recebe linhas às 10:00, 10:40 e 11:30 (maior timestamp 11:30). Depois chega uma linha de 10:20 e outra de 10:35. Com max_chunk_age=2h, quais são aceitas?', answer: 'Corte = 11:30 − 1 h = 10:30. A linha de 10:20 é recusada (too far behind); a de 10:35 é aceita e vai para o head (range tree). A janela é relativa ao maior timestamp do stream, não ao relógio do servidor.' }
      },
      {
        name: 'Chunks',
        problem: 'Guardar linhas de um stream de forma compacta e legível por intervalo de tempo, sem índice de conteúdo: a leitura descomprime só os blocos cujo intervalo toca a consulta.',
        data: { input: 'Entradas (timestamp, linha, metadados) de um único stream.', state: 'Blocos comprimidos com mint/maxt, head não comprimido, symbolizer de nomes e valores de metadados.', output: 'Objeto binário com cabeçalho, blocos, metadados de blocos e checksum, gravado como `<tenant>/<fingerprint>/<from>:<through>:<checksum>` (schema ≥ v12).' },
        steps: ['Linhas entram no head.', 'Head atinge block size: comprime num bloco com mint/maxt.', 'SpaceFor falso: Close corta o head restante; chunk fica fechado.', 'Flush: codifica, calcula checksum e grava no store; referências vão ao índice.', 'Leitura: só blocos cujo [mint, maxt] cruza o intervalo são descomprimidos e iterados.'],
        structures: 'Formato de chunk v4 com structured metadata (symbolizer compartilhado); blocos independentes, cada um comprimido com o codec do chunk.',
        communication: 'Ingester produz; store grava; queriers buscam via fetcher (cache → bucket).',
        params: [
          p('ingester.chunk_idle_period', 'duração', '30m', 'Chunk sem novas linhas por esse tempo é descarregado; menor gera mais chunks pequenos.'),
          p('ingester.chunk_target_size', 'bytes comprimidos', '1572864', 'Ver Ingester.'),
          p('ingester.chunk_block_size', 'bytes', '262144', 'Ver Ingester.')
        ],
        guarantees: ['Um chunk pertence a um stream e a um tenant.', 'O checksum na chave detecta corrupção na leitura.'],
        breaks: ['Não há índice dentro do chunk para conteúdo: filtrar por "timeout" exige descomprimir os blocos do intervalo.', 'Réplicas descarregam chunks próprios: com RF=3 podem existir até três objetos com conteúdo quase igual, deduplicados só na leitura.'],
        failures: [
          f('Bucket com milhões de objetos pequenos', '`loki_ingester_chunk_size_bytes` e `chunks_flushed_total{reason="idle"}` dominante', 'Muitos streams de baixa taxa; reduza cardinalidade antes de mexer em idle.')
        ],
        example: 'O chunk de E1, quando descarregado no laboratório, aparece em `/loki/chunks/fake/<fp em hex>/...` (filesystem); seu nome contém início, fim e checksum em hexadecimal.',
        exercise: { task: 'Por que aumentar chunk_target_size de 1,5 MB para 8 MB quase não muda o tamanho dos chunks de um stream de 1 linha/s?', answer: 'Esse stream nunca chega ao alvo: ele fecha por max_age (2 h) ou idle antes. Em 2 h a 150 bytes/linha são ~1 MB não comprimido. O alvo só importa para streams de alta taxa.' }
      }
    ],
    widget: 'chunk',
    flow: 'write',
    example: {
      language: 'YAML • defaults de 3.7.0 explicitados',
      code: 'ingester:\n  chunk_block_size: 262144     # 256 KiB não comprimidos por bloco\n  chunk_target_size: 1572864   # 1,5 MiB comprimidos por chunk (alvo)\n  chunk_encoding: gzip         # default do flag em 3.7.0\n  max_chunk_age: 2h            # também define a janela de ordem: 1h\nlimits_config:\n  unordered_writes: true\n  per_stream_rate_limit: 3MB\n  per_stream_rate_limit_burst: 15MB',
      caption: 'Valores retirados da referência de configuração da tag v3.7.0. Não é preciso escrevê-los; explicitá-los ajuda a raciocinar.'
    },
    exercise: {
      task: 'No laboratório, consulte `loki_ingester_memory_streams`, `loki_ingester_memory_chunks` e `loki_ingester_chunk_utilization` em http://localhost:3100/metrics. Explique por que a utilização é baixa.',
      solution: 'O gerador escreve 1 linha/s por formato: 2 streams e chunks com poucos KB. Eles fecham por tempo, não por tamanho; a utilização (tamanho/alvo) fica perto de zero. Isso é esperado num laboratório e é o padrão de streams de baixa taxa em produção.'
    },
    refs: [
      ref('Código: stream.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/ingester/stream.go'),
      ref('Código: memchunk.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/chunkenc/memchunk.go'),
      ref('Documentação: escrita fora de ordem', 'https://grafana.com/docs/loki/latest/configure/#accept-out-of-order-writes'),
      ref('Documentação: cardinalidade', 'https://grafana.com/docs/loki/latest/get-started/labels/cardinality/')
    ],
    quiz: [
      q('Um stream de alta taxa: blocos cortados somam 1,2 MB comprimidos e o head tem 250 KB não comprimidos. Chega uma linha de 1 KB. O que acontece?', 0, [
        ['O chunk fecha antes da linha, porque 1,2 MB + 250 KB + 1 KB ≥ 1,5 MB.', 'SpaceFor soma head não comprimido; a soma passa do alvo e storeEntries chama cutChunk.'],
        ['A linha entra e o head é comprimido, porque passou de 256 KB.', 'A verificação de SpaceFor vem antes do Append.'],
        ['Nada muda até max_chunk_age.', 'O tamanho é verificado a cada linha.']
      ]),
      q('O maior timestamp aceito de um stream é 12:00. Com max_chunk_age=4h, uma linha de 10:30 chega. Resultado?', 1, [
        ['Recusada, porque a janela é sempre 1 hora.', 'A janela é max_chunk_age/2, logo 2 h aqui.'],
        ['Aceita, porque 10:30 ≥ 12:00 − 2 h.', 'O corte é 10:00; a linha cabe.'],
        ['Recusada, porque é mais antiga que a anterior.', 'Com unordered_writes, ordem estrita não é exigida dentro da janela.']
      ]),
      q('Dois queriers leem o mesmo stream enquanto o Alloy escreve nele. Quem espera quem?', 2, [
        ['Ninguém espera: não há trava no stream.', 'Existe chunkMtx por stream.'],
        ['Um querier bloqueia o outro, porque o lock é exclusivo.', 'Leituras usam RLock, compartilhado entre leitores.'],
        ['Os queriers compartilham o lock de leitura; o push espera os leitores e vice-versa.', 'RWMutex: muitos leitores ou um escritor.']
      ])
    ]
  },
  {
    id: 'wal-flush',
    quizVersion: 1,
    title: 'WAL, checkpoint e flush: o que o ACK garante',
    short: 'WAL e flush',
    duration: '50 min',
    part: 'Siga a escrita',
    question: 'Depois do 204, que falhas podem apagar E1?',
    summary: 'Siga o registro WAL de E1 até o disco, entenda quando há fsync, como checkpoint e replay funcionam, e quais regras levam o chunk ao object storage.',
    prereqs: 'Módulo 9. write() entrega bytes ao kernel; fsync() força o kernel a gravar no dispositivo. Checkpoint: fotografia do estado em memória que permite descartar o WAL antigo.',
    objectives: [
      'Ordenar append em memória, registro WAL, ACK, fsync, flush e envio do índice para uma linha.',
      'Dizer, para cada etapa, quais falhas a linha sobrevive com RF=1 e RF=3.',
      'Explicar replay, replay_memory_ceiling e por que um ingester demora a voltar ao ring.',
      'Diagnosticar fila de flush crescente e disco do WAL cheio em 3.7.0.'
    ],
    trace: 'Após o append de E1, `instance.Push` grava um registro WAL com as entradas da requisição. O kernel recebe os bytes; não há fsync. O ingester responde OK. Dentro de 5 min um checkpoint inclui o chunk aberto. Cerca de 2 h depois (max_age) o flush loop envia o chunk de E1 ao filesystem do laboratório e acrescenta sua referência ao head TSDB; na rotação seguinte de 15 min, o índice é construído e enviado.',
    sections: [
      s('intuicao', K.inf, 'Três tempos diferentes', 'Confirmar, proteger e persistir acontecem em tempos distintos. O ACK chega em milissegundos. A proteção local depende do disco e do kernel. A persistência no bucket pode levar horas. Cada falha atinge uma dessas camadas.'),
      s('mecanismo', K.code, 'O registro WAL', 'Em `instance.Push`, o registro só é escrito depois de todas as linhas da requisição terem sido acrescentadas aos chunks. `walWrapper.Log` grava primeiro as séries novas e depois as entradas, usando o WAL do Prometheus (`wlog`). `WL.log` copia para uma página de 32 KiB e chama `flushPage`, que faz `Write` no arquivo do segmento. Não há fsync por registro: o fsync acontece ao trocar de segmento (512 MiB no Loki: 128 MiB × 4) e no Close.'),
      s('mecanismo', K.code, 'Disco cheio em 3.7.0', 'Dois mecanismos coexistem. 1) `monitorDisk` verifica o uso a cada 10 s; acima de `disk_full_threshold` (0,9), `Ingester.Push` retorna `ErrReadOnly` e o distributor conta falha. 2) Se ainda assim a escrita do WAL falhar com ENOSPC, o erro é contado em `loki_ingester_wal_disk_full_failures_total` e ignorado: a linha está em memória e foi confirmada sem registro WAL. Qualquer outro erro de WAL retorna erro ao distributor.'),
      s('mecanismo', K.code, 'Checkpoint e replay', 'A cada `checkpoint_duration` (5 min), o ingester grava um checkpoint com séries e chunks em memória e apaga segmentos antigos. No início, `Ingester.starting` lê checkpoint e segmentos antes de iniciar o lifecycler: o ingester só entra no ring depois. Durante o replay, limites de streams ficam desligados para não perder dados; se a memória usada passar de `replay_memory_ceiling` (4 GB), chunks são descarregados antes de continuar.'),
      s('mecanismo', K.code, 'Flush', 'A cada `flush_check_period` (30 s), `sweepStream` coloca na fila os streams com chunks a descarregar. `shouldFlushChunk` usa quatro motivos: fechado por tamanho (full), fechado por sincronização (synced), sem linhas há `chunk_idle_period` (idle) ou intervalo maior que `max_chunk_age` (max_age). Há `concurrent_flushes` (32) filas; o stream vai para a fila fp mod 32. `setFlushRate` espalha os flushes ao longo do período para evitar rajadas. Cada flush tenta com backoff (10 s a 1 min, 10 tentativas) e timeout de `flush_op_timeout` (10 min).'),
      s('implementacao', K.code, 'Depois do flush', '`flushChunks` fecha o chunk, codifica, chama `store.Put` (objeto + referência no head TSDB) e marca `flushed`. `removeFlushedChunks` libera a memória quando o tempo desde o flush excede `chunk_retain_period` (0 s). A partir daí, só o store tem E1.'),
      s('operacao', K.op, 'O que monitorar', '`loki_ingester_flush_queue_length` (fila crescendo = store lento ou rate limit), `loki_ingester_chunks_flush_failures_total`, `loki_ingester_chunks_flushed_total{reason}`, `loki_ingester_wal_disk_usage_percent`, `loki_ingester_wal_disk_full_failures_total`, `loki_ingester_wal_replay_active` e `loki_ingester_wal_corruptions_total`. Se o replay demora, o rolling restart precisa esperar a instância ficar ACTIVE.')
    ],
    code: [
      c('pkg/ingester/instance.go', 265, 'i.wal.Log(record)', 'Registro único por requisição, após os appends; ENOSPC é ignorado.'),
      c('pkg/ingester/wal.go', 118, 'walWrapper.Log', 'Séries antes de entradas; um Log por tipo.'),
      c('pkg/ingester/wal.go', 27, 'walSegmentSize', 'Segmentos de 512 MiB: fsync é raro.'),
      c('vendor/github.com/prometheus/prometheus/tsdb/wlog/wlog.go', 675, 'WL.log', 'Página de 32 KiB e Write; sem fsync por registro.'),
      c('vendor/github.com/prometheus/prometheus/tsdb/wlog/wlog.go', 822, 'WL.fsync', 'Chamado ao trocar de segmento e no Close.'),
      c('pkg/ingester/ingester.go', 1010, 'i.wal.IsDiskThrottled()', 'Escritas recusadas com ErrReadOnly acima do limite de disco.'),
      c('pkg/ingester/wal.go', 194, 'walWrapper.monitorDisk', 'Verificação a cada 10 s; histerese ausente: entra e sai pelo mesmo limite.'),
      c('pkg/ingester/ingester.go', 529, 'Ingester.starting', 'Replay de checkpoint e segmentos antes de o lifecycler entrar no ring.'),
      c('pkg/ingester/flush.go', 180, 'Ingester.sweepStream', 'Fila = fingerprint mod concurrent_flushes.'),
      c('pkg/ingester/flush.go', 356, 'Ingester.shouldFlushChunk', 'Motivos full, synced, idle e max_age.'),
      c('pkg/ingester/flush.go', 416, 'Ingester.flushChunks', 'Close, encode, store.Put, marca flushed.'),
      c('pkg/ingester/flush.go', 376, 'Ingester.removeFlushedChunks', 'Libera memória após chunk_retain_period.')
    ],
    dossiers: [
      {
        name: 'WAL',
        problem: 'Recuperar o conteúdo em memória de um ingester que reinicia, sem precisar descarregar tudo a cada push.',
        data: { input: 'Registros de séries (fingerprint ↔ labels) e de entradas (fingerprint, contador, linhas) gerados em cada push.', state: 'Segmentos numerados em `wal.dir` e checkpoints `checkpoint.N`.', output: 'Durante o replay: streams e chunks reconstruídos em memória.' },
        steps: ['Push gera registro; WL grava em página e Write no segmento.', 'Segmento cheio: fsync, novo segmento.', 'A cada 5 min: checkpoint de tudo que está em memória; segmentos anteriores ao checkpoint são removidos.', 'No start: lê checkpoint, depois segmentos; o contador por stream descarta entradas já vistas.', 'Ao terminar: reativa limites e entra no ring.'],
        structures: 'Log segmentado com páginas de 32 KiB, CRC por registro, mutex único no WL (uma escrita por vez por ingester). Pools de buffers para registros.',
        communication: 'Local ao ingester. Não é replicado nem enviado ao bucket.',
        params: [
          p('ingester.wal.enabled', 'bool', 'true', 'false: reinício perde tudo que não foi descarregado; flush_on_shutdown passa a ser essencial.'),
          p('ingester.wal.dir', 'caminho', 'wal (com path_prefix: <prefix>/wal)', 'Precisa estar em volume persistente; no laboratório /loki/wal.'),
          p('ingester.wal.checkpoint_duration', 'duração', '5m', 'Menor: replay mais curto e mais I/O contínuo.'),
          p('ingester.wal.flush_on_shutdown', 'bool', 'false', 'true: descarrega tudo ao parar; shutdown mais lento, sem depender do WAL.'),
          p('ingester.wal.replay_memory_ceiling', 'bytes', '4GB', 'Acima disso o replay descarrega chunks antes de continuar; ajuste para ~75% da memória do pod.'),
          p('ingester.wal.disk_full_threshold', 'fração', '0.9', 'Acima, o ingester recusa pushes (ErrReadOnly). 0 desliga o mecanismo.')
        ],
        guarantees: ['Reinício do processo com o mesmo disco recupera o que foi registrado (o kernel guarda o que foi escrito mesmo se o processo morrer).'],
        breaks: ['Queda de energia ou kernel antes do fsync pode perder os registros mais recentes (inferência a partir do uso de Write sem fsync).', 'Perda do volume perde tudo que não foi descarregado; só réplicas em outros nós protegem.', 'ENOSPC na escrita: a linha é confirmada sem registro WAL.', 'Arquivos corrompidos: o replay continua e registra `wal_corruptions_total`; streams afetados podem ser perdidos.'],
        failures: [
          f('Ingester demora muitos minutos para ficar pronto', '`loki_ingester_wal_replay_active` = 1; logs "recovering from checkpoint"', 'WAL grande (muitos streams ou checkpoint falhando). Verifique `checkpoint_creations_failed_total`.'),
          f('Distributor recebe ErrReadOnly de um ingester', '`loki_ingester_wal_disk_usage_percent` ≥ 0,9', 'Disco pequeno ou checkpoints falhando; não aumente o limite sem entender o crescimento.')
        ],
        example: 'O registro de E1 vai para o segmento atual em /loki/wal. Um `docker compose restart loki` mata o processo; o kernel já tinha os bytes; o replay reconstrói o stream e E1 volta a ser consultável antes do flush. É o que `verify-restart.mjs` comprova.',
        exercise: { task: 'Por que o Loki pode escolher não fazer fsync a cada push, se isso abre uma janela de perda?', answer: 'Um fsync por requisição limitaria a ingestão à latência do disco. O desenho aceita a janela porque a proteção principal contra perda de nó é a replicação (RF=3 em nós distintos); o WAL cobre o caso mais comum, reinício do processo. Com RF=1 essa troca deixa de ser equilibrada.' }
      },
      {
        name: 'Flush',
        problem: 'Mover chunks da memória para o store no momento certo: grandes o bastante para economizar objetos, cedo o bastante para limitar memória e janela de perda.',
        data: { input: 'Chunks fechados ou elegíveis por tempo.', state: '32 filas de prioridade (por tempo inicial), limitador de taxa, backoff por operação.', output: 'Objetos de chunk e ChunkMetas no head TSDB.' },
        steps: ['A cada 30 s, varre streams e enfileira os elegíveis.', 'Calcula a taxa de flushes para terminar a fila dentro do período.', 'Workers retiram da fila, coletam chunks do stream sob lock e fazem o flush sem lock durante o I/O.', 'Sucesso: marca flushed; a limpeza libera memória. Falha: backoff e nova tentativa.'],
        structures: 'Fila por worker indexada por fingerprint; prioridade pelo tempo do primeiro chunk; `rate.Limiter`.',
        communication: 'Ingester → object storage (Put) e → HeadManager.Append.',
        params: [
          p('ingester.flush_check_period', 'duração', '30s', 'Período da varredura.'),
          p('ingester.concurrent_flushes', 'workers', '32', 'Mais workers: mais requisições simultâneas ao bucket.'),
          p('ingester.chunk_idle_period', 'duração', '30m', 'Stream ocioso descarrega após esse tempo.'),
          p('ingester.max_chunk_age', 'duração', '2h', 'Teto de tempo de um chunk em memória.'),
          p('ingester.flush_op_timeout', 'duração', '10m', 'Tempo máximo de uma operação de flush.'),
          p('ingester.chunk_retain_period', 'duração', '0s', 'Mantém chunk em memória após o flush; em 3.7.0 só é ajustado automaticamente para BoltDB Shipper.')
        ],
        guarantees: ['Um chunk só é removido da memória depois de Put bem-sucedido.'],
        breaks: ['Se o bucket está indisponível por muito tempo, a memória cresce até OOM; o WAL também cresce.', 'Falha persistente após as tentativas: o erro é registrado e o chunk tenta de novo no próximo ciclo; não há descarte silencioso, mas a memória acumula.'],
        failures: [
          f('Memória dos ingesters crescendo sem aumento de tráfego', '`loki_ingester_flush_queue_length` crescente, `chunks_flush_failures_total`', 'Erros ou latência do object storage; credenciais; limites de requisição do provedor.')
        ],
        example: 'O chunk de E1 recebe linhas continuamente; não fica ocioso nem cheio. Ao atingir 2 h de intervalo, shouldFlushChunk retorna max_age; o stream vai para a fila fp mod 32 e é descarregado em até ~30 s.',
        exercise: { task: 'Por que um ingester com `flush_on_shutdown: false` e WAL habilitado pode ser reiniciado em segundos, mas um scale-down (remoção definitiva) exige cuidado?', answer: 'No reinício, o mesmo disco volta e o replay recupera os chunks. Na remoção, o disco não volta: chunks não descarregados se perdem a menos que se force o flush (`/flush` ou `/ingester/shutdown?flush=true`) antes de remover a instância.' }
      }
    ],
    widget: 'durability',
    flow: 'write',
    example: {
      language: 'Terminal • laboratório',
      code: 'docker compose exec loki ls -la /loki/wal          # segmentos e checkpoint\ncurl -s localhost:3100/metrics | grep -E "wal_(records_logged|disk_usage)|flush_queue_length|chunks_flushed_total"\ncurl -X POST localhost:3100/flush                   # força flush de todos os chunks\ndocker compose exec loki find /loki/chunks -type f | head',
      caption: 'O endpoint /flush força o descarregamento. Use-o no laboratório para ver os objetos de chunk aparecerem; em produção ele afeta todos os streams da instância.'
    },
    exercise: {
      task: 'Rode o laboratório por 10 minutos. Liste /loki/chunks antes e depois de `curl -X POST localhost:3100/flush`. Compare `loki_ingester_chunks_flushed_total` por motivo. Depois explique por que antes do flush E1 já era consultável.',
      solution: 'Antes do flush, o diretório de chunks do tenant fake pode estar vazio ou com poucos objetos; depois surgem objetos em `<fp>/<nome>`, onde o nome é `from:through:checksum` codificado em base64: no filesystem, `FSEncoder` codifica o último segmento da chave. O motivo registrado é forced. A leitura antes do flush vinha do ingester: o querier consulta ingesters para intervalos dentro de query_ingesters_within (3 h).'
    },
    refs: [
      ref('Código: wal.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/ingester/wal.go'),
      ref('Código: flush.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/ingester/flush.go'),
      ref('Código: wlog.go do Prometheus vendorizado (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/vendor/github.com/prometheus/prometheus/tsdb/wlog/wlog.go'),
      ref('Documentação: WAL', 'https://grafana.com/docs/loki/latest/operations/storage/wal/')
    ],
    quiz: [
      q('RF=1, laboratório. E1 foi confirmada há 1 minuto. O volume /loki é perdido. E1 sobrevive?', 2, [
        ['Sim, o WAL é enviado ao bucket.', 'O WAL é local ao ingester.'],
        ['Sim, porque o checkpoint é remoto.', 'Checkpoint fica no mesmo diretório do WAL.'],
        ['Não: ela estava em memória e no WAL do mesmo volume, e não há réplica.', 'Antes do flush e sem réplicas, o volume era a única proteção.']
      ]),
      q('RF=3 em três nós distintos. Um nó perde energia 50 ms depois do ACK de E1. O que é mais provável?', 0, [
        ['E1 continua em pelo menos duas réplicas; o nó afetado pode ter perdido o registro WAL não sincronizado.', 'O ACK exigiu duas confirmações; o write sem fsync pode não ter chegado ao disco do nó afetado.'],
        ['E1 foi perdida, porque não houve fsync.', 'Os outros nós não falharam.'],
        ['E1 já está no object storage.', 'O flush ocorre minutos ou horas depois.']
      ]),
      q('O disco do WAL de um ingester chega a 92%. O que muda em 3.7.0?', 1, [
        ['Nada até o disco encher: o erro ENOSPC é ignorado.', 'Desde que disk_full_threshold > 0, o monitor marca throttling antes.'],
        ['Em até 10 s o ingester passa a recusar pushes com ErrReadOnly; o distributor conta falhas dessa réplica.', 'monitorDisk compara com 0,9 e Ingester.Push verifica IsDiskThrottled.'],
        ['O ingester descarrega todos os chunks e apaga o WAL.', 'Não há flush automático por disco.']
      ])
    ]
  },
  {
    id: 'armazenamento',
    quizVersion: 2,
    title: 'TSDB e object storage: como achar E1 depois',
    short: 'TSDB e storage',
    duration: '45 min',
    part: 'Siga a escrita',
    question: 'Como um seletor de labels chega à chave do objeto que contém E1?',
    summary: 'Do ChunkMeta no head TSDB ao arquivo enviado a cada 15 minutos, à compactação por tenant e ao schema que interpreta cada período.',
    prereqs: 'Módulos 9 e 10. Índice invertido: mapa de valor de label para lista de séries. Postings: lista ordenada de IDs de séries.',
    objectives: [
      'Descrever o conteúdo de uma entrada TSDB: série, fingerprint e ChunkMetas.',
      'Explicar o ciclo head → arquivo multi-tenant → arquivo por tenant.',
      'Relacionar schema_config, períodos e tabelas diárias com migrações.',
      'Explicar como estatísticas do índice permitem planejar shards antes de ler chunks.'
    ],
    trace: 'Quando o chunk de E1 é descarregado, `HeadManager.Append` registra para o tenant fake: labels do stream (sem `__name__`), fingerprint e um ChunkMeta (início, fim, checksum, KB, entradas). No próximo período de 15 min, o head é rotacionado, um arquivo TSDB multi-tenant é construído e o shipper o envia. O compactor depois o funde no índice diário do tenant fake.',
    sections: [
      s('intuicao', K.inf, 'O índice é um catálogo, não um buscador', 'O TSDB responde "quais chunks de quais séries cobrem este intervalo para estes matchers". Não sabe nada do conteúdo. Por isso uma consulta com seletor amplo encontra rapidamente milhares de chunks, e o trabalho real começa depois.'),
      s('mecanismo', K.code, 'Do flush ao arquivo', 'O ingester escreve ChunkMetas no head em memória e num WAL próprio do índice. A cada `defaultRotationPeriod` (15 min, constante no código), `tick` rotaciona o head e constrói arquivos TSDB multi-tenant por período de índice (normalmente 24 h). O shipper procura arquivos novos para enviar a cada `UploadInterval` (1 min, constante). Até o envio, o índice daquele chunk só existe no ingester, que também o serve para consultas.'),
      s('mecanismo', K.code, 'Chave do objeto', 'Para schema ≥ v12, `newerExternalKey` monta `<tenant>/<fingerprint hex>/<from hex>:<through hex>:<checksum hex>`. Com o fingerprint distribuído na chave, os objetos de um tenant se espalham por prefixos, o que ajuda provedores que particionam por prefixo.'),
      s('mecanismo', K.code, 'Estatísticas e shards', 'Cada ChunkMeta guarda KB e número de entradas. O frontend pede ao índice (`GetStats`, `GetShards`) a soma de bytes que uma consulta tocaria e usa isso para decidir quantos shards criar, antes de ler qualquer chunk (módulo 12).'),
      s('implementacao', K.doc, 'Schema por períodos', '`schema_config.configs` é uma lista ordenada por `from`. Cada período define `store` (tsdb), `object_store`, `schema` (v13) e `index.period` (24h). Um novo período deve começar no futuro: alterar um período passado faz o Loki interpretar objetos antigos com outro formato. Structured metadata exige tsdb + v13.'),
      s('operacao', K.op, 'Object storage', 'Em produção use S3, GCS, Azure ou compatível; filesystem só serve para instância única. O bucket recebe chunks e índices; o compactor precisa de permissão de listagem e exclusão. Lifecycle policies do bucket devem ser mais longas que a retenção do Loki, ou apagarão chunks ainda referenciados.')
    ],
    code: [
      c('pkg/storage/stores/shipper/indexshipper/tsdb/head_manager.go', 48, 'defaultRotationPeriod = 15 * time.Minute', 'Período de rotação do head e de construção dos TSDB.'),
      c('pkg/storage/stores/shipper/indexshipper/tsdb/head_manager.go', 251, 'HeadManager.Append', 'Remove __name__, grava no head ativo e no WAL do índice.'),
      c('pkg/storage/stores/shipper/indexshipper/tsdb/head_manager.go', 175, 'HeadManager.tick', 'Reconstrói o anterior se falhou; rotaciona; constrói o período encerrado.'),
      c('pkg/storage/stores/shipper/indexshipper/shipper.go', 45, 'UploadInterval = 1 * time.Minute', 'Verificação de novos arquivos para envio.'),
      c('pkg/storage/config/schema_config.go', 783, 'newerExternalKey', 'Formato da chave do chunk em schema ≥ v12.'),
      c('pkg/storage/chunk/client/object_client.go', 71, 'FSEncoder', 'No filesystem, o último segmento da chave vira base64; em S3/GCS a chave é usada como está.'),
      c('pkg/loki/config_wrapper.go', 483, 'applyPathPrefixDefaults', 'Como path_prefix preenche diretórios do WAL e do TSDB.')
    ],
    dossiers: [
      {
        name: 'TSDB (índice)',
        problem: 'Encontrar chunks por labels e tempo com um índice em arquivos imutáveis no object storage, sem banco de dados separado.',
        data: { input: 'ChunkMetas de chunks descarregados.', state: 'Head em memória e WAL do índice no ingester; arquivos TSDB no bucket; cópias locais em cache em queriers e index gateways.', output: 'Referências de chunks, séries, valores de labels, estatísticas e shards.' },
        steps: ['Ingester: Append no head (multi-tenant).', 'A cada 15 min: constrói TSDB multi-tenant e envia.', 'Compactor: baixa os arquivos do dia, separa por tenant, funde e envia um arquivo por tenant e período, apagando os anteriores.', 'Leitores: baixam/sincronizam os arquivos (`resync_interval` 5m) e respondem consultas.'],
        structures: 'Formato derivado do TSDB do Prometheus: tabela de símbolos, séries com labels e ChunkMetas, postings por par label/valor. A interseção de postings resolve matchers de igualdade; regex percorre valores.',
        communication: 'Ingester → bucket; compactor ↔ bucket; index gateway/querier ← bucket.',
        params: [
          p('schema_config.configs[].store', 'enum', '(sem default)', 'tsdb é o recomendado; boltdb-shipper é histórico.'),
          p('schema_config.configs[].schema', 'versão', '(sem default)', 'v13 habilita structured metadata.'),
          p('schema_config.configs[].index.period', 'duração', '24h para tsdb', 'Tamanho de cada tabela de índice.'),
          p('storage_config.tsdb_shipper.active_index_directory', 'caminho', '"" (com path_prefix: <prefix>/tsdb-shipper-active)', 'Onde o ingester constrói arquivos; precisa persistir.'),
          p('storage_config.tsdb_shipper.cache_location', 'caminho', '"" (com path_prefix: <prefix>/tsdb-shipper-cache)', 'Cópias locais de índices baixados.'),
          p('storage_config.tsdb_shipper.cache_ttl', 'duração', '24h', 'Tempo que arquivos baixados permanecem no cache local.'),
          p('storage_config.tsdb_shipper.resync_interval', 'duração', '5m', 'Frequência de sincronização com o bucket.')
        ],
        guarantees: ['Arquivos enviados são imutáveis; a compactação substitui, não altera.'],
        breaks: ['Entre o flush e o envio do arquivo (até ~16 min), a referência só existe no ingester: perder o disco perde a referência mesmo com o chunk no bucket.', 'Queriers podem ver o índice com atraso de até resync_interval após uma compactação.'],
        failures: [
          f('Dados antigos aparecem e somem', 'Logs de sync do shipper; erros de download', 'Cache local inconsistente ou sem espaço; permissões no bucket.'),
          f('Erros "failed building tsdb head"', '`headRotations{status="failure"}` no ingester', 'Disco cheio ou permissões no active_index_directory.')
        ],
        example: 'O índice de E1 primeiro existe no head do ingester; após a rotação vira parte de um arquivo multi-tenant `<timestamp>-<ingester>.tsdb`; o compactor gera `index-<from>-<through>-<checksum>.tsdb` para o tenant fake no período do dia.',
        exercise: { task: 'Você mudou `schema: v12` para `v13` no período existente e reiniciou. O que pode dar errado?', answer: 'O Loki passa a ler objetos antigos com o formato do novo período. A forma correta é acrescentar um período com `from` no futuro (UTC) e manter o antigo intacto.' }
      },
      {
        name: 'Object storage',
        problem: 'Oferecer capacidade praticamente ilimitada, durável e barata, compartilhada por todos os componentes, sem exigir discos replicados.',
        data: { input: 'Chunks, arquivos TSDB, regras (opcional), marcadores de exclusão (opcional).', state: 'Objetos imutáveis por chave.', output: 'Objetos sob demanda para queriers, gateways e compactor.' },
        steps: ['Ingester grava chunk e, depois, arquivo de índice.', 'Compactor reescreve índices e apaga chunks expirados.', 'Leitores fazem GET por chave conhecida a partir do índice.'],
        structures: 'Sem estruturas do Loki: o desenho evita listagens no caminho de leitura, pois as chaves vêm do índice.',
        communication: 'HTTP(S) com o provedor; clientes do Loki com retries, hedging e (opcional) controle de congestionamento.',
        params: [
          p('common.storage.hedging.at', 'duração', '0s', 'Envia requisição duplicada após esse tempo; reduz cauda de latência com custo de requisições.'),
          p('common.storage.hedging.up_to', 'requisições', '2', 'Máximo de requisições em hedge.'),
          p('common.storage.congestion_control.enabled', 'bool', 'false', 'Controle AIMD de taxa de requisições ao bucket.')
        ],
        guarantees: ['A durabilidade é a do provedor, não do Loki.'],
        breaks: ['Lifecycle do bucket mais curto que a retenção apaga chunks referenciados: consultas falham com "object not found".', 'Limites de requisições do provedor afetam flush e leitura ao mesmo tempo.'],
        failures: [
          f('Consultas com erros de chunk ausente', 'Logs do querier com 404 do bucket', 'Política de lifecycle ou exclusão manual; compare com a retenção configurada.')
        ],
        example: 'No laboratório, o object store é o filesystem do container: chunks em /loki/chunks/fake/… e índices sob /loki/chunks/index/… (prefixo index_).',
        exercise: { task: 'Por que o Loki não precisa listar o bucket para responder uma consulta?', answer: 'O índice já contém, para cada série, os ChunkMetas; a chave do objeto é derivável (tenant, fingerprint, from, through, checksum). Listagens ficam para o compactor e a sincronização de índices.' }
      }
    ],
    widget: 'reference',
    flow: 'storage',
    example: {
      language: 'YAML • configuração explícita do laboratório',
      code: 'schema_config:\n  configs:\n    - from: "2024-01-01"\n      store: tsdb\n      object_store: filesystem   # só no laboratório\n      schema: v13\n      index:\n        prefix: index_\n        period: 24h\n# Migração futura (exemplo): acrescente, não edite o anterior\n#   - from: "2027-01-01"\n#     store: tsdb\n#     object_store: s3\n#     schema: v13\n#     index: { prefix: index_, period: 24h }',
      caption: 'A migração de backend é um novo período. Os dados antigos continuam no backend anterior até expirarem.'
    },
    exercise: {
      task: 'No laboratório, após forçar um flush, liste `/loki/chunks/fake` e `/loki/tsdb-index` e `/loki/chunks/index/`. Explique o que cada diretório representa e por que o índice pode demorar mais que o chunk a aparecer no store.',
      solution: '/loki/chunks/fake contém um diretório por fingerprint, com um arquivo por chunk cujo nome é `from:through:checksum` em base64 (`FSEncoder`, só no filesystem; S3 e GCS usam a chave sem codificar). /loki/tsdb-index é o diretório ativo do ingester (head, WAL do índice, arquivos construídos). Os índices aparecem em /loki/chunks/index/index_<tabela>/ só depois da rotação de 15 min e do upload: o chunk vai no flush, o índice no ciclo seguinte.'
    },
    refs: [
      ref('Código: head_manager.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/storage/stores/shipper/indexshipper/tsdb/head_manager.go'),
      ref('Documentação: TSDB', 'https://grafana.com/docs/loki/latest/operations/storage/tsdb/'),
      ref('Documentação: schema', 'https://grafana.com/docs/loki/latest/operations/storage/schema/'),
      ref('Documentação: storage', 'https://grafana.com/docs/loki/latest/configure/storage/')
    ],
    quiz: [
      q('O chunk de E1 foi descarregado há 3 minutos. Onde está a referência que permite encontrá-lo?', 1, [
        ['Apenas no bucket, num arquivo TSDB.', 'O arquivo só é construído na próxima rotação de 15 min.'],
        ['No head TSDB e no WAL do índice do ingester; queriers a obtêm perguntando ao ingester.', 'O ingester serve seu head enquanto o arquivo não foi enviado.'],
        ['No próprio nome do objeto, que o querier lista.', 'O caminho de leitura não lista o bucket.']
      ]),
      q('Para usar structured metadata num cluster com schema v12 em TSDB, o que fazer?', 0, [
        ['Acrescentar um período futuro com schema v13 e habilitar allow_structured_metadata.', 'Structured metadata exige TSDB e v13; períodos antigos não mudam.'],
        ['Trocar v12 por v13 no período atual.', 'Isso reinterpreta dados antigos.'],
        ['Ativar unordered_writes.', 'Não tem relação com o formato de metadados.']
      ])
    ]
  }
];
