# Sistema visual

## Revisão de 2026-11-11: tema escuro e palco de objetos

O tema padrão passou a ser **escuro**, no estilo de painéis de observabilidade (fundo #111217, painéis #181b1f/#1f2229, texto #d0d1dc). O tema claro anterior continua disponível pelo botão no topo (`data-theme="light"`, salvo em localStorage). Todas as cores são tokens em `:root`; o tema claro só redefine os tokens.

Cada conceito do Loki tem uma cor fixa, usada nos chips, nas zonas e nos objetos dos laboratórios: label (amarelo), structured metadata (roxo), campo extraído (azul claro), linha (cinza, borda tracejada), stream (azul), chunk (verde), ingester (laranja), object storage, índice, bloom (ciano), distributor e shard. Ingesters têm oito cores próprias (`--i0` a `--i7`) para que o dono de um token seja reconhecível no anel e nas unidades.

Os laboratórios compartilham uma moldura (`src/lab/stage.js`): cabeçalho com a pergunta, controles, métricas, palco, inspetor lateral, narração, player e premissas. Estados "descartado", "fora do seletor" e "pulado" são marcados por borda tracejada, cor neutra e risco no texto, nunca só por opacidade, para manter contraste AA. Movimento: FLIP de objetos com a mesma chave entre frames; com `prefers-reduced-motion`, a troca é instantânea.


## Direção e superfície

Modo: leitura com exploração. Um manual de campo de engenharia: conteúdo contínuo, trilha lateral numerada e uma bancada visual integrada à explicação. O primeiro viewport apresenta a pergunta da aula, objetivos e percurso; a navegação não compete com o conteúdo.

A identidade foi definida para um projeto vazio e respeita o pedido de interface consistente, legível e responsiva. Nenhum ativo de marca anterior existia. A tecnologia estática foi confirmada pelo usuário.

## Tipografia e cores

Newsreader autohospedada sob OFL nos títulos principais; Segoe UI/Arial no texto e interface; Consolas somente para código e dados. Papel #f5f3ec, tinta #172d29, verde #123c35, superfície #fffefa e destaque #f0ce83.

Corpo com largura de leitura limitada. Código pode rolar horizontalmente. Títulos equilibrados e tamanho adaptativo. O amarelo identifica o componente selecionado no diagrama, não um sucesso de execução real.

## Composição

Barra de produto compacta, trilha persistente no desktop, conteúdo em fluxo e diagramas largos roláveis em telas pequenas. Em mobile, botão expande navegação no fluxo; não há modal ou sobreposição com foco preso.

## Interação característica

Percurso de dados controlado pelo aluno: clicar em um nó, iniciar, pausar, avançar e reiniciar. Conectores editáveis em SVG. A animação de deslocamento só roda por solicitação e respeita prefers-reduced-motion; a descrição textual continua disponível.

## Estados e acessibilidade

Foco visível, alternativas textuais dos diagramas, controles nativos, feedback de quiz em região de status, contraste testado por axe e progresso com confirmação de reinício. Sem recursos externos necessários após o carregamento do site. Falhas de armazenamento e clipboard têm mensagens próprias.
