import { K, s, c, p, f, q, ref } from './helpers.js';

// Parte "Labels por dentro": conceitos do artigo "The concise guide to Grafana Loki: Everything you
// need to know about labels" (Ed Welch, 21/12/2023), conferidos contra a documentação e o código da
// tag v3.7.0. Onde o comportamento mudou desde 2023, o texto diz o que mudou.
const ARTICLE = ref('Artigo base: The concise guide to Grafana Loki — labels (dez/2023, histórico)', 'https://grafana.com/blog/the-concise-guide-to-grafana-loki-everything-you-need-to-know-about-labels/');

export const labels = [
  // -------------------------------------------------------------------------
  {
    id: 'labels-streams',
    quizVersion: 1,
    title: 'Labels criam streams; cardinalidade decide o custo',
    short: 'Labels e cardinalidade',
    duration: '45 min',
    part: 'Labels por dentro',
    labs: ['lab1', 'lab2'],
    question: 'Por que um único label a mais pode transformar 96 streams longos em milhares de streams de uma linha só?',
    summary: 'Labels têm dois papéis no Loki: são a chave que distribui os dados entre ingesters e o único índice usado na consulta. Aqui você monta streams a partir de eventos reais e compara, lado a lado, um modelo de labels saudável com um que promove IDs por requisição.',
    prereqs: 'Módulo 2 (streams e fingerprints). Cardinalidade: número de valores distintos de um campo. Stream: sequência de entradas de um tenant com o mesmo conjunto exato de labels.',
    objectives: [
      'Prever em qual stream um evento cai a partir das chaves promovidas a label.',
      'Calcular o teto de streams como produto dos valores possíveis e explicar por que IDs por requisição não têm teto.',
      'Relacionar streams curtos a chunks pequenos, índice maior e 429 stream_limit.',
      'Escolher labels que descrevem a origem e que alguém usa para consultar.'
    ],
    trace: 'E1 chega com `{app="checkout", env="lab", format="json"}`. Se o Alloy promovesse `request_id` a label, cada linha do gerador abriria um stream novo: E1 teria um chunk só para ela, fechado por `chunk_idle_period` 30 min depois, e Q1 teria que abrir um objeto por linha em vez de um por bloco de ~1,5 MB.',
    sections: [
      s('intuicao', K.doc, 'Um label é uma etiqueta que separa caixas', 'Pense em cada combinação de labels como uma caixa. Todas as linhas com exatamente as mesmas etiquetas entram na mesma caixa, em ordem de tempo; mudar um único valor abre outra caixa. O Loki comprime e indexa por caixa. Caixas grandes e duradouras são baratas; milhares de caixas com uma linha cada são caras, porque cada uma tem custo fixo de memória, de índice e de objeto no bucket.'),
      s('intuicao', K.hist, 'O que o artigo de 2023 continua dizendo certo', 'O artigo resume: menos labels é melhor; labels devem descrever infraestrutura (região, cluster, namespace, aplicação, ambiente), ter vida longa (produzir logs por horas) e ser intuitivos para consultar. Isso continua idêntico na documentação 3.7 (`get-started/labels/bp-labels.md`). O próprio artigo diz que o Loki "usa labels do mesmo jeito que há cinco anos".'),
      s('mecanismo', K.code, 'Combinação, não chave: o stream é o conjunto exato', 'O distributor analisa a string de labels e a ordena por nome (`parseStreamLabels`). `{env="prod", app="checkout"}` e `{app="checkout", env="prod"}` são o mesmo stream; `{app="checkout"}` e `{app="checkout", level="info"}` são streams diferentes, mesmo que os dados se pareçam. O conjunto canônico vira o token do ring (FNV-32) e, no ingester, um fingerprint de 64 bits.'),
      s('mecanismo', K.doc, 'O teto é um produto', 'A documentação de cardinalidade dá o exemplo: `status_code` (3 valores) × `action` (5) = 15 streams; acrescentar `endpoint` (3) leva a 45. Labels de poucos valores também explodem quando combinados. Com um ID por requisição o teto deixa de existir: o número de streams passa a acompanhar o número de requisições.'),
      s('mecanismo', K.code, 'O que um stream curto custa', 'Cada stream tem um chunk aberto por réplica. Um stream de uma linha produz um chunk de poucos bytes, que só sai da memória por `chunk_idle_period` (30 min) e vira um objeto próprio no bucket e uma entrada no índice. No Lab 2, o mesmo fluxo de 300 linhas/min gera ~96 streams com chunks crescendo no cenário A e milhares de chunks de dezenas de bytes no cenário B.'),
      s('implementacao', K.code, 'O limite que dispara primeiro', '`max_global_streams_per_user` (default 5000) é convertido em limite por ingester (global ÷ ingesters saudáveis × RF) e verificado só na criação de stream novo (`AssertNewStreamAllowed`). Acima dele, o push recebe 429 com motivo `stream_limit`. `max_label_names_per_series` (15) limita quantos labels cada stream pode ter. O simulador aplica o limite ao tenant inteiro, uma simplificação.'),
      s('implementacao', K.hist, 'Números de referência do artigo', 'Para tenants grandes (mais de 10 TB/dia), o artigo sugere manter menos de 100 mil streams ativos e menos de 1 milhão de streams em 24 h, e cerca de 10 vezes menos para um tenant 10 vezes menor. São orientações de 2023, não limites do software; o default do Loki 3.7 continua 5000 streams ativos por tenant.'),
      s('operacao', K.op, 'Troubleshooting: 429 stream_limit numa segunda-feira', 'Sintoma: `loki_discarded_samples_total{reason="stream_limit"}` sobe depois de um deploy. Investigue com `logcli series \'{}\' --since=1h --analyze-labels` (comando da documentação) para achar o label com mais valores. Quase sempre é um campo dinâmico promovido no coletor. Aumentar o limite só adia: o custo de memória, índice e objetos continua proporcional aos streams.'),
      s('operacao', K.op, 'level como label: aceitável, com custo', 'O artigo considera aceitável extrair `level` para label (é útil no histograma do Explore), mas ele divide cada stream em até 5. No Loki 3.x, `discover_log_levels` (default true) já grava `detected_level` como structured metadata sem criar streams; prefira isso a promover `level`.')
    ],
    code: [
      c('pkg/distributor/distributor.go', 1363, 'Distributor.parseStreamLabels', 'Ordena e valida os labels; a string canônica identifica o stream.'),
      c('pkg/util/ring/ring.go', 12, 'TokenFor', 'FNV-32 de tenant + labels: o mesmo conjunto sempre produz o mesmo token.'),
      c('pkg/distributor/validator.go', 157, 'Validator.ValidateLabels', 'Aplica max_label_names_per_series e limites de tamanho.'),
      c('pkg/ingester/instance.go', 305, 'streamCountLimiter.AssertNewStreamAllowed', 'Recusa streams novos acima do limite local do tenant.'),
      c('pkg/ingester/flush.go', 356, 'Ingester.shouldFlushChunk', 'Fecha chunks por idle, idade máxima ou tamanho: streams curtos viram chunks pequenos.')
    ],
    dossiers: [],
    example: {
      language: 'Alloy • escolher labels na coleta',
      code: 'loki.process "labels" {\n  forward_to = [loki.write.default.receiver]\n\n  // Origem: poucos valores, estáveis, usados em toda consulta.\n  stage.static_labels {\n    values = { cluster = "production", env = "prod" }\n  }\n\n  stage.json {\n    expressions = { namespace = "kubernetes.namespace", app = "kubernetes.app" }\n  }\n  stage.labels {\n    values = { namespace = "", app = "" }\n  }\n  // Não promova trace_id, order_id ou request_id: ficam na linha.\n}',
      caption: 'Só origem vira label. Antes de acrescentar um `stage.labels`, conte os valores distintos por dia e multiplique pelas outras dimensões.'
    },
    exercise: {
      task: 'No Lab 2, deixe `pod` e `trace_id` ligados, volume 300 linhas/min. Em que minuto o cenário B atinge 5000 streams ativos? Depois desligue `trace_id` e mantenha `pod`: quantos streams B tem no minuto 60 e por que esse número é finito?',
      solution: 'Com trace_id, quase toda linha cai numa combinação nova (o trace muda a cada 4 linhas e as outras dimensões variam por linha): cerca de 300 streams novos por minuto. O limite de 5000 ativos é atingido no minuto 17 e, a partir daí, linhas de streams novos recebem 429. No minuto 30 os primeiros streams fecham por idle e liberam vagas, mas o ciclo se repete. Só com pod (6 por app), o teto é 96 × 6 = 576 streams: finito porque pod tem valores limitados. Ainda assim são 6 vezes mais streams, e chunks 6 vezes menores, que em A.'
    },
    refs: [
      ARTICLE,
      ref('Labels (documentação)', 'https://grafana.com/docs/loki/latest/get-started/labels/'),
      ref('Cardinalidade (documentação)', 'https://grafana.com/docs/loki/latest/get-started/labels/cardinality/'),
      ref('Boas práticas de labels (documentação)', 'https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/'),
      ref('Fonte da documentação na tag v3.7.0', 'https://github.com/grafana/loki/tree/v3.7.0/docs/sources/get-started/labels')
    ],
    quiz: [
      q('Dois eventos chegam com `{env="prod", app="checkout"}` e `{app="checkout", env="prod"}`. Quantos streams?', 1, [
        ['Dois, porque a ordem dos labels é diferente.', 'O distributor ordena por nome antes de calcular o token: a ordem de chegada é descartada.'],
        ['Um, porque o conjunto canônico é o mesmo.', 'Mesmo tenant e mesmo conjunto de pares: mesmo stream, mesmo token, mesmo fingerprint.'],
        ['Depende de qual chegou primeiro ao ingester.', 'A identidade não depende de ordem temporal; é uma função dos labels.']
      ]),
      q('Labels `status_code` (3 valores), `action` (5) e `endpoint` (3). Qual o teto de streams por app?', 2, [
        ['11, a soma dos valores.', 'Streams são combinações: o teto é o produto, não a soma.'],
        ['15, porque endpoint não conta.', 'Todo label compõe a identidade; endpoint triplica.'],
        ['45.', '3 × 5 × 3 = 45, como no exemplo da documentação de cardinalidade.']
      ]),
      q('Um time quer `order_id` como label "para achar pedidos mais rápido". Qual o efeito real?', 0, [
        ['Um stream por pedido: chunks quase vazios, índice do tamanho do número de pedidos e 429 stream_limit.', 'É exatamente o cenário B do Lab 2 e o motivo pelo qual a documentação manda evitar labels sem limite de valores.'],
        ['Consultas por pedido ficam instantâneas sem efeito colateral.', 'A busca por um pedido fica barata, mas a escrita, o índice e todas as outras consultas pagam.'],
        ['O Loki detecta e converte order_id em structured metadata automaticamente.', 'Não há conversão automática de labels; quem decide é o cliente (ou a configuração OTLP).']
      ]),
      q('Depois de 30 minutos sem linhas novas, o que acontece com um stream de uma linha só?', 1, [
        ['Nada: o chunk fica na memória até encher.', 'Ele nunca encheria; por isso existe chunk_idle_period.'],
        ['O chunk é fechado por idle e descarregado como um objeto minúsculo no bucket.', '`chunk_idle_period` (30 min) fecha o chunk; o motivo aparece como reason="idle" nas métricas de flush.'],
        ['O stream é apagado sem gravar nada.', 'Dados confirmados são descarregados, não descartados.']
      ])
    ]
  },
  // -------------------------------------------------------------------------
  {
    id: 'ring-sharding',
    quizVersion: 1,
    title: 'Hash ring e stream sharding: para onde cada stream vai',
    short: 'Hash ring e sharding',
    duration: '45 min',
    part: 'Labels por dentro',
    labs: ['lab3', 'lab4'],
    question: 'Se o hash dos labels escolhe o ingester, o que acontece com um stream que sozinho recebe mais bytes do que um ingester aceita?',
    summary: 'O conjunto de labels de um stream é a chave que distribui a carga. Você vai seguir um stream até o anel, ver quais ingesters o recebem, separar distribuição de replicação e, depois, empurrar um stream gigante até o Loki dividi-lo com `__stream_shard__`.',
    prereqs: 'Módulo "Labels criam streams". Hash: função que transforma uma entrada num número de tamanho fixo. Fator de replicação (RF): quantas cópias de cada stream ficam em ingesters diferentes.',
    objectives: [
      'Descrever as seis etapas do distributor até os ingesters de um stream.',
      'Diferenciar distribuição (quem é dono) de replicação (quantas cópias).',
      'Prever quantos streams mudam de dono quando um ingester entra ou sai.',
      'Explicar quando o automatic stream sharding age, como calcula o número de shards e quais são os custos.'
    ],
    trace: 'O stream de E1 tem token FNV-32 de `fake` + `{app="checkout", env="lab", format="json", service_name="checkout"}`. No laboratório há um ingester e RF=1, então ele recebe tudo. Num cluster com RF=3, os três primeiros ingesters distintos no sentido horário a partir desse token recebem cópias de E1, e o ACK sai quando dois confirmam.',
    sections: [
      s('intuicao', K.doc, 'Um relógio com marcas de cada ingester', 'Imagine um relógio com 2³² posições. Cada ingester crava várias marcas nele. Para guardar um stream, calcule o hash dos labels, coloque o ponteiro nessa posição e ande no sentido horário até a primeira marca: o dono dela recebe o stream. Como o hash é sempre o mesmo, o stream sempre cai no mesmo lugar, e o trabalho se espalha porque streams diferentes caem em posições diferentes.'),
      s('mecanismo', K.code, 'As seis etapas no código', '1) O distributor recebe o push. 2) Ordena os labels de cada stream. 3) Calcula `TokenFor(tenant, labels)` (FNV-32). 4) Procura no anel, com busca binária, o primeiro token **estritamente maior** que o hash; se passar do fim, volta ao início (`searchToken`). 5) O dono desse token é a primeira instância. 6) Continua andando e pula tokens de instâncias já escolhidas até reunir RF instâncias distintas (`findInstancesForKey`); com zone awareness, também pula zonas repetidas.'),
      s('mecanismo', K.code, 'Distribuição não é replicação', 'Distribuição responde "qual parte do anel é dona deste stream"; replicação responde "quantas cópias existem". Com RF=3 cada stream está em memória em três ingesters, cada um com seu chunk e seu WAL. O distributor envia às três e responde 204 quando `minSuccess = RF/2 + 1` (2) confirmam (módulo "Distributor e ring"). No Lab 3, o arco amarelo mostra o caminho até o dono; o arco roxo, o caminho até as réplicas.'),
      s('mecanismo', K.code, 'Entrar ou sair muda só os vizinhos', 'Ao entrar, um ingester registra tokens novos e assume apenas os arcos que terminam neles; os outros streams não mudam de dono. Por isso o Loki usa 128 tokens por instância (`num_tokens`): muitos arcos pequenos espalham tanto a carga quanto o impacto de uma mudança. No Lab 3, com poucos tokens por instância, a desigualdade entre fatias fica visível; aumente os tokens e veja a razão maior ÷ menor cair.'),
      s('mecanismo', K.code, 'Um stream grande demais para um ingester', 'O anel distribui streams, não bytes. Um stream de 20 MB/s (uma ponte Kafka, por exemplo) cai inteiro num único dono. O ingester aplica `per_stream_rate_limit` (3MB, burst 15MB) por stream e recusa o excedente com 429. A recomendação da documentação é primeiro procurar um label útil e de baixa cardinalidade que divida o stream; o sharding automático cobre o que sobra.'),
      s('implementacao', K.code, 'Como o sharding decide', 'Ingesters informam a taxa de cada stream; o distributor consulta essa informação a cada segundo (rate store, com média móvel). Em `shardCountFor`, se a taxa ainda é desconhecida o stream segue inteiro; senão, `calculateShards` = `ceil((taxa + push) ÷ desired_rate)` quando o resultado passa de 1. As entradas são distribuídas em rodízio entre os shards, e cada shard recebe o label `__stream_shard__="n"`, ganhando token próprio e, portanto, outro ponto do anel.'),
      s('implementacao', K.doc, 'O que mudou desde o artigo', 'Em 2023 o artigo descrevia o sharding como recurso recente, sem nomes de configuração. No Loki 3.7, `limits_config.shard_streams.enabled` é **true por padrão**, com `desired_rate` de 1536KB. Existe também o time sharding (`__time_shard__`, `time_sharding_enabled`, desligado por padrão), voltado à ingestão de logs muito antigos fora de ordem.'),
      s('operacao', K.op, 'Custos e sinais de que o sharding está trabalhando', 'Cada shard é um stream: conta no limite de streams, tem chunks próprios (menores) e entra no índice. Como o rate store é reativo, os shards ficam acima de `desired_rate` enquanto o volume sobe; a documentação admite isso. Acompanhe `loki_stream_sharding_count`, `loki_rate_store_max_stream_shards` e `loki_rate_store_max_unique_stream_rate_bytes`; se ainda houver 429 de rate limit, reduza `desired_rate`.'),
      s('operacao', K.op, 'Troubleshooting: um ingester quente', 'Sintoma: um ingester com CPU e memória muito acima dos outros. Verifique se um único stream concentra bytes (`loki_rate_store_max_unique_stream_rate_bytes`). Se o sharding está desligado ou com `desired_rate` alto, é o caso do Lab 4. Se a carga é de muitos streams, olhe a distribuição de tokens: ingesters com menos tokens no anel (por exemplo, após um rollout incompleto) recebem fatias desiguais.')
    ],
    code: [
      c('pkg/util/ring/ring.go', 12, 'TokenFor', 'Hash FNV-32 de tenant + labels que posiciona o stream no anel.'),
      c('vendor/github.com/grafana/dskit/ring/util.go', 130, 'searchToken', 'Primeiro token maior que a chave; volta ao início no fim do anel.'),
      c('vendor/github.com/grafana/dskit/ring/ring.go', 549, 'Ring.findInstancesForKey', 'Anda no sentido horário pulando instâncias repetidas até RF.'),
      c('vendor/github.com/grafana/dskit/ring/replication_strategy.go', 33, 'defaultReplicationStrategy.Filter', 'Remove instâncias sem heartbeat e calcula minSuccess.'),
      c('pkg/distributor/distributor.go', 1080, 'Distributor.shardStream', 'Decide se o stream será dividido e cria os streams derivados.'),
      c('pkg/distributor/distributor.go', 1396, 'Distributor.shardCountFor', 'Sem taxa conhecida, 1 shard; senão usa calculateShards.'),
      c('pkg/distributor/distributor.go', 1426, 'calculateShards', 'ceil((taxa + push) ÷ desired_rate) quando maior que 1.'),
      c('pkg/distributor/distributor.go', 1166, 'Distributor.createShard', 'Acrescenta __stream_shard__ e calcula um novo hash para o shard.'),
      c('pkg/distributor/shardstreams/config.go', 10, 'shardstreams.Config', 'enabled, time_sharding_enabled, logging_enabled e desired_rate.'),
      c('pkg/distributor/ratestore.go', 107, 'rateStore.updateAllRates', 'Coleta as taxas dos ingesters; o sharding vê sempre o passado recente.'),
      c('pkg/ingester/stream.go', 433, 'stream.validateEntries (limiter.AllowN)', 'per_stream_rate_limit aplicado por stream no ingester.')
    ],
    dossiers: [],
    example: {
      language: 'YAML • limites de stream no Loki 3.7',
      code: 'limits_config:\n  per_stream_rate_limit: 3MB        # default\n  per_stream_rate_limit_burst: 15MB # default\n  shard_streams:\n    enabled: true                   # default em 3.7\n    desired_rate: 1536KB            # default; reduza se ainda houver 429 por stream\n    logging_enabled: false          # true só para depurar (afeta desempenho)\n\ningester:\n  lifecycler:\n    num_tokens: 128                 # default: muitos arcos pequenos no anel\n    ring:\n      replication_factor: 3         # default',
      caption: 'Valores conferidos em `docs/sources/shared/configuration.md` da tag v3.7.0. O laboratório local usa RF=1 e um ingester.'
    },
    exercise: {
      task: 'No Lab 3, acompanhe o stream `banking-api` com 4 ingesters e RF=3. Anote os três ingesters. Remova um ingester que não está na lista e depois um que está. Em qual dos dois casos o stream muda de dono, e por quê? No Lab 4, com 12 MB/s e desired_rate 1536KB, quantos shards existem no regime e qual a taxa de cada um?',
      solution: 'Remover um ingester fora da lista não muda os donos desse stream: só os arcos que terminavam em tokens do removido passam ao próximo token. Remover um que estava na lista muda o conjunto: o próximo ingester distinto no sentido horário entra. No Lab 4: ceil(12 ÷ 1,5) = 8 shards de 1,5 MB/s cada, abaixo do limite de 3 MB/s, sem descarte; durante a subida, menos shards com taxa maior.'
    },
    refs: [
      ARTICLE,
      ref('Hash rings (documentação)', 'https://grafana.com/docs/loki/latest/get-started/hash-rings/'),
      ref('Automatic stream sharding (documentação)', 'https://grafana.com/docs/loki/latest/operations/automatic-stream-sharding/'),
      ref('Arquitetura (documentação)', 'https://grafana.com/docs/loki/latest/get-started/architecture/'),
      ref('Fonte da doc de stream sharding na tag v3.7.0', 'https://github.com/grafana/loki/blob/v3.7.0/docs/sources/operations/automatic-stream-sharding.md')
    ],
    quiz: [
      q('O hash de um stream cai exatamente sobre um token do ingester-2. Quem recebe o stream?', 2, [
        ['O ingester-2, porque o token é igual.', '`searchToken` procura o primeiro token estritamente maior; empate avança.'],
        ['O ingester anterior no anel.', 'A busca anda no sentido horário, nunca para trás.'],
        ['O dono do próximo token no sentido horário.', 'O código procura o primeiro token maior que a chave, como comenta o próprio dskit.']
      ]),
      q('Com RF=3, um stream está em ingester-1, -4 e -0. O que isso significa?', 0, [
        ['ingester-1 é o dono do arco; -4 e -0 são os próximos ingesters distintos e guardam cópias completas.', 'Distribuição escolhe o primeiro; replicação continua andando até três instâncias distintas.'],
        ['O stream foi dividido em três partes, uma por ingester.', 'Isso seria sharding. Replicação copia o stream inteiro.'],
        ['Só o ingester-1 guarda dados; os outros guardam índices.', 'As três réplicas mantêm chunk e WAL próprios.']
      ]),
      q('Com shard_streams.enabled e desired_rate 1536KB, um stream sobe de 1 para 6 MB/s em poucos segundos. O que acontece?', 1, [
        ['Na mesma requisição o stream vira 4 shards de exatamente 1,5 MB/s.', 'O rate store é reativo e usa a taxa já observada; os shards ficam atrasados e maiores que desired_rate durante a subida.'],
        ['O número de shards cresce com atraso; cada shard recebe __stream_shard__ e um token próprio.', 'É o comportamento descrito na doc e no código (shardCountFor, calculateShards, createShard).'],
        ['O Loki descarta tudo acima de 1,5 MB/s.', 'desired_rate é alvo de divisão; quem descarta é per_stream_rate_limit, por stream.']
      ]),
      q('Qual é um custo real do automatic stream sharding?', 2, [
        ['Consultas por {app="kafka-bridge"} deixam de encontrar os shards.', 'O seletor casa com todos os shards, porque eles têm os mesmos labels mais __stream_shard__.'],
        ['Ele exige bloom filters habilitados.', 'Não há dependência entre os dois recursos.'],
        ['Mais streams e chunks menores: os shards contam no limite de streams e entram no índice.', 'Cada valor de __stream_shard__ é um stream comum para o ingester e para o TSDB.']
      ])
    ]
  },
  // -------------------------------------------------------------------------
  {
    id: 'onde-guardar',
    quizVersion: 1,
    title: 'Label, structured metadata ou linha: onde guardar cada campo',
    short: 'Onde guardar cada campo',
    duration: '35 min',
    part: 'Labels por dentro',
    labs: ['lab5'],
    question: 'Um evento tem cluster, namespace, pod, trace_id e order_id. Qual deles vai para o índice, qual viaja ao lado da linha e qual fica no texto?',
    summary: 'Structured metadata resolveu o dilema que o artigo de 2023 descrevia como "insatisfatório": guardar atributos de alta cardinalidade sem criar streams e sem reescrever a linha. Você vai classificar campos e ver o efeito de cada escolha no índice, no chunk e na consulta.',
    prereqs: 'Módulos "Labels criam streams" e 2. Structured metadata (SM): pares chave=valor anexados a cada entrada, guardados no chunk, fora do índice. Exige schema v13 (chunk V4).',
    objectives: [
      'Classificar campos em label, structured metadata ou linha usando cardinalidade, origem e presença na linha.',
      'Explicar onde cada tipo vive fisicamente e como é consultado.',
      'Reconhecer os limites de SM (64KB e 128 pares por linha, conta na taxa de ingestão).',
      'Saber quais consultas podem usar bloom filters e por quê isso depende de SM.'
    ],
    trace: 'E1 já usa os três lugares: `app`, `env` e `format` são labels; `request_id` e `detected_level` são structured metadata; `duration_ms` e `message` ficam na linha JSON. Q1 filtra `level="error"` depois de `| json`, mas poderia filtrar `detected_level="error"` sem parser, direto no SM.',
    sections: [
      s('intuicao', K.doc, 'Endereço, etiqueta na caixa e conteúdo da carta', 'Label é o endereço: decide em que caixa (stream) a carta vai e é o que o índice usa para achar caixas. Structured metadata é uma etiqueta colada em cada carta: viaja junto, dá para ler sem abrir o envelope, mas ninguém mantém um catálogo delas. A linha é o conteúdo da carta: para saber o que está escrito é preciso abrir e ler.'),
      s('mecanismo', K.doc, 'Onde cada um vive', 'Label: compõe a identidade do stream, vai ao índice TSDB e escolhe streams antes de qualquer leitura. Structured metadata: gravado no chunk ao lado de cada entrada (chunk V4, schema v13), sem índice; é devolvido como label nos resultados e filtrável com `| chave="valor"`. Linha: texto livre; filtros de linha (`|=`) procuram substrings e parsers (`| json`, `| logfmt`) extraem campos na hora da consulta.'),
      s('mecanismo', K.doc, 'O que mudou desde 2023', 'O artigo apresentava structured metadata como experimental no 2.9, com GA prometido para o 3.0. No Loki 3.7 ele é estável e vem **habilitado por padrão** (`allow_structured_metadata: true`), com `max_structured_metadata_size` 64KB e `max_structured_metadata_entries_count` 128 por linha. As saídas antigas que o artigo citava para `pod` (indexar se ficasse abaixo de ~100 mil streams/hora, ou usar o stage `pack` do Promtail) deixaram de ser necessárias.'),
      s('mecanismo', K.doc, 'Quando a documentação manda usar SM', 'A página de structured metadata da 3.7 lista: dados em formato OpenTelemetry; metadados de alta cardinalidade que não devem ser label **e não existem na linha** (process_id, thread_id, nomes de pod); Logs Drilldown; e bloom filters, que desde o 3.3 indexam SM. Note a condição "não existe na linha": duplicar um valor que já está no texto custa bytes por entrada.'),
      s('implementacao', K.code, 'Consulta: o que cada escolha permite', 'Label: `{pod="banking-api-7f9d8"}` — o índice reduz os chunks lidos. SM: `{app="banking"} | pod="banking-api-7f9d8"` — lê todos os chunks do seletor, mas filtra sem parser; se o filtro vier antes de qualquer parser, pode usar bloom filters. Linha: `{app="banking"} |= "abc123"` — lê os mesmos chunks e procura texto em cada linha. Em métricas, SM vira label do resultado: agrupar por ele pode estourar `max_query_series`; use `| keep` ou `| drop`.'),
      s('operacao', K.op, 'Decisão arquitetural: OTLP decide por você', 'Ao ingerir OTLP, o Loki promove alguns atributos de recurso a labels (`default_resource_attributes_as_index_labels`) e grava o resto como structured metadata. Revise essa lista: um atributo de recurso de alta cardinalidade promovido a label repete o cenário B do Lab 2.'),
      s('operacao', K.op, 'Troubleshooting: "entry too large" depois de adotar SM', 'Se as linhas começam a ser recusadas após mover atributos para SM, confira `max_structured_metadata_size` e `max_structured_metadata_entries_count`. SM conta no limite de taxa de ingestão: mover campos da linha para SM não reduz bytes; duplicá-los aumenta.')
    ],
    code: [
      c('pkg/distributor/validator.go', 157, 'Validator.ValidateLabels', 'Valida labels; structured metadata é verificado separadamente por tamanho e quantidade.'),
      c('pkg/storage/bloom/v1/tokenizer.go', 24, 'StructuredMetadataTokenizer.Tokens', 'Os bloom filters indexam pares de SM, não o texto da linha.'),
      c('pkg/logql/log/parser.go', 25, 'duplicateSuffix', 'Campo extraído com nome de label existente recebe _extracted.')
    ],
    dossiers: [],
    example: {
      language: 'Alloy • trace_id em structured metadata',
      code: 'loki.process "otel_like" {\n  forward_to = [loki.write.default.receiver]\n\n  stage.json {\n    expressions = { trace_id = "", pod = "kubernetes.pod_name" }\n  }\n  // pod: alta cardinalidade, não está na linha que será gravada.\n  stage.structured_metadata {\n    values = { pod = "" }\n  }\n  // trace_id já está no JSON: fica na linha; promova a SM só se for usar bloom filters.\n}',
      caption: 'Structured metadata exige `allow_structured_metadata: true` (default em 3.7) e schema v13. Consulta: `{namespace="banking"} | pod="banking-api-7f9d8"`.'
    },
    exercise: {
      task: 'No Lab 5, aplique "Tudo como label" e anote streams por dia. Depois mova só `trace_id` e `order_id` para structured metadata. Quanto cai? Em seguida aplique a recomendação. Por que a recomendação deixa trace_id na linha, e em que situação você mudaria para SM?',
      solution: 'Tudo como label: 8 × 3 × 25 × 400 × 2×10⁶ × 3×10⁵ × 5, um número absurdo. Sem os dois IDs, sobra 8 × 3 × 25 × 400 × 5 = 1,2 milhão: ainda alto por causa de pod e level. Na recomendação: 8 × 3 × 25 = 600 streams/dia. trace_id fica na linha porque já está no JSON; mudaria para SM se viesse só como atributo OTel (não na linha) ou se você habilitar bloom filters, que só aceleram filtros de SM antes de parser.'
    },
    refs: [
      ARTICLE,
      ref('Structured metadata (documentação)', 'https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/'),
      ref('Labels (documentação)', 'https://grafana.com/docs/loki/latest/get-started/labels/'),
      ref('Fonte da doc de structured metadata na tag v3.7.0', 'https://github.com/grafana/loki/blob/v3.7.0/docs/sources/get-started/labels/structured-metadata.md')
    ],
    quiz: [
      q('`pod` tem 400 valores por dia e não está na linha. Onde guardar, segundo a documentação 3.7?', 1, [
        ['Label, porque 400 é pouco.', '400 valores multiplicam todos os streams e mudam a cada deploy: streams curtos e chunks pequenos.'],
        ['Structured metadata.', 'É o exemplo da própria documentação: alta cardinalidade, não está na linha.'],
        ['Reescrever na linha com stage pack.', 'Era a saída histórica que o artigo considerava insatisfatória; SM a substituiu.']
      ]),
      q('Qual consulta lê menos chunks, se pod for structured metadata?', 0, [
        ['As duas leem os mesmos chunks de {app="banking"}; o filtro de SM só evita parser.', 'SM não é indexado: o seletor decide os chunks; o filtro roda em cada entrada lida (salvo bloom filters).'],
        ['`{app="banking", pod="x"}`, porque pod vira label na consulta.', 'Um matcher de seletor para um nome que não é label não casa com stream nenhum.'],
        ['`{app="banking"} | pod="x"`, porque SM tem índice próprio.', 'SM não tem índice; bloom filters são opcionais e experimentais.']
      ]),
      q('Mover campos da linha para structured metadata reduz a taxa de ingestão contabilizada?', 2, [
        ['Sim, SM não conta no limite de taxa.', 'A documentação avisa que o tamanho de SM entra no rate limiting.'],
        ['Sim, porque SM é comprimido à parte.', 'Compressão não muda o que é contabilizado na ingestão.'],
        ['Não: SM conta na taxa, e duplicar um valor que já está na linha aumenta os bytes.', 'É por isso que a doc recomenda SM para valores que não estão na linha.']
      ])
    ]
  },
  // -------------------------------------------------------------------------
  {
    id: 'agulha',
    quizVersion: 1,
    title: 'Procurar uma agulha: LogQL e bloom filters',
    short: 'LogQL e bloom filters',
    duration: '50 min',
    part: 'Labels por dentro',
    labs: ['lab6', 'lab7'],
    question: 'Como achar o trace_id abc123 em terabytes de logs sem transformar cada ID em label?',
    summary: 'O seletor de labels decide quanto o Loki lê; filtros e parsers decidem quanto trabalho ele faz em cada linha lida. Bloom filters acrescentam uma etapa opcional: descartar com segurança chunks que certamente não contêm um valor de structured metadata.',
    prereqs: 'Módulos "Labels criam streams" e "Onde guardar cada campo". Bloom filter: estrutura probabilística que responde "certamente não contém" ou "talvez contenha"; nunca "certamente contém".',
    objectives: [
      'Separar o que o seletor faz (escolher streams pelo índice) do que o pipeline faz (processar linhas lidas).',
      'Ordenar etapas de uma consulta para interpretar menos linhas.',
      'Explicar por que `| trace_id="abc123"` só encontra linhas onde trace_id é label, SM ou campo extraído antes.',
      'Explicar o que um bloom filter descarta com segurança, o que precisa ser verificado e por que não há falso negativo.'
    ],
    trace: 'Q1 começa por `{app="checkout", env="lab"}`: o índice devolve os chunks desse stream em 24 h e nenhum outro. `|= "timeout"` descarta linhas antes de `| json`, que é a etapa cara. Se E1 trouxesse `trace_id` como structured metadata e bloom filters estivessem habilitados, uma busca `| trace_id="..."` antes do parser poderia pular chunks inteiros.',
    sections: [
      s('intuicao', K.doc, 'Funil: o índice escolhe as gavetas, o pipeline lê as folhas', 'O seletor `{...}` é a única parte que usa índice: ele escolhe quais gavetas (streams) abrir. Tudo depois do `}` trabalha folha por folha dentro das gavetas abertas. Uma consulta rápida abre poucas gavetas e descarta folhas cedo, com filtros simples, antes de interpretar cada uma.'),
      s('mecanismo', K.code, 'Seletor: a regra que recusa consultas', 'Pelo menos um matcher precisa recusar o valor vazio. `{app=~".*"}` e `{app!="x"}` sozinhos são recusados com "queries require at least one regexp or equality matcher that does not have an empty-compatible value" (`pkg/logql/syntax/parser.go`). Seletores mais amplos casam mais streams: mais chunks baixados e mais bytes descomprimidos.'),
      s('mecanismo', K.code, 'Pipeline: filtros, parsers e filtros de label', 'Filtros de linha (`|=`, `!=`, `|~`, `!~`) procuram texto sem interpretar. Parsers (`| json`, `| logfmt`) extraem campos de cada linha que chega a eles; uma linha que não é JSON recebe `__error__="JSONParserErr"` e continua. Filtros de label (`| campo="valor"`) olham labels do stream, structured metadata e campos extraídos; se um campo extraído tem o nome de um label do stream, ele vira `campo_extracted`.'),
      s('mecanismo', K.code, 'A armadilha de `| trace_id="abc123"`', 'Sem parser antes, esse filtro só enxerga labels e structured metadata. Se trace_id está apenas no JSON, nenhuma linha casa e o resultado é vazio, sem erro. No Lab 6, compare o exemplo "trace_id como structured metadata" (app banking, que tem SM) com o stream payments, onde o ID só existe no JSON e é preciso `| json` antes.'),
      s('mecanismo', K.code, 'Bloom filter: certamente não, ou talvez', 'Um bloom filter é um vetor de m bits e k funções de hash. Inserir liga k bits; testar verifica os mesmos k bits. Se algum está em 0, o item nunca foi inserido: descarte seguro. Se todos estão em 1, pode ser o item ou uma coincidência de outros itens (falso positivo), e o chunk precisa ser lido. Não existe falso negativo, porque inserir nunca desliga bits. A taxa de falso positivo cresce com o preenchimento: (1 − e^(−kn/m))^k.'),
      s('implementacao', K.code, 'Como o Loki 3.7 usa blooms', 'O bloom builder lê chunks já descarregados e, para cada par de structured metadata, insere quatro tokens no bloom do stream: `nome`, `nome=valor` e as duas versões prefixadas pela referência do chunk (`tokenizer.go`). O bloom gateway, chamado pelo index gateway, testa o token sem prefixo para pular o stream inteiro e o prefixado para pular chunks. O query frontend também usa blooms no planejamento com `tsdb_sharding_strategy: bounded`.'),
      s('implementacao', K.doc, 'O que mudou desde o artigo', 'O artigo prometia bloom filters "no Loki 3.0" para buscas como `|= "<uuid>"` no texto. No 3.3 houve uma mudança de rumo: blooms deixaram de indexar texto livre e passaram a indexar **só structured metadata**; o bloom compactor foi substituído por planner e builder. Hoje só são acelerados filtros `| chave="valor"` (ou `or`, ou regex simples convertida) sobre SM, colocados antes de qualquer parser. `|= "abc123"` não é acelerado.'),
      s('operacao', K.op, 'Status e custo: experimental', 'Na 3.7, query acceleration com blooms é **experimental**, sem SLA, indicado para quem ingere mais de 75 TB/mês, não suportado em single binary e recomendado só no modo microsserviços. Exige deploy de bloom planner (uma única instância), builders e gateways com SSD local, e `bloom_creation_enabled`/`bloom_gateway_enable_filtering` por tenant. Dados recentes ainda nos ingesters não passam por blooms.'),
      s('operacao', K.op, 'Blooms não substituem o índice de labels', 'O índice de labels decide quais streams entram na consulta; blooms só podem tirar chunks desse conjunto. Um seletor amplo como `{cluster="prod"}` continua listando todos os chunks do cluster no índice; o bloom apenas evita baixar parte deles. Para a maioria dos clusters, a estratégia certa continua a do artigo: seletor estreito + filtro de linha.')
    ],
    code: [
      c('pkg/logql/syntax/parser.go', 19, 'errAtleastOneEqualityMatcherRequired', 'Recusa seletores em que todo matcher aceita o valor vazio.'),
      c('pkg/logql/log/parser.go', 74, 'JSONParser.Process', 'Extrai campos de cada linha; erro de parse vira __error__.'),
      c('pkg/logql/log/parser.go', 25, 'duplicateSuffix', 'Conflito entre campo extraído e label do stream: sufixo _extracted.'),
      c('pkg/storage/bloom/v1/tokenizer.go', 24, 'StructuredMetadataTokenizer.Tokens', 'Quatro tokens por par de SM: nome, nome=valor e versões prefixadas pelo chunk.'),
      c('pkg/bloomgateway/bloomgateway.go', 205, 'Gateway.FilterChunkRefs', 'Recebe chunks candidatos do index gateway e remove os que o bloom descarta.')
    ],
    dossiers: [],
    example: {
      language: 'LogQL • da mais cara à mais barata',
      code: '# 1) Amplo e interpreta tudo: lê o cluster inteiro, faz parse de cada linha\n{cluster="production"} | json | trace_id="abc123"\n\n# 2) Seletor estreito + filtro de linha antes do parser\n{cluster="production", namespace="banking", app="banking"} |= "abc123" | json\n\n# 3) trace_id em structured metadata, filtro antes de qualquer parser:\n#    elegível a bloom filters (experimental, se habilitados)\n{cluster="production", namespace="banking"} | trace_id="abc123"',
      caption: 'Todas são LogQL válidas. Só a 3 pode ser acelerada por blooms, e só se trace_id estiver em structured metadata e os componentes de bloom estiverem implantados.'
    },
    exercise: {
      task: 'No Lab 6, rode "Seletor amplo + filtro" e anote bytes lidos. Reescreva para ler menos e retornar as mesmas linhas de app banking. No Lab 7, com m=32, procure abc123: quantos falsos positivos? Aumente m até zerar. Por que, em nenhuma configuração, o chunk que contém abc123 é pulado?',
      solution: 'O seletor amplo lê os 4 streams (todos os bytes). `{app="banking"} |= "abc123"` lê só os streams de app banking e devolve as linhas de banking. No Lab 7, com m=32 aparecem vários falsos positivos; com 128 bits eles somem neste cenário. O chunk com abc123 nunca é pulado porque os bits ligados na inserção continuam ligados: o teste sempre encontra 1 em todas as posições, então a resposta é "talvez", nunca "não".'
    },
    refs: [
      ARTICLE,
      ref('Bloom filters (documentação, experimental)', 'https://grafana.com/docs/loki/latest/operations/bloom-filters/'),
      ref('Query acceleration (documentação)', 'https://grafana.com/docs/loki/latest/query/query_acceleration/'),
      ref('Consultas de log: filtros e parsers', 'https://grafana.com/docs/loki/latest/query/log_queries/'),
      ref('Notas da versão 3.3 (mudança dos blooms para structured metadata)', 'https://github.com/grafana/loki/blob/v3.7.0/docs/sources/release-notes/v3-3.md')
    ],
    quiz: [
      q('`{app="payments"} | trace_id="abc123"` retorna vazio, mas a linha tem `"trace_id":"abc123"` no JSON. Por quê?', 1, [
        ['O Loki não suporta filtro de label sem agregação.', 'Filtros de label funcionam em consultas de log.'],
        ['Sem parser antes, o filtro só vê labels e structured metadata; o campo do JSON nunca foi extraído.', 'É preciso `| json` (ou SM na ingestão) antes do filtro.'],
        ['trace_id é um nome reservado.', 'Não é; é só um campo que não existe nas labels daquela linha.']
      ]),
      q('O bloom de um chunk testa as posições 3, 17 e 40 para trace_id=abc123. A posição 17 está em 0. Conclusão?', 0, [
        ['O chunk certamente não contém abc123 e pode ser pulado.', 'Inserir abc123 teria ligado as três posições; um 0 prova ausência.'],
        ['O chunk talvez contenha abc123 e precisa ser lido.', 'Isso vale quando todas as posições estão em 1.'],
        ['O bloom está corrompido.', 'Bits em 0 são normais; são eles que permitem descartar.']
      ]),
      q('Qual consulta pode ser acelerada por bloom filters no Loki 3.7?', 2, [
        ['`{cluster="prod"} |= "abc123"`', 'Desde o 3.3 blooms não indexam texto livre; filtros de linha não são acelerados.'],
        ['`{cluster="prod"} | json | trace_id="abc123"`', 'O filtro vem depois de um parser; a doc diz que isso impede a aceleração.'],
        ['`{cluster="prod"} | trace_id="abc123"` com trace_id em structured metadata', 'Filtro de igualdade sobre SM, antes de qualquer parser: atende aos critérios da documentação.']
      ]),
      q('Por que bloom filters não substituem o índice de labels?', 1, [
        ['Porque são lentos demais para qualquer uso.', 'São rápidos; o ponto é o papel, não a velocidade.'],
        ['Porque só podem remover chunks de um conjunto que o índice de labels já escolheu.', 'O seletor define os candidatos; blooms descartam parte deles com segurança.'],
        ['Porque só funcionam para labels.', 'Funcionam para structured metadata, justamente o que não é label.']
      ])
    ]
  }
];
