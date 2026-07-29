# Plano: sistema de design tokens — acabamento de launcher profissional

Status: proposto
Escopo: `src/app.scss`, `src/pages/ProfilePage.scss`, `src/pages/GameAchievementsPage.scss` (18.827 linhas de estilo no total).
Fora de escopo: mudar a identidade visual. O app continua **escuro, monocromático e de cantos retos**; o dourado continua exclusivo do painel de assinatura e das conquistas raras.

## Objetivo

1. Trocar o conjunto atual de tokens — que hoje colapsa em poucas cores repetidas — por uma **rampa neutra completa** com hierarquia real de superfície, borda e texto.
2. Introduzir as escalas que hoje não existem: tipografia, espaçamento, elevação, foco e z-index.
3. Separar tokens em arquivos próprios (`src/styles/`), em três camadas: primitivo → semântico → componente.
4. Preservar 100% do dourado (`--premium-gold`) e centralizá-lo em um único mixin, hoje triplicado.

---

## Diagnóstico

### A. A hierarquia de superfície não existe na prática
[src/app.scss:1-13](src/app.scss:1)

`--background`, `--surface-interactive`, `--surface-primary` e `--surface-tertiary` são **todos `#0f0f0f`**. `--surface-secondary` é `#151515`.

Contraste `#151515` sobre `#0f0f0f` = **1,03:1**. Em um monitor comum, painel, card e canvas são o mesmo pixel. O app não parece "minimalista"; parece sem camadas — é a diferença mais visível entre ele e um launcher comercial (Steam/Epic/Battle.net separam canvas → painel → card → elemento interativo em 3–4 degraus perceptíveis).

### B. As cinco variáveis de borda são a mesma cor
[src/app.scss:32-38](src/app.scss:32)

```
--border-dark / --border / --border-subtle / --border-ui / --border-strong / --border-hover  →  #202020
```

Contraste `#202020` sobre `#0f0f0f` = **1,18:1** — abaixo do limiar de percepção em telas não calibradas. Consequências: hover não muda a borda (o token de hover é o mesmo), não há como marcar um item selecionado pela borda, e divisores somem. Estados foram então compensados com `background`, o que explica os 58 `!important` em `app.scss` e 10 em `ProfilePage.scss`.

### C. `--text-tertiary` é uma cor de borda, não de texto
[src/app.scss:45](src/app.scss:45)

`--text-tertiary: #202020` = **1,18:1** sobre o canvas. É texto invisível. Já `--text-secondary: #757575` dá **4,18:1** — abaixo dos 4,5:1 de WCAG AA para texto normal, e ele é usado em 12–13px, justamente onde o critério é mais rígido.

Há ainda **11 aliases legados** (`--text`, `--text-strong`, `--color-text`, `--text-muted`, `--color-subtext`, `--text-soft`, `--text-dim`, `--text-faint`, `--hydra-button-text`, …) apontando para os mesmos três valores — custo de leitura sem ganho.

### D. Não existe escala tipográfica
`font-size` aparece com 13px (91×), 12px (85×), 14px (34×), 11px (28×), 15px (12×), 10px (8×), além de 9px, 16px, 18px, 20px, 22px, 25px, 26px, 34px e 14 `clamp()` distintos — todos literais. Sem token, cada tela reinventa a hierarquia, e 15px/25px/26px são ruído de arrasto, não decisão de design.

`--font-sans`, `--font-display` e `--font-sidebar` apontam para a mesma família ("Open Sans"), então a distinção entre eles é decorativa.

### E. `--spacing: 8px` só cobre uma fração do layout
Contra 22 usos de `gap: var(--spacing)`, existem 64 `gap: 8px`, 45 `gap: 6px`, 44 `gap: 10px`, 31 `gap: 12px`, 26 `gap: 4px`, mais 5px/7px/9px avulsos. Em `padding` o quadro se repete (`14px 16px`, `16px 18px 18px`, `10px 12px`, …). A base de 8px não descreve o app real, que na verdade usa passo de 2px.

