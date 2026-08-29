# GhostBoxSite

Site institucional do GhostBox. Vive neste repositório, mas é um build isolado:
não compartilha entrypoint, tsconfig nem saída com o app Tauri.

```bash
npm run site:dev     # http://localhost:1430
npm run site:check   # tsc --noEmit
npm run site:build   # gera GhostBoxSite/dist
```

## Deploy (Cloudflare Pages)

| Campo | Valor |
| --- | --- |
| Build command | `npm run site:build` |
| Output directory | `GhostBoxSite/dist` |
| Root directory | raiz do repositório |

O build gera quatro rotas estáticas: `/`, `/terms`, `/privacy` e `/refund`. Os
três caminhos de política são os mesmos do site anterior — links do Stripe e do
rodapé continuam válidos.

### Checkout

O site anterior tinha uma Pages Function em `/api/create-checkout-session`. Ela
não existe mais aqui: a assinatura é feita dentro do app, na aba Assinatura dos
Ajustes, e o CTA do Premium leva à seção de instalação. Se o checkout pelo site
voltar a ser necessário, a function precisa ser adicionada em
`GhostBoxSite/functions/api/create-checkout-session.ts` e o CTA repontado.

## Como o site se relaciona com o app

- **Tokens**: `src/styles/_primitives.scss` é cópia fiel do arquivo do app.
  `_semantic.scss` é um subconjunto com os mesmos nomes. `_site.scss` é a única
  camada exclusiva do site (espaçamento de página, display type, motion).
- **Preço**: importado de `src/lib/subscriptionPricing.ts`. Nunca escrever preço
  no conteúdo — `tests/site-content.test.ts` falha se aparecer.
- **Conteúdo**: `src/content/pt.ts` e `en.ts`, com forma idêntica garantida por
  teste. Toda string da interface vive ali.
- **Interface**: os recortes da janela do launcher são sempre desenhados em DOM
  (`src/components/LauncherMockup.tsx`) — fragmentos flutuando sobre a página,
  sem moldura de janela: banner e prateleira (Início), busca e grade
  (Biblioteca), linhas e prévia (Catálogo), métricas, progresso e toast de
  conquista (Perfil). Cada fragmento entra em cascata (`lm-rise`) e a elevação
  vem só de sombra, nunca de borda. Arte, títulos, estúdios, tags e notas vêm
  do catálogo real — ver `scripts/sync-games.mjs`.
- **Arte e dados dos jogos**: vêm do catálogo real (worker
  `piratebox-catalogue`) e da descrição curta do `piratebox-steam-details`.
  Títulos, estúdios, gêneros, tags, capturas e a nota (proporção de reviews
  positivas × 5, a mesma conta de `src/utils/gameMetrics.ts`) são do banco;
  conquistas e horas são números de exibição, porque não existe usuário logado
  numa landing.

## Atualizar a vitrine de jogos

```bash
npm run site:games
```

Baixa `header.jpg`, `library_600x900.jpg` e `library_hero.jpg` pelo proxy de
imagem do worker, converte para webp em `public/games/` e regrava
`src/content/games.generated.ts` (arquivo gerado — não editar à mão). A curadoria
de appIds fica no topo de `scripts/sync-games.mjs`. Requer ffmpeg no PATH.
`tests/site-games.test.ts` falha se o arquivo gerado apontar para uma imagem que
não existe.

## Motion

Personalidade Premium: sem overshoot, uma curva (`--site-ease`) e três durações
(`--site-motion-quick/base/slow`). Todo movimento vive dentro de
`@media (prefers-reduced-motion: no-preference)`; sob redução de movimento o
conteúdo nasce visível e parallax e contagem de preço não rodam. Os estados
escondidos de reveal também dependem de `html.js`, então a página continua
legível sem JavaScript.

## Regras visuais herdadas do launcher

Nenhum gradiente decorativo e nenhuma borda ornamental: separação entre
superfícies vem de salto de degrau na rampa (`--surface-canvas` → `--surface-panel`
→ `--surface-raised` → `--surface-strong`) e de espaçamento, como manda o
`design.md` do app. Sombras (`--shadow-*`) ficam só em mídia e janela flutuante;
bordas existem apenas em anéis de foco e indicadores de status.
