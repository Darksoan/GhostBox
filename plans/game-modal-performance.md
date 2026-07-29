# Plano: otimizar desempenho do modal de jogos

Status: proposto (nada implementado)
Data: 2026-07-29
Escopo: `src/components/modals/GameModal.tsx`, `src/components/routing/ContentOverlay.tsx`,
`src/hooks/useCollapsiblePanelHeight.ts`, blocos `.modal*` / `.backdrop--details` em `src/app.scss`.

## Objetivo

1. Abrir o modal sem long task perceptível (hero pintado antes da sidebar).
2. Zero re-render da árvore inteira ao carregar screenshot, medir painel ou passar o mouse numa conquista.
3. Sem forced synchronous layout nos efeitos de altura (painéis colapsáveis e "sobre o jogo").
4. Animação de entrada em 60fps.

## Diagnóstico

### Render

1. `GameModal` tem 1506 linhas num único componente, com ~20 `useState`. Qualquer set
   (screenshot carregado, altura de painel, tooltip) re-renderiza a árvore toda:
   12 `AchievementIcon`, chips, requisitos e o HTML do "sobre".
2. Derivados recalculados a cada render sem memo — `GameModal.tsx:701-753`:
   `withoutHeroImageSources`, 4x `uniqueSources`, 4x `join("\n")`, `achievementImageSourceList`.
3. O memo de `screenshotItems` (`GameModal.tsx:755`) depende de `loadedScreenshotSources` e
   `failedScreenshotSources`, que são `Set` novos a cada imagem carregada. O memo nunca
   sobrevive a um load.
4. `ContentOverlay.tsx:126` chama `resolveOverlayGame` sem memo: 3 `.find` sobre a biblioteca
   inteira + `sort` + `mergeSteamAchievementsIntoGame` + spread, a cada render do pai.
   Produz um objeto `game` com identidade nova toda vez.
5. O efeito de fetch (`GameModal.tsx:661`) tem `onDetailsLoaded` nas dependências. Se o pai não
   memoizar o callback, o efeito refaz fetch e reseta `detailGame`/`achievementLoadState`.

### Layout thrash

6. `useCollapsiblePanelHeight` registra `MutationObserver` com `subtree + characterData` mais
   `ResizeObserver` no painel **e em cada filho**, multiplicado por 3 painéis. Cada mutação lê
   `scrollHeight` (layout síncrono) e dispara setState no modal inteiro.
7. Efeito do "sobre" (`GameModal.tsx:938-993`): rAF lendo `getBoundingClientRect` de 3 elementos
   mais `scrollHeight`, com `ResizeObserver` em 3 nós e listener de `resize`. Ciclo read/write
   clássico.

### Main thread

8. `getSanitizedSteamAboutHtml` faz `DOMParser` completo + `querySelectorAll("*")` percorrendo
   todos os atributos. Adiado por `runWhenIdle(800)`, mas ainda bloqueia quando roda, e
   re-executa ao reabrir o mesmo jogo.
9. A sanitização força `autoplay loop muted` em todos os `<video>` (`GameModal.tsx:268-276`) —
   decodificam mesmo fora da viewport ou com a seção colapsada.
10. Os dois fetches (`loadGameStoreDetailsCached`, `loadGameAchievementDetailsCached`) só usam
    flag `cancelled`; a requisição continua em voo depois de fechar o modal.

### Paint

11. `backdrop-filter: blur(24px) saturate(1.05)` nos botões flutuantes sobre a arte do hero
    (`app.scss:11384`, `app.scss:13048`) — repaint caro por frame durante a animação de entrada.
    Já existe o escape `html.no-backdrop-blur`.
12. O crossfade renderiza até 3 `<img>`, e a `key` inclui `displaySource`
    (`GameModal.tsx:1035`), então trocar de fonte remonta o nó e recarrega a imagem.
13. `key={displayGame.id}` no backdrop (`GameModal.tsx:1005`) remonta o modal inteiro se o merge
    de detalhes alterar o id.

## Fases

