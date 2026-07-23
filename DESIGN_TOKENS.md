# Design Tokens do GhostBox

Este arquivo resume os tokens visuais usados no app. A fonte principal é o bloco `:root` de `src/app.scss`; tokens locais aparecem em componentes específicos para ajustar uma superfície sem quebrar o tema global.

## Princípios

- Use os tokens canônicos antes dos aliases legados.
- Para texto, prefira apenas `--text-primary`, `--text-secondary` e `--text-tertiary`.
- Para movimento, prefira `transform` e `opacity` com `--motion-*` e `--ease`.
- Para espaçamento, componha a partir de `--spacing` com `calc()`.

## Canvas e Superfícies

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--background` | `#0b0b0b` | Fundo base do app. | `background: var(--background);` |
| `--background-dark` | `#0b0b0b` | Fundo escuro de páginas e overlays sólidos. | `background: var(--background-dark);` |
| `--surface-interactive` | `#0f0f0f` | Superfícies clicáveis ou com estado ativo. | `background: var(--surface-interactive);` |
| `--surface-primary` | `var(--surface-interactive)` | Superfície principal. | `background: var(--surface-primary);` |
| `--surface-secondary` | `var(--surface-interactive)` | Superfície secundária. | `background: var(--surface-secondary);` |
| `--surface-tertiary` | `#0b0b0b` | Superfície mais escura. | `background: var(--surface-tertiary);` |
| `--surface-solid` | `var(--surface-primary)` | Alias para superfícies sólidas. | `background: var(--surface-solid);` |
| `--surface-ui` | `var(--surface-primary)` | Alias para UI de base. | `background: var(--surface-ui);` |
| `--surface-deep` | `var(--surface-tertiary)` | Alias para camada profunda. | `background: var(--surface-deep);` |
| `--surface` | `rgba(255, 255, 255, 0.04)` | Elevação sutil sobre fundo escuro. | `background: var(--surface);` |
| `--surface-subtle` | `rgba(255, 255, 255, 0.025)` | Elevação ainda mais discreta. | `background: var(--surface-subtle);` |
| `--surface-hover` | `var(--surface-interactive)` | Estado hover de superfícies. | `.item:hover { background: var(--surface-hover); }` |
| `--surface-active` | `rgba(255, 255, 255, 0.08)` | Estado selecionado/pressionado. | `background: var(--surface-active);` |
| `--surface-strong` | `rgba(255, 255, 255, 0.085)` | Destaque mais forte. | `background: var(--surface-strong);` |
| `--sidebar-selector` | `#151515` | Fundo do item ativo na sidebar. | `background: var(--sidebar-selector);` |
| `--sidebar-option-active` | `var(--sidebar-selector)` | Item ativo da sidebar. | `background: var(--sidebar-option-active);` |
| `--sidebar-option-active-hover` | `var(--sidebar-selector)` | Hover do item ativo da sidebar. | `background: var(--sidebar-option-active-hover);` |

## Bordas

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--border-dark` | `var(--surface-interactive)` | Borda base escura. | `border-color: var(--border-dark);` |
| `--border` | `var(--border-dark)` | Borda padrão. | `border: 1px solid var(--border);` |
| `--border-subtle` | `var(--border-dark)` | Borda discreta. | `border-bottom: 1px solid var(--border-subtle);` |
| `--border-ui` | `var(--border-dark)` | Borda de elementos de interface. | `border: 1px solid var(--border-ui);` |
| `--border-strong` | `var(--border-dark)` | Borda enfatizada. | `border-color: var(--border-strong);` |
| `--border-hover` | `var(--border-dark)` | Borda em hover. | `.card:hover { border-color: var(--border-hover); }` |

## Texto

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--text-primary` | `#f0f0f0` | Texto principal e títulos. | `color: var(--text-primary);` |
| `--text-secondary` | `#757575` | Metadados, descrições e labels. | `color: var(--text-secondary);` |
| `--text-tertiary` | `#4a4a4a` | Texto de baixa ênfase. | `color: var(--text-tertiary);` |
| `--text` | `var(--text-primary)` | Alias legado de texto principal. | `color: var(--text);` |
| `--text-strong` | `var(--text-primary)` | Alias para texto forte. | `color: var(--text-strong);` |
| `--color-text` | `var(--text-primary)` | Alias legado. | `color: var(--color-text);` |
| `--text-muted` | `var(--text-secondary)` | Alias para texto secundário. | `color: var(--text-muted);` |
| `--color-subtext` | `var(--text-secondary)` | Alias legado de subtítulo. | `color: var(--color-subtext);` |
| `--text-soft` | `var(--text-secondary)` | Texto suave. | `color: var(--text-soft);` |
| `--text-dim` | `var(--text-secondary)` | Texto menos enfatizado. | `color: var(--text-dim);` |
| `--text-faint` | `var(--text-tertiary)` | Texto muito discreto. | `color: var(--text-faint);` |
| `--hydra-button-text` | `var(--text-primary)` | Texto de botões herdados do Hydra. | `color: var(--hydra-button-text);` |

