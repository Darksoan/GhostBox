# GhostBox - Instruções do Projeto

## Mapa de pastas

```
src/
  pages/        páginas (Home, Library, Catalogue, Downloads, Profile, Notifications, Settings, Achievements, Favorites)
  components/   componentes de UI reutilizáveis (ver components/ui para os primitivos de design system)
  features/     lógica de features específicas (ex.: ciclos de recomendação, calendário pessoal)
  hooks/        hooks React compartilhados
  context/      contexts globais (settings, auth/premium, etc.)
  queries/      integração com React Query
  utils/        funções puras (wishlistCycle, personalCalendar, storage, steamTitles, etc.)
  styles/       tokens do design system (_primitives.scss, _semantic.scss)
  lib/          integração com o backend Tauri (ghostboxApi.tauri.ts) e afins
  types/        tipos compartilhados
  i18n.ts       strings PT/EN

src-tauri/src/  backend Rust: steam*, catalogue*, cdndownload, ludusavi, backup, cloud_save,
                achievement_monitor, manifest_sources, subscription, window_lifecycle

workers/        Cloudflare Workers: catalogue, steam-details, steam-stats, subscriptions, feedback
tests/          testes Vitest (um arquivo por área: layout, wishlist-cycle, personal-calendar, etc.)
scripts/        manutenção (check-tokens.mjs, set-release-version.mjs)
Plans/          planos de melhoria e features
fixes/          auditorias pós-implementação de features específicas
```

## Convenções

### Design tokens

- Nunca usar hex cru ou `--n-*`/`--a-*`/`--gold-*` diretamente em componentes — só tokens semânticos (`--surface-*`, `--text-*`, `--border-*`, `--space-*`, `--type-*`, `--motion-*`).
- Fonte de verdade dos tokens: `src/styles/_primitives.scss` e `src/styles/_semantic.scss`. Regras completas em [design.md](design.md).
- Toda mudança em SCSS deve passar em `npm run check:tokens` antes de commitar.
- Não criar token novo para resolver um caso isolado; se o papel visual se repetir, promover para token semântico e atualizar os testes de tokens.

### i18n

- Strings visíveis ao usuário vão em `src/i18n.ts`, com cobertura PT e EN.
- Nova string sem tradução em um dos dois idiomas é bug, não pendência.

### Features

- Lógica de dado/algoritmo (filtragem, ranking, ciclos) fica em `src/utils/*.ts`, testável sem React.
- Componentes de página (`src/pages/*.tsx`) orquestram estado e chamam essas funções puras — evita testar comportamento de negócio via DOM.
- Efeitos que disparam por múltiplos gatilhos (mount, `visibilitychange`, timeout) precisam de guarda de execução concorrente (`inFlight`) para não empilhar pipelines caros.

## Como rodar testes

```bash
npm test              # suíte completa (Vitest)
npm run test:watch    # modo watch
npx tsc --noEmit       # type-check
npm run check:tokens   # valida uso de design tokens
npm run build          # gate completo: check:tokens + tsc + vite build
```

CI (`.github/workflows/ci.yml`) roda `check:tokens`, `tsc --noEmit` e `npm test` em push/PR para `master`. Release (`.github/workflows/release.yml`) builda e publica o instalador Windows em push para `master`.

## Regras de produto

- GhostBox só gerencia jogos/apps que o usuário já está autorizado a executar — não distribui nem modifica jogos. Ver [POLICIES.md](POLICIES.md).
- Chave da Steam Web API nunca vai para o desktop ou `.env` — fica só como secret do Worker `steam-stats`.