### Fase 0 — medir (antes de tocar em código)

- React DevTools Profiler: gravar abrir modal, navegar screenshots, hover em conquistas.
  Anotar contagem de renders e o commit mais caro.
- Performance panel: marcar Long Tasks, "Recalculate Style"/"Layout" forçados, custo do `DOMParser`.
- Baseline a registrar: tempo até o hero pintado, tempo até a sidebar pronta, FPS na animação
  de entrada.
- Critério de aceite de cada fase seguinte = comparação contra essa baseline.

### Fase 1 — cortar renders desperdiçados (maior ganho, risco baixo)

- `React.memo` em `AchievementIcon`, `RequirementItem`, `GameRequirementsSection`,
  `GameDetailsLoadingSections`.
- Extrair `modal__actions` (bloco de botões) para um componente memoizado — hoje re-renderiza
  a cada screenshot carregado.
- `useMemo` no bloco de derivados de imagem (`GameModal.tsx:701-753`), chaveado por
  `displayGame?.id` e pelo tamanho da lista de screenshots.
- Tirar `loadedScreenshotSources` / `failedScreenshotSources` do state: usar `useRef<Set>` com
  contador de versão, ou mover o estado de load para um componente `ShowcaseImage` por imagem.
  Isso remove a invalidação global do memo de `screenshotItems`.
- `useMemo` em `resolveOverlayGame` dentro de `ContentOverlay`.
- Conferir se `handleGameDetailsLoaded` do `AppDataContext` é `useCallback` estável; corrigir se não.

Aceite: carregar um screenshot não deve re-renderizar a sidebar (verificar no Profiler).

### Fase 2 — eliminar layout thrash

- `useCollapsiblePanelHeight`: trocar a altura em pixel por `grid-template-rows: 0fr/1fr`
  (ou `max-height` com transição) e apagar o hook. Se a animação exata for obrigatória, então
  remover `MutationObserver` subtree/characterData, observar apenas o painel com um
  `ResizeObserver` e fazer debounce por rAF.
- Efeito do "sobre": substituir o cálculo por `getBoundingClientRect` por clamp em CSS
  (`-webkit-line-clamp` ou `max-height` em `em`), mantendo um único `ResizeObserver` no shell
  só para decidir se o botão "Ver mais" aparece.

Aceite: nenhum "Forced reflow" no Performance panel ao abrir o modal ou colapsar seções.

### Fase 3 — aliviar o main thread

- Cache de `getSanitizedSteamAboutHtml` por `game.id` (`Map`), para não re-sanitizar ao reabrir.
- Substituir `querySelectorAll("*")` + varredura de atributos por `TreeWalker` com allowlist de
  tags — poda mais barata.
- Vídeos do "sobre": `preload="none"` e autoplay apenas quando visível (`IntersectionObserver`),
  ou play no hover.
- `AbortController` de verdade nos dois fetches, abortando ao fechar o modal.

Aceite: sem long task > 50ms ao abrir jogo com descrição grande.

### Fase 4 — paint

- Remover `backdrop-filter` dos botões sobre o hero; usar gradiente ou `rgba` sólido.
- `key` das imagens do showcase: apenas `item.index` + `item.source`, sem `displaySource`.
- `contain: layout paint` na sidebar e no showcase.
- Revisar `key={displayGame.id}` no backdrop — usar o `game.id` vindo das props para não
  remontar quando o merge alterar o id.

Aceite: animação de entrada em 60fps.

### Fase 5 — estrutural (opcional, se as fases 1-4 não bastarem)

- Quebrar `GameModal` em `ModalShowcase`, `ModalActions`, `ModalAbout`, `ModalSidebar`, com o
  estado de imagem local em cada um.
- Renderizar a sidebar após o primeiro paint (`useDeferredValue` ou `startTransition`) para o
  hero aparecer antes.

## Ordem e retorno esperado

Fases 1 e 2 devem cobrir a maior parte do jank. Fase 3 ataca o congelamento em jogos com
descrição grande. Fase 4 é ganho de FPS na animação de abertura.
