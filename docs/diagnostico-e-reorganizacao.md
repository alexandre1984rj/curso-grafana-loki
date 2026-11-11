# Diagnóstico da versão anterior e proposta de reorganização

Data: 2026-11-08. Base analisada: commit `44b5d7a` deste repositório e o código-fonte oficial do Loki na tag [`v3.7.0`](https://github.com/grafana/loki/tree/v3.7.0) (commit `3361de24b692875d77bd7433cd6baa7c68dc0ef9`), a mesma versão usada no laboratório (`grafana/loki:3.7.0`). Nenhuma afirmação sobre comportamento foi tirada de `main`.

## 1. Lacunas encontradas

| # | Lacuna | Evidência na versão anterior | Consequência para o aluno |
| --- | --- | --- | --- |
| 1 | Explicações de duas a quatro frases por tema, sem mecanismo passo a passo | `src/course.js`: cada módulo tinha 3 seções curtas | Reconhece nomes, não consegue prever comportamento |
| 2 | Nenhuma ligação com o código | Zero referências a arquivos/funções do Loki; só links para `docs/latest` | Não há como verificar ou aprofundar uma afirmação |
| 3 | Componentes ausentes ou citados em uma frase | Ruler inexistente; scheduler, index gateway e compactor sem mecanismo; ring, WAL, chunks e TSDB sem estrutura interna | O aluno não sabe o que cada um guarda nem como falha |
| 4 | Nenhum parâmetro com default verificado | Apenas valores do laboratório | Não sabe o que muda ao ajustar, nem o ponto de partida |
| 5 | Afirmação desatualizada para 3.7.0 | "Disco cheio pode impedir novos registros no WAL sem interromper a aceitação de escritas" | Em 3.7.0, `ingester.wal.disk_full_threshold` (default 0,9) faz `Ingester.Push` retornar `ErrReadOnly`; só o `ENOSPC` durante a escrita do WAL continua sendo engolido. Ver `pkg/ingester/ingester.go:1010` e `pkg/ingester/instance.go:265` |
| 6 | Garantia do ACK pouco precisa | "Confirmação pode preceder o flush" | Faltava: o registro WAL é escrito sem `fsync` por requisição (`wlog.log` → `flushPage`), o ACK ao cliente depende de quorum e o conteúdo fica fora do bucket por até `max_chunk_age` |
| 7 | Diagramas mostravam caixas e setas | `src/flows.js`: um caminho linear, uma bolinha animada | Não respondiam pergunta técnica; não separavam dados, controle, confirmação e falha |
| 8 | Sem exemplo contínuo | Cada módulo usava um exemplo próprio | O aluno não consegue montar o caminho completo de um evento e de uma consulta |
| 9 | Exercícios e quizzes de reconhecimento | Alternativas como "Sim, se o Grafana estiver aberto" | Acertar não demonstrava raciocínio |
| 10 | Desempenho sem modelo quantitativo | Texto genérico sobre "mais workers podem piorar" | Não explicava splits, shards, semáforo de paralelismo, slots de querier ou teto de CPU/IO |
| 11 | Classificação de evidência ambígua | Rótulo "Fato documentado" usado para inferências | Não havia distinção entre confirmado no código, documentação, simplificação e inferência |
| 12 | Laboratório sem inspeção interna | Só consultas LogQL e reinício | Não mostrava WAL, chunks, índice TSDB, métricas de flush ou cache de resultados (que está desligado por padrão: `query_range.cache_results = false`) |

## 2. Proposta e o que foi implementado

**Camadas em todo módulo:** intuição → mecanismo → implementação → operação. Cada seção é rotulada como *Confirmado no código* (Loki v3.7.0 ou, para o coletor, Alloy v1.11.0), *Confirmado na documentação*, *Simplificação didática*, *Inferência*, *Recomendação operacional*, *Fonte histórica* ou *Não verificado*.

**Fio condutor:** o evento E1 (`payment timeout`, tenant `fake`, labels `{app="checkout", env="lab", format="json"}`) e a consulta Q1 (`sum by (app) (count_over_time({app="checkout", env="lab"} |= "timeout" | json | level="error" [5m]))` em 24 h) aparecem em todos os módulos, cada um mostrando o que acontece com eles naquela etapa.

**Dossiê por componente**, com os dez itens pedidos: problema, dados (entrada/estado/saída), funcionamento passo a passo, estruturas e concorrência, comunicação, parâmetros (YAML completo, unidade, default em 3.7.0, efeito), garantias e quando deixam de valer, falhas (sintoma, como observar, como investigar), exemplo de ponta a ponta e exercício com resposta.

**Trilha reorganizada (14 módulos):**

| Parte | Módulo | Componentes/mecanismos | Visual que responde a uma pergunta |
| --- | --- | --- | --- |
| Mapa | 1. Fundamentos | Camadas, evidência, E1/Q1 | Onde está o trabalho: dados × controle |
| | 2. Modelo de dados | Stream, fingerprint, cardinalidade | Quantos streams cabem nas escolhas? |
| | 3. Coleta | Alloy, API push, retries | Fluxo com 429/5xx e reenvio |
| Escrita | 4. Distributor e ring | Distributor, ring | Quando o cliente recebe ACK? (quorum) |
| | 5. Ingester e chunks | Ingester, chunks | Quando um bloco e um chunk são cortados? |
| | 6. WAL e flush | WAL, checkpoint, flush | O que sobrevive a cada falha após o ACK? |
| | 7. TSDB e object storage | TSDB, object storage, schema | Como uma label vira chave de objeto? |
| Leitura | 8. Frontend e scheduler | Query frontend, query scheduler | Em quantas tarefas Q1 vira e quem limita? |
| | 9. Querier, index gateway e caches | Querier, index gateway, caches | De onde vem cada pedaço da resposta? |
| | 10. Execução de LogQL | Pipeline, parsers, hints | Por que json em 24 h pesa? |
| Operação | 11. Compactor e ruler | Compactor, retenção, ruler | Quando um chunk é realmente apagado? |
| | 12. Deploy e disponibilidade | Topologias, zonas | Domínios de falha × réplicas |
| | 13. Desempenho e incidentes | Paralelismo, gargalos | Quando mais paralelismo piora? |
| | 14. Caso GO e projeto | Decisões históricas | — |

**Preservação:** IDs dos módulos anteriores mantidos, novos IDs acrescentados; conclusões salvas permanecem; respostas de quiz de módulos cuja prova mudou são descartadas por versão (`quizVersion`), para que uma resposta antiga não seja aplicada a outra pergunta. Teclado, foco, alternativas textuais, movimento reduzido e layout móvel foram mantidos e testados.

## 3. Correções descobertas durante a implementação

- E1 é gravado com `service_name="checkout"` além dos três labels enviados: `ParseRequest` o acrescenta a partir de `app` (`pkg/loghttp/push/push.go:443`). O token do ring é calculado sobre os quatro labels.
- No filesystem do laboratório, o nome do arquivo de cada chunk é `from:through:checksum` em base64 (`FSEncoder`, `pkg/storage/chunk/client/object_client.go:71`).
- `query_ingesters_within` é aplicado a cada subconsulta depois do split por hora (`pkg/querier/intervals.go`), não à consulta inteira.
- Os rótulos das tarefas da versão anterior sobre o Alloy foram conferidos no código do Alloy v1.11.0: retries só para 429, 5xx e erros de conexão; envio síncrono por endpoint; posição salva é o offset lido.

## 4. Limites desta revisão

- O código foi lido e citado; ele **não foi compilado nem executado** a partir da tag nesta revisão. As garantias derivadas de leitura de código são marcadas como tal.
- O laboratório usa a imagem oficial 3.7.0 e não foi reexecutado nesta revisão (ambiente sem Docker). Os novos experimentos do roteiro são verificáveis no seu Docker; a CI executa o laboratório.
- Os modelos interativos reproduzem regras do código com premissas explícitas; não medem desempenho.
- O caminho de escrita via Kafka (`distributor.kafka_writes_enabled`, desligado por padrão) e o novo engine de consultas (`v2`) são citados, não detalhados.
