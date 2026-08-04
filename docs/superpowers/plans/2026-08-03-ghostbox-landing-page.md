# GhostBox Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Portuguese, cinematic GhostBox marketing site to this repository without replacing or changing the existing Tauri desktop application.

**Architecture:** Keep the current Vite/Tauri app as the default product surface and add an isolated `GhostBoxSite/` Vite entrypoint for the presentation site. Share the repository's existing React, Vite, Lucide and public brand assets, but keep the landing page's content, styles and build output inside `GhostBoxSite/` so the desktop application remains independently buildable.

**Tech Stack:** React 18, TypeScript, Vite 7, `lucide-react`, SCSS, Vitest, existing `public/ghost-solid.png` asset.

## Global Constraints

- The initial language is Brazilian Portuguese; content data must be isolated for a future English translation.
- The visual direction is editorial, cinematic and dark: charcoal/black base, cool blue gradients, lilac interaction color and gold reserved for Premium.
- The page is a single institutional route with no authentication, checkout integration or persistence.
- The page must describe only capabilities verified in the repository: Steam library, catalogue, favourites/collections, achievements, notifications, editable profile, backups and cloud sync.
- Existing Tauri entrypoints and the default desktop build must continue to work unchanged.
- CTAs are presentation links/actions unless an existing public destination is available; do not invent URLs.
- Motion must respect `prefers-reduced-motion`, and controls must be keyboard accessible.
- Plan prices are sourced from the current subscription worker: monthly R$ 6,99 and quarterly R$ 14,99.

---

### Task 1: Create the isolated site surface and build scripts

**Files:**
- Create: `GhostBoxSite/index.html`
- Create: `GhostBoxSite/vite.config.ts`
- Create: `GhostBoxSite/tsconfig.json`
- Modify: `package.json`
- Test: `site` build command

**Interfaces:**
- Consumes: existing root React/Vite dependencies and `public/ghost-solid.png`.
- Produces: `npm run site:dev`, `npm run site:build`, `npm run site:check`, and a static build in `GhostBoxSite/dist/`.

- [ ] **Step 1: Add the site document shell**

  Create `GhostBoxSite/index.html` with `lang="pt-BR"`, viewport metadata, the GhostBox title/description, a theme-color, and a single `<div id="root"></div>` loading `/src/main.tsx`.

- [ ] **Step 2: Add the site Vite configuration**

  Configure `GhostBoxSite/vite.config.ts` with `root` set to the `GhostBoxSite/` directory, React plugin, `publicDir` pointing to the repository's existing `public/` directory, `outDir` pointing to `GhostBoxSite/dist/`, and `emptyOutDir: true` so only the isolated output is cleaned.

- [ ] **Step 3: Add site TypeScript settings**

  Create `GhostBoxSite/tsconfig.json` extending the root compiler options, overriding `include` to `GhostBoxSite/src`, and enabling the same strict JSX/bundler settings used by the application.

- [ ] **Step 4: Add package scripts without changing desktop defaults**

  Add these scripts to `package.json` while leaving `dev`, `build`, `dev:tauri` and `build:tauri` unchanged:

  ```json
  "site:dev": "vite --config GhostBoxSite/vite.config.ts",
  "site:build": "vite build --config GhostBoxSite/vite.config.ts",
  "site:check": "tsc --project GhostBoxSite/tsconfig.json --noEmit"
  ```

- [ ] **Step 5: Run the empty site build**

  Run `npm run site:build`.

  Expected: Vite creates `GhostBoxSite/dist/index.html` without touching the existing `dist/` application output.

- [ ] **Step 6: Commit the isolated site surface**

  ```powershell
  git add GhostBoxSite/index.html GhostBoxSite/vite.config.ts GhostBoxSite/tsconfig.json package.json package-lock.json
  git commit -m "chore: add isolated GhostBox site surface"
  ```

### Task 2: Define the marketing content and test its product claims

**Files:**
- Create: `GhostBoxSite/src/content.ts`
- Create: `tests/landing-content.test.ts`

