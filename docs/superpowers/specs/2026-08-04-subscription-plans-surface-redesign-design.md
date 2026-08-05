# Redesign da aba de Planos/Preços — surface ramped

## Context

A tela de planos (`.subscription-plans` / `.subscription-plan-card`, componente
[SubscriptionPlans.tsx](src/components/subscription/SubscriptionPlans.tsx)) roda em duas
superfícies — modal de upsell e aba Configurações → Assinatura — e ainda usa bordas
decorativas, gradientes fora do ramp e literais fora da escala de tokens, violando as mesmas
regras já corrigidas na aba de conta (`docs/superpowers/plans/2026-08-04-black-to-202020-surface-system.md`,
`2026-08-04-low-contrast-borderless-tokens.md`): sem bordas em surfaces/cards/pills, fundos
sempre um stop do ramp `--n-0..--n-4`.

Validado com mockup (opção B): a diferenciação Free vs Premium deve vir de **contraste máximo
dentro do ramp** — Free fica no chão do ramp (quase apagado), Premium no topo — em vez de
depender de cor de texto ou borda. Escopo: os dois surfaces (`--modal` e `--settings`).

## Hierarquia de superfície

| Elemento | Fundo |
|---|---|
| Card Free (`.subscription-plan-card`, base) | `var(--surface-canvas)` |
| Card Premium (`.subscription-plan-card--featured`) | `var(--surface-panel)` (já é o degrau mais alto disponível sem sair do ramp) |
| Botão "Atual"/"Assinar" (`__action`) | mesmo nível do card + 1 degrau no hover |
| Billing toggle (`__billing-toggle`) | `var(--surface-raised)`; thumb ativo `var(--surface-popover)` |
| Highlight cards, discord link/action, detail cards, step cards, policy note | `var(--surface-panel)` |

Card Free já está em `--surface-secondary` hoje; desce para `--surface-canvas` (n-0, chão do
ramp) para maximizar o contraste com o Premium, conforme opção B aprovada. Card Premium
(`--featured`) já usa `--surface-raised` (n-2, topo disponível para um card) — mantém como
está. O contraste máximo fica entre esses dois extremos do ramp, sem tocar borda.

## Tarefas

Todas em [src/app.scss](src/app.scss).

### `.subscription-plan-card` (4451-4672)
- Base (4451): `background: var(--surface-canvas)` (era `--surface-secondary`) — chão do ramp.
- `--featured` (4468): mantém `var(--surface-raised)`.
- `&__badge` (4472): `background: var(--background)` não é token de superfície → `var(--surface-popover)`. `top: -10px` → `calc(var(--space-3) * -1 - var(--space-1))` ou token de posição existente; manter `border: 0` (já sem borda).
- `&__billing-toggle` (4528): fundo `var(--surface-raised)` (era `--surface-canvas`, agora reservado ao card Free).
- `&__billing-toggle-thumb` (4540): `background: var(--sidebar-selector)` → `var(--surface-popover)` para ficar dentro do ramp; `top/bottom/left: 3px` → `var(--space-1)` (2px, mais próximo do valor atual) ou introduzir `--space-1-5` se necessário — usar `var(--space-1)`.
- `&__billing-toggle button:focus-visible` (4573): `outline-color: var(--icon-default)` → `var(--focus-ring-color)`.
- `&__action` (4638): remover `border: 1px solid var(--border)` (4641) e os `border-color` de hover/disabled (4656, 4668); fundo `var(--surface-raised)` (um degrau acima do card), hover `var(--surface-popover)`. Adicionar `&:focus-visible { outline: 2px solid var(--focus-ring-color); outline-offset: 2px; }`.
- Literais: `min-height: 34px` (4639) → token de escala; `top: -10px` (4474) tratado acima.

### `.subscription-plans--modal .subscription-plan-card` (4674-4691) e `--settings` variant (4693+)
- `min-height: 260px` / `350px` → tokens de escala (`calc()` sobre `--space-16`).

### `.subscription-plans` (3949-4449)
- `&__highlight-card` (4210): remover o gradiente radial (4216-4222), fundo `var(--surface-panel)`.
- `&__discord-link` (4250), `&__discord-action` (4298), `&__step` (4338), `&__detail-card`/`&__policy-note` (4377): já `border: 0`; trocar `var(--surface-canvas)` por `var(--surface-panel)` para virem um degrau acima do fundo transparente da página (mesma lógica da aba de conta).
- `&__step span` (4351): remover `border: 1px solid var(--border-ui)` (4357), fundo `var(--background-dark)` → `var(--surface-popover)`.
- `&__discord-action:hover` (4317): `background: var(--surface-secondary)` → `var(--surface-popover)` (token de superfície válido, mantém consistência de nomenclatura já usada no resto do redesign).
- Literais fora de escala nesta seção: `4180` `height: 18px`/`max-width: 34px`, `4189-4190` `20px`/`38px`, `4139-4140` `14px`, `4353-4354` `24px`, `4020-4021` `min-height: 42px`, `4027-4028` `22px`, `4083`/`4511` `max-width: 220px/540px`, `4012` `clamp(8px, 2vh, 22px)`, `4674-4695` já listado. Normalizar para a escala `--space-*` (usar `calc()` quando não houver stop exato, como já feito na aba de conta).
- `line-height` literais (1.25, 1.4, 1.45, 1.1, 1.35, 1.5, 1.2, 1.3) → `--type-line-*` correspondentes.
- `letter-spacing: 0.04em` (4158) → `--ls-100`; `letter-spacing: 0` explícito (4629) pode ser removido (já é o default do `--ls-300`/`400`).

### Consistência com a aba de conta
Reusar o mesmo vocabulário de superfície já aplicado em `.subscription-account`
([app.scss:4834+](src/app.scss:4834)) — não introduzir um terceiro esquema de cores; `--surface-panel`,
`--surface-raised`, `--surface-popover` são os únicos níveis usados no card e nos blocos de apoio.

## Verificação

```bash
npm run check:tokens
npm test
npm run build
```

Visual: `npm run tauri dev` — abrir o modal de upsell premium e Configurações → Assinatura → Planos:
- nenhuma borda decorativa restante;
- card Free visivelmente mais "apagado" que o Premium (contraste de ramp, não de cor de texto);
- toggle Mensal/Trimestral com thumb sólido, sem borda, foco visível;
- badge "Popular" (se usado) legível sobre `--surface-popover`;
- hover dos botões de ação e do discord-action muda de superfície sem salto de borda.
