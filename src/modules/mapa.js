import { K, s, c, p, f, q, ref } from './helpers.js';

// E1 e Q1 acompanham todos os módulos.
export const E1 = {
  line: '{"timestamp":"2026-11-08T14:02:11.418Z","level":"error","message":"payment timeout","duration_ms":1201,"request_id":"req-1"}',
  sentLabels: '{app="checkout", env="lab", format="json"}',
  storedLabels: '{app="checkout", env="lab", format="json", service_name="checkout"}',
  metadata: 'request_id="req-1", detected_level="error"',
  tenant: 'fake'
};
export const Q1 = 'sum by (app) (count_over_time({app="checkout", env="lab"} |= "timeout" | json | level="error" [5m]))';

export const mapa = [
  {
    id: 'fundamentos',
    quizVersion: 2,
    title: 'O mapa: onde está o trabalho',
    short: 'Fundamentos',
    duration: '30 min',
    part: 'Mapa',
    question: 'Quando você escreve E1 e consulta Q1, quais partes do Loki trabalham e o que cada uma guarda?',
    summary: 'Monte o mapa que o resto do curso detalha: o caminho de escrita, o caminho de leitura, o plano de controle, o que é indexado e o que não é, e como cada afirmação do curso é classificada.',
    prereqs: 'Containers e HTTP. Log: registro com horário e conteúdo. Índice: estrutura que responde "onde estão os dados que atendem a esta condição" sem ler tudo. Object storage: armazenamento de objetos imutáveis por chave (S3, GCS, Azure Blob ou disco local no laboratório).',
    objectives: [
      'Nomear os componentes que E1 atravessa até ser durável e os que Q1 atravessa até virar resposta.',
      'Separar fluxo de dados (linhas, chunks, resultados) de fluxo de controle (ring, heartbeats, filas, limites).',
      'Explicar por que o índice de labels responde "quais chunks" e não "quais linhas", e o custo que isso desloca para a leitura.',
      'Classificar uma afirmação técnica como código, documentação, simplificação, inferência ou recomendação.'
    ],
    trace: 'E1 é uma linha JSON escrita pelo gerador do laboratório em `/var/log/demo/json.log`: `{"level":"error","message":"payment timeout","duration_ms":1201,"request_id":"req-1",…}`. O Alloy a envia ao tenant `fake` com os labels `{app="checkout", env="lab", format="json"}`. Q1 é `sum by (app) (count_over_time({app="checkout", env="lab"} |= "timeout" | json | level="error" [5m]))` num intervalo de 24 h. Cada módulo mostra o que acontece com E1 e Q1 naquela etapa.',
    sections: [
      s('intuicao', K.inf, 'Um índice pequeno de propósito', 'O Loki indexa só os labels de cada stream e o intervalo de tempo de cada chunk. Ele não indexa as palavras das linhas. Isso deixa a escrita barata e o índice pequeno, mas transfere trabalho para a consulta: para saber quais linhas têm "timeout", o Loki precisa descomprimir e ler os chunks candidatos. Todo o curso gira em torno desse compromisso: quanto o seletor restringe, quantos bytes sobram para ler e quanto paralelismo existe para lê-los.'),
      s('mecanismo', K.code, 'O caminho de escrita, em uma frase por etapa', 'O cliente envia lotes por HTTP a `/loki/api/v1/push`. O distributor valida, aplica limites e usa o ring para escolher os ingesters de cada stream. O ingester acrescenta a linha ao chunk aberto daquele stream na memória e registra a requisição no WAL. Depois de horas ou de um chunk cheio, o ingester faz flush: grava o chunk comprimido no object storage e acrescenta a referência ao índice TSDB local, que é enviado ao bucket periodicamente. O compactor depois junta índices e aplica retenção.'),
      s('mecanismo', K.code, 'O caminho de leitura, em uma frase por etapa', 'O query frontend recebe Q1, divide 24 h em intervalos de 1 h, calcula shards pelo volume estimado e coloca as tarefas numa fila por tenant (no próprio frontend ou no scheduler). Queriers retiram tarefas, perguntam aos ingesters pelos dados recentes e ao índice (direto ou via index gateway) pelos chunks antigos, buscam chunks no cache ou no bucket, filtram, interpretam e agregam. O frontend junta as respostas parciais.'),
      s('mecanismo', K.code, 'Dados × controle', 'Fluxo de dados é o que carrega linhas ou resultados: push, chunks, consultas e respostas. Fluxo de controle é o que decide quem faz o quê: o ring (quem é dono de cada stream), heartbeats, filas e limites. Uma falha no controle pode bloquear dados que estão íntegros, como no caso de um ingester saudável marcado UNHEALTHY por heartbeat atrasado, que deixa de receber escritas.'),
      s('implementacao', K.code, 'Um binário, vários papéis', 'O mesmo executável roda qualquer componente. `-target=all` (o laboratório) liga, no mesmo processo, query scheduler, query frontend, querier, ingester, pattern ingester, distributor, ruler, compactor e UI. O index gateway **não** faz parte de `all` em 3.7.0: no monolítico, o querier consulta o índice diretamente. Os alvos `read`, `write` e `backend` agrupam papéis para o modo simples escalável (ver módulo 16).'),
      s('implementacao', K.doc, 'Como o curso classifica cada afirmação', '*Confirmado no código*: lido no código-fonte da tag usada pelo laboratório (Loki v3.7.0, commit 3361de24; Alloy v1.11.0), com arquivo e linha. *Confirmado na documentação*: está na documentação oficial, mas não foi rastreado no código. *Simplificação didática*: omite detalhes de propósito, e diz quais. *Inferência*: conclusão derivada de código ou documentação, não medida. *Recomendação operacional*: prática sugerida, que depende do seu ambiente. *Não verificado*: não foi possível confirmar.'),
      s('operacao', K.op, 'Três perguntas para qualquer incidente', '1) O problema está na escrita, na leitura ou no controle? 2) Qual componente guarda o estado envolvido (memória do ingester, WAL, bucket, índice, fila)? 3) Qual métrica ou endpoint mostra esse estado? Os módulos seguintes respondem às três para cada componente.'),
      s('operacao', K.simp, 'O que este mapa omite', 'Pattern ingester, bloom gateway/builder, o caminho de escrita via Kafka e o engine de consultas v2. Eles existem em 3.7.0 e alteram partes do caminho, mas estão desligados no laboratório ou fora do escopo.')
    ],
    code: [
      c('pkg/loki/loki.go', 866, 'deps[All]', 'Lista dos módulos que `-target=all` liga; IndexGateway não está nela.'),
      c('pkg/distributor/http.go', 36, 'Distributor.pushHandler', 'Entrada HTTP do caminho de escrita; responde 204 quando o push termina sem erro.'),
      c('pkg/querier/queryrange/roundtrip.go', 984, 'NewMetricTripperware', 'Cadeia do frontend para consultas métricas como Q1: limites, divisão, cache, shards e retry.'),
      c('pkg/util/constants/api_paths.go', 14, 'PathLokiIndexStats', 'Endpoint que responde quantos streams, chunks e bytes um seletor toca, sem ler as linhas.')
    ],
    dossiers: [],
    widget: null,
    labs: ['ingest'],
    flow: 'overview',
    example: {
      language: 'Shell • laboratório',
      code: '# Quantos streams, chunks e bytes o seletor de Q1 toca nas últimas 24 h?\ncurl -sG http://localhost:3100/loki/api/v1/index/stats \\\n  --data-urlencode \'query={app="checkout", env="lab"}\' \\\n  --data-urlencode "start=$(date -d \'-24 hours\' +%s)000000000" \\\n  --data-urlencode "end=$(date +%s)000000000"\n# Resposta: {"streams":…,"chunks":…,"bytes":…,"entries":…}',
      caption: 'A resposta vem só do índice e dos metadados dos chunks. `bytes` é o volume que uma consulta sem filtro precisaria descomprimir: o número que o frontend usa para escolher shards (módulo 12).'
    },
    exercise: {
      task: 'Com o laboratório rodando, execute o comando acima e depois Q1 no Grafana. Compare `bytes` de index/stats com "Bytes processed" do inspetor de consulta do Grafana. Explique a diferença.',
      solution: 'index/stats estima os bytes descomprimidos dos chunks que o seletor alcança. A consulta processa os chunks que intersectam o intervalo, mais os dados ainda em memória nos ingesters. Os números ficam próximos se quase tudo foi lido; ficam distantes se cache de resultados, limite de linhas ou dados só em memória entraram na conta. O ponto é: o índice sabe quanto há para ler, mas não quantas linhas contêm "timeout".'
    },
    refs: [
      ref('Código-fonte do Loki na tag v3.7.0', 'https://github.com/grafana/loki/tree/v3.7.0'),
      ref('Arquitetura (documentação)', 'https://grafana.com/docs/loki/latest/get-started/architecture/'),
      ref('Componentes (documentação)', 'https://grafana.com/docs/loki/latest/get-started/components/'),
      ref('API HTTP: index/stats', 'https://grafana.com/docs/loki/latest/reference/loki-http-api/#query-log-statistics'),
      ref('Grafana Loki Deep Dive (Loki 2.4.1, histórico)', 'https://taisho6339.gitbook.io/grafana-loki-deep-dive/')
    ],
    quiz: [
      q('Q1 procura "timeout". O índice do Loki responde quais linhas contêm essa palavra?', 1, [
        ['Sim, o TSDB guarda um índice invertido das palavras.', 'O TSDB indexa labels e intervalos de chunks; o conteúdo da linha não é indexado.'],
        ['Não. O índice devolve chunks candidatos pelos labels e pelo tempo; o querier lê as linhas para filtrar.', 'É o compromisso central: escrita e índice baratos, leitura proporcional aos bytes candidatos.'],
        ['Só se a palavra estiver em structured metadata.', 'Structured metadata é guardado no chunk, junto da linha; também não ganha índice textual.']
      ]),
      q('Um ingester saudável deixa de enviar heartbeats por 2 minutos por causa de CPU saturada. Que tipo de falha é essa e qual o efeito?', 2, [
        ['Falha de dados: as linhas na memória dele são corrompidas.', 'Heartbeat é controle; a memória do processo não muda por isso.'],
        ['Nenhum efeito, porque heartbeats só servem para métricas.', 'O ring usa heartbeats para decidir quem pode receber escritas.'],
        ['Falha de controle: o ring o considera UNHEALTHY e as escritas deixam de contar com ele, embora os dados dele estejam íntegros.', 'Passado o `heartbeat_timeout` (1 min), `Filter` remove a instância do conjunto de réplicas.']
      ]),
      q('No laboratório (`-target=all`), quem consulta o índice TSDB durante Q1?', 0, [
        ['O próprio querier, porque o index gateway não está no alvo all em 3.7.0.', 'O alvo all não inclui IndexGateway; sem endereço de gateway, o querier lê o índice localmente.'],
        ['O index gateway embutido no processo.', 'Ele só roda com `-target=index-gateway` ou `backend`.'],
        ['O compactor, que mantém o índice em memória.', 'O compactor reescreve índices no bucket; não responde consultas.']
      ])
    ]
  },
  {
    id: 'modelo-dados',
    quizVersion: 2,
    title: 'Streams, fingerprints e cardinalidade',
    short: 'Modelo de dados',
    duration: '40 min',
    part: 'Mapa',
    question: 'Quantos streams as suas escolhas de labels criam, e onde cada um custa memória, índice e chunks?',
    summary: 'Veja como um conjunto de labels vira identidade de stream, o que o Loki acrescenta sozinho (service_name e detected_level), como o ingester calcula o fingerprint e por que cardinalidade alta fragmenta chunks.',
    prereqs: 'Módulo 1. Cardinalidade: número de valores distintos de um campo. Hash: função que transforma uma entrada num número de tamanho fixo; colisão é quando duas entradas diferentes produzem o mesmo número.',
    objectives: [
      'Prever o conjunto final de labels de E1 depois da ingestão, incluindo os acrescentados pelo Loki.',
      'Distinguir label, structured metadata e campo da linha pelo efeito em índice, memória e consulta.',
      'Estimar o número de streams ativos e o custo de chunks pequenos que um label de alta cardinalidade causa.',
      'Ler o erro de limite de streams e decidir se o problema é o limite ou o modelo de labels.'
    ],
    trace: 'O Alloy envia E1 com `{app="checkout", env="lab", format="json"}` e `request_id` como structured metadata. `ParseRequest` acrescenta `service_name="checkout"` (copiado de `app`), e o distributor acrescenta `detected_level="error"` como structured metadata, lido do campo `level` da linha. O stream de E1 é `{app="checkout", env="lab", format="json", service_name="checkout"}`. No ingester, esse conjunto vira um fingerprint de 64 bits.',
    sections: [
      s('intuicao', K.inf, 'Stream é a unidade de tudo', 'Cada combinação distinta de labels dentro de um tenant é um stream. É por stream que o distributor escolhe ingesters, que o ingester mantém um chunk aberto, que o índice guarda uma série e que os limites são contados. Um label a mais com 100 valores pode multiplicar por 100 tudo isso.'),
      s('mecanismo', K.code, 'O que o Loki acrescenta sem você pedir', 'Em `ParseRequest`, se o stream não tem `service_name` e `limits_config.discover_service_name` não está vazio, o Loki procura o primeiro label da lista (service, app, application, …) e copia o valor para `service_name`; se nenhum existir, usa `unknown_service`. Com `discover_log_levels: true` (default), o distributor procura o nível nos labels, no structured metadata ou na própria linha (JSON ou logfmt) e grava `detected_level` como structured metadata. O primeiro altera a identidade do stream; o segundo, não.'),
      s('mecanismo', K.code, 'Da string ao fingerprint', 'No distributor, `parseStreamLabels` ordena os labels e produz a string canônica, que entra no `TokenFor` do ring (FNV-32). No ingester, `getHashForLabels` calcula um hash de 64 bits (xxhash via `HashWithoutLabels`) e passa pelo `FpMapper`, que detecta colisões: se dois conjuntos diferentes produzem o mesmo hash, um deles recebe outro fingerprint. O fingerprint é a chave do stream no índice em memória, no WAL, no TSDB e no nome do chunk.'),
      s('mecanismo', K.code, 'Onde cada atributo vive', 'Label: compõe o stream; vai ao índice TSDB e ao índice invertido em memória do ingester. Structured metadata: viaja com cada entrada dentro do chunk, não muda o stream e não entra no índice; pode ser filtrado na consulta sem parser. Campo da linha: só existe no texto e precisa de parser (`| json`, `| logfmt`) na consulta. Limites: `max_label_names_per_series` 15 (o `service_name` não conta), `max_structured_metadata_entries_count` 128 e `max_structured_metadata_size` 64KB por entrada.'),
      s('implementacao', K.code, 'O limite de streams é por ingester', '`max_global_streams_per_user` (5000) é convertido em limite local: global ÷ ingesters saudáveis × RF. Com 5000, 10 ingesters e RF=3, cada ingester aceita 1500 streams do tenant. Ao criar um stream novo além disso, `AssertNewStreamAllowed` falha e o push recebe 429 com motivo `stream_limit`. O limite protege a memória do ingester, não o bucket.'),
      s('implementacao', K.inf, 'Por que cardinalidade alta custa na leitura também', 'Cada stream tem seu próprio chunk aberto. Com o mesmo volume dividido por 1000 streams, cada chunk demora 1000 vezes mais para encher e acaba fechado por `chunk_idle_period` ou `max_chunk_age` ainda pequeno. Resultado: mais objetos pequenos no bucket, mais entradas no índice e mais requisições por consulta, cada uma com latência fixa.'),
      s('operacao', K.op, 'Regra prática para labels', 'Use labels para a origem (aplicação, ambiente, cluster, namespace), com valores que você consegue listar. Use structured metadata para identificadores por requisição (request_id, trace_id). Deixe o resto na linha. Antes de promover um campo a label, conte os valores distintos esperados por dia e multiplique pelas outras dimensões.'),
      s('operacao', K.simp, 'O que este módulo omite', 'Políticas de stream (`policy_stream_mapping`), limites por política e o rastreador de streams customizado. Eles mudam qual limite se aplica, não o mecanismo.')
    ],
    code: [
      c('pkg/loghttp/push/push.go', 443, 'ParseRequest (descoberta de service_name)', 'Acrescenta `service_name` antes de o distributor calcular o token.'),
      c('pkg/distributor/field_detection.go', 96, 'FieldDetector.extractLogLevel', 'Procura o nível em labels, metadata e na linha; grava `detected_level` como metadata.'),
      c('pkg/distributor/distributor.go', 1363, 'Distributor.parseStreamLabels', 'Ordena e valida labels; a string canônica entra no TokenFor.'),
      c('pkg/distributor/validator.go', 157, 'Validator.ValidateLabels', 'Número de labels (service_name descontado), tamanho de nome e valor, nomes duplicados.'),
      c('pkg/ingester/instance.go', 465, 'instance.getHashForLabels', 'Hash de 64 bits dos labels com mapeamento de colisões.'),
      c('pkg/ingester/mapper.go', 52, 'FpMapper.MapFP', 'Trata colisões de fingerprint entre conjuntos de labels diferentes.'),
      c('pkg/ingester/instance.go', 305, 'streamCountLimiter.AssertNewStreamAllowed', 'Limite de streams verificado só na criação de stream novo.'),
      c('pkg/ingester/limiter.go', 161, 'calculateLimitForSingleZone', 'Global ÷ ingesters saudáveis × RF.')
    ],
    dossiers: [
      {
        name: 'Stream e índice em memória do ingester',
        problem: 'Agrupar entradas que pertencem à mesma origem para comprimi-las juntas e encontrá-las por labels, sem indexar o conteúdo.',
        data: { input: 'Labels canônicos e entradas de um PushRequest.', state: 'Mapa de streams por tenant (`streamsMap`), índice invertido label→fingerprints em `index_shards` partições, chunk aberto por stream.', output: 'Fingerprint estável usado no WAL, no TSDB e na chave do chunk.' },
        steps: ['O ingester procura o stream pela string de labels no mapa do tenant.', 'Se não existe, analisa a string, verifica o limite de streams, calcula o fingerprint e o registra no índice invertido.', 'Cria a estrutura `stream` com o formato de chunk do schema vigente no timestamp da primeira entrada.', 'Registra a série no WAL (`RefSeries`) junto com as entradas da mesma requisição.'],
        structures: 'Mapa concorrente de streams por tenant; índice invertido particionado (32 shards por padrão), consultado pelos queriers para dados recentes; colisões tratadas por `FpMapper` com um mapa adicional por fingerprint.',
        communication: 'Recebe do distributor via gRPC; responde a queriers com streams que casam com um seletor; repassa fingerprints ao TSDB no flush.',
        params: [
          p('limits_config.max_global_streams_per_user', 'streams', '5000', 'Teto por tenant no cluster, convertido em limite por ingester. Aumentar exige memória proporcional.'),
          p('limits_config.max_streams_per_user', 'streams', '0 (desligado)', 'Limite local fixo por ingester; o menor não nulo entre local e global convertido vence.'),
          p('limits_config.max_label_names_per_series', 'labels', '15', 'Acima disso, 400 na validação.'),
          p('limits_config.discover_service_name', 'lista', 'service, app, application, app_name, name, …', 'Lista vazia desliga a criação automática de service_name.'),
          p('limits_config.discover_log_levels', 'bool', 'true', 'Grava detected_level em structured metadata; custa um parse leve da linha na ingestão.'),
          p('limits_config.max_structured_metadata_entries_count', 'pares', '128', 'Acima disso a entrada é recusada.'),
          p('ingester.index_shards', 'partições', '32', 'Mais partições reduzem contenção no índice em memória.')
        ],
        guarantees: ['Mesmo tenant e mesmos labels canônicos produzem o mesmo stream, o mesmo token e o mesmo fingerprint.', 'Structured metadata nunca cria stream novo.'],
        breaks: ['Ordem dos labels não importa (são ordenados), mas `App` e `app` são labels diferentes.', 'Mudar `discover_service_name` muda o conjunto de labels e portanto cria streams novos para os mesmos dados.'],
        failures: [
          f('Push com 429 "maximum active stream limit exceeded"', '`loki_discarded_samples_total{reason="stream_limit"}` e `loki_ingester_memory_streams`', 'Liste labels com mais valores (`logcli series --analyze-labels` ou `/loki/api/v1/series`); ajuste o modelo antes do limite.'),
          f('Chunks pequenos demais no bucket', '`loki_ingester_chunk_size_bytes` e `loki_ingester_chunks_flushed_total{reason="idle"}` dominando', 'Streams demais para o volume: reduza cardinalidade ou aceite o custo.')
        ],
        example: 'E1 chega com 3 labels. O stream final tem 4: `service_name` foi acrescentado. `request_id` e `detected_level` ficam no structured metadata da entrada. No laboratório só existem dois streams do gerador (json e logfmt), mais streams internos se habilitados.',
        exercise: { task: 'Um time propõe o label `user_id` com 200 mil valores por dia, em 4 ambientes e 6 aplicações. Estime o pior caso de streams e diga o que quebra primeiro.', answer: 'Teto combinatório 200 000 × 4 × 6 = 4,8 milhões por dia. O limite de 5000 streams por tenant corta muito antes: 429 com stream_limit. Mesmo com limite alto, cada stream tem chunk próprio quase vazio, fechado por idle: milhões de objetos pequenos e um índice enorme. `user_id` deve ir para structured metadata.' }
      }
    ],
    widget: 'cardinality',
    flow: 'model',
    example: {
      language: 'Representação do que o Loki guarda para E1',
      code: 'tenant:   fake\nlabels:   {app="checkout", env="lab", format="json", service_name="checkout"}   # identidade do stream\nmetadata: request_id="req-1", detected_level="error"                            # dentro do chunk, por entrada\nlinha:    {"timestamp":"…","level":"error","message":"payment timeout","duration_ms":1201,"request_id":"req-1"}',
      caption: 'Representação didática, não um formato de arquivo. O timestamp da entrada é o momento da leitura pelo Alloy, porque o laboratório não usa `stage.timestamp`.'
    },
    exercise: {
      task: 'No laboratório, consulte `curl -s localhost:3100/loki/api/v1/labels` e `curl -sG localhost:3100/loki/api/v1/series --data-urlencode \'match[]={app="checkout"}\'`. Quantos streams existem e quais labels não estão no config.alloy? Depois rode `{app="checkout"} | detected_level="error"` e explique por que funciona sem `| json`.',
      solution: 'Dois streams (format json e logfmt). `service_name` não está no config.alloy: foi criado por discover_service_name. O filtro em `detected_level` funciona sem parser porque é structured metadata gravado na ingestão; o querier o lê junto com a entrada, sem interpretar a linha.'
    },
    refs: [
      ref('Código: push.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/loghttp/push/push.go'),
      ref('Código: field_detection.go (v3.7.0)', 'https://github.com/grafana/loki/blob/v3.7.0/pkg/distributor/field_detection.go'),
      ref('Cardinalidade (documentação)', 'https://grafana.com/docs/loki/latest/get-started/labels/cardinality/'),
      ref('Structured metadata (documentação)', 'https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/'),
      ref('Boas práticas de labels', 'https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/')
    ],
    quiz: [
      q('E1 chega com `{app="checkout", env="lab", format="json"}`. Com os defaults de 3.7.0, quantos labels tem o stream gravado e por quê?', 2, [
        ['Três, porque o Loki não altera labels.', '`ParseRequest` acrescenta service_name quando ele não existe e a lista de descoberta não está vazia.'],
        ['Cinco, porque detected_level também vira label.', 'detected_level é gravado como structured metadata, fora da identidade do stream.'],
        ['Quatro: `service_name="checkout"` é copiado de `app`.', '`app` é o segundo nome da lista default de discover_service_name.']
      ]),
      q('Você move `request_id` de label para structured metadata. O que muda?', 0, [
        ['O número de streams cai para o número de origens; o filtro por request_id continua possível, mas lê os chunks candidatos.', 'Metadata não cria stream e não entra no índice; a consulta filtra durante a leitura.'],
        ['Nada muda no ingester, só no Grafana.', 'Cada request_id distinto criava um stream com chunk, memória e entrada de índice próprios.'],
        ['A busca por request_id passa a usar o índice TSDB.', 'Structured metadata não é indexado no TSDB.']
      ]),
      q('Tenant com `max_global_streams_per_user: 5000`, 4 ingesters saudáveis, RF=3, uma zona. Quantos streams desse tenant cada ingester aceita?', 1, [
        ['1250, porque 5000 ÷ 4.', 'Falta multiplicar por RF: cada stream ocupa 3 ingesters.'],
        ['3750, porque 5000 ÷ 4 × 3.', 'calculateLimitForSingleZone usa global ÷ saudáveis × RF.'],
        ['5000, porque o limite é global.', 'O limite global é convertido em local em cada ingester.']
      ])
    ]
  },
  {
    id: 'coleta',
    quizVersion: 2,
    title: 'Coleta: do arquivo ao push',
    short: 'Coleta',
    duration: '40 min',
    part: 'Mapa',
    question: 'Se o Loki responde 429 ou 500, E1 se perde, se repete ou espera, e por quanto tempo?',
    summary: 'Siga E1 dentro do Alloy: leitura do arquivo, posição salva, processamento, lote por tenant, envio síncrono, retries com backoff e descarte. Veja o que o cliente faz com cada código HTTP.',
    prereqs: 'Módulos 1 e 2. Backoff exponencial: esperar cada vez mais entre tentativas. Head-of-line blocking: um item parado na frente de uma fila impede os seguintes de avançar.',
    objectives: [
      'Explicar quando um lote do Alloy é enviado (tamanho ou idade) e o que acontece com as linhas seguintes durante um retry.',
      'Prever, pelo código HTTP, se o Alloy reenvia ou descarta, e calcular a janela máxima de retry com os defaults.',
      'Explicar por que a posição salva não é confirmação de entrega e o que isso implica em cada tipo de falha.',
      'Diagnosticar falta de logs separando leitura do arquivo, processamento e envio pelas métricas do Alloy.'
    ],
    trace: 'O gerador grava E1 em `json.log`. O tailer do `loki.source.file` lê a linha, `loki.process` extrai `request_id` e o anexa como structured metadata, e `loki.write` coloca a entrada no lote do tenant (sem `tenant_id`, o Loki do laboratório usa `fake`). O lote sai quando passa de 1 MiB ou quando tem 1 s de idade. O laboratório gera uma linha por segundo por arquivo, então cada push leva poucas linhas.',
    sections: [
      s('intuicao', K.inf, 'O cliente decide parte da durabilidade', 'Antes do Loki, a linha está num arquivo e numa fila em memória do Alloy. O que o Alloy faz quando o Loki recusa ou demora define se a linha chega uma vez, mais de uma vez ou nunca. O Loki só pode garantir o que acontece depois do 204.'),
      s('mecanismo', K.code, 'Leitura e posição', '`loki.source.file` mantém um tailer por arquivo. O tailer lê linhas, envia cada uma para o próximo componente e, periodicamente, grava em `positions.yml` o offset atual do arquivo (`tail.Tell()`), com sincronização a cada 10 s. Esse offset é o que foi **lido**, não o que o Loki confirmou. Se o arquivo encolher abaixo da posição salva (truncamento, como faz o gerador do laboratório ao passar de 5 MB), a posição é descartada e a leitura recomeça do início.'),
      s('mecanismo', K.code, 'Lote e envio', 'O cliente de `loki.write` roda um laço único por endpoint. Cada entrada entra no lote do seu tenant. Se a entrada faria o lote passar de `batch_size` (1 MiB), o lote atual é enviado antes. Um ticker verifica a idade dos lotes e envia os que passaram de `batch_wait` (1 s). O envio (`sendBatch`) é síncrono dentro desse laço: enquanto um lote está em retry, o laço não aceita novas entradas e a fila de entrada enche até bloquear quem a alimenta.'),
      s('mecanismo', K.code, 'Retry por código HTTP', 'Em `sendBatch`, sucesso é qualquer 2xx. Erros de conexão (sem status), 429 e 5xx são reenviados com backoff exponencial do dskit: a espera começa em [500 ms, 1 s) e dobra a cada tentativa até `max_backoff_period` (5 min). Com `max_backoff_retries` 10, o lote é enviado até 10 vezes, com 9 esperas que somam entre cerca de 4 e 8,5 minutos. Depois disso o lote é descartado e conta em `loki_write_dropped_entries_total`. Qualquer outro 4xx, como 400, é descartado na primeira resposta.'),
      s('implementacao', K.inf, 'O que acontece com E1 em cada falha', 'Loki retorna 429: o lote espera e é reenviado; nada se perde se o Loki voltar dentro da janela de retry. Loki retorna 500 depois de gravar em algumas réplicas: o reenvio pode criar duplicatas; o ingester só descarta a duplicata se ela for idêntica à última entrada do stream. Alloy reinicia durante o retry: o lote em memória se perde, e a posição salva já pode estar depois dele, porque a posição acompanha a leitura. Alloy fica fora do ar enquanto o arquivo é truncado ou rotacionado: as linhas que ele não leu podem não existir mais.'),
      s('implementacao', K.doc, 'O WAL do Alloy', '`loki.write` tem um bloco `wal` opcional (desligado por padrão) que grava as entradas em disco antes do envio e faz o cliente ler desse WAL, reduzindo a perda em reinícios. O laboratório não o usa. Ele não foi rastreado no código nesta revisão.'),
      s('operacao', K.op, 'Lendo as métricas do coletor', 'Leitura: `loki_source_file_read_bytes_total` e `loki_source_file_file_bytes_total` por arquivo (a diferença é o atraso de leitura). Envio: `loki_write_sent_entries_total`, `loki_write_batch_retries_total`, `loki_write_dropped_entries_total{reason}` e `loki_write_request_duration_seconds{status_code}`. Se a leitura avança e o envio não, o problema está entre o Alloy e o Loki; se a leitura parou, olhe permissão, caminho e posição.'),
      s('operacao', K.hist, 'Promtail', 'Promtail, citado no Deep Dive e no caso GO, chegou ao fim de suporte em 2 de março de 2026. O cliente dele, ainda presente em `clients/pkg/promtail/client` na tag v3.7.0, tem os mesmos defaults e a mesma regra de retry. Configuração do Alloy não é YAML; não cole configuração do Promtail em config.alloy.')
    ],
    code: [
      c('alloy:internal/component/loki/source/file/file.go', 111, 'positions.New (SyncPeriod 10s)', 'positions.yml é sincronizado a cada 10 s.'),
      c('alloy:internal/component/loki/source/file/tailer.go', 340, 'tailer.markPositionAndSize', 'A posição gravada é o offset lido (`tail.Tell()`), não o confirmado pelo Loki.'),
      c('alloy:internal/component/loki/source/file/tailer.go', 202, 'fi.Size() < pos', 'Arquivo menor que a posição: a posição é removida e a leitura recomeça.'),
      c('alloy:internal/component/common/loki/client/client.go', 277, 'batch.sizeBytesAfter > BatchSize', 'Lote enviado antes de ultrapassar batch_size.'),
      c('alloy:internal/component/common/loki/client/client.go', 299, 'batch.age() < BatchWait', 'Lote enviado por idade.'),
      c('alloy:internal/component/common/loki/client/client.go', 351, 'sendBatch (regra de retry)', 'Reenvia 429, 5xx e erros de conexão; descarta os outros 4xx.'),
      c('alloy:internal/component/common/loki/client/client.go', 366, 'final error sending batch', 'Esgotadas as tentativas, o lote é descartado.'),
      c('vendor/github.com/grafana/dskit/backoff/backoff.go', 99, 'Backoff.NextDelay', 'Espera aleatória entre mínimo e máximo, ambos dobrando até max_backoff.')
    ],
    dossiers: [
      {
        name: 'Cliente de envio (loki.write)',
        problem: 'Transformar um fluxo de linhas em poucas requisições HTTP eficientes e absorver falhas temporárias do Loki sem perder dados, até um limite.',
        data: { input: 'Entradas com labels, timestamp, linha e structured metadata, vindas dos componentes anteriores.', state: 'Um lote por tenant em memória; fila de entrada; com WAL habilitado, segmentos em disco.', output: 'POST protobuf+snappy em `/loki/api/v1/push`; métricas de envio, retry e descarte.' },
        steps: ['Recebe a entrada no canal do cliente.', 'Descarta ou trunca linhas acima de `max_line_size` do cliente, se configurado.', 'Adiciona ao lote do tenant ou envia o lote atual se a entrada o faria passar de `batch_size`.', 'A cada tique, envia lotes mais velhos que `batch_wait`.', 'Codifica, envia e, conforme o status, termina, espera e reenvia, ou descarta.'],
        structures: 'Um goroutine por endpoint com `select` sobre o canal de entradas e um ticker; mapa tenant→lote; backoff do dskit com espera aleatória num intervalo que dobra.',
        communication: 'HTTP para o distributor (ou gateway). O cabeçalho `X-Scope-OrgID` carrega o tenant quando definido.',
        params: [
          p('loki.write > endpoint > batch_size', 'bytes', '1MiB', 'Maior: menos requisições e lotes que podem passar de `ingestion_burst_size_mb` do Loki (6 MB), que nunca são aceitos.'),
          p('loki.write > endpoint > batch_wait', 'duração', '1s', 'Maior: mais latência até o Loki e lotes maiores.'),
          p('loki.write > endpoint > min_backoff_period', 'duração', '500ms', 'Primeira espera de retry.'),
          p('loki.write > endpoint > max_backoff_period', 'duração', '5m', 'Teto de cada espera.'),
          p('loki.write > endpoint > max_backoff_retries', 'tentativas', '10', 'Com 10, cerca de 4 a 8,5 min de retry antes do descarte.'),
          p('loki.write > endpoint > retry_on_http_429', 'bool', 'true', 'false descarta lotes com 429 imediatamente, evitando bloquear outros tenants.'),
          p('loki.write > endpoint > remote_timeout', 'duração', '10s', 'Tempo máximo de cada requisição; timeout conta como erro de conexão e é reenviado.')
        ],
        guarantees: ['Um lote com 2xx foi aceito pelo Loki por inteiro.', 'Dentro da janela de retry, 429 e 5xx não perdem dados enquanto o processo do Alloy estiver vivo.'],
        breaks: ['Reinício do Alloy perde lotes em memória (sem WAL).', 'Retries depois de 5xx parcial geram duplicatas.', 'Um 400 parcial descarta as linhas inválidas sem retry, e o Alloy não distingue quais linhas do lote foram aceitas.'],
        failures: [
          f('Logs atrasados minutos e depois chegando em rajada', '`loki_write_batch_retries_total` subindo e `loki_write_request_duration_seconds{status_code="429"}`', 'O Loki está limitando o tenant; veja `loki_discarded_samples_total{reason="rate_limited"}` no Loki.'),
          f('Linhas faltando sem erro no Loki', '`loki_write_dropped_entries_total{reason}` no Alloy', 'Retries esgotados ou 4xx; o motivo diz qual.'),
          f('Leitura parada', '`loki_source_file_read_bytes_total` constante', 'Caminho, permissão, posição maior que o arquivo ou fila do cliente bloqueada por retry.')
        ],
        example: 'O gerador grava E1. Em até 1 s o lote do tenant (sem tenant explícito) com E1 e a linha info vizinha é enviado. O Loki responde 204 e `loki_write_sent_entries_total` sobe. Se o Loki estivesse parado, a primeira espera seria de 0,5 a 1 s, a segunda de 1 a 2 s, e assim por diante.',
        exercise: { task: 'O Loki fica 3 minutos devolvendo 503 durante um rolling restart. Com os defaults, o Alloy perde dados? E se ficar 12 minutos?', answer: 'Com 3 minutos, não: as esperas acumuladas até a 8ª tentativa somam de 127,5 a 255 s, e as tentativas seguintes alcançam o Loki de volta. Com 12 minutos, o lote esgota as 10 tentativas em no máximo cerca de 8,5 min e é descartado. Enquanto isso, o laço está bloqueado e a leitura do arquivo para; as linhas seguintes esperam no arquivo, e não se perdem, desde que ele não seja truncado nem rotacionado e removido.' }
      }
    ],
    widget: 'retry',
    flow: 'collect',
    example: {
      language: 'Alloy • laboratório comentado',
      code: 'loki.process "json" {\n  stage.json {\n    expressions = { request_id = "request_id" }   // extrai para uso interno\n  }\n  stage.structured_metadata {\n    values = { request_id = "" }                   // anexa à entrada, fora do índice\n  }\n  forward_to = [loki.write.local.receiver]\n}\n\nloki.write "local" {\n  endpoint {\n    url = "http://loki:3100/loki/api/v1/push"\n    // defaults: batch_size 1MiB, batch_wait 1s, max_backoff_retries 10,\n    // min_backoff_period 500ms, max_backoff_period 5m, retry_on_http_429 true\n  }\n}',
      caption: 'Sem `stage.timestamp`, o timestamp de E1 é o momento da leitura, não o campo `timestamp` da linha. Num atraso de leitura, isso desloca os eventos no tempo.'
    },
    exercise: {
      task: 'No laboratório: 1) abra http://localhost:12345/metrics e anote `loki_write_sent_entries_total`. 2) Pare o Loki (`docker compose stop loki`) por 30 s e volte. 3) Compare `loki_write_batch_retries_total` e `loki_write_dropped_entries_total`, e procure no Grafana o intervalo parado.',
      solution: 'Retries sobem durante a parada; descartes não, porque 30 s cabem nas primeiras tentativas. Os eventos do intervalo aparecem com timestamp de leitura, logo após o retorno, porque a leitura também parou enquanto o laço estava em retry. É a diferença entre não perder dados e manter o tempo correto: para manter o horário original, use `stage.timestamp`.'
    },
    refs: [
      ref('Código: cliente loki.write (Alloy v1.11.0)', 'https://github.com/grafana/alloy/blob/v1.11.0/internal/component/common/loki/client/client.go'),
      ref('Alloy: loki.write', 'https://grafana.com/docs/alloy/latest/reference/components/loki/loki.write/'),
      ref('Alloy: loki.source.file', 'https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.file/'),
      ref('Alloy: loki.process', 'https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/'),
      ref('Fim de suporte do Promtail', 'https://grafana.com/docs/loki/latest/send-data/promtail/')
    ],
    quiz: [
      q('O Loki responde 400 a um lote do Alloy por causa de uma linha com timestamp de 10 dias atrás. O que o Alloy faz?', 1, [
        ['Reenvia o lote com backoff até 10 vezes.', 'Só 429, 5xx e erros de conexão são reenviados.'],
        ['Não reenvia; as linhas válidas já foram aceitas pelo Loki e a inválida é perdida.', 'O 400 do Loki é parcial; o Alloy trata 4xx diferente de 429 como definitivo.'],
        ['Descarta o lote inteiro e o Loki também descarta todas as linhas.', 'O distributor aceita as linhas válidas do lote e recusa só as inválidas.']
      ]),
      q('O Alloy é reiniciado enquanto um lote está em retry. A posição salva era posterior às linhas desse lote. O que acontece com elas?', 2, [
        ['São relidas do arquivo, porque a posição só avança depois do 204.', 'A posição acompanha a leitura (`tail.Tell()`), não a confirmação.'],
        ['São recuperadas do WAL do Alloy.', 'O WAL do loki.write é opcional e desligado no laboratório.'],
        ['Perdem-se: estavam só no lote em memória e a leitura recomeça depois delas.', 'É a lacuna entre lido e confirmado; o WAL do loki.write existe para reduzi-la.']
      ]),
      q('Um tenant recebe 429 por horas. Outros tenants enviados pelo mesmo `loki.write` também atrasam. Por quê?', 0, [
        ['O envio é síncrono no laço do cliente: um lote em retry bloqueia os lotes dos outros tenants.', 'É por isso que existe `retry_on_http_429 = false`, que descarta em vez de bloquear.'],
        ['O Loki aplica o limite de um tenant a todos.', 'O rate limiter do distributor é por tenant.'],
        ['O backoff é compartilhado no Loki.', 'Backoff é do cliente; o Loki não guarda estado de retry.']
      ])
    ]
  }
];
