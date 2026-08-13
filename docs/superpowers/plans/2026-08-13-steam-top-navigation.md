# Navegação no topo estilo Steam — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a sidebar global de 280px e o card de navegação flutuante por abas no header do app, movendo as coleções para um painel lateral dentro da página Biblioteca.

**Architecture:** Um componente `TopNav` novo entra no `Header` existente, consumindo a mesma lista `navigationItems` que sidebar e card flutuante já usavam. O avatar sai do card flutuante para um `NavProfile` reutilizável antes de o card ser deletado. As coleções migram para um `LibraryPanel` escopado na página Biblioteca — isso precisa existir **antes** da Sidebar ser removida, porque `App.tsx:418-420` mostra que criar e excluir coleção só existem lá.

**Tech Stack:** React 18 + TypeScript, SCSS monolítico (`src/app.scss`), Vitest com `sass-embedded` + `postcss` para asserções de estilo, Tauri 2.

## Global Constraints

- **Sem tokens novos sem necessidade.** `npm run check:tokens` roda no `build` e é uma catraca: falha quando a contagem de valores crus de um arquivo **sobe** em relação ao baseline. CSS novo usa tokens existentes.
- **Sem cor de destaque.** O sistema é monocromático (`--n-*`, `--c-*`, alfas `--a-*`). Não existe token azul/accent. A referência da Steam usa azul na aba ativa; aqui o estado ativo é `--text-primary` + sublinhado, com inativo em `--text-tertiary`. Não inventar `--accent-*`.
- **Navegação em linha única.** Decisão explícita do usuário. As abas entram no `.header` de 52px existente, não numa segunda faixa.
- **Testes ficam em `tests/`**, nunca em `src/`. `vitest.config.ts` só inclui `tests/**/*.test.ts`. Não existe `@testing-library/react` — os testes são de lógica pura ou asserções sobre CSS compilado / texto-fonte.
- **Rodar `npx tsc --noEmit` e `npm test` antes de cada commit.**
- Idioma de comentários no código: português, seguindo o restante do repositório.

---

### Task 1: Componente `TopNav`

**Files:**
- Create: `src/components/layout/TopNav.tsx`
- Create: `tests/top-nav.test.ts`

**Interfaces:**
- Consumes: `primaryNavigation`, `secondaryNavigation` de `src/components/layout/navigationItems.ts`; `getActiveDownloadCount` e `downloadTasksChangedEvent` de `src/lib/downloadManager.ts`; `useSettings` de `src/context/settings`.
- Produces: `export const TopNav` com props `{ activePage: Page; onNavigate: (page: Page) => void }`. Task 4 monta ele no `Header`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/top-nav.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allNavigation,
  primaryNavigation,
  secondaryNavigation,
} from "../src/components/layout/navigationItems";

describe("TopNav — itens de navegação", () => {
  it("mantém as cinco páginas, na ordem", () => {
    expect(allNavigation.map((item) => item.id)).toEqual([
      "home",
      "catalogue",
      "library",
      "downloads",
      "settings",
    ]);
  });

  it("dá a todo item uma chave de tradução e um ícone", () => {
    for (const item of [...primaryNavigation, ...secondaryNavigation]) {
      expect(item.labelKey).toMatch(/^nav\./);
      expect(item.icon).toBeTruthy();
    }
  });
});

