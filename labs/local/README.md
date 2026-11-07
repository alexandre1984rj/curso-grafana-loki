# Laboratório local: um log de ponta a ponta

Este laboratório executa **Loki real**. A bancada do site é uma simulação independente.

## Pré-requisitos e versões

Docker Engine ou Docker Desktop em modo Linux, Docker Compose v2, Node.js 22+ para a verificação automática, portas 3000, 3100 e 12345 livres. Reserve inicialmente cerca de 4 GB de memória para Docker; é uma orientação de laboratório, não um dimensionamento de produção. O primeiro início precisa baixar imagens.

| Serviço | Imagem fixada | Papel |
| --- | --- | --- |
| Loki | grafana/loki:3.7.0 | Monolítico, índice TSDB, schema v13, filesystem |
| Grafana | grafana/grafana:12.2.0 | Exploração; datasource provisionada |
| Alloy | grafana/alloy:v1.11.0 | Coleta de arquivos e metadados |
| Gerador | node:22.14.0-alpine | JSON e logfmt determinísticos |

As tags são explícitas; não afirmamos que sejam as últimas versões. As releases Grafana, Loki e Alloy foram conferidas em 2026-11-07. Tags não equivalem a digests imutáveis; registre digests se precisar de repetibilidade binária estrita.

## Iniciar

Na raiz do repositório:

~~~sh
cd labs/local
docker compose config --quiet
docker compose up -d
docker compose ps
node verify.mjs
~~~

A verificação aguarda até 90 segundos, consulta prontidão, busca erros nos dois formatos e executa uma contagem de erros, filtra metadados sem parser e confirma uma média com agrupamento explícito. Se falhar, encerra com código diferente de zero; não declara sucesso por existir apenas um container.

- Grafana: http://localhost:3000 — datasource **Loki do laboratório**.
- Loki: http://localhost:3100/ready — resposta esperada: ready.
- Alloy: http://localhost:12345 — estado dos componentes.

Grafana e Alloy usam os nomes internos dos serviços para chegar a Loki. Dentro dos containers, localhost não é o outro serviço.

## Explorar no Grafana

Abra Explore, selecione a datasource e escolha últimos 5 minutos. Um evento por segundo é gravado em cada formato. Aproximadamente um terço contém level=error, conforme o ciclo determinístico. Totais variam com o tempo de execução e a janela.

~~~logql
{app="checkout", env="lab"}
~~~

Resultado: linhas dos dois formatos. A configuração não promove request_id a label de stream.

~~~logql
{app="checkout", env="lab", format="json"}
  |= "timeout"
  | json
  | duration_ms > 1000
  | __error__=""
~~~

Resultado: eventos JSON de timeout, com duração acima de 1000 ms. A unidade vem do campo duration_ms, não é inferida como duração LogQL.

~~~logql
{app="checkout", format="logfmt"} | logfmt | level="error"
~~~

Resultado: erros no arquivo logfmt.

~~~logql
sum(count_over_time(
  {app="checkout", format="json"} | json level="level" | level="error" | drop request_id | __error__="" [5m]
))
~~~

Resultado: contagem positiva após a ingestão dos primeiros erros. A janela é cinco minutos, não uma taxa por minuto.

~~~logql
sum(rate(
  {app="checkout", format="json"} | json level="level" | level="error" | drop request_id | __error__="" [5m]
))
~~~

Resultado: taxa de eventos por segundo.

~~~logql
avg_over_time(
  {app="checkout", format="json"}
  | json duration_ms="duration_ms" | drop request_id | unwrap duration_ms | __error__="" [5m]
) by (app, env, format)
~~~

Resultado: média do campo duration_ms agrupada por app, env e format. O agrupamento explícito também evita separar resultados pelo metadado detected_level adicionado pelo Loki. A extração seletiva evita criar campos de timestamp e ID como dimensões da agregação; drop request_id remove o metadado de alta cardinalidade da consulta. No Grafana, configure a unidade de apresentação como milissegundos.

Para transformar uma consulta métrica em painel, use Add to dashboard / adicionar ao dashboard no Explore e salve um dashboard novo. Compare contagem e taxa, incluindo unidade e janela no título. A interface pode mudar entre versões do Grafana.

## Experimentos

1. **Metadados:** expanda um evento JSON e confira request_id. Diferencie seus metadados dos labels app, env e format.
2. **Parsing:** compare filtro literal antes e depois do parser com a mesma semântica e intervalo. Esta carga pequena não serve como benchmark.
3. **Recuperação:** node verify-restart.mjs captura um evento, reinicia Loki e procura exatamente seu timestamp e conteúdo. Depois execute node verify.mjs. O volume permanece; isso não simula perda de disco nem comprova HA.
4. **Retenção:** localize retention_enabled e retention_period. O mínimo configurado é 24 h; não prometa exclusão instantânea nem tente validar retenção de um dia em segundos.
5. **Cardinalidade:** use a visualização do site; não adicione IDs infinitos aos labels do laboratório sem limites.

## Diagnóstico

| Sintoma | Verificação | Próximo passo |
| --- | --- | --- |
| Porta ocupada | Mensagem de bind do Compose | Troque a porta do host; ajuste LOKI_URL para verify.mjs se mudar 3100 |
| Loki não inicia | docker compose logs loki | Confira montagem e parâmetros; não misture snippets de outras versões |
| permission denied | Logs Loki/Alloy/Grafana | Confira volumes e permissões de escrita; não aplique chmod 777 indiscriminadamente |
| Nenhuma linha | Logs Alloy e generator; intervalo no Grafana | Aguarde descoberta e envio; confira caminhos e labels |
| Erros de parser | Campo format no seletor | Não aplique json às linhas logfmt |
| Endpoint não acessível de outro container | URL configurada | Use http://loki:3100 na rede Compose |
| Download de imagem falha | Rede e acesso ao registry | Restaure conectividade; o curso não simula um pull bem-sucedido |

~~~sh
docker compose logs --tail=100 loki alloy generator
~~~

## Encerrar e preservar

~~~sh
docker compose down
~~~

Isso mantém volumes e dados. Para **apagar deliberadamente todos os dados deste laboratório**, execute docker compose down -v apenas depois de decidir que pode perder o conteúdo. Não é necessário para encerrar.

## Simplificações e produção

As portas estão vinculadas a 127.0.0.1. Grafana permite acesso anônimo administrativo **apenas para o laboratório**; Loki está sem autenticação. Não exponha essa configuração na rede. Loki não oferece autenticação embutida: produção precisa de uma camada de acesso apropriada.

Uma réplica e disco local não demonstram HA, falha de zona, S3/GCS, escalabilidade de microserviços ou segurança entre tenants. O gerador limita cada arquivo a aproximadamente 5 MiB usando truncamento; produção requer rotação coordenada. Volumes persistentes precisam de estratégia de backup e recuperação.

## Referências

- [Instalação local do Loki](https://grafana.com/docs/loki/latest/setup/install/local/)
- [Alloy e arquivos](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.file/)
- [Processamento Alloy](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/)
- [TSDB](https://grafana.com/docs/loki/latest/operations/storage/tsdb/)
- [Retenção](https://grafana.com/docs/loki/latest/operations/storage/retention/)
- [WAL](https://grafana.com/docs/loki/latest/operations/storage/wal/)
