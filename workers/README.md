# Workers do GhostBox

Cinco Workers Cloudflare servem o app desktop. Todos ficam neste diretório, cada um com seu `wrangler.toml` e seu `package.json`.

O papel principal deles é manter credenciais fora do desktop: a Steam Web API key, as chaves da Stripe e os segredos de OAuth vivem só como secrets do Worker. **Nenhuma delas pode ir para um `.env` do desktop ou para o repositório.**

## Visão geral

| Worker | Nome no Cloudflare | URL de produção | O que faz |
|---|---|---|---|
| `catalogue` | `piratebox-catalogue` | `https://piratebox-catalogue.hella.workers.dev` | Catálogo de jogos em D1, alimentado por um cron que varre a SteamSpy |
| `steam-details` | `piratebox-steam-details` | `https://piratebox-steam-details.hella.workers.dev` | Proxy dos detalhes da Steam Store |
| `steam-stats` | `ghostbox-steam-stats` | `https://ghostbox-steam-stats.hella.workers.dev` | Proxy da Steam Web API (reviews, conquistas, perfil), com cache em KV |
| `subscriptions` | `ghostbox-subscriptions` | `https://ghostbox-subscriptions.hella.workers.dev` | Stripe (Premium), OAuth, cloud save e imagens de perfil |
| `feedback` | `ghostbox-feedback` | `https://ghostbox-feedback.hella.workers.dev` | Feedback do usuário e endpoint do updater (`/updates/latest`) |

As URLs padrão ficam no código em [src/lib/ghostboxApi.tauri.ts](../src/lib/ghostboxApi.tauri.ts) (catalogue, feedback) e no Rust em [src-tauri/src/catalogue.rs](../src-tauri/src/catalogue.rs), [settings.rs](../src-tauri/src/settings.rs), [subscription.rs](../src-tauri/src/subscription.rs) e [cloud_save.rs](../src-tauri/src/cloud_save.rs). Dá para apontar o app para outro deployment por variável de ambiente — ver o [README principal](../README.md).

## Deploy

Cada Worker é deployado a partir da raiz do repositório, apontando para o `wrangler.toml` dele:

```bash
wrangler deploy --config workers/steam-stats/wrangler.toml
```

Para desenvolvimento local:

```bash
wrangler dev --config workers/steam-stats/wrangler.toml
```

O Worker `catalogue` tem testes próprios:

```bash
cd workers/catalogue && npm test
```

## Secrets e variáveis

Secrets vão por `wrangler secret put NOME --config workers/<worker>/wrangler.toml`. Variáveis não sensíveis (URLs de retorno, IDs de guild, nomes de bucket) já estão em `[vars]` no `wrangler.toml` de cada Worker e podem ser versionadas.

### `steam-stats`

| Nome | Tipo | Observação |
|---|---|---|
| `STEAM_WEB_API_KEY` | **secret** | A chave da Steam. Nunca sai daqui. |
| `METRICS_TOKEN` | **secret** | Protege `GET /steam/metrics`. |
| `ALLOWED_ORIGIN` | var | CORS. |
| `RATE_LIMIT_PER_MINUTE` | var | Teto por IP; ver "Rate limiting" abaixo. |
| `STATS_CACHE` | KV | Cache das respostas da Steam. |
| `SCAN_COORDINATOR` | Durable Object | Agrega as métricas entre isolates. |

### `subscriptions`

| Nome | Tipo | Observação |
|---|---|---|
| `STRIPE_SECRET_KEY` | **secret** | |
| `STRIPE_WEBHOOK_SECRET` | **secret** | Valida a assinatura do webhook. |
| `CLOUD_SESSION_SECRET` | **secret** | Assina as sessões de cloud save. |
| `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_SYNC_TOKEN`, `DISCORD_OAUTH_STATE_SECRET` | **secret** | Integração com Discord (cargo Premium). |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **secret** | |
| `CHECKOUT_RETURN_URL` | var | Em `[vars]`. |
| `DISCORD_GUILD_ID`, `DISCORD_PREMIUM_ROLE_ID`, `DISCORD_REDIRECT_URI`, `OAUTH_REDIRECT_URI` | var | Em `[vars]`. As redirect URIs precisam bater **exatamente** com o console do provider — barra final ou `http://` já dá `redirect_uri_mismatch`. |
| `CLOUD_SAVE_BUCKET`, `PROFILE_IMAGE_BUCKET` | var | Em `[vars]`. Nomes dos buckets R2 (padrão `cloud-saves` / `profile-images`). |
| `DISCORD_CLIENT_ID`, `STRIPE_API_VERSION`, `STRIPE_PORTAL_RETURN_URL` | ⚠️ | O código lê estas três, mas elas **não estão** no `wrangler.toml` — hoje só existem no dashboard do Cloudflare ou como secret. Convém movê-las para `[vars]` para o deploy ser reproduzível a partir do repositório. |
| `SUBSCRIPTION_DB` | D1 | `ghostbox-subscriptions`. |

Roda um cron a cada 30 minutos (`[triggers]` no `wrangler.toml`): sincroniza os
cargos Premium no Discord (`syncDiscordPremiumRoles`) e limpa registros velhos
(`pruneStaleRecords`).

