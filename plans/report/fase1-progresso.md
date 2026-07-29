# Relatório: Fase 1 — Cortar renders desperdiçados

## Status geral: 11/11 concluídos (100%)

## O que foi feito

### ✅ Importar `memo` em `GameModal.tsx`
`memo` adicionado ao import de `react`.

### ✅ `React.memo` em 4 componentes de `GameModal.tsx`
- `AchievementIcon`
- `RequirementItem`
- `GameRequirementsSection`
- `GameDetailsLoadingSections`

### ✅ Extração de `ModalActions` para componente memoizado
- **Componente**: `ModalActions` (memoizado com `memo`)
- **Props**: `isAdding`, `isInstalled`, `isAdded`, `isRemoving`, `isPlaying`, `isSessionActive`, `isFavorite`, `isBackupOptionsOpen`, `language`, `game`, `onPlay`, `onRemove`, `onQueue`, `onToggleFavorite`, `onOpenBackupOptions`
- **Ganho**: carregar/alternar screenshot não re-renderiza a barra de botões flutuantes.

### ✅ `useMemo` no bloco de derivados de imagem em `GameModal.tsx`
Quebrado em dois `useMemo`:
1. **`imageDerivatives`**: `screenshots`, `modalHeroSources`, `heroScreenshotFallback`, `showcaseSources`, `preloadShowcaseSources`, `logoSources` (deps: `[displayGame, game, isLoadingDetails]`)
2. **`keyDerivatives`**: `currentLogoSource`, `screenshotsKey`, `modalHeroSourcesKey`, `cachedScreenshotsKey`, `achievementImageSources`, `achievementImageSourcesKey` (deps: `[cachedLogoSources, logoSources, failedLogoSources, showcaseSources, modalHeroSources, cachedScreenshotSources, visibleAchievements]`)

### ✅ `useRef<Set>` + `screenshotSourcesVersion` em `GameModal.tsx`
- Substituído `useState<Set<string>>` por `useRef<Set<string>>` (`loadedScreenshotSourcesRef`, `failedScreenshotSourcesRef`)
- Adicionado estado leve `screenshotSourcesVersion` (number) como dep para o `useMemo` de `screenshotItems`
- Callbacks `onLoad` e `onError` das imagens agora alteram o `Set` via `.add()` sem clonagem de objetos e incrementam a versão somente quando a URL for inédita.

### ✅ `useMemo` em `resolveOverlayGame` em `ContentOverlay.tsx`
- Adicionado `useMemo` no topo do componente `ContentOverlay` para memoizar a resolução das props de jogo (`resolvedAchievementsGame` e `resolvedSelectedGame`).

### ✅ `handleGameDetailsLoaded` verificado
- `useCallback` com deps vazias em `AppDataContext.tsx` — estável.

### ✅ Typecheck validado
- Executado `npx tsc --noEmit` sem erros.

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| [GameModal.tsx](file:///E:/GhostBox/src/components/modals/GameModal.tsx) | `memo` em 4 componentes, extração de `ModalActions`, `useMemo` em derivados de imagem, `useRef<Set>` para screenshot sources |
| [ContentOverlay.tsx](file:///E:/GhostBox/src/components/routing/ContentOverlay.tsx) | `useMemo` para `resolveOverlayGame` |
| [fase1-progresso.md](file:///E:/GhostBox/plans/report/fase1-progresso.md) | Relatório atualizado |

## Próximos passos

1. Prosseguir para Fase 2 (eliminar layout thrash) conforme plano geral.