### F. Faltam escalas de elevação, foco e z-index
- 15 `box-shadow` no arquivo inteiro, nenhum tokenizado — não há linguagem de elevação para modais, dropdowns e o painel de assinatura.
- 15 `outline: none` contra 4 outlines reais, com três definições diferentes de anel de foco (`--border-strong`, `--border-hover`, `color-mix(text-primary 28%)`). Navegação por teclado — esperada em launcher com suporte a gamepad/atalhos — fica inconsistente.
- `z-index` literal em 21 valores distintos, de `1` a `20000`, incluindo `9999`, `10000`, `1001`, `301`. Empilhamento hoje é resolvido por escalada.

### G. Tokens mortos / fora do tema
`--accent: #8b5cf6` (roxo) tem **1 uso** em 18k linhas; `--xp-color` é o mesmo roxo. Num tema monocromático + dourado, é uma terceira cor de marca não intencional. `--weight-bold` e `--weight-muted` são ambos `600` — `--weight-bold` não distingue nada.

### H. A borda dourada está copiada três vezes
[src/app.scss:12986](src/app.scss:12986), [src/pages/GameAchievementsPage.scss:173](src/pages/GameAchievementsPage.scss:173) e [src/pages/ProfilePage.scss:824](src/pages/ProfilePage.scss:824) contêm o **mesmo** `conic-gradient` de 6 paradas para conquista rara. O painel de assinatura tem sua variante em [src/app.scss:6023](src/app.scss:6023). Qualquer ajuste no dourado exige quatro edições sincronizadas.

### I. Tudo mora em um arquivo de 15.141 linhas
Os tokens são as primeiras 105 linhas de `app.scss`, misturados com o CSS do tray e de todas as telas. Não há `src/styles/`.

---

## Proposta

### Estrutura de arquivos

```
src/styles/
  _primitives.scss   // rampa neutra, dourado, escalas cruas — sem semântica
  _semantic.scss     // :root com os tokens que a UI usa
  _mixins.scss       // gold-flashlight-border, focus-ring, surface-card, type-*
  _legacy.scss       // aliases antigos → novos (temporário, removido na etapa 7)
```

`app.scss` passa a começar com `@use "./styles/semantic";` etc. (`@use` precisa vir antes de qualquer regra — as 105 linhas de `:root` saem do arquivo por completo). `sass-embedded` já está no projeto, nenhuma dependência nova.

### 1. Primitivos — rampa neutra de 13 degraus

Preserva o preto profundo atual e cria os degraus que faltam. Contrastes calculados sobre `--n-1` (canvas).

| Token | Hex | Contraste vs `--n-1` | Papel |
|---|---|---|---|
| `--n-0` | `#0a0a0a` | — | poço (trilhos, campos afundados) |
| `--n-1` | `#101010` | 1,00 | canvas do app |
| `--n-2` | `#161616` | 1,05 | painel |
| `--n-3` | `#1c1c1c` | 1,11 | card |
| `--n-4` | `#242424` | 1,20 | card hover / controle |
| `--n-5` | `#2e2e2e` | 1,40 | borda padrão |
| `--n-6` | `#3d3d3d` | 1,70 | borda forte / selecionado |
| `--n-7` | `#4f4f4f` | 2,15 | borda interativa (hover) |
| `--n-8` | `#6b6b6b` | 3,58 | texto terciário |
| `--n-9` | `#8f8f8f` | 5,90 | texto secundário |
| `--n-10` | `#b4b4b4` | 9,20 | ícone/label forte |
| `--n-11` | `#d6d6d6` | 13,1 | texto primário |
| `--n-12` | `#f2f2f2` | 16,6 | ênfase máxima |

Nota: `#cccccc` atual (11,98:1) vira `--n-11` `#d6d6d6`; a diferença é sutil, mas fecha o gap com `--n-9`/`--n-10` e mantém a leitura fria e sem tinta.

Alfas para camadas de estado (state layers), independentes da rampa:
`--a-hover: rgba(255,255,255,.045)` · `--a-active: rgba(255,255,255,.08)` · `--a-selected: rgba(255,255,255,.10)` · `--a-scrim-1/2/3: rgba(0,0,0,.28/.48/.72)`.

