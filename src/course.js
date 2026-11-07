export const consultedAt = '2026-11-07';
export const versions = { loki: '3.7.0', alloy: '1.11.0', grafana: '12.2.0' };
export const modules = [
  {
    "id": "fundamentos",
    "title": "O mapa antes do caminho",
    "short": "Fundamentos",
    "duration": "15 min",
    "part": "Comece aqui",
    "summary": "Entenda o que o Loki guarda, o que o Grafana mostra e por que o índice muda a forma de investigar.",
    "prereqs": "Noções de containers e requisições HTTP. Um log é um registro de evento com horário e conteúdo; observabilidade é investigar o estado de um sistema a partir dos sinais que ele emite.",
    "objectives": [
      "Distinguir coletor, armazenamento e visualização.",
      "Relacionar labels, streams e consultas.",
      "Reconhecer o compromisso entre indexação e leitura."
    ],
    "sections": [
      {
        "title": "Quem faz o quê",
        "kind": "Fato documentado",
        "text": "Grafana é a interface de exploração. Loki recebe e consulta logs. Um coletor lê eventos e os envia. Label é um par chave/valor usado para organizar a origem; stream é um conjunto de entradas do mesmo tenant com labels idênticos. Tenant é a unidade lógica de isolamento."
      },
      {
        "title": "O compromisso do índice",
        "kind": "Fato documentado",
        "text": "O índice de labels ajuda a encontrar chunks, blocos comprimidos de logs. O conteúdo da linha não recebe um índice textual completo. Procurar uma palavra pode exigir ler dados candidatos. Um seletor preciso restringe a busca antes do processamento da mensagem."
      },
      {
        "title": "Pensar antes de dimensionar",
        "kind": "Inferência didática",
        "text": "Guardar muito e consultar pouco favorece esse compromisso. Consultas amplas e frequentes podem deslocar custo para a leitura. Isso não demonstra que Loki será mais barato em qualquer cenário: meça armazenamento, computação, transferência e trabalho operacional."
      }
    ],
    "example": {
      "language": "LogQL",
      "code": "{app=\"checkout\", env=\"lab\"} |= \"timeout\"",
      "caption": "O seletor restringe streams; o filtro procura a sequência timeout nas linhas. O intervalo é escolhido na interface ou API."
    },
    "flow": "overview",
    "exercise": {
      "task": "Desenhe o percurso de uma mensagem desde o container até a tela. Onde entram a coleta, o índice e a busca no conteúdo?",
      "solution": "Container → Alloy → Loki → Grafana. Loki usa labels e tempo para encontrar dados candidatos; filtros examinam as linhas. Grafana apresenta a resposta, mas não substitui o armazenamento do Loki."
    },
    "refs": [
      {
        "title": "Visão geral",
        "url": "https://grafana.com/docs/loki/latest/get-started/overview/"
      },
      {
        "title": "Workshop: explorar e consultar",
        "url": "https://github.com/grafana/loki-workshop/blob/main/docs/docs/lab1/02-query-logs.md"
      }
    ],
    "quiz": [
      {
        "question": "Quem executa uma consulta LogQL sobre os logs?",
        "correct": 1,
        "options": [
          {
            "text": "O navegador armazena todos os chunks.",
            "why": "O navegador apresenta resultados; ele não é o armazenamento do Loki."
          },
          {
            "text": "O Loki; o Grafana apresenta a resposta.",
            "why": "O servidor Loki processa a consulta solicitada pela interface."
          },
          {
            "text": "O coletor sempre calcula a resposta.",
            "why": "O coletor envia eventos; consultas históricas são responsabilidade do Loki."
          }
        ]
      },
      {
        "question": "Se você retirar app do seletor e mantiver apenas env, o que pode acontecer?",
        "correct": 0,
        "options": [
          {
            "text": "Mais streams podem se tornar candidatos.",
            "why": "Um seletor mais amplo pode incluir outras aplicações."
          },
          {
            "text": "Os logs serão apagados.",
            "why": "Filtros de consulta não alteram a retenção."
          },
          {
            "text": "Todos os campos JSON serão indexados.",
            "why": "Mudar o seletor não muda a indexação."
          }
        ]
      }
    ]
  },
  {
    "id": "modelo-dados",
    "title": "Labels desenham o custo",
    "short": "Modelo de dados",
    "duration": "20 min",
    "part": "Entenda os dados",
    "summary": "Observe como combinações viram streams e escolha entre label, metadado estruturado e conteúdo.",
    "prereqs": "Fundamentos. Cardinalidade significa quantidade de valores distintos; em Loki, interessa também o número de combinações dos labels.",
    "objectives": [
      "Contar combinações sem confundir possibilidade com realidade.",
      "Distinguir índice, chunk e metadados.",
      "Evitar identificadores sem limite nos labels."
    ],
    "sections": [
      {
        "title": "Uma combinação, um stream",
        "kind": "Fato documentado",
        "text": "Dentro de um tenant, mudar qualquer valor do conjunto de labels cria outra identidade de stream. Muitas combinações podem aumentar índice, memória e quantidade de chunks pequenos. A multiplicação de cardinalidades é um teto combinatório, não uma medição dos streams que realmente existem."
      },
      {
        "title": "Três lugares para um atributo",
        "kind": "Fato documentado",
        "text": "Use labels para dimensões de origem com valores controlados. Structured metadata são pares associados à entrada sem compor seu índice de labels nem alterar a linha. Campos no conteúdo continuam disponíveis para parsing (interpretação da estrutura da linha) na consulta. Metadados estruturados exigem TSDB, um índice organizado em blocos, e schema, a versão do formato de armazenamento, compatível, como v13."
      },
      {
        "title": "O que o índice não responde",
        "kind": "Inferência didática",
        "text": "Encontrar checkout no índice não diz quais linhas contêm timeout. Evitar parsing com um metadado estruturado também não significa que o campo ganhou um índice textual completo. São decisões diferentes."
      }
    ],
    "example": {
      "language": "Representação didática",
      "code": "labels: {app: checkout, env: lab}\nmetadata: {request_id: req-42}\nline: '{\"level\":\"error\",\"message\":\"timeout\"}'",
      "caption": "Representação conceitual, não é um arquivo de configuração Loki. request_id não participa da identidade do stream."
    },
    "flow": "model",
    "exercise": {
      "task": "Duas aplicações, três ambientes e quatro pods por aplicação/ambiente: qual o teto de combinações? O que muda se cada requisição tiver um request_id indexado?",
      "solution": "Se todas as combinações ocorrerem, 2 × 3 × 4 = 24. Um request_id distinto por evento pode fragmentar cada origem em novos streams; o crescimento depende das combinações realmente observadas."
    },
    "refs": [
      {
        "title": "Cardinalidade",
        "url": "https://grafana.com/docs/loki/latest/get-started/labels/cardinality/"
      },
      {
        "title": "Structured metadata",
        "url": "https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/"
      }
    ],
    "quiz": [
      {
        "question": "Duas linhas com mensagens diferentes e labels idênticos pertencem a…",
        "correct": 0,
        "options": [
          {
            "text": "Um mesmo stream no mesmo tenant.",
            "why": "A mensagem não define a identidade indexada do stream."
          },
          {
            "text": "Dois streams obrigatoriamente.",
            "why": "Mudar conteúdo não muda o conjunto de labels."
          },
          {
            "text": "Um índice textual para cada mensagem.",
            "why": "O Loki não constrói esse índice completo do conteúdo."
          }
        ]
      },
      {
        "question": "Por que request_id costuma ser inadequado como label?",
        "correct": 2,
        "options": [
          {
            "text": "Porque números são proibidos.",
            "why": "Valores de labels podem conter números."
          },
          {
            "text": "Porque não pode aparecer no conteúdo.",
            "why": "Ele pode estar na linha ou em metadados estruturados."
          },
          {
            "text": "Porque pode criar uma quantidade sem limite de combinações.",
            "why": "A cardinalidade cresce com identificadores distintos e fragmenta streams."
          }
        ]
      }
    ]
  },
  {
    "id": "coleta",
    "title": "Do arquivo à ingestão",
    "short": "Coleta com Alloy",
    "duration": "20 min",
    "part": "Siga o log",
    "summary": "Colete sem transformar todos os campos em labels. Acompanhe extração, envio e erros.",
    "prereqs": "Labels e streams. Pipeline é uma sequência ordenada de etapas; parsing interpreta a estrutura de uma mensagem.",
    "objectives": [
      "Ler um pipeline Alloy.",
      "Separar extração e promoção a label.",
      "Diagnosticar uma falha entre leitura e envio."
    ],
    "sections": [
      {
        "title": "O coletor é uma fronteira",
        "kind": "Fato documentado",
        "text": "Grafana Alloy pode descobrir arquivos, ler novas linhas, aplicar etapas e enviar lotes ao Loki. No laboratório, loki.source.file lê arquivos e loki.write envia ao endpoint HTTP. Posições de leitura ficam em volume persistente para sobreviver ao reinício do coletor."
      },
      {
        "title": "Extrair não é indexar",
        "kind": "Fato documentado",
        "text": "stage.json extrai valores para processamento. stage.labels os promove a labels; stage.structured_metadata os associa como metadados. São operações distintas. No laboratório request_id vira metadado, enquanto app, env e format identificam a origem."
      },
      {
        "title": "Uma referência histórica importante",
        "kind": "Fato documentado",
        "text": "Promtail aparece no Deep Dive e no caso GO. Seu suporte terminou em 2 de março de 2026. O laboratório novo usa Alloy. Configuração Alloy usa a linguagem própria de componentes; não cole YAML de Promtail em config.alloy."
      }
    ],
    "example": {
      "language": "Alloy • fragmento",
      "code": "loki.process \"json\" {\n  stage.json {\n    expressions = { request_id = \"request_id\" }\n  }\n  stage.structured_metadata {\n    values = { request_id = \"\" }\n  }\n  forward_to = [loki.write.local.receiver]\n}",
      "caption": "Fragmento comentado pela aula; o componente loki.write.local está definido no arquivo completo do laboratório."
    },
    "flow": "collect",
    "exercise": {
      "task": "Abra labs/local/config.alloy. Identifique a origem de app e a etapa que extrai request_id. Execute o laboratório e procure esse atributo no Grafana.",
      "solution": "app é label estático do alvo de arquivo. request_id é extraído por stage.json e anexado por stage.structured_metadata. Se não aparece, verifique o formato JSON, o caminho do arquivo e os logs do Alloy antes de alterar Loki."
    },
    "refs": [
      {
        "title": "Alloy: leitura de arquivos",
        "url": "https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.file/"
      },
      {
        "title": "Alloy: processamento",
        "url": "https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/"
      },
      {
        "title": "Fim de suporte do Promtail",
        "url": "https://grafana.com/docs/loki/latest/send-data/promtail/"
      }
    ],
    "quiz": [
      {
        "question": "stage.json automaticamente indexa cada campo?",
        "correct": 1,
        "options": [
          {
            "text": "Sim, todos viram labels do stream.",
            "why": "Extração para processamento e atribuição de labels são etapas distintas."
          },
          {
            "text": "Não; promoção a label é uma decisão separada.",
            "why": "O pipeline pode usar o valor sem alterar a identidade do stream."
          },
          {
            "text": "Não, porque JSON é sempre descartado.",
            "why": "JSON pode ser processado e enviado normalmente."
          }
        ]
      },
      {
        "question": "Loki está pronto, mas nenhum arquivo chega. Qual a primeira investigação útil?",
        "correct": 0,
        "options": [
          {
            "text": "Caminho, permissões e logs do coletor.",
            "why": "Estar pronto não demonstra que o coletor leu e enviou os arquivos."
          },
          {
            "text": "Multiplicar o número de queriers.",
            "why": "Queriers não corrigem um arquivo que não foi coletado."
          },
          {
            "text": "Aumentar a retenção.",
            "why": "Retenção não faz o coletor encontrar o arquivo."
          }
        ]
      }
    ]
  },
  {
    "id": "escrita",
    "title": "Uma escrita, várias garantias",
    "short": "Caminho de escrita",
    "duration": "25 min",
    "part": "Siga o log",
    "summary": "Explore distributor, ring, réplicas e a diferença entre confirmar, recuperar e persistir.",
    "prereqs": "Coleta. Replicação mantém cópias em instâncias diferentes; quorum é o número mínimo de confirmações exigidas. WAL é o registro local usado na recuperação.",
    "objectives": [
      "Explicar a função do ring.",
      "Relacionar confirmação, replicação e WAL.",
      "Separar queda de processo e perda do disco."
    ],
    "sections": [
      {
        "title": "Distribuir e manter identidade",
        "kind": "Fato documentado",
        "text": "Distributor valida a requisição e encaminha streams. O hash, valor calculado a partir do tenant e dos labels, determina os ingesters responsáveis no ring, o mapa de participantes. Ring é controle de distribuição, não um caminho pelo qual o log precisa passar como se fosse outro armazenamento."
      },
      {
        "title": "Buffer e recuperação",
        "kind": "Fato documentado",
        "text": "Ingester mantém chunks em memória. WAL registra dados no disco local para recuperação após reinício; flush envia chunks ao armazenamento durável. Um processo pode confirmar dados antes de o chunk chegar ao bucket. WAL não substitui redundância nem backup."
      },
      {
        "title": "As falhas têm alcance diferente",
        "kind": "Fato documentado",
        "text": "Recuperar por WAL depende de seus arquivos íntegros e disponíveis. Disco cheio pode impedir novos registros no WAL sem interromper a aceitação de escritas. Antes de concluir que há durabilidade, verifique volumes e métricas de falha. O laboratório usa uma réplica apenas para estudo."
      }
    ],
    "example": {
      "language": "YAML • escolha do laboratório, não default",
      "code": "common:\n  replication_factor: 1 # uma instância local; sem HA\n  ring:\n    kvstore:\n      store: inmemory # sem descoberta distribuída\ningester:\n  wal:\n    enabled: true\n    dir: /loki/wal # volume nomeado no Compose",
      "caption": "Fragmento de loki.yaml. A configuração completa inclui schema, armazenamento e diretórios."
    },
    "flow": "write",
    "exercise": {
      "task": "No laboratório, execute docker compose restart loki sem apagar os volumes. Depois explique por que isso não prova resistência à perda do disco.",
      "solution": "O reinício preserva o volume com WAL e dados. A perda desse volume é outro cenário. Com uma única réplica não há outro ingester disponível como cópia independente. O exercício não demonstra alta disponibilidade."
    },
    "refs": [
      {
        "title": "WAL e suas exceções",
        "url": "https://grafana.com/docs/loki/latest/operations/storage/wal/"
      },
      {
        "title": "Deep Dive: ingestão (2.4.1)",
        "url": "https://taisho6339.gitbook.io/grafana-loki-deep-dive/ingestion-process"
      },
      {
        "title": "Componentes",
        "url": "https://grafana.com/docs/loki/latest/get-started/components/"
      }
    ],
    "quiz": [
      {
        "question": "Um ACK prova que o chunk já está no bucket?",
        "correct": 2,
        "options": [
          {
            "text": "Sim, sempre.",
            "why": "O buffer em memória e a persistência posterior são partes distintas do caminho."
          },
          {
            "text": "Sim, se Grafana estiver aberto.",
            "why": "A interface não define a garantia da escrita."
          },
          {
            "text": "Não; confirmação pode preceder o flush.",
            "why": "As garantias dependem também de réplicas, WAL e falhas envolvidas."
          }
        ]
      },
      {
        "question": "O processo caiu e o volume do WAL foi perdido. O WAL sozinho recupera os dados?",
        "correct": 0,
        "options": [
          {
            "text": "Não; os arquivos necessários desapareceram.",
            "why": "WAL só recupera o que continua íntegro e acessível."
          },
          {
            "text": "Sim, porque o ring guarda o conteúdo.",
            "why": "Ring guarda participação e distribuição, não as linhas."
          },
          {
            "text": "Sim, porque todo dado já estava no bucket.",
            "why": "Dados ainda não descarregados podem depender do WAL ou de réplicas."
          }
        ]
      }
    ]
  },
  {
    "id": "leitura",
    "title": "Por onde uma consulta passa",
    "short": "Caminho de leitura",
    "duration": "25 min",
    "part": "Siga a consulta",
    "summary": "Separe planejamento, fila, execução e obtenção dos dados antes de aumentar o paralelismo.",
    "prereqs": "Chunks e índices. Subconsulta é uma parte do trabalho original; cache reutiliza dados ou resultados já obtidos.",
    "objectives": [
      "Distinguir frontend, scheduler e querier.",
      "Entender dados recentes e históricos.",
      "Separar latência de custo total."
    ],
    "sections": [
      {
        "title": "Planejar não é executar",
        "kind": "Fato documentado",
        "text": "Query frontend organiza consultas e reúne respostas. Um scheduler separado pode manter as filas. Queriers são os trabalhadores que executam subconsultas. A separação permite distribuir trabalho, mas fila, CPU, memória e armazenamento continuam impondo limites."
      },
      {
        "title": "Dois lugares para buscar",
        "kind": "Fato documentado",
        "text": "A consulta pode precisar dos ingesters para dados recentes e do armazenamento para dados históricos. Index gateway atende consultas ao índice em implantações que o utilizam. O diagrama é lógico: alguns componentes ficam no mesmo processo no modo monolítico."
      },
      {
        "title": "Caches não são todos iguais",
        "kind": "Fato documentado",
        "text": "Cache de chunks evita algumas leituras repetidas do armazenamento; cache de resultados reutiliza trabalho elegível. TSDB não utiliza o antigo cache de consultas ao índice da mesma forma que os índices anteriores. Cache local de arquivos TSDB é outro conceito."
      }
    ],
    "example": {
      "language": "LogQL",
      "code": "{app=\"checkout\", env=\"lab\", format=\"json\"}\n  |= \"timeout\"\n  | json\n  | duration_ms > 1000",
      "caption": "Escolha o intervalo no Grafana. O parser só recebe linhas que sobreviveram ao filtro textual, sem prometer menos downloads na mesma proporção."
    },
    "flow": "read",
    "exercise": {
      "task": "Uma consulta de 48 h espera na fila, mas depois executa rapidamente. Aumentar cache de chunks resolve necessariamente? Que medida distingue espera de execução?",
      "solution": "Não. Investigue tempo de fila, trabalhadores disponíveis e concorrência antes do armazenamento. Compare os tempos por fase e a saturação dos componentes. Cache pode ajudar I/O, mas não demonstra capacidade disponível na fila."
    },
    "refs": [
      {
        "title": "Deep Dive: leitura histórica",
        "url": "https://taisho6339.gitbook.io/grafana-loki-deep-dive/query-process"
      },
      {
        "title": "Caches",
        "url": "https://grafana.com/docs/loki/latest/operations/caching/"
      },
      {
        "title": "TSDB",
        "url": "https://grafana.com/docs/loki/latest/operations/storage/tsdb/"
      },
      {
        "title": "Componentes",
        "url": "https://grafana.com/docs/loki/latest/get-started/components/"
      }
    ],
    "quiz": [
      {
        "question": "Mais paralelismo sempre reduz o custo da consulta?",
        "correct": 1,
        "options": [
          {
            "text": "Sim, divide também o volume total por N.",
            "why": "Dividir trabalho não elimina necessariamente os bytes totais processados."
          },
          {
            "text": "Não; pode reduzir latência e elevar a pressão sobre recursos.",
            "why": "Mais tarefas simultâneas competem por CPU, memória e I/O."
          },
          {
            "text": "Sim, porque dispensa os chunks.",
            "why": "Ainda é necessário obter e processar os dados candidatos."
          }
        ]
      },
      {
        "question": "O bucket ainda não contém um log recém-aceito. Onde a leitura pode encontrá-lo?",
        "correct": 0,
        "options": [
          {
            "text": "No ingester responsável.",
            "why": "Dados recentes podem ainda estar nos buffers dos ingesters."
          },
          {
            "text": "No ring.",
            "why": "O ring não armazena o texto dos logs."
          },
          {
            "text": "Exclusivamente no navegador.",
            "why": "O navegador não é a fonte desses dados."
          }
        ]
      }
    ]
  },
  {
    "id": "logql",
    "title": "Pergunte melhor aos seus logs",
    "short": "LogQL na prática",
    "duration": "30 min",
    "part": "Siga a consulta",
    "summary": "Pratique seletores, filtros e parsing em dados pequenos; depois leve as consultas ao Loki real.",
    "prereqs": "Modelo de dados e leitura. LogQL é a linguagem de consultas do Loki; agregação resume entradas ou valores extraídos.",
    "objectives": [
      "Distinguir seletor indexado e filtro de campo.",
      "Interpretar JSON e logfmt.",
      "Diferenciar contagem, taxa e valores extraídos."
    ],
    "sections": [
      {
        "title": "Da origem ao campo",
        "kind": "Fato documentado",
        "text": "O seletor entre chaves restringe streams. |= filtra uma sequência literal na linha. json e logfmt interpretam campos; filtros posteriores usam os valores extraídos. A ordem importa. Um filtro textual antecipado só preserva a resposta se não excluir registros válidos."
      },
      {
        "title": "De eventos a medidas",
        "kind": "Fato documentado",
        "text": "count_over_time conta entradas em uma janela; rate expressa uma taxa por segundo. sum agrega séries. Para estatísticas sobre um campo numérico, unwrap extrai amostras. Erros de parsing e conversão precisam de tratamento explícito, especialmente em consultas métricas. Campos extraídos e metadados podem ampliar as séries da consulta: extraia apenas o necessário e remova dimensões que não devem participar da agregação."
      },
      {
        "title": "Uma janela não é uma unidade",
        "kind": "Análise crítica",
        "text": "Uma contagem em [5m] representa eventos nos cinco minutos da janela, não eventos por minuto. O workshop usa um exemplo dessa janela; preserve a distinção entre count_over_time e rate ao interpretar os gráficos."
      }
    ],
    "example": {
      "language": "LogQL • executar no Loki real",
      "code": "sum(count_over_time(\n  {app=\"checkout\", format=\"json\"}\n    | json level=\"level\" | level=\"error\" | drop request_id | __error__=\"\" [5m]\n))\n\navg_over_time(\n  {app=\"checkout\", format=\"json\"}\n    | json duration_ms=\"duration_ms\" | drop request_id | unwrap duration_ms | __error__=\"\" [5m]\n) by (app, env, format)",
      "caption": "Primeira expressão: total de erros na janela. Segunda: média agrupada por app, env e format. A extração seletiva, drop request_id e agrupamento explícito controlam dimensões. A simulação não implementa essas operações avançadas."
    },
    "flow": "query",
    "exercise": {
      "task": "No simulador, encontre apenas erros em JSON. Depois abra o Grafana do laboratório e execute a consulta de contagem acima.",
      "solution": "Simulação: {app=\"checkout\", format=\"json\"} | json | level=\"error\". Na amostra fixa há 2 linhas. O laboratório gera continuamente: o total real depende da janela e do tempo em execução."
    },
    "refs": [
      {
        "title": "Log queries",
        "url": "https://grafana.com/docs/loki/latest/query/log_queries/"
      },
      {
        "title": "Metric queries",
        "url": "https://grafana.com/docs/loki/latest/query/metric_queries/"
      },
      {
        "title": "Workshop: métricas",
        "url": "https://github.com/grafana/loki-workshop/blob/main/docs/docs/lab2/01-metric-queries.md"
      }
    ],
    "quiz": [
      {
        "question": "count_over_time(...[5m]) retorna qual grandeza?",
        "correct": 2,
        "options": [
          {
            "text": "Eventos por segundo.",
            "why": "Essa é a ideia da taxa calculada por rate."
          },
          {
            "text": "Eventos por minuto automaticamente.",
            "why": "A janela não transforma contagem em taxa por minuto."
          },
          {
            "text": "Quantidade de eventos na janela de cinco minutos.",
            "why": "A unidade é eventos contados naquela janela."
          }
        ]
      },
      {
        "question": "Adicionar | json muda os labels indexados na ingestão?",
        "correct": 0,
        "options": [
          {
            "text": "Não; é processamento durante a consulta.",
            "why": "Campos extraídos não reescrevem o índice persistido."
          },
          {
            "text": "Sim, retroativamente.",
            "why": "Consulta não altera a indexação histórica."
          },
          {
            "text": "Sim, mas apenas em 24 h.",
            "why": "O intervalo não muda essa distinção."
          }
        ]
      }
    ]
  },
  {
    "id": "armazenamento",
    "title": "O que fica e o que sai",
    "short": "Storage e retenção",
    "duration": "25 min",
    "part": "Opere com critério",
    "summary": "Conecte TSDB, object storage e compactor. Retenção é um processo, não apenas um número.",
    "prereqs": "Escrita e leitura. Object storage armazena objetos como os de S3 e GCS; compactação reorganiza índices para consulta eficiente.",
    "objectives": [
      "Separar versão de schema e tipo de índice.",
      "Entender migrações por períodos.",
      "Explicar exclusão assíncrona."
    ],
    "sections": [
      {
        "title": "Schema não é backend",
        "kind": "Fato documentado",
        "text": "store escolhe o tipo de índice; object_store escolhe o armazenamento; schema escolhe o formato. TSDB é recomendado para novos dados desde Loki 2.8. BoltDB Shipper é uma opção histórica: estudar seu funcionamento não é adotá-lo como padrão de um projeto novo."
      },
      {
        "title": "O calendário preserva a história",
        "kind": "Prática de operação",
        "text": "Em uma migração, preserve períodos antigos de schema_config e acrescente um período futuro com o formato desejado. Alterar a interpretação do passado não converte os objetos existentes. Planeje a virada em UTC e valide a configuração exata antes do rollout."
      },
      {
        "title": "Retenção precisa trabalhar",
        "kind": "Fato documentado",
        "text": "Compactor compacta índices e pode aplicar retenção quando habilitada. Referências são removidas e chunks são excluídos depois, de forma assíncrona. Mantenha seus marcadores em disco persistente. Uma política do bucket que apaga cedo demais pode deixar referências para objetos inexistentes."
      }
    ],
    "example": {
      "language": "YAML • configuração explícita do laboratório",
      "code": "schema_config:\n  configs:\n    - from: \"2024-01-01\"\n      store: tsdb\n      object_store: filesystem # só neste laboratório\n      schema: v13\n      index:\n        prefix: index_\n        period: 24h\n# Configuração completa em labs/local/loki.yaml",
      "caption": "Escolhas do curso, não uma lista de defaults. Produção normalmente usa object storage compartilhado e configurações próprias."
    },
    "flow": "storage",
    "exercise": {
      "task": "Explique por que definir retention_period isoladamente não prova que dados antigos serão apagados. Consulte a configuração completa do laboratório.",
      "solution": "É preciso um mecanismo de retenção ativo e compatível, além de armazenamento e permissões corretos. No laboratório há retention_enabled, delete_request_store e diretório persistente do compactor. A exclusão não ocorre instantaneamente ao atingir a idade."
    },
    "refs": [
      {
        "title": "TSDB",
        "url": "https://grafana.com/docs/loki/latest/operations/storage/tsdb/"
      },
      {
        "title": "Schema",
        "url": "https://grafana.com/docs/loki/latest/operations/storage/schema/"
      },
      {
        "title": "Retenção",
        "url": "https://grafana.com/docs/loki/latest/operations/storage/retention/"
      }
    ],
    "quiz": [
      {
        "question": "O valor schema: v13 informa sozinho se o bucket é S3 ou GCS?",
        "correct": 1,
        "options": [
          {
            "text": "Sim, v13 significa S3.",
            "why": "Schema identifica formato, não o provedor."
          },
          {
            "text": "Não; object_store é uma escolha separada.",
            "why": "Tipo de índice, formato e backend têm papéis diferentes."
          },
          {
            "text": "Sim, v13 significa GCS.",
            "why": "O mesmo schema pode ser usado com diferentes backends."
          }
        ]
      },
      {
        "question": "É seguro encurtar o lifecycle do bucket sem olhar a retenção Loki?",
        "correct": 2,
        "options": [
          {
            "text": "Sim, porque o índice desaparece junto.",
            "why": "A exclusão no bucket pode não coordenar referências do índice."
          },
          {
            "text": "Sim, se o Grafana estiver desligado.",
            "why": "A interface não coordena a política de retenção."
          },
          {
            "text": "Não; pode apagar chunks ainda referenciados.",
            "why": "É necessário coordenar tempos e o processo do compactor."
          }
        ]
      }
    ]
  },
  {
    "id": "implantacao",
    "title": "Do laptop ao cluster",
    "short": "Deploy e disponibilidade",
    "duration": "25 min",
    "part": "Opere com critério",
    "summary": "Escolha uma topologia entendendo o que o laboratório simplifica e o que a produção exige.",
    "prereqs": "Containers e componentes Loki. Kubernetes organiza workloads; Helm empacota recursos e parâmetros do cluster; HA significa alta disponibilidade.",
    "objectives": [
      "Comparar monolítico, SSD e distribuído.",
      "Reconhecer limitações de uma instância.",
      "Planejar segurança e armazenamento antes do tuning."
    ],
    "sections": [
      {
        "title": "Um binário, formas de operar",
        "kind": "Fato documentado",
        "text": "Monolítico reúne componentes com target all. Simple Scalable, também chamado SSD, agrupa read, write e backend. Distribuído separa processos e permite escalar componentes com maior independência, ao custo de mais operação."
      },
      {
        "title": "O estado atual importa",
        "kind": "Fato documentado",
        "text": "Na documentação consultada em 7 de novembro de 2026, SSD está em depreciação, com remoção anunciada para Loki 4.0. Ele continua relevante para entender instalações 2.9 e 3.0. Não trate um exemplo antigo de chart como a recomendação atual."
      },
      {
        "title": "O laboratório tem limites",
        "kind": "Decisão didática",
        "text": "Nossa instância monolítica usa filesystem e fator de replicação 1. Não demonstra HA, descoberta entre processos, múltiplas zonas nem desempenho de S3/GCS. Em produção, planeje autenticação no gateway, autorização de tenants, TLS, discos persistentes, backups e procedimentos de recuperação."
      }
    ],
    "example": {
      "language": "Terminal • raiz labs/local",
      "code": "docker compose up -d\nnode verify.mjs\n# Após estudar e preservar o que precisar:\ndocker compose down\n# down preserva volumes; não acrescente -v sem querer apagá-los.",
      "caption": "O guia do laboratório contém pré-requisitos, consultas, endpoints e recuperação dos erros mais comuns."
    },
    "flow": "deploy",
    "exercise": {
      "task": "Desenhe uma implantação em Kubernetes para consultas pesadas e ingestão contínua. Indique pelo menos três falhas que a topologia deve tolerar.",
      "solution": "Avalie falha de processo, perda de nó/disco e indisponibilidade de zona. Defina cópias independentes, volumes, armazenamento compartilhado, distribuição de workloads e recuperação. Não há uma contagem universal de réplicas sem requisitos e capacidade."
    },
    "refs": [
      {
        "title": "Modos de implantação",
        "url": "https://grafana.com/docs/loki/latest/get-started/deployment-modes/"
      },
      {
        "title": "Helm: implantação",
        "url": "https://grafana.com/docs/loki/latest/setup/install/helm/"
      },
      {
        "title": "Autenticação",
        "url": "https://grafana.com/docs/loki/latest/operations/authentication/"
      }
    ],
    "quiz": [
      {
        "question": "O laboratório com replication_factor: 1 demonstra HA?",
        "correct": 0,
        "options": [
          {
            "text": "Não; um único processo ou volume pode interromper o serviço.",
            "why": "A simplificação serve para aprender, não comprova tolerância a falhas."
          },
          {
            "text": "Sim, porque usa Docker.",
            "why": "Containers não criam cópias independentes automaticamente."
          },
          {
            "text": "Sim, porque WAL é backup externo.",
            "why": "WAL local não é backup externo."
          }
        ]
      },
      {
        "question": "Como apresentar Simple Scalable neste curso atualizado?",
        "correct": 1,
        "options": [
          {
            "text": "Como a recomendação universal para novas instalações.",
            "why": "A documentação atual já alerta sobre depreciação."
          },
          {
            "text": "Como topologia histórica ainda encontrada, com depreciação identificada.",
            "why": "Isso mantém contexto sem esconder seu estado atual."
          },
          {
            "text": "Como se nunca tivesse existido.",
            "why": "Isso impediria compreender instalações e fontes históricas."
          }
        ]
      }
    ]
  },
  {
    "id": "desempenho",
    "title": "Investigue antes de aumentar",
    "short": "Desempenho e incidentes",
    "duration": "25 min",
    "part": "Opere com critério",
    "summary": "Diagnostique consultas de 24 horas, parsing caro e filas com hipóteses que podem ser testadas.",
    "prereqs": "Leitura e LogQL. Saturação ocorre quando um recurso limita o trabalho; latência é o tempo até a resposta.",
    "objectives": [
      "Separar fila, CPU, I/O e agregação.",
      "Comparar consultas semanticamente equivalentes.",
      "Evitar ajustes sem medida."
    ],
    "sections": [
      {
        "title": "Comece pelo conjunto candidato",
        "kind": "Fato documentado",
        "text": "Reduza o intervalo quando possível e use labels seletivos. Filtros literais antes de parsers podem diminuir o trabalho de interpretação. Preserve a semântica: uma sequência literal não necessariamente equivale a comparar um campo JSON, devido a escapes e formatação."
      },
      {
        "title": "Faça uma hipótese observável",
        "kind": "Prática de operação",
        "text": "Registre consulta, intervalo, concorrência, tempos por fase, bytes processados, CPU, memória e comportamento dos caches. Compare uma mudança por vez, repetindo com cuidado para não confundir cache aquecido com ganho do parser. Não execute cargas amplas em produção sem combinar o teste."
      },
      {
        "title": "Trabalho dividido continua sendo trabalho",
        "kind": "Inferência didática",
        "text": "Mais workers podem reduzir espera quando há capacidade ociosa. Se CPU ou armazenamento já estão saturados, maior concorrência pode piorar a latência e aumentar pressão de memória. O número de linhas retornadas não mede todo o conteúdo examinado."
      }
    ],
    "example": {
      "language": "LogQL • comparar no mesmo intervalo",
      "code": "# A: interpreta todas as candidatas\n{app=\"checkout\", format=\"json\"} | json | level=\"error\"\n\n# B: exemplo só equivalente se ERROR estiver em toda linha-alvo\n{app=\"checkout\", format=\"json\"} |= \"ERROR\" | json | level=\"error\"",
      "caption": "B não é uma otimização automaticamente correta. No nosso gerador level é minúsculo e ERROR não é garantido: B perde resultados."
    },
    "flow": "read",
    "exercise": {
      "task": "Incidente: CPU dos queriers está alta; há muitas buscas com json em 48 h. Proponha duas hipóteses, uma medição para cada uma e uma mudança reversível.",
      "solution": "Hipótese 1: muitos bytes candidatos; compare intervalos e seletores com estatísticas. Hipótese 2: custo de parsing; compare filtros equivalentes e linhas que chegam ao parser. Reduza escopo ou concorrência de forma controlada e observe fila e CPU; não aumente todos os limites de uma vez."
    },
    "refs": [
      {
        "title": "Boas práticas de consultas",
        "url": "https://grafana.com/docs/loki/latest/query/bp-query/"
      },
      {
        "title": "Deep Dive: desempenho histórico",
        "url": "https://taisho6339.gitbook.io/grafana-loki-deep-dive/performance-improvement"
      },
      {
        "title": "Investigação de consultas",
        "url": "https://grafana.com/docs/loki/latest/query/troubleshoot-query/"
      }
    ],
    "quiz": [
      {
        "question": "CPU caiu após colocar um filtro antes de json; downloads quase não mudaram. Isso é possível?",
        "correct": 2,
        "options": [
          {
            "text": "Não, cada filtro altera o índice.",
            "why": "Filtros na linha não mudam retroativamente o conjunto indexado."
          },
          {
            "text": "Não, toda redução de CPU elimina downloads.",
            "why": "CPU de parsing e I/O não variam necessariamente juntos."
          },
          {
            "text": "Sim; menos linhas chegaram ao parser, mesmo com chunks semelhantes.",
            "why": "São fases distintas do processamento."
          }
        ]
      },
      {
        "question": "Uma consulta retorna só cinco linhas. O custo é necessariamente baixo?",
        "correct": 0,
        "options": [
          {
            "text": "Não; pode ter examinado muitos dados para encontrá-las.",
            "why": "Resposta pequena e conjunto candidato pequeno não são sinônimos."
          },
          {
            "text": "Sim, o custo depende apenas das linhas retornadas.",
            "why": "O trabalho anterior ao resultado também custa."
          },
          {
            "text": "Sim, se usar logfmt.",
            "why": "O formato não limita sozinho o volume de dados candidato."
          }
        ]
      }
    ]
  },
  {
    "id": "caso-go",
    "title": "Uma decisão tem contexto",
    "short": "Estudo de caso GO",
    "duration": "20 min",
    "part": "Conecte as decisões",
    "summary": "Leia uma experiência real com cuidado: entenda suas escolhas e revise o que não deve ser copiado.",
    "prereqs": "Disponibilidade, retenção e leitura. Este estudo é histórico; não é uma auditoria da infraestrutura atual da empresa.",
    "objectives": [
      "Separar relato e recomendação.",
      "Revisar riscos de replicação 1.",
      "Produzir uma proposta de arquitetura com justificativas."
    ],
    "sections": [
      {
        "title": "O relato de 2023",
        "kind": "Fonte histórica • GO",
        "text": "O artigo japonês descreve Loki em um cluster de observabilidade, recebendo logs de EKS e GKE, com S3 e Promtail. A empresa separou pools de leitura e escrita para acomodar perfis de recursos e reduzir interferência."
      },
      {
        "title": "O que exige crítica",
        "kind": "Fonte histórica • GO",
        "text": "A GO adotou replicação 1, o codec de compressão snappy e ajustes de leitura por razões de custo e operação. O relato de recuperação não prova proteção contra perda do volume. Não transplante seus números ou chaves de Helm para outra versão."
      },
      {
        "title": "Projeto final",
        "kind": "Exercício de arquitetura",
        "text": "Defina volume, consultas, retenção, isolamento e objetivo de recuperação. Desenhe escrita e leitura, justifique labels e explique como validará a capacidade. Avalie as escolhas históricas à luz do seu cenário e da documentação atual."
      }
    ],
    "example": {
      "language": "Proposta para preencher",
      "code": "Carga e picos: ...\nConsultas e concorrência: ...\nRetenção e tenants: ...\nTopologia e armazenamento: ...\nFalhas toleradas e recuperação: ...\nEvidências de capacidade: ...",
      "caption": "O cenário e os números devem ser definidos por você. Nenhum benchmark do curso representa a infraestrutura da GO."
    },
    "flow": "deploy",
    "exercise": {
      "task": "Entregue um desenho de arquitetura e um registro de decisão: você adotaria replicação 1? Declare o risco aceito, o objetivo de recuperação e como testaria a hipótese.",
      "solution": "Uma resposta consistente relaciona disponibilidade e perda aceitável às cópias e discos existentes. Deve explicar perda do WAL, restauração, custos e evidências. Não basta afirmar que reiniciar recupera tudo. Use o roteiro em docs/projeto-final.md."
    },
    "refs": [
      {
        "title": "GO: artigo original em japonês",
        "url": "https://techblog.goinc.jp/entry/2023/11/17/090000"
      },
      {
        "title": "WAL: garantias e limites",
        "url": "https://grafana.com/docs/loki/latest/operations/storage/wal/"
      },
      {
        "title": "Situação atual dos deploys",
        "url": "https://grafana.com/docs/loki/latest/get-started/deployment-modes/"
      }
    ],
    "quiz": [
      {
        "question": "O uso de replicação 1 pela GO torna essa escolha universalmente segura?",
        "correct": 1,
        "options": [
          {
            "text": "Sim, porque uma empresa a utilizou.",
            "why": "Um caso não demonstra que seus requisitos e falhas são iguais."
          },
          {
            "text": "Não; é preciso avaliar cópias, discos e perda aceitável.",
            "why": "A decisão depende de requisitos e de recuperação demonstrável."
          },
          {
            "text": "Sim, se a retenção for longa.",
            "why": "Retenção não cria redundância dos dados recentes."
          }
        ]
      },
      {
        "question": "Qual entrega demonstra compreensão de arquitetura?",
        "correct": 2,
        "options": [
          {
            "text": "Copiar o YAML histórico.",
            "why": "Versões e requisitos diferentes podem invalidar as chaves e decisões."
          },
          {
            "text": "Escolher a maior máquina disponível.",
            "why": "Isso não explica garantias nem capacidade necessária."
          },
          {
            "text": "Justificar escolhas, limites e testes de recuperação.",
            "why": "A arquitetura precisa relacionar requisitos a evidências."
          }
        ]
      }
    ]
  }
];
