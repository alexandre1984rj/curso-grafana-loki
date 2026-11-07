# Loki por dentro

Curso interativo de Grafana Loki em português brasileiro. Explicações progressivas, diagramas SVG clicáveis, animações controláveis, exercícios, quizzes com feedback e laboratório local.

O repositório estava vazio em 2026-11-07; esta implementação cria sua base. Não é um produto oficial da Grafana Labs.

## Executar o curso

Pré-requisito: **Node.js 22 ou superior**. Conhecimentos de containers e HTTP ajudam; cada módulo apresenta seus pré-requisitos e define os termos necessários.

~~~sh
npm run dev
~~~

Abra http://127.0.0.1:4173. O site não exige instalação de dependências para funcionar: usa HTML, CSS e módulos JavaScript nativos. Inicie por HTTP; abrir index.html diretamente em file:// não é suportado para módulos JavaScript.

~~~sh
npm run build
npm run preview
~~~

O build produz dist/. Publique seu conteúdo em uma hospedagem estática. URLs relativas também permitem hospedar em uma subpasta, como /curso-grafana-loki/. A autorização recebida foi para publicar o **código**; ativação de um serviço de hosting não foi feita.

## Trilha

| Módulo | O que você pratica |
| --- | --- |
| 1. Fundamentos | Papéis de Grafana, Loki e coletor; índice e conteúdo |
| 2. Modelo de dados | Streams, labels, cardinalidade, chunks e metadados |
| 3. Coleta | Pipeline Alloy, extração e envio |
| 4. Escrita | Distributor, ring, ingester, WAL e persistência |
| 5. Leitura | Frontend, scheduler, querier, índice e caches |
| 6. LogQL | Seletores, filtros, JSON, logfmt, contagem, taxa e unwrap |
| 7. Storage | TSDB, schemas, compactação e retenção |
| 8. Deploy | Ambiente local, Kubernetes, topologias e disponibilidade |
| 9. Desempenho | Janelas longas, parsing, filas e troubleshooting |
| 10. Caso GO e projeto | Análise de decisões históricas e desenho justificado |

Cada aula contém objetivos, pré-requisitos, explicações identificadas por natureza da evidência, exemplo comentado, visual interativo, exercício com raciocínio esperado e referências. A conclusão de um módulo depende das duas respostas corretas, mas a navegação é livre.

O progresso e as respostas ficam apenas no localStorage deste navegador, sem conta ou envio ao servidor. O botão de reinício pede confirmação e apaga esse progresso. Se o armazenamento estiver bloqueado, o site informa que as respostas durarão apenas na visita.

## Interações

- Diagramas separados de escrita e leitura, com conectores SVG e componentes selecionáveis por mouse ou teclado.
- Iniciar, pausar, avançar e reiniciar o percurso; movimento reduzido respeitado.
- Visualização de cardinalidade: combinações possíveis, não previsão de RAM ou preço.
- Bancada LogQL com seis eventos fixos e cinco exercícios guiados.
- Vinte perguntas com explicação de todas as alternativas.

**A bancada é uma simulação**, sem conexão a Loki. Implementa um subconjunto explícito: seletores com igualdade, filtros literais, JSON plano, logfmt simples, filtros de campo e duas agregações em uma janela fixa de cinco minutos. Rejeita funcionalidades não suportadas. Não mede desempenho. Execute consultas completas no laboratório real.

## Laboratório real

O [roteiro completo](labs/local/README.md) explica início, ingestão, consultas, erros comuns, recuperação e encerramento.

~~~sh
cd labs/local
docker compose config --quiet
docker compose up -d
node verify.mjs
~~~

Versões fixas: **Loki 3.7.0**, **Alloy 1.11.0**, **Grafana 12.2.0** e **Node 22.14.0-alpine** no gerador. Loki usa TSDB e schema v13. A datasource do Grafana já está provisionada.

Os serviços são vinculados a localhost; há uma única réplica, filesystem e acesso simplificado. **Essa configuração não é uma implantação de produção.** O roteiro identifica as diferenças.

## Fontes e versões

Consulta editorial: **7 de novembro de 2026**. A documentação latest consultada identifica Loki 3.7.x; as imagens são fixadas e não são anunciadas como as mais novas disponíveis.

- [Workshop oficial](https://github.com/grafana/loki-workshop), incluindo seus laboratórios de exploração, LogQL, métricas e dashboards.
- [Grafana Loki Deep Dive](https://taisho6339.gitbook.io/grafana-loki-deep-dive), contextualizado em Loki 2.4.1.
- [Artigo original japonês da GO, de 2023](https://techblog.goinc.jp/entry/2023/11/17/090000), tratado como caso histórico.
- [Documentação oficial atual](https://grafana.com/docs/loki/latest/), para revisão das recomendações.

A [análise crítica das fontes](docs/fontes-e-decisoes.md) registra contribuições, divergências, limitações de acesso, versões e decisões. Promtail é apresentado como histórico, TSDB como índice recomendado e Simple Scalable com seu estado de depreciação. O pedido de implementação atual amplia o escopo da conversa anterior, que estudava 2.9.1 e 3.0.0; exemplos antigos não são aplicados silenciosamente ao laboratório novo.

## Verificar o projeto

Testes de lógica e conteúdo e build não precisam de dependências:

~~~sh
npm test
npm run build
~~~

Os únicos pacotes de desenvolvimento são Playwright e axe para testes de navegador e acessibilidade; nenhum pacote é servido ao aluno.

~~~sh
npm ci
npx playwright install chromium
npm run dev
# Em outro terminal:
npm run test:browser
~~~

Para usar um Chromium já instalado, defina CHROMIUM_PATH com o caminho do executável. COURSE_URL permite testar uma hospedagem ou subpasta diferente. Os testes verificam módulos, quizzes, fluxo, teclado, progresso após reload, reinício, cardinalidade, simulação, mobile e regras automatizadas WCAG A/AA. Eles não substituem uma avaliação completa com tecnologia assistiva.

A CI executa testes, build, navegador e laboratório real, preservando resultados em artifacts. Consulte [VALIDACAO.md](docs/VALIDACAO.md) para o que foi efetivamente executado nesta entrega.

## Estrutura

~~~text
src/course.js       Conteúdo, exercícios e referências
src/app.js          Interface e interações
src/flows.js        Nós e conexões SVG editáveis
src/simulator.js    Subconjunto didático de LogQL
src/progress.js     Persistência local
src/style.css       Interface responsiva e movimento reduzido
public/             Ícone original e fonte com licença
labs/local/         Compose, configurações, gerador e verificação real
docs/               Pesquisa, projeto final e evidências de validação
scripts/            Servidor HTTP e build com biblioteca padrão do Node
tests/              Testes de lógica e navegador
~~~

## Atribuição

Conteúdo e diagramas foram escritos para este curso, sem copiar imagens dos artigos. As referências permanecem nos módulos. O workshop usa Apache-2.0; sua licença não é presumida para as demais fontes. Não há redistribuição de screenshots ou tradução integral do artigo japonês. A fonte Newsreader é distribuída sob SIL Open Font License; sua licença acompanha o arquivo em public/fonts/OFL.txt.