### `feedback`

| Nome | Tipo | Observação |
|---|---|---|
| `GITHUB_TOKEN` | **secret** | Abre issues a partir do feedback. |
| `DISCORD_WEBHOOK_URL` | **secret** | |
| `UPDATE_SIGNATURE` | **secret** | Assinatura do updater, quando servida pelo Worker. |
| `GITHUB_OWNER`, `GITHUB_REPO`, `RELEASE_ASSET_NAME`, `LATEST_VERSION`, `INSTALLER_URL`, `RELEASE_NOTES_URL`, `ALLOWED_ORIGIN` | var | Com `RELEASE_ASSET_NAME` vazio, o Worker pega o `.exe` mais recente do release do GitHub. |

### `catalogue`

Bindings `DB` (D1 `piratebox-games`, leituras do catálogo) e `STEAMSPY_SNAPSHOT` (KV). Cron diário `0-44/2 0 * * *` (00h00–00h44 UTC): coleta 20 páginas da SteamSpy e publica um snapshot imutável no KV. A rotina agendada nunca escreve no D1 — SteamSpy só persiste no KV; o D1 segue como fallback somente leitura para amostras antigas.

O índice FTS `games_search` é preenchido automaticamente pelo cron `*/2 * * * *`, de forma retomável e limitada a 80 mil escritas por dia. O Worker processa até 75 jogos por execução, salva o cursor e ativa o índice sozinho após validar contagens, IDs e amostras. Não depende do computador ou do Codex. Os comandos abaixo servem apenas para diagnóstico/recuperação administrativa:

```bash
cd workers/catalogue
npm run backfill:search-index
npm run backfill:search-index -- --status
npm run backfill:search-index -- --max-batches 20
npm run backfill:search-index -- --activate # apenas após `complete: true`
```

O checkpoint autoritativo é `catalogue_meta.searchIndexBackfillState` (formato 2). Cada execução processa até 20 lotes, imprime o progresso e encerra; não continua em segundo plano. Retome com o mesmo comando até `complete: true`, respeitando a reserva diária de 80 mil escritas e o reset às 00:00 UTC. Uma reserva persistida antes do lote cobre interrupções e impede execuções simultâneas; SQL e cursor são importados no mesmo lote. Escritas medidas pelo D1 substituem a reserva após sucesso, com margem para o checkpoint. A reserva de uma execução interrompida permanece contabilizada e o bloqueio expira em dez minutos. Os lotes usam arquivo temporário para evitar o limite de argumentos do Windows.

O formato 2 refaz o backfill anterior para preservar pontuação em filtros exatos e limitar tags às doze visíveis. `--activate` apenas valida: exige conclusão, compara contagens, verifica IDs ausentes/excedentes e amostras antes de gravar `searchIndexVersion=1`. Antes disso, o Worker continua no caminho legado. A reserva cobre o backfill, não outras escritas da conta: não o execute em um dia cujo orçamento já foi consumido por migrations ou outros serviços.

Antes de iniciar e entre lotes, o script também exige margem nos totais deste banco: até 90 mil escritas e 4 milhões de leituras, incluindo a reserva do próximo lote. A base vem de `wrangler d1 info` e usa as últimas 24 horas (mais conservador que o dia UTC), acrescida das operações medidas na execução. Isso inclui migrations, mas não garante o orçamento agregado de outros bancos da conta. Métricas ausentes impedem o backfill.

### `steam-details`

Sem secrets: só faz proxy do endpoint público da Steam Store.

## Rate limiting e cache

Estado atual, por Worker:

| Worker | Rate limit | Cache |
|---|---|---|
| `steam-stats` | Sim — janela de 1 min por IP, `RATE_LIMIT_PER_MINUTE` (`src/index.ts`, `rateLimitExceeded`) | KV `STATS_CACHE` |
| `steam-details` | Não | `Cache-Control` |
| `feedback` | Não | `Cache-Control` |
| `catalogue` | Não (protegido de fato pelo cron, não por request do usuário) | D1 + cache no Rust ([catalogue_cache.rs](../src-tauri/src/catalogue_cache.rs): fresh 30 min, stale utilizável por 7 dias) |
| `subscriptions` | Não | — |

> **Pendente:** `catalogue`, `steam-details` e `subscriptions` não têm rate limit próprio. Só `steam-stats` consome cota da Steam Web API diretamente, então ele é o crítico e já está coberto — mas `subscriptions` fala com Stripe e Discord sem teto.

## Health e observabilidade

- `subscriptions`: `GET /health`.
- `steam-stats`: `GET /steam/metrics` (exige `METRICS_TOKEN`), com contadores agregados por Durable Object — inclui `rateLimited`.
- `catalogue` e `steam-details`: `[observability] enabled = true` no `wrangler.toml`, ou seja, logs no dashboard do Cloudflare.
- `feedback`: sem health nem observability declarada.

> **Pendente:** não há endpoint de health em `catalogue`, `steam-details` e `feedback`, então uma degradação só aparece quando o app cai no fallback.