**Interfaces:**
- Consumes: the product capabilities and plan values documented in the approved design.
- Produces: typed `features`, `plans`, and `faqItems` constants consumed by the page.

- [ ] **Step 1: Write failing content tests**

  Add tests that import the content constants and assert the page has the approved Portuguese headline, six product features, both plan IDs, exact plan prices (`699` and `1499` cents), and FAQ coverage for Steam, perfil and cancelamento.

  ```ts
  import { describe, expect, it } from "vitest";
  import { faqItems, features, plans } from "../GhostBoxSite/src/content";

  describe("landing content", () => {
    it("keeps the approved product narrative", () => {
      expect(features).toHaveLength(6);
      expect(features.map((feature) => feature.id)).toEqual([
        "library",
        "catalogue",
        "collections",
        "achievements",
        "notifications",
        "profile",
      ]);
      expect(plans.map((plan) => plan.id)).toEqual(["free", "premium"]);
      expect(plans.find((plan) => plan.id === "premium")?.prices).toEqual({
        monthly: 699,
        quarterly: 1499,
      });
      expect(faqItems.map((item) => item.id)).toEqual([
        "steam",
        "profile",
        "cloud",
        "cancel",
      ]);
    });
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run `npx vitest run tests/landing-content.test.ts`.

  Expected: FAIL because `GhostBoxSite/src/content.ts` does not exist yet.

- [ ] **Step 3: Implement typed, localized content**

  Create typed constants with Portuguese copy for the hero, six feature cards, the Free/Premium comparison, and four FAQ entries. Export the plan price map as `monthly`/`quarterly` integer cents and keep all strings in this file so a future language file can replace it without restructuring the component.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run `npx vitest run tests/landing-content.test.ts`.

  Expected: PASS.

- [ ] **Step 5: Commit the content contract**

  ```powershell
  git add GhostBoxSite/src/content.ts tests/landing-content.test.ts
  git commit -m "feat: define GhostBox landing content"
  ```

### Task 3: Build the interactive landing page component

**Files:**
- Create: `GhostBoxSite/src/main.tsx`
- Create: `GhostBoxSite/src/LandingPage.tsx`

**Interfaces:**
- Consumes: `features`, `plans`, and `faqItems` from `GhostBoxSite/src/content.ts`.
- Produces: one accessible React page with navigation, hero, product showcase, profile section, plan toggle, FAQ accordion, and final CTA.

- [ ] **Step 1: Add the React entrypoint**

  Create `GhostBoxSite/src/main.tsx` with `createRoot(document.getElementById("root")!)`, render `<LandingPage />`, and import `./landing.scss` from the page module so the entrypoint remains minimal.

- [ ] **Step 2: Add the page structure**

  Implement `GhostBoxSite/src/LandingPage.tsx` with these semantic sections and IDs: `#recursos`, `#perfil`, `#planos`, and `#faq`. Use `header`, `main`, `section`, `nav`, `article`, `footer`, and native buttons. Render content arrays rather than duplicating feature/plan/FAQ copy.

- [ ] **Step 3: Add local interaction state**

  Add `useState` for the mobile menu, billing period (`monthly | quarterly`), and the open FAQ ID. Close the mobile menu after an anchor click, expose the FAQ state through `aria-expanded`, and update the visible Premium price and billing label when the period changes.

- [ ] **Step 4: Create product-specific mockups with existing icons and CSS primitives**

  Build the hero and showcase imagery from layered panels: sidebar/library rows, cover tiles, progress bars, achievement cards, profile banner/avatar and collection chips. Use `lucide-react` icons for interface affordances and `/ghost-solid.png` for branding; do not add generic stock logos or invented testimonials.

- [ ] **Step 5: Add accessible CTA behavior**

  Use real links for same-page anchors, real buttons for the billing toggle and FAQ accordion, visible focus styles, descriptive labels for icon-only controls, and a mobile menu button with `aria-controls` and `aria-expanded`.

- [ ] **Step 6: Run site type-checking**

  Run `npm run site:check`.

  Expected: PASS with no unused imports, missing types, or JSX errors.