## Overlays e Estados Semânticos

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--overlay-subtle` | `rgba(0, 0, 0, 0.2)` | Overlay leve. | `background: var(--overlay-subtle);` |
| `--overlay-medium` | `rgba(0, 0, 0, 0.42)` | Overlay médio. | `background: var(--overlay-medium);` |
| `--overlay-strong` | `rgba(0, 0, 0, 0.68)` | Backdrop forte. | `background: var(--overlay-strong);` |
| `--danger` | `#ef4444` | Erros e ações destrutivas. | `color: var(--danger);` |
| `--danger-hover` | `#f87171` | Hover destrutivo. | `.delete:hover { color: var(--danger-hover); }` |
| `--danger-soft` | `rgba(239, 68, 68, 0.12)` | Fundo suave de erro. | `background: var(--danger-soft);` |
| `--success` | `#35d07f` | Sucesso e confirmação. | `color: var(--success);` |
| `--success-hover` | `#5cff8a` | Hover de sucesso. | `.save:hover { color: var(--success-hover); }` |
| `--success-soft` | `rgba(53, 208, 127, 0.12)` | Fundo suave de sucesso. | `background: var(--success-soft);` |
| `--premium-gold` | `#f5b342` | Destaques premium. | `color: var(--premium-gold);` |
| `--premium-surface-soft` | `rgba(255, 255, 255, 0.045)` | Fundo premium suave. | `background: var(--premium-surface-soft);` |
| `--premium-surface-faint` | `rgba(255, 255, 255, 0.025)` | Fundo premium discreto. | `background: var(--premium-surface-faint);` |
| `--premium-border-glow` | `rgba(242, 242, 242, 0.48)` | Brilho de borda premium. | `box-shadow: 0 0 0 1px var(--premium-border-glow);` |
| `--premium-border-angle` | `0deg` | Ângulo animado para borda premium. | `background: conic-gradient(from var(--premium-border-angle), ...);` |
| `--profile-banner-placeholder-bg` | `#060606` | Fundo fallback do banner de perfil. | `background: var(--profile-banner-placeholder-bg);` |
| `--xp-color` | `#8b5cf6` | Cor de XP/progresso. | `color: var(--xp-color);` |
| `--accent` | `#8b5cf6` | Cor de acento geral. | `border-color: var(--accent);` |

