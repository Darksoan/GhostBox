# Remover transições de troca de abas e páginas

**Data:** 2026-07-28
**Status:** Aprovado

## Objetivo

Tornar a troca de abas e de páginas instantânea, eliminando a latência introduzida
pela View Transitions API. Micro-animações (dropdowns, hover de capa, modais,
overlays, FLIP de layout) permanecem intactas.

## Motivação

`runViewTransition` executa `flushSync` dentro de `document.startViewTransition`
(`src/utils/viewTransition.ts:72-76`). Isso força um commit síncrono do React e,
quando uma transição já está em voo, enfileira o update em `pendingUpdate` para só
executá-lo no `finished` da transição anterior. O resultado é latência de até
`--motion-base` em cliques rápidos de aba, além de perder o batching e a
concorrência do React.

Removendo a camada, cada troca vira um `setState` comum.

## Escopo

### Chamadas removidas

Todas as 5 chamadas de `runViewTransition` passam a executar seu corpo diretamente:

| Local | Handler |
|---|---|
| `src/App.tsx:181` | `handleNavigate` (navegação da sidebar) |
| `src/App.tsx:220` | `handleBack` |
| `src/App.tsx:256` | `handleForward` |
| `src/App.tsx:275` | `handleSidebarSettingsTabChange` (abas de Ajustes) |
| `src/pages/ProfilePage.tsx:1175` | `handleTabClick` (abas do Perfil) |

Em `handleSidebarSettingsTabChange` e `handleTabClick`, o cálculo de
`currentIndex`/`nextIndex` — que existia apenas para escolher a direção do slide —
também sai, junto com a dependência `appearance.reduceAllAnimations` dos
`useCallback` correspondentes.

### Arquivos deletados

- `src/utils/viewTransition.ts` (163 linhas): fila `pendingUpdate`,
  `transitionSequence`, `warnDuplicateViewTransitionNames`, lista de classes
  `motion-*`, `runViewTransition`, `isViewTransitionActive`.

### CSS removido (`src/app.scss`, faixa ~845-1030)

- Comentário longo sobre titlebar/scroller que precede as regras.
- `html.motion-page-transition [data-vt="ghostbox-page-content"]` e os
  `::view-transition-group/old/new(ghostbox-page-content)`.
- `html.motion-tab-transition [data-vt="ghostbox-tab-content"]` e os
  `::view-transition-group/old/new(ghostbox-tab-content)`.
- Regras `::view-transition-old(root)` / `::view-transition-new(root)`.
- Regras `html.motion-tab-forward` / `html.motion-tab-backward`.
- `[data-vt="ghostbox-tab-content"] { contain: layout style; }` — existia apenas
  para isolar o painel durante a transição; volta ao comportamento anterior.
- Os 6 `@keyframes`: `ghostbox-page-out`, `ghostbox-page-in`,
  `ghostbox-tab-out-forward`, `ghostbox-tab-in-forward`,
  `ghostbox-tab-out-backward`, `ghostbox-tab-in-backward`.

### Atributos removidos

`data-vt` em `src/App.tsx:424`, `src/pages/ProfilePage.tsx:1857`,
`src/pages/SettingsPage.tsx:395`.

### `useFlipLayout`

Remove o import de `isViewTransitionActive` e o guard em
`src/hooks/useFlipLayout.ts:33` (que salvava os rects e abortava o FLIP durante
uma transição). O restante do hook — animação de 180 ms para reposicionamento e
entrada de cards — permanece: é micro-animação de layout, não troca de aba.

## O que permanece

- O toggle `reduceAllAnimations` (`src/context/settings.tsx:56`) e a classe
  `no-animations` no `<html>`. Continuam governando `GameModal`
  (`src/components/modals/GameModal.tsx:1004`), `ContentOverlay`
  (`src/components/routing/ContentOverlay.tsx:92`), `OverlayContext`
  (`src/context/OverlayContext.tsx:121`) e `useFlipLayout`. Deixam apenas de ter
  efeito sobre troca de aba/página, que passa a ser sempre instantânea.
- Toda micro-animação: dropdowns, hover de capas, modais, overlays.
- A lógica de histórico e de restauração de scroll de `useAppNavigation`.

## Riscos e verificação

Nenhum dos símbolos afetados tem cobertura de testes (confirmado via codegraph).
A verificação é manual, com o app rodando.

| Risco | Como verificar |
|---|---|
| Scroll do Perfil quebrar ao remover `contain: layout style` | Abrir Perfil rolado, trocar de aba; conferir scrollbar e posição |
| Restauração de scroll por página dependia do timing do `flushSync` (`src/hooks/useAppNavigation.ts:127`) | Home → Biblioteca rolada → back; scroll deve voltar ao ponto salvo |
| Flash ou salto visual na troca de página sem fade | Inspeção visual nas rotas Home, Biblioteca, Perfil, Ajustes |
| Troca rápida repetida de abas | Clicar abas do Perfil em sequência rápida; sem engasgo nem estado preso |

## Pendência de documentação

`plans/animation-stability.md` (arquivo ainda não commitado) descreve o
comportamento das View Transitions e fica obsoleto. Deve ser atualizado ou
removido na mesma leva.
