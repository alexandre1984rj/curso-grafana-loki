# Projeto final: arquitetura com decisões verificáveis

Defina um cenário seu. Estimativas são permitidas se forem identificadas; não use números do curso como capacidade medida.

## Entregáveis

1. Requisitos: taxa média e pico antes/depois de compressão, streams ativos, tenants, retenção, janelas de consulta e concorrência.
2. Garantias: interrupção tolerada, perda aceitável, domínios de falha e objetivos de recuperação.
3. Dois diagramas: escrita e leitura, incluindo armazenamento, limites de acesso e componentes opcionais.
4. Registro de decisões: topologia, versão do Loki e chart, coletor, schema, labels, metadados, replicação, WAL, caches e retenção.
5. Plano de validação: carga representativa, consultas, falhas, métricas, critérios de aceite e rollback.
6. Estimativa de custos separando armazenamento, operações, transferência, computação e tempo de manutenção.

## Incidente para defender

Às 10h, várias consultas de 48 horas aplicam parsing JSON. A latência cresce, CPU dos queriers satura e o tempo de fila aumenta. A ingestão deve continuar.

Explique quais dados você coleta primeiro, que mudança reversível faria e qual evidência mostraria melhora. Não trate aumentar limites como resposta automática.

## Rubrica de revisão

| Critério | Evidência necessária |
| --- | --- |
| Modelo de dados | Identidade de stream e cardinalidade justificadas |
| Escrita | Confirmação, flush, WAL e falhas distinguidos |
| Leitura | Fila, execução, armazenamento e caches separados |
| Recuperação | Queda de processo e perda de disco testadas separadamente |
| Segurança | Autenticação, autorização de tenants e comunicação protegida |
| Retenção | Compactor, permissões e lifecycle coordenados |
| Operação | Métricas por fase, capacidade e rollback definidos |
| Honestidade | Suposições e resultados ainda não medidos identificados |

Uma boa proposta pode ter escolhas diferentes das nossas. O requisito é ligar cada decisão ao cenário e a evidências, incluindo os riscos aceitos.

## Referências

- [Componentes](https://grafana.com/docs/loki/latest/get-started/components/)
- [WAL](https://grafana.com/docs/loki/latest/operations/storage/wal/)
- [Consultas eficientes](https://grafana.com/docs/loki/latest/query/bp-query/)
- [Retenção](https://grafana.com/docs/loki/latest/operations/storage/retention/)