## Espaçamento e Raios

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--spacing` | `8px` | Unidade base de espaçamento. | `gap: calc(var(--spacing) * 2);` |
| `--radius-xs` | `1px` | Cantos mínimos. | `border-radius: var(--radius-xs);` |
| `--radius-sm` | `2px` | Cantos pequenos. | `border-radius: var(--radius-sm);` |
| `--radius-md` | `3px` | Cantos médios. | `border-radius: var(--radius-md);` |
| `--radius-lg` | `4px` | Cantos maiores em cards. | `border-radius: var(--radius-lg);` |
| `--radius-pill` | `999px` | Chips e pills. | `border-radius: var(--radius-pill);` |
| `--radius-circle` | `50%` | Avatares e círculos. | `border-radius: var(--radius-circle);` |

## Tipografia

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--weight-regular` | `400` | Peso regular. | `font-weight: var(--weight-regular);` |
| `--weight-medium` | `500` | Peso médio. | `font-weight: var(--weight-medium);` |
| `--weight-semibold` | `600` | Peso semibold. | `font-weight: var(--weight-semibold);` |
| `--weight-bold` | `600` | Alias de negrito visual do app. | `font-weight: var(--weight-bold);` |
| `--weight-muted` | `600` | Peso de labels/metadados. | `font-weight: var(--weight-muted);` |
| `--font-sans` | `"Open Sans", "Segoe UI", system-ui, sans-serif` | Fonte base. | `font-family: var(--font-sans);` |
| `--font-display` | `"Open Sans", "Segoe UI", system-ui, sans-serif` | Títulos e display. | `font-family: var(--font-display);` |
| `--font-sidebar` | `"Open Sans", "Segoe UI", system-ui, sans-serif` | Sidebar. | `font-family: var(--font-sidebar);` |