Consolidar aqui os ~30 `rgba()` avulsos de `app.scss` (`rgba(4,4,4,.72)`, `rgba(11,11,11,.58)`, `rgba(6,6,6,.24)`, `rgba(5,5,5,.28)`, `rgba(7,7,7,.48)` … são todos o mesmo preto com opacidade ligeiramente diferente).

### 2. Semânticos

```
/* superfície */
--surface-canvas: var(--n-1);
--surface-panel: var(--n-2);
--surface-card: var(--n-3);
--surface-raised: var(--n-4);
--surface-sunken: var(--n-0);
--surface-hover: var(--a-hover);
--surface-active: var(--a-active);
--surface-selected: var(--a-selected);

/* borda — quatro pesos com diferença perceptível */
--border-subtle: #1f1f1f;   /* divisor interno */
--border-default: var(--n-5);
--border-strong: var(--n-6);
--border-interactive: var(--n-7);  /* hover/foco de controle */

/* texto — quatro papéis */
--text-primary: var(--n-11);
--text-secondary: var(--n-9);   /* AA em 12–13px */
--text-tertiary: var(--n-8);    /* só ≥14px ou meta não essencial */
--text-inverse: var(--n-1);
--icon-default: var(--n-10);
--icon-muted: var(--n-9);
```

`--text-tertiary` antigo (`#202020`) **não** sobrevive: onde ele for encontrado, ou é decoração (vira `--border-subtle`) ou é texto quebrado (vira `--text-tertiary` novo).

### 3. Tipografia

Escala fixa alinhada ao uso real (13px é o corpo do app, com 91 ocorrências):

| Token | Tamanho | Line-height | Tracking | Uso |
|---|---|---|---|---|
| `--fs-100` | 11px | 16px | `.06em` | rótulo caixa-alta (já é o tracking dominante: 21 usos) |
| `--fs-200` | 12px | 16px | `.01em` | meta, status, badge |
| `--fs-300` | 13px | 18px | `0` | **corpo padrão** |
| `--fs-400` | 14px | 20px | `0` | corpo forte, item de lista |
| `--fs-500` | 16px | 22px | `-.01em` | título de card |
| `--fs-600` | 20px | 26px | `-.02em` | título de seção |
| `--fs-700` | 26px | 32px | `-.02em` | título de página |
| `--fs-800` | 34px | 40px | `-.03em` | hero (banner de jogo/perfil) |

Mapeamento dos avulsos: 9px→`--fs-100`, 10px→`--fs-100`, 15px→`--fs-400`, 18px→`--fs-500`, 22px→`--fs-600`, 25px→`--fs-700`, 32px→`--fs-800`.
Os 14 `clamp()` viram dois tokens fluidos: `--fs-hero` e `--fs-title-fluid`, ancorados em `--fs-600`…`--fs-800`.

Pesos: manter `400/500/600`, **remover** `--weight-bold` (duplicata de 600) e `--weight-muted` (nome descreve cor, não peso — vira `--weight-semibold`).
Famílias: manter uma única `--font-sans`; `--font-display` e `--font-sidebar` viram aliases marcados como legado e saem na etapa 7.

Mixins `@mixin type-label`, `type-body`, `type-title` empacotam tamanho + altura + tracking + peso, para uma declaração por bloco em vez de quatro.

### 4. Espaçamento — passo de 2px

`--space-0: 0` · `1: 2px` · `2: 4px` · `3: 6px` · `4: 8px` · `5: 10px` · `6: 12px` · `7: 14px` · `8: 16px` · `9: 20px` · `10: 24px` · `12: 32px` · `14: 40px` · `16: 48px`

Cobre ~95% dos valores já presentes sem redesenhar tela nenhuma; 5px, 7px e 9px (30 ocorrências somadas) sobem para o degrau par mais próximo. `--spacing: 8px` vira alias de `--space-4` e é aposentado na etapa 7. Adicionar `--space-gutter` (padding de borda de conteúdo, hoje `--content-edge-padding`) e `--space-section`.

### 5. Raio — inalterado por decisão de design

A rampa atual (1/2/3/4px) **é** o que dá o ar de ferramenta ao app; permanece exatamente como está. Apenas os 15 literais (`3px`, `4px`, `2px`, `8px 0 0 8px`) passam a usar os tokens, e `--radius-lg` ganha o par `--radius-panel: 6px` para modais e painel de assinatura.