describe("TopNav — componente", () => {
  const source = readFileSync("src/components/layout/TopNav.tsx", "utf8");

  it("reaproveita a lista compartilhada em vez de repetir as páginas", () => {
    expect(source).toContain('from "./navigationItems"');
    expect(source).not.toMatch(/id:\s*"home"/);
  });

  it("mostra o badge de downloads a partir do gerenciador, não de prop", () => {
    expect(source).toContain("getActiveDownloadCount");
    expect(source).toContain("downloadTasksChangedEvent");
  });

  it("marca a aba ativa para leitores de tela", () => {
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/top-nav.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'src/components/layout/TopNav.tsx'`

- [ ] **Step 3: Escrever o componente**

Criar `src/components/layout/TopNav.tsx`:

```tsx
import { memo, useEffect, useState } from "react";
import type { Page } from "../../types";
import { useSettings } from "../../context/settings";
import {
  downloadTasksChangedEvent,
  getActiveDownloadCount,
} from "../../lib/downloadManager";
import { primaryNavigation, secondaryNavigation } from "./navigationItems";

const navigationItems = [...primaryNavigation, ...secondaryNavigation];

interface TopNavProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export const TopNav = memo(function TopNav({
  activePage,
  onNavigate,
}: TopNavProps) {
  const { t } = useSettings();
  const [activeDownloadCount, setActiveDownloadCount] = useState(() =>
    getActiveDownloadCount()
  );

  useEffect(() => {
    const refresh = () => setActiveDownloadCount(getActiveDownloadCount());
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, []);

  return (
    <nav className="top-nav" aria-label="Navegação principal">
      <ul className="top-nav__list">
        {navigationItems.map(({ id, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          const isActive = activePage === id;

          return (
            <li key={id}>
              <button
                type="button"
                className={`top-nav__tab${isActive ? " top-nav__tab--active" : ""}`}
                onClick={() => onNavigate(id)}
                aria-current={isActive ? "page" : undefined}
                title={label}
              >
                <Icon
                  className="top-nav__icon"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="top-nav__label">{label}</span>
                {id === "downloads" && activeDownloadCount > 0 && (
                  <strong className="top-nav__badge">
                    {activeDownloadCount > 99 ? "99+" : activeDownloadCount}
                  </strong>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/top-nav.test.ts` → PASS
Run: `npx tsc --noEmit` → sem erros

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/TopNav.tsx tests/top-nav.test.ts
git commit -m "feat: componente TopNav com abas de navegação"
```

---

### Task 2: Estilos do `TopNav`

**Files:**
- Modify: `src/app.scss` — inserir o bloco `.top-nav` logo após o bloco `.header` (que termina antes de `.header {` na linha ~1870; inserir antes dessa segunda declaração)
- Modify: `tests/top-nav.test.ts`

**Interfaces:**
- Consumes: classes emitidas pela Task 1 (`.top-nav`, `__list`, `__tab`, `--active`, `__icon`, `__label`, `__badge`).
- Produces: nada em código; Task 4 depende só do visual existir.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `tests/top-nav.test.ts`:

```ts
import { compile } from "sass-embedded";
import postcss from "postcss";

describe("TopNav — estilos", () => {
  const css = postcss.parse(compile("src/app.scss").css);

  const declsFor = (selector: string) => {
    const found = new Map<string, string>();
    css.walkRules((rule) => {
      if (rule.selector !== selector) return;
      rule.walkDecls((declaration) => {
        found.set(declaration.prop, declaration.value);
      });
    });
    return found;
  };

  it("usa o texto terciário no inativo e o primário no ativo", () => {
    expect(declsFor(".top-nav__tab").get("color")).toBe("var(--text-tertiary)");
    expect(declsFor(".top-nav__tab--active").get("color")).toBe(
      "var(--text-primary)"
    );
  });

  it("carrega o estado ativo no sublinhado, já que o sistema não tem cor de destaque", () => {
    expect(declsFor(".top-nav__tab--active").get("box-shadow")).toContain(
      "var(--text-primary)"
    );
  });

  it("colapsa para só ícone antes de o header apertar", () => {
    const source = readFileSync("src/app.scss", "utf8");
    expect(source).toContain("@media (max-width: 1100px)");
    let labelHidden = false;
    css.walkAtRules("media", (atRule) => {
      if (!atRule.params.includes("1100px")) return;
      atRule.walkRules((rule) => {
        if (rule.selector.includes(".top-nav__label")) labelHidden = true;
      });
    });
    expect(labelHidden).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/top-nav.test.ts`
Expected: FAIL — `expected undefined to be 'var(--text-tertiary)'`

- [ ] **Step 3: Escrever o SCSS**

Inserir em `src/app.scss`, imediatamente antes da segunda declaração `.header {` (linha ~1870):

```scss
/* ─── Navegação no topo ───────────────────────────────────────────────────── */
/*
 * Abas dentro do próprio `.header`, em linha única — decisão de layout do
 * usuário. O sistema é monocromático: não existe token de destaque, então o
 * estado ativo é texto primário mais sublinhado, e não cor.
 */
.top-nav {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 100%;

  &__list {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    height: 100%;
    padding: 0 var(--space-5);
    border: 0;
    background: transparent;
    color: var(--text-tertiary);
    font-size: var(--type-size-compact);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--ls-500);
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
    transition: color var(--motion-fast) var(--ease);

    &:hover {
      color: var(--text-primary);
    }
  }

  /* `box-shadow` e não `border-bottom`: a borda mudaria a altura da caixa
     dentro do header, que tem altura travada. */
  &__tab--active {
    color: var(--text-primary);
    box-shadow: inset 0 -2px 0 0 var(--text-primary);
  }

  &__icon {
    flex: 0 0 auto;
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-titlebar-control);
    color: var(--text-primary);
    font-size: var(--type-size-micro);
    font-weight: var(--weight-semibold);
  }
}

/* Só ícone antes que as abas briguem por espaço com o bloco de ações. */
@media (max-width: 1100px) {
  .top-nav__label {
    display: none;
  }

  .top-nav__tab {
    padding: 0 var(--space-4);
  }
}
```

Antes de rodar, conferir que `--radius-pill`, `--ls-500`, `--weight-semibold`, `--motion-fast` e `--ease` existem em `src/styles/_primitives.scss` / `_semantic.scss`. Se algum não existir, trocar pelo token equivalente que já esteja em uso no arquivo — **não criar token novo**.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/top-nav.test.ts` → PASS
Run: `npm run check:tokens` → sem aumento de baseline
Run: `npx sass --no-source-map src/app.scss /dev/null` → exit 0

- [ ] **Step 5: Commit**

```bash
git add src/app.scss tests/top-nav.test.ts
git commit -m "feat: estilos das abas de navegação no topo"
```

---

### Task 3: Extrair `NavProfile` do card flutuante

**Files:**
- Create: `src/components/layout/NavProfile.tsx`
- Modify: `src/components/layout/FloatingNav.tsx:231-295` — apagar `FloatingNavProfile` e importar `NavProfile`
- Create: `tests/nav-profile.test.ts`

**Interfaces:**
- Consumes: `useCachedImageSources`, `useLoadableImageSource` de `src/hooks/useCachedImageSources`; `preloadProfileImages` de `src/utils/image`; `useAuth` de `src/context/AuthContext`; `useSettings`.
- Produces: `export const NavProfile` com props `{ profile: SteamProfile | null; isCloudProfileRestoring: boolean; isActive: boolean; onOpenProfile: () => void; className?: string }`. Task 4 usa no `Header`.

Extrair antes de deletar o card. A lógica de avatar em cache, skeleton durante restauração da nuvem e cadeia de fallback do nome já tem casos de borda resolvidos — reescrever seria perder isso.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/nav-profile.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("NavProfile", () => {
  const source = readFileSync("src/components/layout/NavProfile.tsx", "utf8");

  it("segura o avatar antigo da Steam enquanto o perfil da nuvem restaura", () => {
    expect(source).toContain("shouldHoldSteamAvatar");
    expect(source).toContain("/storage/v1/object/public/profile-images/");
  });

  it("mantém a cadeia de fallback do nome", () => {
    expect(source).toContain("profile?.displayName");
    expect(source).toContain("account?.displayName");
    expect(source).toContain("account?.username");
  });

  it("pré-carrega as imagens no hover e no foco", () => {
    expect(source).toContain("onMouseEnter");
    expect(source).toContain("onFocus");
    expect(source).toContain("preloadProfileImages");
  });

  it("o card flutuante passa a consumir o componente extraído", () => {
    const floating = readFileSync(
      "src/components/layout/FloatingNav.tsx",
      "utf8"
    );
    expect(floating).toContain('from "./NavProfile"');
    expect(floating).not.toContain("function FloatingNavProfile");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/nav-profile.test.ts`
Expected: FAIL — `ENOENT ... NavProfile.tsx`

- [ ] **Step 3: Criar o componente e religar o card**

Criar `src/components/layout/NavProfile.tsx` movendo o corpo de `FloatingNavProfile` (`FloatingNav.tsx:238-295`), trocando o prefixo de classe `floating-nav__` por `nav-profile__` e aceitando `className` para o header estilizar por fora:

```tsx
import { memo, useEffect } from "react";
import { UserRound } from "lucide-react";
import type { SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { useAuth } from "../../context/AuthContext";
import {
  useCachedImageSources,
  useLoadableImageSource,
} from "../../hooks/useCachedImageSources";
import { preloadProfileImages } from "../../utils/image";

interface NavProfileProps {
  profile: SteamProfile | null;
  isCloudProfileRestoring: boolean;
  isActive: boolean;
  onOpenProfile: () => void;
  className?: string;
}

export const NavProfile = memo(function NavProfile({
  profile,
  isCloudProfileRestoring,
  isActive,
  onOpenProfile,
  className = "",
}: NavProfileProps) {
  const { appearance } = useSettings();
  const { account } = useAuth();
  const avatarSources = useCachedImageSources(
    profile?.avatarUrl ? [profile.avatarUrl] : []
  );
  const avatarSource = useLoadableImageSource(avatarSources);

  // Enquanto o perfil da nuvem restaura, o avatar antigo da Steam ainda está no
  // ar e trocaria duas vezes: segura no skeleton até a fonte final chegar.
  const shouldHoldSteamAvatar = Boolean(
    isCloudProfileRestoring &&
      profile?.avatarUrl &&
      !profile.avatarUrl.startsWith("data:") &&
      !profile.avatarUrl.includes("/storage/v1/object/public/profile-images/")
  );

  useEffect(() => {
    preloadProfileImages(profile);
  }, [profile?.avatarUrl, profile?.bannerUrl]);

  const displayName =
    profile?.displayName ||
    account?.displayName ||
    account?.username ||
    (appearance.language === "en" ? "Log in" : "Faça login");

  return (
    <button
      type="button"
      className={`nav-profile${isActive ? " nav-profile--active" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onOpenProfile}
      onMouseEnter={() => profile && preloadProfileImages(profile)}
      onFocus={() => profile && preloadProfileImages(profile)}
    >
      <span className="nav-profile__avatar" aria-hidden="true">
        {shouldHoldSteamAvatar || (isCloudProfileRestoring && !avatarSource) ? (
          <span className="nav-profile__avatar-skeleton" />
        ) : avatarSource ? (
          <img
            src={avatarSource}
            alt=""
            width={28}
            height={28}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <UserRound size={16} />
        )}
      </span>
      <span className="nav-profile__name">{displayName}</span>
    </button>
  );
});
```

Em `src/components/layout/FloatingNav.tsx`: apagar `FloatingNavProfile` e sua interface (linhas 231-295), apagar os imports que ficaram órfãos (`UserRound`, `useAuth`, `useCachedImageSources`, `useLoadableImageSource`, `preloadProfileImages`, `SteamProfile` se não usado em outro lugar), adicionar `import { NavProfile } from "./NavProfile";` e trocar o uso em `FloatingNav.tsx:170-175` por:

```tsx
<NavProfile
  profile={steamProfile}
  isCloudProfileRestoring={isCloudProfileRestoring}
  isActive={activePage === "profile"}
  onOpenProfile={onOpenProfile}
  className="floating-nav__profile"
/>
```

Copiar as regras `.floating-nav__profile`, `__avatar`, `__avatar-skeleton`, `__profile-name` de `src/components/layout/FloatingNav.scss` para um bloco `.nav-profile` novo em `src/app.scss` (o `.scss` do card é deletado na Task 9).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/nav-profile.test.ts` → PASS
Run: `npx tsc --noEmit` → sem erros
Run: `npm test` → suíte inteira verde (o card flutuante continua funcionando)

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/NavProfile.tsx src/components/layout/FloatingNav.tsx src/app.scss tests/nav-profile.test.ts
git commit -m "refactor: extrai NavProfile do card flutuante"
```

---

### Task 4: Montar `TopNav` e `NavProfile` no `Header`

**Files:**
- Modify: `src/components/layout/Header.tsx:529-562`
- Modify: `src/App.tsx:443-475` — passar as props novas
- Modify: `tests/top-nav.test.ts`

**Interfaces:**
- Consumes: `TopNav` (Task 1), `NavProfile` (Task 3).
- Produces: `Header` passa a aceitar `activePage: Page`, `onNavigate: (page: Page) => void`, `isCloudProfileRestoring: boolean`, `onOpenProfile: () => void`. `Header` já recebe `page` e `steamProfile`; reusar `page` como `activePage` em vez de adicionar prop duplicada.

Nesta task a sidebar ainda existe, então a navegação aparece duplicada. É interino e proposital: a remoção da sidebar é a Task 10, e cada task precisa ser commitável sozinha.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `tests/top-nav.test.ts`:

```ts
describe("TopNav — montagem no header", () => {
  const header = readFileSync("src/components/layout/Header.tsx", "utf8");

  it("fica entre o bloco da esquerda e o de ações", () => {
    const left = header.indexOf("header__section--left");
    const nav = header.indexOf("<TopNav");
    const actions = header.indexOf("header__section--actions");

    expect(nav).toBeGreaterThan(left);
    expect(nav).toBeLessThan(actions);
  });

  it("leva o perfil para o bloco de ações", () => {
    expect(header).toContain("<NavProfile");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/top-nav.test.ts`
Expected: FAIL — `expected -1 to be greater than <n>`

- [ ] **Step 3: Montar**

Em `src/components/layout/Header.tsx`, adicionar aos imports:

```tsx
import { TopNav } from "./TopNav";
import { NavProfile } from "./NavProfile";
```

Adicionar à interface de props do componente (junto de `page` e `steamProfile`, que já existem):

```tsx
  onNavigate: (page: Page) => void;
  onOpenProfile: () => void;
  isCloudProfileRestoring?: boolean;
```

Inserir o `TopNav` logo depois do `</div>` que fecha `header__navigation-controls`, ainda dentro de `header__section--left` (linha 559-560):

```tsx
        </div>

        <TopNav activePage={page} onNavigate={onNavigate} />
      </div>
```

Inserir o `NavProfile` como **primeiro** filho de `header__section--actions` (linha 562):

```tsx
      <div className="header__section header__section--actions">
        <NavProfile
          profile={steamProfile}
          isCloudProfileRestoring={isCloudProfileRestoring ?? false}
          isActive={page === "profile"}
          onOpenProfile={onOpenProfile}
          className="header__profile"
        />
```

Em `src/App.tsx`, no `<Header ...>` (linha 443), acrescentar:

```tsx
            onNavigate={handleNavigate}
            onOpenProfile={() => handleNavigate("profile")}
            isCloudProfileRestoring={appData.isCloudProfileRestoring}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/top-nav.test.ts` → PASS
Run: `npx tsc --noEmit` → sem erros
Run: `npm run tauri:dev` — clicar em cada aba, confirmar que troca de página e que o estado ativo acompanha

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Header.tsx src/App.tsx tests/top-nav.test.ts
git commit -m "feat: monta abas e perfil no header"
```

---

### Task 5: Abas de ajustes sempre dentro da página

**Files:**
- Modify: `src/components/routing/PageRouter.tsx:110,128,310`
- Modify: `src/App.tsx:486`
- Create: `tests/settings-tabs-bar.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `PageRouter` perde a prop `showSettingsTabsBar`. Task 10 depende disso, porque hoje ela é alimentada por `isFloatingNavLayout`.

`SettingsPage.tsx:369` já renderiza a barra quando `showTabsBar` é true. Vira incondicional.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/settings-tabs-bar.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Barra de abas de ajustes", () => {
  it("não depende mais do layout de navegação", () => {
    const router = readFileSync(
      "src/components/routing/PageRouter.tsx",
      "utf8"
    );
    const app = readFileSync("src/App.tsx", "utf8");

    expect(router).not.toContain("showSettingsTabsBar");
    expect(app).not.toContain("showSettingsTabsBar");
  });

  it("a página de ajustes segue renderizando a própria barra", () => {
    const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");
    expect(settings).toContain("settings-page__tabs-bar");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/settings-tabs-bar.test.ts`
Expected: FAIL — a string `showSettingsTabsBar` ainda existe nos dois arquivos

- [ ] **Step 3: Remover a prop**

Em `src/components/routing/PageRouter.tsx`: apagar `showSettingsTabsBar: boolean;` (linha 110), apagar `showSettingsTabsBar,` da desestruturação (linha 128) e trocar a linha 310 por `showTabsBar`.

Em `src/App.tsx`: apagar a linha 486 (`showSettingsTabsBar={isFloatingNavLayout}`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/settings-tabs-bar.test.ts` → PASS
Run: `npx tsc --noEmit` → sem erros
Run: `npm run tauri:dev` — abrir Ajustes em janela restaurada e confirmar que a barra de abas aparece

- [ ] **Step 5: Commit**

```bash
git add src/components/routing/PageRouter.tsx src/App.tsx tests/settings-tabs-bar.test.ts
git commit -m "feat: barra de abas de ajustes sempre na própria página"
```

---

### Task 6: `LibraryPanel` — estrutura e lista de coleções

**Files:**
- Create: `src/components/library/LibraryPanel.tsx`
- Modify: `src/app.scss` — bloco `.library-panel` novo
- Create: `tests/library-panel.test.ts`

**Interfaces:**
- Consumes: `UserCollection` e `GhostBoxGame` de `src/types` / `src/data`; `useSettings`.
- Produces: `export const LibraryPanel` com props:

```ts
interface LibraryPanelProps {
  collections: UserCollection[];
  favoriteGames: GhostBoxGame[];
  uncategorizedCount: number;
  activeCollectionId: string | null;
  onSelectCollection: (collectionId: string | null) => void;
  onCreateCollection: () => void;
  onDeleteCollection: (collectionId: string) => void;
  onOpenGame: (game: GhostBoxGame) => void;
}
```

Task 7 monta na `LibraryPage`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/library-panel.test.ts`:

```ts
import { compile } from "sass-embedded";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("LibraryPanel — estrutura", () => {
  const source = readFileSync(
    "src/components/library/LibraryPanel.tsx",
    "utf8"
  );

  it("mostra a contagem de cada grupo", () => {
    expect(source).toContain("library-panel__group-count");
  });

  it("expande e recolhe cada grupo", () => {
    expect(source).toContain("aria-expanded");
    expect(source).toContain("expandedGroupIds");
  });

  it("tem grupo derivado de sem categoria", () => {
    expect(source).toContain("uncategorizedCount");
  });
});

describe("LibraryPanel — estilos", () => {
  const css = postcss.parse(compile("src/app.scss").css);

  const declsFor = (selector: string) => {
    const found = new Map<string, string>();
    css.walkRules((rule) => {
      if (rule.selector !== selector) return;
      rule.walkDecls((declaration) => {
        found.set(declaration.prop, declaration.value);
      });
    });
    return found;
  };

  it("tem largura fixa, como a referência", () => {
    expect(declsFor(".library-panel").get("width")).toBeDefined();
  });

  it("separa visualmente um grupo do outro", () => {
    expect(declsFor(".library-panel__group + .library-panel__group").get(
      "border-top"
    )).toContain("var(--border-subtle)");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/library-panel.test.ts`
Expected: FAIL — `ENOENT ... LibraryPanel.tsx`

- [ ] **Step 3: Escrever componente e estilos**

Criar `src/components/library/LibraryPanel.tsx`. O padrão de grupo recolhível vem de `src/components/layout/Sidebar.tsx:263-380`, com o prefixo trocado de `sidebar__` para `library-panel__`:

```tsx
import { memo, useMemo, useState } from "react";
import { ChevronRight, Folder, Heart, Plus, Trash2 } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import type { UserCollection } from "../../types";
import { useSettings } from "../../context/settings";

export const FAVORITES_GROUP_ID = "favorites";
export const UNCATEGORIZED_GROUP_ID = "__uncategorized__";

interface LibraryPanelProps {
  collections: UserCollection[];
  favoriteGames: GhostBoxGame[];
  uncategorizedCount: number;
  activeCollectionId: string | null;
  onSelectCollection: (collectionId: string | null) => void;
  onCreateCollection: () => void;
  onDeleteCollection: (collectionId: string) => void;
  onOpenGame: (game: GhostBoxGame) => void;
}

interface PanelGroup {
  id: string;
  name: string;
  count: number;
  games: GhostBoxGame[];
  removable: boolean;
}

export const LibraryPanel = memo(function LibraryPanel({
  collections,
  favoriteGames,
  uncategorizedCount,
  activeCollectionId,
  onSelectCollection,
  onCreateCollection,
  onDeleteCollection,
  onOpenGame,
}: LibraryPanelProps) {
  const { t, appearance } = useSettings();
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const [search, setSearch] = useState("");

  const language = appearance.language;

  // Favoritos primeiro, coleções do usuário no meio, "sem categoria" por
  // último — os dois das pontas são derivados e não podem ser excluídos.
  const groups = useMemo<PanelGroup[]>(() => {
    const list: PanelGroup[] = [
      {
        id: FAVORITES_GROUP_ID,
        name: t("profile.favorites"),
        count: favoriteGames.length,
        games: favoriteGames,
        removable: false,
      },
      ...collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        count: collection.gameIds.length,
        games: collection.games ?? [],
        removable: true,
      })),
      {
        id: UNCATEGORIZED_GROUP_ID,
        name: language === "en" ? "Uncategorized" : "Sem categoria",
        count: uncategorizedCount,
        games: [],
        removable: false,
      },
    ];

    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((group) => group.name.toLowerCase().includes(term));
  }, [collections, favoriteGames, language, search, t, uncategorizedCount]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const sortGames = (games: GhostBoxGame[]) =>
    [...games].sort((a, b) => a.title.localeCompare(b.title, language));

  return (
    <aside className="library-panel" aria-label={t("nav.library")}>
      <header className="library-panel__header">
        <button
          type="button"
          className={`library-panel__home${
            activeCollectionId === null ? " library-panel__home--active" : ""
          }`}
          onClick={() => onSelectCollection(null)}
        >
          {language === "en" ? "Home" : "Página inicial"}
        </button>
      </header>

      <input
        type="search"
        className="library-panel__search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={language === "en" ? "Search" : "Buscar"}
        aria-label={language === "en" ? "Search collections" : "Buscar coleções"}
      />

      <div className="library-panel__groups">
        {groups.map((group) => {
          const isExpanded = expandedGroupIds.has(group.id);
          const isActive = activeCollectionId === group.id;

          return (
            <section key={group.id} className="library-panel__group">
              <div className="library-panel__group-row">
                <button
                  type="button"
                  className="library-panel__group-toggle"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isExpanded}
                  aria-label={group.name}
                >
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className={`library-panel__chevron${
                      isExpanded ? " library-panel__chevron--expanded" : ""
                    }`}
                  />
                </button>

                <button
                  type="button"
                  className={`library-panel__group-button${
                    isActive ? " library-panel__group-button--active" : ""
                  }`}
                  onClick={() => onSelectCollection(isActive ? null : group.id)}
                  aria-current={isActive ? "true" : undefined}
                >
                  {group.id === FAVORITES_GROUP_ID ? (
                    <Heart size={16} strokeWidth={2} />
                  ) : (
                    <Folder size={16} strokeWidth={2} />
                  )}
                  <span className="library-panel__group-name">{group.name}</span>
                  <span className="library-panel__group-count">
                    ({group.count})
                  </span>
                </button>

                {group.removable && (
                  <button
                    type="button"
                    className="library-panel__group-remove"
                    onClick={() => onDeleteCollection(group.id)}
                    aria-label={`${
                      language === "en" ? "Delete" : "Excluir"
                    } ${group.name}`}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                )}
              </div>

              {isExpanded && group.games.length > 0 && (
                <ul className="library-panel__games">
                  {sortGames(group.games).map((game) => (
                    <li key={game.id}>
                      <button
                        type="button"
                        className="library-panel__game"
                        onClick={() => onOpenGame(game)}
                        title={game.title}
                      >
                        {game.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <button
        type="button"
        className="library-panel__create"
        onClick={onCreateCollection}
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        <span>{language === "en" ? "New collection" : "Criar coleção"}</span>
      </button>
    </aside>
  );
});
```

Antes de rodar, conferir que `t("profile.favorites")` e `t("nav.library")` existem em `src/i18n.ts` — as duas já são usadas por `FloatingNav.tsx:110` e `navigationItems.ts:17`. Conferir também que `GhostBoxGame` tem `title`; se o campo tiver outro nome, ajustar `sortGames` e o texto do botão.

O grupo "Sem categoria" tem `games: []` de propósito: a contagem chega por prop, mas a página não passa a lista, então ele funciona como filtro e não expande com conteúdo. O toggle continua ali para o visual bater com a referência.

**Fora desta task:** o dropdown "Jogos e Softwares" da referência não entra. Ele filtra por tipo de produto (jogo vs. software), distinção que o modelo de dados do GhostBox não tem hoje — implementar seria inventar funcionalidade, não portar. O toggle de vista também fica de fora, conforme o spec: ele alterna para a vista de Coleções, que é o Spec B.

Adicionar em `src/app.scss` o bloco `.library-panel`, com pelo menos:

```scss
.library-panel {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  width: 272px;
  min-width: 272px;
  gap: var(--space-4);
  padding: var(--space-6);
  background: var(--surface-sidebar);

  /* Separador entre grupos — pedido explícito na referência. */
  &__group + &__group {
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--space-4);
  }

  &__group-count {
    margin-left: auto;
    color: var(--text-tertiary);
    font-size: var(--type-size-caption);
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/library-panel.test.ts` → PASS
Run: `npx tsc --noEmit` → sem erros
Run: `npm run check:tokens` → sem aumento

- [ ] **Step 5: Commit**

```bash
git add src/components/library/LibraryPanel.tsx src/app.scss tests/library-panel.test.ts
git commit -m "feat: painel lateral de coleções da biblioteca"
```

---

### Task 7: Ligar o painel na `LibraryPage` e aposentar os chips

**Files:**
- Modify: `src/pages/LibraryPage.tsx:56-68` (props), `247-340` (render)
- Modify: `src/App.tsx` — passar `onCreateCollection` e `onDeleteCollection` à `LibraryPage`
- Modify: `src/app.scss` — `.content-section--library` vira linha flex
- Modify: `tests/library-panel.test.ts`

**Interfaces:**
- Consumes: `LibraryPanel` (Task 6).
- Produces: `LibraryPageProps` ganha `onCreateCollection: () => void` e `onDeleteCollection: (collectionId: string) => void`. Task 10 depende disso: são as funções que a Sidebar carregava.

Este é o ponto que impede regressão. Depois desta task, criar e excluir coleção existem em dois lugares (sidebar e painel), o que é seguro. Só então a Sidebar pode sair.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `tests/library-panel.test.ts`:

```ts
describe("LibraryPanel — ligação com a página", () => {
  const page = readFileSync("src/pages/LibraryPage.tsx", "utf8");

  it("a página monta o painel", () => {
    expect(page).toContain("<LibraryPanel");
  });

  it("os chips de coleção da toolbar saíram", () => {
    expect(page).not.toContain("library-toolbar__chips");
  });

  it("criar e excluir coleção chegam até o painel", () => {
    expect(page).toContain("onCreateCollection");
    expect(page).toContain("onDeleteCollection");
  });

  it("a contagem de sem categoria é derivada na página", () => {
    expect(page).toContain("uncategorizedCount");
  });

  it("filtra de verdade ao selecionar sem categoria", () => {
    // Sem este ramo o grupo derivado não casa com nenhuma coleção e a lista
    // passa inteira, dando a impressão de que o filtro não fez nada.
    expect(page).toContain("UNCATEGORIZED_GROUP_ID");
    expect(page).toContain("claimedGameKeys");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/library-panel.test.ts`
Expected: FAIL — `<LibraryPanel` não está em `LibraryPage.tsx`

- [ ] **Step 3: Ligar**

Em `src/pages/LibraryPage.tsx`:

Adicionar à interface (linha 56-68):

```tsx
  onCreateCollection: () => void;
  onDeleteCollection: (collectionId: string) => void;
```

Importar o painel e os IDs derivados:

```tsx
import {
  LibraryPanel,
  UNCATEGORIZED_GROUP_ID,
} from "../components/library/LibraryPanel";
```

Derivar o conjunto de jogos já reivindicados por alguma coleção, e a contagem de sem categoria, junto dos outros `useMemo` (perto da linha 148):

```tsx
  const claimedGameKeys = useMemo(() => {
    const claimed = new Set<string>();
    for (const collection of userCollections) {
      collection.gameIds.forEach((gameId) => addLibraryGameKey(claimed, gameId));
      (collection.games ?? []).forEach((game) => {
        for (const key of getLibraryGameKeys(game)) claimed.add(key);
      });
    }
    return claimed;
  }, [userCollections]);

  const uncategorizedCount = useMemo(
    () =>
      visibleGames.filter(
        (game) => !gameMatchesLibraryKeys(game, claimedGameKeys)
      ).length,
    [claimedGameKeys, visibleGames]
  );
```

**Tratar o grupo derivado no filtro.** Sem isso, selecionar "Sem categoria" não filtra nada: `selectedCollectionId` vira `"__uncategorized__"`, que não é `"favorites"` nem existe em `userCollections`, então `favoritesOnly` e `activeCollectionId` ficam ambos falsos e a lista passa inteira. Dentro do `useMemo` que monta `libraryGames` (linhas 148-182), acrescentar um ramo antes do `return`:

```tsx
    } else if (selectedCollectionId === UNCATEGORIZED_GROUP_ID) {
      filteredGames = [...gamesByKey.values()].filter(
        (game) => !gameMatchesLibraryKeys(game, claimedGameKeys)
      );
    }
```

e incluir `claimedGameKeys` e `selectedCollectionId` no array de dependências desse `useMemo`.

Apagar o bloco `library-toolbar__chips` inteiro (linhas 295-338) — a seleção de coleção passa a vir do painel. Manter a dropdown de ordenação.

Pôr o painel ao lado do conteúdo, dentro do `<section className="content-section ... content-section--library">`. O `<div className="library-toolbar">` (linhas 249-340) e o bloco condicional de grid/loading/empty (linhas 342-358) que já existem passam a viver dentro do wrapper novo, sem outra alteração:

```tsx
      <LibraryPanel
        collections={userCollections}
        favoriteGames={favoriteGames}
        uncategorizedCount={uncategorizedCount}
        activeCollectionId={selectedCollectionId}
        onSelectCollection={changeActiveCollection}
        onCreateCollection={onCreateCollection}
        onDeleteCollection={onDeleteCollection}
        onOpenGame={onOpenGame}
      />

      <div className="library-page__main">
        {/* <div className="library-toolbar"> ... </div> — inalterado */}
        {/* {loading ? <GameGridLoadingState .../> : ...} — inalterado */}
      </div>
```

O `<ContextMenu>` (linhas 360-367) fica fora do wrapper, como último filho do `<section>`.

Em `src/app.scss`, ajustar `.content-section--library` para linha flex e dar `min-width: 0` ao main (senão o grid não encolhe):

```scss
.content-section--library {
  flex-direction: row;
  align-items: stretch;
  gap: 0;
}

.library-page__main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  gap: var(--space-6);
}
```

Em `src/App.tsx`, passar as duas funções à `LibraryPage` (via `PageRouter`, seguindo como as outras props de biblioteca já chegam lá): `onCreateCollection={appData.openCreateUserCollectionModal}` e `onDeleteCollection={appData.deleteCollection}`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/library-panel.test.ts` → PASS
Run: `npx tsc --noEmit` → sem erros
Run: `npm run tauri:dev` — na Biblioteca: expandir grupo, selecionar coleção e ver o grid filtrar, criar coleção, excluir coleção, conferir o separador entre grupos

- [ ] **Step 5: Commit**

```bash
git add src/pages/LibraryPage.tsx src/App.tsx src/app.scss tests/library-panel.test.ts
git commit -m "feat: liga painel de coleções na biblioteca"
```

---

### Task 8: Desacoplar `GameModal` do card flutuante

**Files:**
- Modify: `src/components/modals/GameModal.tsx:297,1341-1351`
- Modify: `tests/floating-nav.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada. Precede a Task 9 — sem isso, deletar o card deixa `querySelector(".floating-nav")` retornando `null` para sempre, código morto que confunde.

`sidebarBottom` ali é a sidebar **sticky do próprio modal**, não a sidebar do app. Ela fica.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/floating-nav.test.ts`, substituir o caso `"keeps the game modal's Ver mais button clear of the card"` por:

```ts
  it("o botão Ver mais segue só a sidebar do modal, sem o card", () => {
    const source = readFileSync("src/components/modals/GameModal.tsx", "utf8");

    expect(source).not.toContain('querySelector(".floating-nav")');
    expect(source).not.toContain("floatingNavTop");
    expect(source).not.toContain("floatingNavGapPx");
    // A sidebar sticky do modal continua sendo o limite de baixo.
    expect(source).toContain("sidebarBottom");
    expect(source).toContain("subscribeScrollIdle(updateCollapsedHeight)");
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/floating-nav.test.ts`
Expected: FAIL — `expected source not to contain 'querySelector(".floating-nav")'`

- [ ] **Step 3: Remover o acoplamento**

Em `src/components/modals/GameModal.tsx`: apagar `const floatingNavGapPx = 16;` (linha 297) e trocar as linhas 1341-1351 por:

```tsx
        // A sidebar sticky do modal é o limite de baixo: o botão "Ver mais" não
        // pode passar dela.
        const bottomLimit = sidebarBottom;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/floating-nav.test.ts` → PASS
Run: `npx tsc --noEmit` → sem erros
Run: `npm run tauri:dev` — abrir um jogo com descrição longa e conferir o botão "Ver mais"

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/GameModal.tsx tests/floating-nav.test.ts
git commit -m "refactor: desacopla GameModal do card flutuante"
```

---

### Task 9: Deletar o card flutuante

**Files:**
- Delete: `src/components/layout/FloatingNav.tsx`, `src/components/layout/FloatingNav.scss`
- Modify: `src/App.tsx:427-438` — remover a renderização
- Delete: `tests/floating-nav.test.ts`
- Modify: `tests/page-bottom-spacing.test.ts` — se referenciar o card
- Create: `tests/vertical-covers.test.ts`

**Interfaces:**
- Consumes: `NavProfile` já extraído (Task 3), `GameModal` já desacoplado (Task 8).
- Produces: nada.

O último `describe` de `tests/floating-nav.test.ts` — `"Vertical covers — a single hover badge style"` — **não tem relação com o card** e testa que `achievement-progress` não voltou. Precisa sobreviver, movido para arquivo próprio.

- [ ] **Step 1: Preservar o teste que não é do card**

Criar `tests/vertical-covers.test.ts` com o conteúdo do último `describe` de `tests/floating-nav.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Capas verticais — um único estilo de badge no hover", () => {
  it("abandona o badge de progresso só-dos-favoritos em favor do compartilhado", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const favorites = readFileSync("src/pages/FavoritesPage.tsx", "utf8");
    const loading = readFileSync("src/components/ui/LoadingStates.tsx", "utf8");

    for (const source of [styles, favorites, loading]) {
      expect(source).not.toContain("achievement-progress");
    }

    expect(favorites).toContain("game-card__achievement-badges");
  });
});
```

Run: `npx vitest run tests/vertical-covers.test.ts` → PASS (nada mudou ainda no código que ele cobre)

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/no-floating-nav.test.ts`:

```ts
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Card flutuante removido", () => {
  it("os arquivos do card não existem mais", () => {
    expect(existsSync("src/components/layout/FloatingNav.tsx")).toBe(false);
    expect(existsSync("src/components/layout/FloatingNav.scss")).toBe(false);
  });

  it("o App não renderiza mais o card", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).not.toContain("FloatingNav");
    expect(app).not.toContain("app-main--floating-nav");
  });

  // Herdado de `tests/floating-nav.test.ts`, que este passo deleta: sem isto o
  // guarda-corpo do desacoplamento da Task 8 sumiria junto com o arquivo.
  it("o GameModal não procura mais o card no DOM", () => {
    const modal = readFileSync("src/components/modals/GameModal.tsx", "utf8");
    expect(modal).not.toContain('querySelector(".floating-nav")');
    expect(modal).not.toContain("floatingNavTop");
    expect(modal).not.toContain("floatingNavGapPx");
    expect(modal).toContain("sidebarBottom");
  });
});
```

Run: `npx vitest run tests/no-floating-nav.test.ts`
Expected: FAIL — `expected true to be false`

- [ ] **Step 3: Deletar**

```bash
git rm src/components/layout/FloatingNav.tsx src/components/layout/FloatingNav.scss tests/floating-nav.test.ts
```

Em `src/App.tsx`: apagar o import de `FloatingNav` e o bloco de renderização (linhas 427-438). Apagar a interpolação `${isFloatingNavLayout ? " app-main--floating-nav" : ""}` da linha 404 (a variável em si sai na Task 10).

Rodar `grep -rn "floating-nav\|FloatingNav" src/ tests/` e limpar o que sobrar. Conferir `tests/page-bottom-spacing.test.ts`: se ele afirma que `--page-bottom-space` embute a altura do card, ajustar a asserção para o valor sem o bump.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/no-floating-nav.test.ts` → PASS
Run: `npm test` → suíte inteira verde
Run: `npx tsc --noEmit` e `npx sass --no-source-map src/app.scss /dev/null` → limpos

- [ ] **Step 5: Commit**

Estagiar por caminho explícito, nunca `git add -A`: o repositório pode ter trabalho de terceiros sem commit, e `-A` varreria tudo para dentro deste commit.

```bash
git add src/App.tsx src/app.scss tests/no-floating-nav.test.ts tests/vertical-covers.test.ts tests/page-bottom-spacing.test.ts
git commit -m "feat: remove o card de navegação flutuante"
```

Os arquivos deletados já ficaram estagiados pelo `git rm` do Step 3.

---

### Task 10: Deletar a sidebar global e limpar o layout

**Files:**
- Delete: `src/components/layout/Sidebar.tsx`, `src/hooks/useWideViewport.ts`
- Modify: `src/App.tsx:11,125,404-425`
- Modify: `src/app.scss` — remover o bloco da sidebar (~921-1564), ajustar `.page` (linha ~811)
- Modify: `tests/home-layout.test.ts`, `tests/typography-tokens.test.ts`, `tests/viewport-resize.test.ts`
- Create: `tests/no-global-sidebar.test.ts`

**Interfaces:**
- Consumes: `LibraryPanel` já cobrindo criar/excluir coleção (Task 7). **Não executar esta task antes da Task 7.**
- Produces: nada.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/no-global-sidebar.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Sidebar global removida", () => {
  it("os arquivos não existem mais", () => {
    expect(existsSync("src/components/layout/Sidebar.tsx")).toBe(false);
    expect(existsSync("src/hooks/useWideViewport.ts")).toBe(false);
  });

  it("o App não troca mais de layout de navegação", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).not.toContain("Sidebar");
    expect(app).not.toContain("useWideViewport");
    expect(app).not.toContain("isFloatingNavLayout");
  });

  it("a página ganha respiro simétrico, já sem a sidebar à esquerda", () => {
    const css = postcss.parse(compile("src/app.scss").css);
    let padding: string | undefined;
    css.walkRules((rule) => {
      if (rule.selector !== ".page") return;
      rule.walkDecls("padding", (declaration) => {
        padding = declaration.value;
      });
    });
    expect(padding).toBe("0 var(--space-6)");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/no-global-sidebar.test.ts`
Expected: FAIL — `expected true to be false`

- [ ] **Step 3: Deletar e limpar**

```bash
git rm src/components/layout/Sidebar.tsx src/hooks/useWideViewport.ts
```

Em `src/App.tsx`: apagar o import de `Sidebar` e o de `useWideViewport` (linha 11), apagar `const isFloatingNavLayout = useWideViewport();` (linha 125), apagar o bloco `{!isFloatingNavLayout && (<Sidebar ... />)}` (linhas 405-425) e simplificar a linha 404 para `<main className="app-main">`.

Em `src/app.scss`:
- Apagar o bloco da sidebar, aproximadamente linhas 921-1564. **Cuidado:** as linhas 593-601 e 620-627 agrupam `.sidebar` com `.header`, `.notifications-page`, `.downloads-page` e `.modal__details` — remover **só o seletor `.sidebar`/`.sidebar-profile`** dessas listas, nunca a regra inteira.
- Apagar `.sidebar__section-title` (~14823) e `.sidebar-profile__button-title` (~14838).
- Trocar o `padding` de `.page` (linha ~811) de `0 var(--space-6) 0 0` para `0 var(--space-6)`. O respiro à esquerda vinha da sidebar; sem ela, vira simétrico.
- `.page--profile { padding-right: 0 }` (linha ~817-819) existe para a capa full-bleed do perfil: trocar por `padding-inline: 0`.

Ajustar os testes que citam a sidebar:
- `tests/home-layout.test.ts:34-45` — afirma `--surface-sidebar`, `--sidebar-option-hover`, `--sidebar-option-selected` e `.sidebar { background }`. O token `--surface-sidebar` passa a ser consumido pelo `.library-panel` (Task 6): trocar a asserção de `.sidebar` para `.library-panel`. Se os tokens `--sidebar-option-*` ficarem sem consumidor, remover as asserções correspondentes.
- `tests/typography-tokens.test.ts:48` — a regex de prefixos aceita `sidebar-option`; deixar como está se os tokens ficarem, remover o trecho se saírem.
- `tests/viewport-resize.test.ts:141-143` — o `describe` inteiro é sobre `useWideViewport`, que deixou de existir. Apagar esse `describe`; manter o resto do arquivo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/no-global-sidebar.test.ts` → PASS
Run: `npm test` → suíte inteira verde
Run: `npx tsc --noEmit` e `npx sass --no-source-map src/app.scss /dev/null` → limpos
Run: `npm run check:tokens` → sem aumento
Run: `npm run tauri:dev` — percorrer todas as abas; redimensionar de 1920px a 800px e conferir o colapso para ícone; maximizar e restaurar e conferir que nenhum resquício do card aparece

- [ ] **Step 5: Commit**

Estagiar por caminho explícito, nunca `git add -A` — mesma razão da Task 9.

```bash
git add src/App.tsx src/app.scss tests/no-global-sidebar.test.ts tests/home-layout.test.ts tests/typography-tokens.test.ts tests/viewport-resize.test.ts
git commit -m "feat: remove a sidebar global em favor da navegação no topo"
```

Os arquivos deletados já ficaram estagiados pelo `git rm` do Step 3.

---

## Verificação final

Depois da Task 10, com `npm run tauri:dev` aberto:

1. Navegar por Início, Catálogo, Biblioteca, Downloads e Ajustes pelas abas do topo; conferir estado ativo em cada uma
2. Iniciar um download e conferir o badge na aba de downloads
3. Redimensionar de 1920px até 800px; conferir que as abas viram só ícone em ~1100px e que nada do header sobrepõe
4. Na Biblioteca: expandir e recolher grupo, selecionar coleção e ver o grid filtrar, criar coleção, excluir coleção, conferir o separador entre grupos e a contagem de "Sem categoria"
5. Abrir Ajustes em janela restaurada e maximizada; a barra de abas aparece nas duas
6. Abrir um jogo com descrição longa; conferir o botão "Ver mais"
7. Clicar no perfil no canto direito do header
8. `npm run build` completo (roda `check:tokens` + `tsc` + `vite build`)
