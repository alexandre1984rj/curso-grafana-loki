# Relatório da evolução: laboratórios de objetos e "Labels por dentro"

Data: 2026-11-11. Base técnica: Loki 3.7.0 (código na tag `v3.7.0` e documentação `latest`). Artigo analisado: *The concise guide to Grafana Loki: Everything you need to know about labels* (dez/2023).

## 1. Diagnóstico do estado anterior

- 14 módulos com boa base técnica (código da v3.7.0 citado por arquivo e linha, dossiês, quizzes, laboratório Docker real).
- A visualização era um diagrama SVG de setas com um pacote percorrendo arestas. Explicava *quem fala com quem*, mas não mostrava o que acontece com os dados: nenhum log, stream ou chunk existia como objeto na tela.
- Os modelos interativos eram formulários (entrada → texto de resultado). Cardinalidade, ring, sharding, structured metadata e blooms apareciam como texto e números, sem manipulação.
- Os conceitos do artigo estavam espalhados (cardinalidade no módulo 2, ring e `__stream_shard__` no distributor, SM e bloom em notas). Faltava uma sequência que levasse de "label cria stream" até "como achar um trace_id".
- Tema apenas claro.

## 2. O que foi feito

**Nova parte "Labels por dentro"** (módulos 4 a 7), entre o mapa e o caminho de escrita, cada um com a sequência intuição → visual → simulação → técnica → configuração → exercício → teste (navegação de 7 passos no topo do módulo):

| Módulo | Laboratórios |
| --- | --- |
| 4. Labels criam streams; cardinalidade decide o custo | Lab 1 (labels → streams), Lab 2 (cardinalidade A × B) |
| 5. Hash ring e stream sharding | Lab 3 (hash ring), Lab 4 (`__stream_shard__`) |
| 6. Label, structured metadata ou linha | Lab 5 (classificação) |
| 7. Procurar uma agulha: LogQL e bloom filters | Lab 6 (LogQL por etapa), Lab 7 (bloom filters) |

Mais o **simulador de ingestão até o bucket** no módulo 1 (pedido explícito na recomendação 3).

Animações não foram espalhadas pelos demais módulos: os 14 originais mantêm seu conteúdo, diagramas e modelos.

## 3. Os laboratórios

Todos compartilham uma moldura: controles de parâmetro, palco de objetos, métricas ao vivo, inspetor lateral (clique ou Enter), narração em `aria-live`, player (reproduzir/pausar, avançar, voltar, reiniciar, velocidade 0,5/1/2×, linha do tempo) e um bloco "Premissas, regras e limites" que diz o que a simulação **não** representa.

| Lab | O aluno faz | O que vê |
| --- | --- | --- |
| Ingestão | Muda linhas por tick, ingesters, RF, tamanho do chunk, label extra (`pod`, `request_id`) | Documentos chegam ao distributor, entram no chunk aberto do stream no ingester dono do token, chunks fecham (cheio ou idle) e vão ao bucket com entrada no índice |
| 1 | Liga e desliga chaves de label, insere eventos | Eventos agrupados em streams; ordem diferente das chaves cai no mesmo stream |
| 2 | Liga `pod`, `trace_id`, `order_id`, muda volume e dimensões | A e B lado a lado em escala comum: streams, ativos contra 5000, chunks, KB por chunk, rejeições; minuto em que B bate no limite |
| 3 | Adiciona/remove ingesters, muda tokens por instância e RF, escolhe o stream | Hash FNV-32, marcador no anel, busca do primeiro token maior, caminhada até RF instâncias distintas, fatia de cada ingester e streams que mudaram de dono |
| 4 | Muda taxa do stream, `desired_rate`, liga/desliga sharding | Rate store atrasado 1 s, `calculateShards`, pílulas `__stream_shard__="N"` distribuídas no ring, medidor contra 3 MB/s, 429 depois do burst de 15 MB quando desligado |
| 5 | Arrasta ou escolhe label / SM / linha para cluster, namespace, pod, trace_id, order_id, level | Streams por dia, limites de labels e streams, registro no índice e no chunk, veredito e consulta recomendada para cada campo |
| 6 | Roda LogQL (presets ou texto livre) | Pipeline por etapa: streams escolhidos pelo índice, chunks lidos, linhas descartadas em cada filtro, `__error__`, `_extracted`, recusa de seletor que aceita vazio |
| 7 | Muda bits (m), hashes (k), IDs por chunk, ID procurado | Bloom por stream com as posições testadas: pular com segurança, verificar obrigatoriamente, falso positivo, nenhum falso negativo; nota de que o índice de labels vem antes |