### 6. Elevação, foco, motion, z-index

```
--shadow-1: 0 1px 2px rgb(0 0 0 / .32);                      /* card raised */
--shadow-2: 0 4px 12px rgb(0 0 0 / .40);                     /* dropdown, popover */
--shadow-3: 0 12px 32px rgb(0 0 0 / .52);                    /* modal */
--shadow-inset-hairline: inset 0 1px 0 rgb(255 255 255 / .04); /* topo de painel */

--focus-ring: 0 0 0 2px var(--surface-canvas), 0 0 0 3px var(--n-10);
--focus-ring-inset: inset 0 0 0 1px var(--n-10);
```

Um único `@mixin focus-ring` substitui as três definições concorrentes e os 15 `outline: none` passam a ser `outline: none` **+ mixin** (nunca `outline: none` sozinho).

Motion: manter `--motion-fast/base/slow` e `--ease`; adicionar `--ease-out: cubic-bezier(.16,1,.3,1)` e `--motion-emphasis: .42s` para o painel de assinatura. Eliminar os três literais restantes (`0.15s`, `0.3s`, `transition: all`).

Z-index nomeado (substitui os 21 valores literais):
`--z-base 0` · `--z-raised 10` · `--z-sticky 100` · `--z-header 200` · `--z-drawer 300` · `--z-overlay 900` · `--z-modal 1000` · `--z-popover 1100` · `--z-toast 1200` · `--z-tooltip 1300`.

### 7. Dourado — preservado e centralizado

O dourado **não muda de aparência**. Só ganha estrutura e deixa de ser copiado:

```
--gold-500: #f5b342;             /* valor atual, intocado */
--gold-400: color-mix(in srgb, var(--gold-500) 78%, #fff);
--gold-600: color-mix(in srgb, var(--gold-500) 82%, #000);
--gold-border: color-mix(in srgb, var(--gold-500) 32%, var(--border-default));
--gold-wash: color-mix(in srgb, var(--gold-500) 10%, transparent);
--gold-text: var(--gold-500);
--premium-gold: var(--gold-500);  /* alias mantido — 20+ usos */
```

O `conic-gradient` do flash vira **um** mixin parametrizado:

```scss
@mixin gold-flashlight-border($intensity: 1, $opacity: .72, $duration: 9s) { … }
```

- painel de assinatura: `@include gold-flashlight-border($intensity: .6, $opacity: .72)` — [app.scss:6023](src/app.scss:6023)
- conquista rara (3 locais): `@include gold-flashlight-border($intensity: 1, $opacity: .9)` — [app.scss:12986](src/app.scss:12986), [GameAchievementsPage.scss:173](src/pages/GameAchievementsPage.scss:173), [ProfilePage.scss:824](src/pages/ProfilePage.scss:824)

`--premium-border-angle` e o `@property` associado permanecem como estão.
Regra escrita no `_semantic.scss`: **dourado só em assinatura e raridade**. Nada de dourado em foco, seleção, sucesso ou destaque genérico.

### 8. Cores de status

`--danger`, `--success` continuam (feedback semântico precisa de cor). **Removidos**: `--accent` (roxo, 1 uso) e `--xp-color` — a barra de XP passa a usar `--n-10`/`--n-11` sobre trilho `--surface-sunken`, coerente com o monocromático. O gold de `hsl(42deg 72% 48%)` em [app.scss:7811](src/app.scss:7811) vira `--gold-600`.

---

## Etapas (commits independentes, cada um verificável na tela)

