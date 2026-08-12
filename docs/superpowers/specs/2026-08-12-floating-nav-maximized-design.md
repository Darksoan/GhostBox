# Navegação flutuante com janela maximizada

**Data:** 2026-08-12
**Status:** aprovado (design)

## Problema

Com a janela maximizada, a sidebar de 280px ocupa espaço horizontal que o
catálogo e a biblioteca aproveitariam melhor. A navegação precisa continuar
acessível sem essa coluna fixa.

## Solução

Quando a janela do Tauri está maximizada, a sidebar deixa de ser renderizada e
um card flutuante horizontal aparece no rodapé:

```
[avatar] Username | [home] [catalogue] [library] [downloads] [settings] | [coleções ▲]
```

Ao restaurar a janela, a sidebar volta e o card some. É o estado real da janela
que decide — não largura de viewport, não fullscreen, não toggle manual.

## Componentes

### 1. `src/hooks/useWindowMaximized.ts`

Retorna `boolean`.

- No mount: `await getCurrentWindow().isMaximized()`.
- Listener `getCurrentWindow().onResized(...)` reavalia o estado a cada resize
  (maximizar/restaurar emitem resize).
- Fora do Tauri (vite dev no browser) retorna `false` e não registra listener.
- A permissão `core:window:allow-is-maximized` já existe em
  `src-tauri/capabilities/default.json`.

### 2. `src/components/layout/navigationItems.ts`

Extrai de `Sidebar.tsx` os arrays `navigation` (home, catalogue, library,
downloads) e `sidebarFooterNavigation` (settings), junto com o tipo
`SidebarNavIcon`. `Sidebar.tsx` e `FloatingNav.tsx` passam a importar daqui.
Rótulo e ícone de cada página ficam definidos em um lugar só.

### 3. `src/components/layout/FloatingNav.tsx` + `FloatingNav.scss`

Componente novo. Não é variante da `Sidebar`: o markup diverge quase por
completo (linha horizontal com dropup versus coluna com árvore expansível), e
`Sidebar.tsx` já tem ~625 linhas.

Estrutura, na ordem:

1. Botão de perfil: avatar 28px + nome. Mesma origem de dados do
   `SidebarProfile` (`steamProfile`, fallback para `account`, skeleton durante
   `isCloudProfileRestoring`). Navega para `profile`.
2. Divisor.
3. Cinco botões ícone vindos de `navigationItems.ts`. Estado ativo espelha
   `activePage`. `downloads` mostra o badge de downloads ativos, alimentado por
   `getActiveDownloadCount()` + `downloadTasksChangedEvent`, com `99+` acima de
   99 — igual à sidebar.
4. Divisor.
5. Botão de coleções com chevron para cima, que abre o dropup.

Os botões ícone não têm rótulo visível; cada um leva `aria-label` e `title` com
o texto traduzido por `t(labelKey)`.

Posicionamento: `position: absolute` ancorado em `.app-main`, `bottom` com
espaçamento por token, `left: 50%` + `translateX(-50%)`. Absolute e não fixed
para respeitar o chrome da janela do app.

Estilos apenas com tokens existentes (`--surface-*`, `--text-*`, `--space-*`,
`--radius-*`, `--motion-*`), por causa da catraca de
`scripts/check-tokens.mjs`.

### 4. Dropup de coleções

Painel ancorado acima do card, alinhado ao botão de coleções. Lista Favoritos
seguido das coleções do usuário, com a mesma montagem de dados da sidebar
(`favoriteGames`, `userCollections` vindos de `appData` via `App.tsx`). Clicar
em uma coleção navega (`onNavigate("favorites", collectionId)`) e fecha o
painel.

Fecha com Esc, clique fora, e quando `activePage` muda. Enquanto aberto, o
auto-hide fica travado no estado visível.

Escopo: o dropup lista coleções, não os jogos dentro delas. A árvore expansível
continua exclusiva da sidebar.

### 5. `src/hooks/useAutoHideOnScroll.ts`

Recebe o ref do scroller (`contentRef`, que já existe em `App.tsx` e aponta
para `.container__content`).

- Scroll para baixo acumulando mais de 8px: esconde
  (`translateY(120%)`, `opacity: 0`, `pointer-events: none`).
- Scroll para cima, ou `scrollTop < 24`: mostra.
- Mouse na faixa de 80px junto à borda inferior da janela: mostra.
- Dropup aberto: travado visível.
- `prefers-reduced-motion: reduce`: sem transição, troca direta de visibilidade.

### 6. Página de Settings maximizada

Sem sidebar, a lista de abas de settings precisa de outro lugar. Quando
maximizado, `SettingsPage` renderiza uma barra de abas horizontal no topo do seu
conteúdo, alimentada por `activeSettingsTabId` e `onSettingsTabChange`, que já
existem em `App.tsx` e hoje descem para a `Sidebar`. As abas vêm de
`settingsNavigationTabs` / `settingsTabLabelKeys`, sem duplicar a lista.

Com a janela restaurada, nada muda: as abas continuam na sidebar.

O `FloatingNav` não troca de conteúdo em Settings — os mesmos cinco ícones
permanecem, com `settings` marcado como ativo.

### 7. Integração em `App.tsx`

`useWindowMaximized()` decide entre `<Sidebar />` e `<FloatingNav />` dentro de
`.app-main`. O `FloatingNav` recebe apenas o que consome: `activePage`,
`steamProfile`, `isCloudProfileRestoring`, `favoriteGames`, `userCollections`,
`onNavigate`, `onOpenProfile` e o `contentRef` para o auto-hide.

## Testes (vitest)

`tests/floating-nav.test.ts`:

- renderiza botão de perfil + cinco itens de navegação;
- badge de downloads aparece com contagem maior que zero e vira `99+` acima de 99;
- dropup abre no clique, lista Favoritos e coleções, fecha com Esc;
- auto-hide: scroll para baixo esconde, scroll para cima mostra.

`tests/use-window-maximized.test.ts`: com o módulo do Tauri mockado, retorna o
estado inicial e reage ao evento de resize; sem Tauri, retorna `false`.

## Fora de escopo

- Alterar o visual ou o comportamento da sidebar em janela restaurada.
- Mover a árvore expansível de jogos por coleção para dentro do card.
- Qualquer toggle manual entre sidebar e card.