## 4. Tecnologias e arquitetura

- HTML, CSS e módulos ES nativos, sem framework nem biblioteca de animação (padrão do projeto mantido; nenhuma dependência nova servida ao aluno).
- `src/lab/engine.js`: modelos puros e determinísticos (PRNG mulberry32 com semente), sem DOM. Cada lab gera frames pré-calculados.
- `src/lab/stage.js`: componentes reutilizáveis (moldura, player, FLIP com Web Animations API, inspetor, chips, métricas).
- `src/lab/labs.js`: markup e montagem de cada lab sobre os frames.
- Tema escuro padrão com tokens; tema claro preservado. `prefers-reduced-motion` respeitado.

## 5. Validação técnica

A tabela completa (afirmação do artigo → situação na 3.7 → fonte) está em [fontes-e-decisoes.md](fontes-e-decisoes.md). Resumo do que **mudou** desde o artigo:

- Stream sharding: hoje ligado por padrão (`desired_rate` 1536KB).
- Structured metadata: estável e ligado por padrão (exige schema v13; 64KB e 128 entradas por linha). As saídas antigas para `pod` (limite de streams/hora, `pack` do Promtail) estão superadas.
- Bloom filters: desde o 3.3 indexam só structured metadata e aceleram `| chave="valor"` antes de parser; `|= "uuid"` não é acelerado. Experimental, fora do single binary.
- Os números de 100 mil streams ativos / 1 milhão por dia são orientação de 2023, não limite; o default continua 5000 streams ativos por tenant.

Regras reproduzidas nos labs e conferidas no código v3.7.0: `TokenFor` (FNV-32 de tenant + labels canônicos), `searchToken` do dskit (primeiro token estritamente maior, com volta), réplicas distintas, `calculateShards`, rate store de 1 s, token bucket por stream (3 MB/s, burst 15 MB), corte de chunk por tamanho e idle, tokenizador de bloom, mensagem de erro do parser para seletores vazios.

## 6. Testes executados

Detalhes em [VALIDACAO.md](VALIDACAO.md).

- `npm test`: 32/32 (10 novos para os modelos dos labs).
- `npm run build`: ok.
- `tests/browser.mjs`: 18 módulos, 52 perguntas, interações de todos os labs, axe sem violações nos 18 módulos (escuro, claro, 390 px) e em estados intermediários, sem rolagem horizontal no celular, sem erros de console.

## 7. Limitações e pendências

- **Escala reduzida.** Chunks fecham por número de linhas (não 1,5 MB comprimido); o tempo é em ticks ou minutos simulados. As proporções e regras são reais; os números absolutos de memória, CPU e compressão não são medições.
- **LogQL é um subconjunto**: seletor, filtros de linha, `| json`, `| logfmt`, filtros de label. Sem agregações, `unwrap`, `line_format` etc. (o lab diz isso ao recusar).
- **Bloom**: um bloom por stream com m pequeno, para que falsos positivos apareçam; o real usa blocos por série e escala muito maior.
- **Hash ring**: 1 a 16 tokens por instância (o default é 128) para o anel ser legível; sem zonas.
- Leitor de tela real, Safari e Firefox não foram testados; axe não substitui isso.
- Os demais 14 módulos não ganharam palco de objetos, por decisão (recomendação de não animar tudo).
