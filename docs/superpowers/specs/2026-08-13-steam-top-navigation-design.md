# Navegação no topo, estilo Steam — Spec A

**Data:** 2026-08-13
**Status:** aprovado, pronto para plano de implementação
**Substitui:** `2026-08-12-floating-nav-maximized-design.md` — o card flutuante desenhado ali é removido por este spec.

## Contexto

Hoje o GhostBox tem dois sistemas de navegação principais, trocados por largura de janela em `useWideViewport` (limite de 1600px, com histerese de 40px):

- **Sidebar** ancorada de 280px, abaixo de 1600px
- **FloatingNav**, card flutuante no rodapé, a partir de 1600px

O usuário quer o modelo da Steam: uma barra de navegação no topo do app, sempre, sem sidebar global. A Steam não tem sidebar de navegação — tem abas no topo (`LOJA BIBLIOTECA COMUNIDADE <perfil>`) e, dentro da Biblioteca, um painel lateral próprio com coleções.

O bloqueio que define o escopo: `App.tsx:418-420` mostra que a Sidebar é o **único** ponto de entrada para criar e excluir coleção. Removê-la sem substituto perde a funcionalidade, então o painel lateral da Biblioteca entra neste spec, não no seguinte.

## Escopo

Este spec (A) cobre a navegação e a remoção do chrome antigo sem regressão. A vista de "COLEÇÕES" em grid (cards com colagem de capas, card "CRIAR COLEÇÃO", alternador de vista) fica para o **Spec B**.

### Fora de escopo

- Vista de coleções em grid — Spec B
- Carrosséis `home-recommended` / `home-explore`, que ainda usam `flex-basis` com `calc()`
- Qualquer mudança nos grids de card, já resolvida em trabalho anterior

## Arquitetura

### Componentes novos

**`src/components/layout/TopNav.tsx`**

Renderiza as abas de navegação. Um trabalho só. Fica separado porque `Header.tsx` já tem 922 linhas e embutir a nav lá piora um arquivo que já está grande demais.

- Consome `primaryNavigation` e `secondaryNavigation` de `src/components/layout/navigationItems.ts` — mesma fonte de verdade que Sidebar e FloatingNav já usavam, então a ordem das páginas não se duplica
- Props: `activePage`, `onNavigate`
- Assina `downloadTasksChangedEvent` e usa `getActiveDownloadCount` (de `src/lib/downloadManager.ts`) para o badge na aba de downloads — mesma lógica que está hoje em `FloatingNav.tsx:44-51`

**`src/components/layout/NavProfile.tsx`**

Extraído de `FloatingNavProfile` (`FloatingNav.tsx:238-295`) **antes** de deletar o arquivo. Traz pronto: avatar via `useCachedImageSources` / `useLoadableImageSource`, skeleton enquanto o perfil da nuvem restaura, `preloadProfileImages` no hover/focus, e a cadeia de fallback do nome (`steamProfile.displayName` → `account.displayName` → `account.username` → "Faça login").

Não reescrever essa lógica: os casos de borda dela já foram resolvidos.

**`src/components/library/LibraryPanel.tsx`**

Painel lateral de ~272px, escopado na página Biblioteca. Substitui os chips de coleção da `library-toolbar` atual (`LibraryPage.tsx:295-338`).

Conteúdo, conforme a referência:

| Elemento | Origem |
|---|---|
| Botão "Página inicial" + toggle de vista | novo — o toggle **não é renderizado** neste spec; entra no Spec B, junto com a vista que ele alterna |
| Dropdown de filtro ("Jogos e Softwares") | reaproveita `settings-dropdown`, que a `library-toolbar` já usa para ordenação |
| Campo de busca + ícone de filtro | novo |
| Grupos de coleção recolhíveis, com contagem e **separador entre cada grupo** | porta `sidebar__collapsible-section` / `sidebar__section-toggle` |
| Lista alfabética de jogos ao expandir um grupo | porta `sidebar__collection-games` |
| Criar e excluir coleção | absorve `onCreateCollection` / `onDeleteCollection` da Sidebar |

O grupo "Sem categoria" é derivado: jogos da biblioteca que não pertencem a nenhuma coleção do usuário. Essa contagem não existe hoje e precisa ser calculada.

### Componentes alterados

**`src/components/layout/Header.tsx`**

- Renderiza `<TopNav>` entre `header__section--left` (voltar/avançar) e `header__section--actions`
- Renderiza `<NavProfile>` dentro de `header__section--actions`, à esquerda dos controles de janela

Layout em **linha única** — decisão explícita do usuário. A Steam usa duas linhas (titlebar + linha de abas), mas como o header do GhostBox já tem voltar/avançar na esquerda, as abas ficam adjacentes a eles e o resultado lê parecido com a referência, sem gastar altura.

**`src/App.tsx`**