## Movimento

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--motion-fast` | `0.12s` | Feedback curto. | `transition: color var(--motion-fast) var(--ease);` |
| `--motion-base` | `0.18s` | Transições padrão de páginas, abas e controles. | `transition: transform var(--motion-base) var(--ease);` |
| `--motion-slow` | `0.3s` | Animações mais longas. | `animation: fade var(--motion-slow) ease both;` |
| `--ease` | `cubic-bezier(0.4, 0, 0.2, 1)` | Curva padrão. | `transition: opacity var(--motion-base) var(--ease);` |
| `--motion-sidebar-duration` | `0.1s` | Movimento específico da sidebar. | `transition-duration: var(--motion-sidebar-duration);` |
| `--motion-linear` | `linear` | Movimento linear, como spinners. | `animation: spin 1s var(--motion-linear) infinite;` |

## Cards e Receita Compartilhada

| Token | Valor | Uso | Exemplo |
| --- | --- | --- | --- |
| `--card-bg` | `var(--surface-tertiary)` | Fundo padrão de card. | `background: var(--card-bg);` |
| `--card-bg-hover` | `var(--surface-interactive)` | Fundo de card em hover. | `.card:hover { background: var(--card-bg-hover); }` |
| `--card-bg-active` | `var(--surface-interactive)` | Fundo de card ativo. | `.card.is-active { background: var(--card-bg-active); }` |
| `--card-border` | `var(--border)` | Borda de card. | `border: 1px solid var(--card-border);` |
| `--card-radius` | `var(--radius-lg)` | Raio de card. | `border-radius: var(--card-radius);` |
| `--app-gradient` | `var(--surface-tertiary)` | Fundo unificado do app. | `background: var(--app-gradient);` |

## Tokens Locais e Dinâmicos

Estes tokens são definidos fora do `:root` ou injetados via React para parametrizar um componente específico.

| Token | Origem | Uso | Exemplo |
| --- | --- | --- | --- |
| `--pb-cover-prerender-size` | Capas de jogos | Tamanho da camada de pré-render para zoom nítido. | `width: var(--pb-cover-prerender-size);` |
| `--pb-cover-rest-scale` | Capas de jogos | Escala da camada em repouso. | `transform: scale(var(--pb-cover-rest-scale));` |
| `--pb-cover-hover-scale` | Capas de jogos | Escala em hover. | `.card:hover { --pb-cover-hover-scale: 1.045; }` |
| `--pb-cover-zoom-opacity` | Capas de jogos | Opacidade da camada de zoom. | `opacity: var(--pb-cover-zoom-opacity);` |
| `--app-splash-progress` | `App.tsx` e `Header.tsx` | Progresso visual do splash/update. | `style={{ "--app-splash-progress": "72%" }}` |
| `--home-page-block-start-padding` | `.home-page` | Padding vertical inicial da Home. | `padding-block-start: var(--home-page-block-start-padding);` |
| `--home-page-inline-padding` | `.home-page` | Padding horizontal base da Home. | `padding-inline: var(--home-page-inline-padding);` |
| `--home-content-inline-inset` | `.home-page` | Recuo interno de seções da Home. | `padding-inline: var(--home-content-inline-inset);` |
| `--home-section-gap` | `.home-page` | Espaço vertical entre seções. | `gap: var(--home-section-gap);` |
| `--home-category-gap` | `.home-page` | Espaço entre categorias. | `gap: var(--home-category-gap);` |
| `--home-section-title-color` | `.home-page` | Cor compartilhada dos títulos da Home. | `color: var(--home-section-title-color);` |
| `--home-carousel-gap` | Carrosséis da Home | Gap entre cards do carrossel. | `gap: var(--home-carousel-gap);` |
| `--home-carousel-side-padding` | Carrosséis da Home | Padding lateral do trilho. | `padding-inline: var(--home-carousel-side-padding);` |
| `--home-carousel-bottom-padding` | Carrosséis da Home | Padding inferior do trilho. | `padding-bottom: var(--home-carousel-bottom-padding);` |
| `--home-carousel-card-width` | Carrosséis da Home | Largura calculada dos cards. | `flex-basis: var(--home-carousel-card-width);` |
| `--home-carousel-control-border` | Carrosséis da Home | Borda dos controles. | `border-color: var(--home-carousel-control-border);` |
| `--home-category-section-gap` | Seções de categoria | Distância entre blocos de categorias. | `gap: var(--home-category-section-gap);` |
| `--home-calendar-gap` | Calendário da Home | Gap entre colunas/cards de calendário. | `gap: var(--home-calendar-gap);` |
| `--home-calendar-day-heading-space` | Calendário da Home | Espaço reservado para heading do dia. | `padding-top: var(--home-calendar-day-heading-space);` |
| `--filter-color` | `CataloguePage.tsx` | Cor de chip de filtro ativo. | `style={{ "--filter-color": "#8b5cf6" }}` |
| `--filter-orb-color` | `CataloguePage.tsx` | Cor do orb da seção de filtro. | `style={{ "--filter-orb-color": "#35d07f" }}` |
| `--catalogue-list-fade-color` | Lista do Catálogo | Cor do fade da lista. | `background: var(--catalogue-list-fade-color);` |
| `--catalogue-results-height` | `CataloguePage.tsx` | Altura medida da área de resultados. | `style={{ "--catalogue-results-height": "620px" }}` |
| `--library-inline-padding` | Biblioteca | Padding lateral compartilhado da biblioteca. | `padding-inline: var(--library-inline-padding);` |
| `--modal-details-padding-left` | Modal de jogo | Padding esquerdo responsivo dos detalhes. | `padding-left: var(--modal-details-padding-left);` |
| `--modal-details-padding-right` | Modal de jogo | Padding direito responsivo dos detalhes. | `padding-right: var(--modal-details-padding-right);` |
| `--achievement-scrollbar-thumb-width` | `ProfilePage.tsx` | Largura do thumb customizado de conquistas. | `width: var(--achievement-scrollbar-thumb-width);` |
| `--achievement-scrollbar-thumb-x` | `ProfilePage.tsx` | Posição horizontal do thumb customizado. | `transform: translateX(var(--achievement-scrollbar-thumb-x));` |
| `--settings-enter-delay` | `SettingsPage.tsx` | Delay escalonado de blocos de configurações. | `style={{ "--settings-enter-delay": "0.08s" }}` |

## Exemplo Completo

```scss
.example-card {
  display: grid;
  gap: calc(var(--spacing) * 1.5);
  padding: calc(var(--spacing) * 2);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  background: var(--card-bg);
  color: var(--text-primary);
  font-family: var(--font-sans);
  transition:
    background var(--motion-fast) var(--ease),
    transform var(--motion-base) var(--ease);
}

.example-card:hover {
  background: var(--card-bg-hover);
  transform: translate3d(0, -2px, 0);
}
```

```tsx
<div
  className="catalogue-filter-chip"
  style={{ "--filter-color": "#8b5cf6" } as React.CSSProperties}
>
  RPG
</div>
```
