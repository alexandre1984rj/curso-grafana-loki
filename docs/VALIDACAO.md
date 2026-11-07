# Validação da entrega

Data: **2026-11-07**. Execução local em Windows, com containers Linux no Docker Desktop.

## Executado e aprovado

| Verificação | Resultado observado |
| --- | --- |
| Testes de lógica e conteúdo | 10 testes passaram: trilha, simulador, rejeição de sintaxe, unidades, cardinalidade, persistência, diagramas e gerador |
| Build estático | npm run build produziu dist/ |
| Navegador desktop | Chromium, 1440 × 1050; dez módulos e vinte perguntas exercitados |
| Navegador mobile | Chromium, 390 × 844; navegação, ausência de overflow da página, teclado e movimento reduzido |
| Quizzes | Alternativas erradas e corretas produziram feedback; conclusão e navegação funcionaram |
| Progresso | Conclusões e respostas preservadas após reload; reinício confirmado e persistido |
| Simulação LogQL | Cinco consultas guiadas aprovadas; sintaxe fora do subconjunto rejeitada |
| Acessibilidade automatizada | axe com regras WCAG A/AA e 2.1 AA: zero violações nos dez módulos desktop e na tela mobile verificada |
| Inspeção visual | Capturas desktop/mobile examinadas; correções de botões e conectores aplicadas |
| Revisão independente | Três achados estáticos corrigidos: continuidade de percursos, rótulos de arestas e botão após Escape |
| Docker Compose | docker compose config --quiet passou; quatro serviços iniciaram |
| Ingestão real | Alloy enviou JSON e logfmt; erros foram consultados por parsing no Loki |
| Consultas métricas reais | Contagem positiva e média agrupada verificadas |
| Metadados reais | request_id filtrado sem parser JSON |
| Grafana | /api/health informou database=ok e versão 12.2.0; datasource respondeu Data source successfully connected |
| Recuperação | verify-restart.mjs reencontrou exatamente o timestamp e a linha capturados antes do reinício do Loki, preservando volumes |

O teste real revelou que detected_level separava a média em duas séries. O exemplo foi corrigido com agrupamento explícito por app, env e format. Não se declarou correto o resultado anterior.

As capturas e os resultados brutos locais ficam em artifacts/, ignorado pelo Git. A CI preserva seus próprios artifacts quando executada no GitHub. Não incluímos imagens geradas, dependências ou volumes de laboratório no commit.

## Limites

- axe não substitui revisão completa com leitor de tela e usuários.
- A verificação visual cobriu desktop e celular; não é uma matriz de todos os navegadores e dispositivos.
- O detector auxiliar de design funcionou em modo reduzido, sem seus parsers opcionais; sua ausência de achados não foi usada como prova de contraste. A auditoria executada no navegador é registrada acima.
- O laboratório é monolítico, sem autenticação Loki e com acesso administrativo anônimo no Grafana, vinculado a localhost. Não é produção.
- Não foram medidos throughput, desempenho de queries de 24 h, custos, HA, múltiplas zonas ou object storage S3/GCS.
- O reinício preservou volumes. Não simulou perda de disco e não prova ausência de perda em outros cenários.
- Retenção de 24 h foi configurada; não esperamos um dia para comprovar exclusão física. O processo é assíncrono.
- As limitações de acesso às fontes históricas estão em fontes-e-decisoes.md.
- A execução local da CI não implica que o GitHub já tenha executado o workflow. O resultado remoto deve ser consultado nos checks do commit.

## Ambiente de CI

A primeira execução remota confirmou testes de lógica e build. O runner ubuntu-latest selecionou Ubuntu 26.04, incompatível com a versão fixada do Playwright. O workflow foi corrigido para ubuntu-24.04 nos dois jobs; o resultado da nova execução deve ser conferido nos checks do commit.