- Remove a renderização de `Sidebar` e `FloatingNav` (`App.tsx:405-438`)
- Remove `isFloatingNavLayout` e a classe `app-main--floating-nav`
- Remove as props que só existiam para a Sidebar: `onCreateCollection`, `onDeleteCollection`, `onRemoveFavorite`, `activeSettingsTabId`, `onSettingsTabChange`, `onOpenGame`, `onBack` — repassando à `LibraryPage` o que ela passar a precisar
- `showSettingsTabsBar={isFloatingNavLayout}` (`App.tsx:486`) deixa de existir

**`src/components/routing/PageRouter.tsx`**

Remove a prop `showSettingsTabsBar` (linhas 110, 128, 310). `SettingsPage` passa a sempre renderizar a própria barra de abas — `SettingsPage.tsx:369` já faz isso quando `showTabsBar` é true; o comportamento vira incondicional.

**`src/pages/LibraryPage.tsx`**

- Renderiza `<LibraryPanel>` à esquerda do grid
- Remove o bloco de chips de coleção da toolbar (`LibraryPage.tsx:295-338`); a seleção de coleção passa a vir do painel
- Mantém `changeActiveCollection`, `selectedCollectionId` e a filtragem por coleção (`LibraryPage.tsx:148-182`) — só muda quem dispara

### Arquivos deletados

- `src/components/layout/Sidebar.tsx` (607 linhas)
- `src/components/layout/FloatingNav.tsx`
- `src/components/layout/FloatingNav.scss`
- `src/hooks/useWideViewport.ts` — verificado: os únicos consumidores são `App.tsx:11` (import) e `App.tsx:125` (`isFloatingNavLayout`), ambos removidos por este spec, então o arquivo sai inteiro

## Estilo

### Abas

Conforme os prints da Steam: texto em maiúsculas, ~13px, semibold. Inativo em `--text-tertiary`; hover para `--text-primary`; ativo em cor de destaque com sublinhado.

### Colapso responsivo

O bloco direito do header já carrega feedback, Discord, premium, notificações e busca. Somando as abas na mesma linha, aperta. As abas viram **só ícone** abaixo de ~1100px — os ícones já existem em `navigationItems.ts`. Mesmo padrão do `.header__search`, que já colapsa para 36px em ≤820px.

### CSS a remover e a portar

O bloco da Sidebar em `src/app.scss` ocupa aproximadamente as linhas 921–1564, mais regras de tipografia espalhadas (595–660, 14823, 14838). Boa parte do tratamento visual de lista de coleção deve ser **portada** para `LibraryPanel`, não descartada — o visual é reaproveitado.

O bump de `--page-bottom-space` que existia para o card flutuante não abrir sobre o conteúdo sai junto com `FloatingNav.scss`.

### Consequência de largura

Sem a sidebar global, o conteúdo ganha 280px. O `--content-max-width` introduzido em trabalho anterior passa a valer em mais larguras, que é o comportamento desejado.

O `padding` assimétrico do `.page` (`0 var(--space-6) 0 0`, em `app.scss:811`) existia porque a sidebar dava o respiro esquerdo. Vira simétrico.

A Biblioteca é a única aba sem cap de largura — de propósito, por paridade com a Steam. Então mesmo com o painel de 272px de volta, o grid de capas continua com a janela toda.

## Riscos

- **Perda de funcionalidade de coleção.** É o risco central. Criar e excluir coleção só existem na Sidebar hoje. O `LibraryPanel` precisa cobrir os dois antes de a Sidebar ser deletada — de preferência nessa ordem, para nunca haver um commit intermediário sem a funcionalidade.
- **Aperto no header.** Linha única com abas mais seis grupos de ação à direita. O colapso para ícone precisa ser verificado em 1280px, 1100px e 820px.
- **Estado de aba de ajustes.** `activeSettingsTabId` e `handleSidebarSettingsTabChange` hoje sobem até o `App`. Com a barra de abas dentro da própria página, esse estado pode descer — verificar quem mais lê antes de mover.
- **Superfície de deleção grande.** ~700 linhas de CSS e 607 de TSX. Alto risco de remover por engano regra compartilhada; os seletores de tipografia em 595–660 misturam `.sidebar` com `.header`, que **fica**.

## Verificação

1. `npx sass --no-source-map src/app.scss` e `npx tsc --noEmit` limpos
2. `npm run tauri dev`
3. Navegar por todas as abas pelo topo; conferir estado ativo e badge de downloads
4. Redimensionar de 1920px até 800px; conferir o colapso das abas para ícone e que nada do header sobrepõe
5. Na Biblioteca: expandir e recolher grupo, selecionar coleção e ver o grid filtrar, **criar** coleção, **excluir** coleção, conferir o separador entre grupos
6. Abrir Ajustes e confirmar que a barra de abas aparece na própria página em qualquer largura
7. Maximizar e restaurar: confirmar que nenhum resquício do card flutuante aparece