### Task 4: Apply the cinematic responsive visual system

**Files:**
- Create: `GhostBoxSite/src/landing.scss`

**Interfaces:**
- Consumes: class names from `GhostBoxSite/src/LandingPage.tsx` and `/ghost-solid.png`.
- Produces: the approved desktop/mobile visual language and responsive interaction states.

- [ ] **Step 1: Define tokens and page primitives**

  Add font stacks, charcoal/blue/lilac/gold color tokens, spacing/radius tokens, max-width containers, body reset, background gradients, grain-like CSS texture, and button/card primitives. Avoid inline SVG illustrations and keep decorative shapes in CSS.

- [ ] **Step 2: Style the first viewport and navigation**

  Style the fixed/translucent nav, hero headline, supporting text, CTA hierarchy, atmospheric background, and large app mockup so the first viewport communicates the product before scrolling.

- [ ] **Step 3: Style the narrative and feature sections**

  Add editorial section labels, manifesto typography, six feature cards, the showcase panel, profile customization panel, and pricing cards with the Premium gold treatment.

- [ ] **Step 4: Add responsive breakpoints**

  At mobile widths, collapse the nav into a menu, stack two-column sections, reduce hero type without clipping, turn card grids into a single column, and keep all mockup copy readable without hover.

- [ ] **Step 5: Add motion and reduced-motion behavior**

  Use opacity/transform-only reveal and hover transitions. Wrap animation rules in a `@media (prefers-reduced-motion: reduce)` override that disables transitions and keyframes.

- [ ] **Step 6: Run the site build**

  Run `npm run site:build` and `npm run site:check`.

  Expected: both PASS and `GhostBoxSite/dist/` contains a self-contained landing page referencing the existing GhostBox asset.

- [ ] **Step 7: Commit the page and visual system**

  ```powershell
  git add GhostBoxSite/src/main.tsx GhostBoxSite/src/LandingPage.tsx GhostBoxSite/src/landing.scss GhostBoxSite/index.html
  git commit -m "feat: build GhostBox marketing landing page"
  ```

### Task 5: Validate the complete product surface and hand off to Sites

**Files:**
- Modify: `docs/superpowers/plans/2026-08-03-ghostbox-landing-page.md` only if execution notes are needed
- Verify: `GhostBoxSite/dist/`, existing `dist/`, `package.json`

**Interfaces:**
- Consumes: the completed site source and existing desktop build.
- Produces: a verified local site build and a publishable handoff.

- [ ] **Step 1: Run the focused site test suite**

  Run `npx vitest run tests/landing-content.test.ts`.

  Expected: PASS.

- [ ] **Step 2: Run the full existing test suite**

  Run `npm test`.

  Expected: existing tests and `landing-content.test.ts` pass; if an unrelated pre-existing test fails, record the exact failure without changing unrelated files.

- [ ] **Step 3: Rebuild the desktop app**

  Run `npm run build`.

  Expected: the existing Tauri/Vite application build passes and the landing page changes do not replace `dist/index.html`.

- [ ] **Step 4: Preview the landing page locally**

  Run `npm run site:dev` and open the exact local URL printed by Vite. Confirm the hero, anchor navigation, responsive menu, billing toggle and FAQ accordion render without relying on browser screenshots or DOM inspection unless browser testing is explicitly requested.

- [ ] **Step 5: Verify the final source state**

  Run `git diff --check`, `git status --short`, and `git log -1 --oneline`. Confirm only the landing-page files and the plan/test artifacts are part of the implementation commits; preserve unrelated pre-existing worktree changes.

- [ ] **Step 6: Publish through Sites when the project surface is available**

  Read or create the Sites project configuration for the isolated site, push the exact implementation commit, save a version from that commit, and deploy only that saved version. If the current repository cannot be accepted by Sites because it is a Tauri/Vite desktop project rather than an OpenNext/vinext source, report the local site build as complete and identify the exact hosting compatibility blocker instead of altering the desktop build architecture.