1. **Extrair sem mudar valor.** Criar `src/styles/_primitives.scss` + `_semantic.scss` + `_legacy.scss` com **exatamente** os valores de hoje; `app.scss` passa a `@use`. Diff visual esperado: zero. Referência para as etapas seguintes.
2. **Rampa neutra.** Trocar os valores dos primitivos pela tabela do item 1. Aqui aparece o degrau de superfície e a borda visível — é a etapa que mais muda a percepção. Revisar tela a tela: biblioteca, modal de jogo, perfil, conquistas, tray, assinatura.
3. **Texto e borda semânticos.** Aplicar os quatro papéis de texto e os quatro pesos de borda; corrigir todo uso de `--text-tertiary` antigo. Remover os aliases legados de texto que já não têm consumidor.
4. **Tipografia.** Introduzir escala e mixins; migrar `font-size`/`letter-spacing` literais, começando por 13/12/14/11px (238 das ~290 ocorrências).
5. **Espaçamento e raio.** Migrar `gap`/`padding`/`margin` para `--space-*`; eliminar os 15 raios literais.
6. **Elevação, foco, z-index, motion.** Aplicar `--shadow-*`, mixin de foco em todos os interativos, escala de z-index, remover literais de transição.
7. **Dourado + limpeza.** Extrair o mixin, substituir as quatro cópias, remover `--accent`/`--xp-color`/`--weight-bold`/`--font-display`/`--font-sidebar`/`--spacing` e apagar `_legacy.scss`. Reduzir os 68 `!important` que existiam só para vencer estado por background.
8. **Guarda.** `scripts/check-tokens.mjs` (Node puro, sem dependência) roda no build e falha se um arquivo `.scss` fora de `src/styles/` contiver hex cru, `rgba()` cru, `font-size` em px, `z-index` de camada global ou `box-shadow` literal. Sem isso, o sistema volta a se dissolver em três semanas.

   **Implementado como catraca, não como portão.** Um lint "tudo ou nada" seria
   inviável: sobraram 163 violações herdadas, que só somem com revisão visual
   caso a caso. O script guarda a contagem por arquivo/regra em
   `scripts/token-baseline.json` e falha **apenas quando a contagem sobe**.
   Reduzir é sempre permitido; `--update` trava o teto novo, `--list` mostra tudo.

   Ajuste de regra: `z-index` de 1 a 9 **não** é violação — é empilhamento local
   dentro do próprio componente, uso legítimo. A escala nomeada só vale a partir
   de 10, onde o valor vira camada do app.

   Dívida registrada no baseline (a ser reduzida com o app rodando):

   | Regra | Ocorrências |
   |---|---|
   | `raw-rgb` | 127 |
   | `z-index-literal` | 18 |
   | `raw-hex` | 17 |
   | `font-size-px` | 1 |

   Entre os hex, **6 são `#151515`** — o valor *antigo* de `--surface-secondary`,
   que depois da rampa não corresponde mais a token nenhum (`--n-2` é `#161616`).
   São bugs latentes de cor, não só dívida de estilo: prioridade na próxima passada.

Etapas 2 e 3 devem ser revisadas juntas na tela antes de seguir — é onde o app deixa de parecer chapado.

---

## Riscos

- **Etapa 2 é a única com risco visual real.** A separação de superfícies expõe lugares que hoje "funcionam" por acidente (elemento sem borda em cima de fundo idêntico). Esperar ajustes pontuais, não regressões silenciosas.
- **`ProfilePage.scss` tem 10 `!important` e 25 `focus-visible` próprios**; a etapa 6 pode conflitar com eles — migrar essa página por último dentro de cada etapa.
- **Bordas mais visíveis alteram densidade percebida.** Se ficar pesado, o ajuste é `--border-default` → `#2a2a2a` (1,32:1), não voltar a `#202020`.
- **`color-mix` + `@property`** já são usados no projeto; nenhum requisito novo de engine (Tauri/WebView2).

## Critérios de aceite

1. Nenhum hex, `rgba()`, `font-size` em px, `z-index` numérico ou `box-shadow` literal fora de `src/styles/` — verificado por `check-tokens.mjs`.
2. Canvas, painel e card distinguíveis a olho nu; borda padrão em ≥1,4:1 sobre a superfície que a cerca.
3. Todo texto de corpo em ≥4,5:1; `--text-tertiary` nunca abaixo de 3:1 e nunca em texto essencial.
4. Todo elemento focável mostra o mesmo anel de foco por teclado; nenhum `outline: none` órfão.
5. Painel de assinatura e conquistas raras visualmente idênticos ao estado atual, com o `conic-gradient` definido em um único lugar.
6. Nenhuma cor cromática no app fora de `--danger`, `--success` e da família `--gold-*`.
