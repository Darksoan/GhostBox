# Preview de jogo no catálogo — especificação

## Objetivo

Ao passar o mouse (ou focar via teclado) em um jogo da lista do catálogo, exibir um minimodal fixo na coluna de filtros, imediatamente abaixo da seção do filtro “Ano”. O preview deve contextualizar o item sem abrir o modal completo e deve usar exclusivamente os tokens semânticos já existentes no app.

## Experiência

- O preview aparece quando um item recebe `pointerenter` ou foco e desaparece quando o item perde o ponteiro/foco.
- Apenas um jogo é exibido por vez; entrar em outro item troca o conteúdo sem desmontar o painel.
- O painel não captura cliques nem cobre a lista. O clique no item continua abrindo o modal completo.
- O painel permanece visível quando o filtro “Ano” está recolhido, pois fica logo após as seções de filtro (que já ordenam “Ano” por último).
- Em larguras onde os filtros deixam de ser uma coluna lateral, o preview acompanha o fluxo abaixo das seções, sem `position: fixed` ou sobreposição.

## Conteúdo e dados

O componente recebe o `GhostBoxGame` selecionado e renderiza:

- até três screenshots de `game.screenshots`, filtrando fontes de header com os utilitários existentes;
- título do jogo;
- desenvolvedora, quando disponível, com fallback textual localizado para dados ausentes.

As screenshots usam o hook de cache de imagens já adotado pela aplicação. O preload de assets existente no hover da lista continua sendo a primeira camada de aquecimento; o painel não cria uma nova fonte de URLs.

## Estrutura técnica

1. `CatalogueListItem` passa a notificar `onHoverGame(game | null)` nos eventos de ponteiro e foco, mantendo o comportamento de abertura, contexto e remoção intacto.
2. `CatalogueList` repassa esse callback sem criar estado local adicional.
3. `CataloguePage` mantém `hoveredGame` e fornece o callback à lista. O estado é resetado quando a lista/página muda para não reter um jogo que não está mais visível.
4. Novo componente de apresentação `CatalogueHoverPreview` vive em `src/components/ui/` e é renderizado depois de `catalogue-filters__sections`, portanto abaixo de “Ano”.
5. Novos estilos ficam agrupados em `app.scss` sob um namespace próprio, consumindo somente tokens semânticos (`--surface-*`, `--border-*`, `--text-*`, `--space-*`, `--fs-*`, `--radius-*`, `--shadow-*`, `--motion-*`).

## Estados e acessibilidade

- Sem jogo selecionado, o painel não ocupa espaço visual.
- Sem screenshots válidas, mantém uma área de mídia neutra usando o token de letterbox e ainda mostra os detalhes textuais.
- O painel usa `aria-live="polite"` apenas no título/detalhes para que a troca via teclado seja anunciada sem interromper a navegação.
- O item permanece um alvo de teclado existente (`role="button"`); foco e hover têm o mesmo resultado visual.
- `prefers-reduced-motion` desativa a transição de entrada/troca do painel.

## Verificação

- Testes unitários de layout garantem a presença dos seletores do painel e que nenhum valor de cor literal novo foi introduzido.
- `npm run check:tokens`, `npx tsc --noEmit` e `npm test` devem passar.

## Revisão aprovada — rotação e hierarquia visual

- Exibir somente uma screenshot por vez e avançar automaticamente a cada 1500 ms.
- O ciclo é controlado pelo componente, reiniciado quando o jogo ativo muda e limpo quando o preview desmonta ou não possui screenshots.
- Remover a borda do container externo do preview; manter superfície, raio e sombra existentes.
- Remover publisher do conteúdo e das traduções do preview; manter somente a desenvolvedora.
- Alinhar pesos e tamanhos ao catálogo: título em `--fs-400`/`--weight-semibold`; linha de desenvolvedora em `--fs-300`/`--weight-medium`, com o rótulo em `--weight-semibold`.
- Verificação manual: hover entre vários jogos, foco por teclado, jogo sem screenshots, viewport estreito e filtro “Ano” recolhido.
