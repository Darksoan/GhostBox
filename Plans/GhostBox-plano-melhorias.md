# Plano de melhoria — GhostBox

**Repositório:** https://github.com/Darksoan/GhostBox  
**Versão analisada:** 0.1.6  
**Data:** 2026-08-27  

**Contexto:** app desktop Tauri + React focado em biblioteca Steam pessoal, catálogo, downloads, saves (Ludusavi), conquistas, Premium (Stripe) e recomendações. Backend auxiliar em Cloudflare Workers. Design system documentado em `design.md`.

---

## 1. Bugs e inconsistências já identificados (alta prioridade)

Fonte principal: `fixes/home-wishlist-cycle-fixes.md` (seção “Da sua wishlist da Steam”).

| ID | Severidade | Problema | Impacto |
|----|------------|----------|---------|
| **F1** | Alta | Ciclo incompleto é gravado e nunca revalida | Pipeline caro (~29 requests) roda em todo mount/focus |
| **F2** | Alta | `history` queima os 4 ciclos em regenerações da mesma semana | Perde proteção de diversidade e exclui bons candidatos |
| **F3** | Alta | Pool de similares perde 4 das 6 fontes (corta nos 16 primeiros) | Diversidade prometida não acontece |
| **F4** | Média | Sem guarda de execução concorrente em `loadWishlistCycle` | Pipelines sobrepostos ao focar a janela |
| **F5** | Média | Teste quebrado pela remoção do “ver mais” | CI/local vermelho |
| **F6** | Média | Placeholders entram no pool e queimam slots | Fallback caro mais frequente |
| **F7** | Baixa | Seed de rotação trava com wishlist múltipla de 7 | Mesmas fontes toda semana |
| **F8** | Baixa | Skeleton com 4 pills, card com 3 tags | Layout shift |
| **F9** | Baixa | Um jogo instalado descarta o ciclo inteiro | Resorteio desnecessário e consome history |
| **Pré-existentes** | — | 2 testes falhando no HEAD (`home-layout`, `typography-tokens`) | Suíte não confiável |

### Ações desta seção

- Tratar **F1–F6** primeiro (código + testes).
- Atualizar ou remover os 2 testes pré-existentes.
- Em seguida **F7–F9** e limpeza de CSS órfão (`.home-wishlist-card__short-info` / `__review`).

### Notas de implementação (referência)

**F1** — não gravar ciclo incompleto; agendar retry (ex.: 30 min) em vez de `expiresAt` do ciclo.

**F2** — se `cycleStart` for o mesmo, substituir só o topo do history (não prepender entrada nova da mesma semana).

**F3** — intercalar similares por fonte antes do corte em 16.

**F4** — guarda `inFlight` única para `runWhenIdle`, `visibilitychange` e timeout de expiração.

**F5** — corrigir o teste (`home-layout`), não reintroduzir o botão “ver mais”.

**F6** — no caminho de detalhes, `.catch(() => null)` e filtrar; placeholders só nas fontes (tags/gêneros).

**F7** — usar índice de semana (`getWishlistCycleIndex`) em vez de `YYYYMMDD` para o seed.

**F8** — skeleton com 3 tag-skeletons.

**F9** — manter sobreviventes do cache e preencher só slots faltantes, com o mesmo `cycleStart`.

---

## 2. Testes e qualidade de build

- Há dezenas de testes (layout, catálogo, hover, profile, wishlist, tokens, etc.).
- Documentado na auditoria: **80 passaram, 3 falharam**.
- Só existe workflow de **release Windows** (`.github/workflows/release.yml`). **Não há CI de PR**.

### Ações

1. Corrigir os 3 testes vermelhos + os 2 pré-existentes.
2. Adicionar workflow `ci.yml` em push/PR:
   - `npm ci`
   - `npm run check:tokens`
   - `npx tsc --noEmit`
   - `npm test`
   - (opcional) `npm run build` em Linux
3. Manter `npm run build` (já chama `check:tokens`) como gate local e no CI.

---

## 3. Documentação e onboarding

- **README** ainda é template Tauri + notas de proxy Steam. Não descreve produto, arquitetura, páginas, Premium, Ludusavi, workers.
- `AGENTS.md` está praticamente vazio.
- `design.md` e `POLICIES.md` estão sólidos.
- `Referências e Links dos Repositórios.md` é útil para providers de manifest, mas tem notas de 404 e renomeações.

### Ações

1. Reescrever README: o que é o GhostBox, setup (Node/Rust/Tauri), scripts, variáveis de ambiente, workers, aviso legal (só software autorizado).
2. Preencher `AGENTS.md` com mapa de pastas, convenções (tokens, i18n, features) e “como rodar testes”.
3. Revisar links de providers (ManifestHub etc.) e marcar os que ainda respondem.

---

## 4. Fluxo de dados e robustez de rede

### Pontos críticos atuais

- **Frontend** → proxies Workers (`steam-stats`, `steam-details`, `catalogue`, `subscriptions`, `feedback`) → fallback Steam Store público.
- **Rust** → Steam local (appinfo, appcache, manifests, path), Ludusavi, CDN download, image cache, cloud save.
- **Home / Wishlist cycle** → muitas requests paralelas sem dedupe forte (F4) e com cache frágil (F1/F2).

### Ações

1. Implementar guarda `inFlight` (F4) e não gravar ciclo incompleto (F1).
2. Intercalar similares por fonte (F3) e filtrar placeholders antes do pool (F6).
3. Revisar `requestQueue` e caches (`gameCache`, `catalogue_cache`, React Query) para:
   - timeouts e retry com backoff
   - cancelamento em unmount / mudança de página
   - mensagens de erro claras (offline, rate limit, path Steam inválido)
4. Garantir que falha de um worker não derrube a UI inteira (já há fallback Store; estender o padrão).

---

## 5. Camada Tauri / Rust

Módulos relevantes: `steam*`, `catalogue*`, `cdndownload`, `ludusavi`, `backup`, `cloud_save`, `achievement_monitor`, `manifest_sources`, `subscription`, `window_lifecycle`.

### Ações

1. Validar path da Steam e estados de erro (instalação não encontrada, permissão, disco cheio). — *permissão negada tratada em `steam_select_path`; disco cheio (`ENOSPC`) ainda pendente*
2. Revisar concorrência em download/CDN e em monitor de conquistas (evitar race e leak de handles). — *race do `achievement_monitor` corrigida; pendências do `cdndownload` abaixo*
3. `externalBin: ludusavi` — documentar versão, atualização e fallback se o binário falhar.
4. Patch de `tao` em `vendor/` — anotar por que existe e se ainda é necessário.
5. CI/release só Windows: decidir se Linux/macOS entram no roadmap ou se o escopo oficial continua Windows-first.

### Pendências de concorrência em `cdndownload.rs`

Levantadas na Fase B e **não corrigidas**: exigem teste manual em Windows com download real, porque o efeito observável depende do timing do worker `steamkit`. Ordenadas por gravidade.

| # | Local | Problema |
|---|-------|----------|
| C1 | `cdndownload.rs:1096-1113` | Worker morto durante `downloadDepot` é descartado (`*worker = None`) sem `kill()`/`wait()`. `Child::drop` não mata o processo no Rust — se ele não morreu sozinho, vira processo filho vazado. |
| C2 | `cdndownload.rs:129-132` | `read_worker_event` usa `read_line` bloqueante **sem timeout**. Worker travado deixa o comando de download pendurado para sempre; o cancelamento só é consumido nos checkpoints do loop. |
| C3 | `cdndownload.rs:970-984` | Nada impede duas invocações concorrentes de `cdndownload_download_game` para o mesmo `app_id`. Sem guard por app_id, as duas colidem em `active_download_processes` (uma `clear_active_download_process` apaga o estado da outra) e no mesmo `ChunkIndexGuard` / `install_path` — o comentário em `:1060-1063` já assume um único escritor, mas nada garante isso. |
| C4 | `cdndownload.rs:31-45` | `shutdown_download_worker` mata o `Child` enquanto um download ativo ainda segura clones de `Arc<Mutex<stdin/stdout>>` obtidos fora do lock principal (`:975-980`). Não dá crash (vira `Err`/`worker-exited`), mas é race entre shutdown do app e download em andamento. |

Também pendente, fora do `cdndownload`: `achievement_monitor.rs:71-91` faz `thread::spawn` sem guardar o `JoinHandle`; se `notify_new_unlocks` panicar, a thread morre em unwind e o cleanup do map (`:83-90`) não roda.

---

## 6. Workers e secrets

Workers: `catalogue`, `steam-details`, `steam-stats`, `subscriptions`, `feedback` (updater endpoint).

### Ações

1. Documentar deploy (`wrangler`), secrets (`STEAM_WEB_API_KEY`, Stripe, etc.) e URLs de produção/dev.
2. Rate limiting e cache nos workers para não estourar cotas Steam.
3. Health/status simples (ou logs) para saber quando um proxy está degradado.
4. Manter a regra: **nunca** colocar Steam Web API key no desktop `.env`.

---

## 7. UI / design system / acessibilidade

`design.md` é forte (tokens, rampa neutra, motion, a11y). Há `check-tokens` e testes de tipografia/layout.

### Ações

1. Manter disciplina de tokens (sem hex cru em componentes).
2. Alinhar skeleton (3 tags) com card real (F8).
3. Revisar estados vazios/erro/loading em Home, Library, Catalogue, Downloads, Profile.
4. Teclado e foco em modais/overlays (já parcialmente tratados no `App.tsx` com histórico de overlay).
5. i18n (`src/i18n.ts`): garantir cobertura PT/EN nas novas strings do wishlist e settings.

---

## 8. Premium, auth e políticas

Fluxo de assinatura e portal já existe em `App.tsx` (reconcile checkout, cache, reset no logout). Policies em `POLICIES.md`.

### Ações

1. Testes de integração leves para:
   - logout limpa Premium
   - checkout pendente não some em falha de rede
   - portal com erro mostra toast
2. Conferir e-mail de suporte (`ghostbox@mail.com`) e se o fluxo de refund está documentado na UI de Settings.
3. Evitar “flash” de UI não-premium após pagamento (já há lógica; validar edge cases).

---

## 9. Downloads, biblioteca e catálogo

Páginas: Home, Library, Catalogue, Favorites, Downloads, Profile, Notifications, Settings, Achievements.

### Ações

1. Download manager: estados claros (fila, pausa, erro, disco), persistência e retomada.
2. Catálogo: hover preview já tem vários testes — manter regressão coberta; revisar retenção/rotação sob lista grande (virtualização com `@tanstack/react-virtual`).
3. Merge Steam local + dados remotos (`steamLibraryMerge`, etc.): conflitos de título, AppID inválido, jogos removidos.
4. Manifest providers (doc de referências): priorizar Tier 1 estáveis e testes automatizados com AppID de referência (ex. `2713000`).

---

## 10. Release e versionamento

- Release automático em push em `master` (NSIS + signature).
- Versão em `package.json` / `Cargo.toml` / `tauri.conf.json` (0.1.6).

### Ações

1. Evitar release em todo push de `master` se o fluxo for barulhento — considerar tag `v*` ou `workflow_dispatch` + tag.
2. Changelog mínimo no body do release (hoje só SHA).
3. Script `set-release-version.mjs` — manter versões sincronizadas nos três lugares.

---

## Ordem sugerida de execução

### Fase A — Estabilizar (1–2 sprints)

1. Corrigir F1–F6 + testes vermelhos/pré-existentes  
2. CI mínimo (tsc + vitest + check-tokens)  
3. README + AGENTS.md úteis  

### Fase B — Robustez de fluxo

4. Guarda de concorrência e cache do wishlist cycle (F2, F7, F9)  
5. Request queue / timeouts / cancelamento  
6. Estados de erro Steam path + Ludusavi  

### Fase C — Produto e operação

7. Workers documentados + rate limit  
8. Download manager e merge de biblioteca  
9. Ajustes de release (tags, changelog)  
10. Providers de manifest com health check  

---

## Riscos e observações

- O produto lida com **software autorizado** (`POLICIES.md`). Manter a mensagem no README e na UI.
- `ghostboxtokens.txt` no root: revisar se não vaza nada sensível (parece baseline de design tokens; o nome é ambíguo).
- Complexidade alta no Rust (Steam local + download + saves). Qualquer mudança em path/manifest deve ser acompanhada de teste manual em Windows.
- Escopo atual de release é **Windows-first**; Linux/macOS precisam de decisão explícita de produto.

---

## Checklist rápido (copiar para issues)

- [x] F1 — não gravar ciclo incompleto + retry
- [x] F2 — history da mesma semana substitui topo
- [x] F3 — intercalar similares por fonte
- [x] F4 — guarda `inFlight` no wishlist cycle
- [x] F5 — corrigir teste do chevron / “ver mais”
- [x] F6 — filtrar placeholders do pool de detalhes
- [x] F7 — seed por índice de semana
- [x] F8 — skeleton com 3 tags
- [x] F9 — preencher só slots faltantes ao instalar jogo
- [x] Corrigir 2 testes pré-existentes (home-layout, typography-tokens)
- [x] Workflow CI (tsc + vitest + check-tokens)
- [x] README de produto + setup
- [x] AGENTS.md preenchido
- [x] Revisar providers de manifest (links vivos) — *checado em 27/08/2026; `qwe213312/k25FCdfEOoEJ42S6` fora do ar (502)*
- [x] Timeouts / cancelamento em requests — *timeout na `requestQueue`; cancelamento real por `AbortController` ainda pendente (hoje só flag `cancelled`)*
- [x] Erros claros de path Steam — *permissão negada tratada; disco cheio pendente*
- [ ] Erros claros de Ludusavi (binário ausente já tem mensagem; sem fallback)
- [ ] Concorrência do `cdndownload` (C1–C4, ver seção 5)
- [x] Documentar workers e secrets — *[workers/README.md](../workers/README.md)*
- [ ] Rate limit / cache nos workers — *só `steam-stats` tem rate limit; `catalogue`, `steam-details` e `subscriptions` não (ver workers/README.md)*
- [ ] Health check em `catalogue`, `steam-details` e `feedback` (só `subscriptions` tem `/health`)
- [ ] `subscriptions`: `DISCORD_CLIENT_ID`, `STRIPE_API_VERSION` e `STRIPE_PORTAL_RETURN_URL` são lidas pelo código mas não estão no `wrangler.toml` — deploy não é reproduzível só do repositório
- [ ] Estados vazios/erro/loading nas páginas principais
- [ ] Testes leves de Premium/logout/checkout
- [ ] Download manager: estado de disco cheio — *fila/pausa/erro/persistência já existem; falta o estado de disco, que depende do `ENOSPC` no Rust*
- [x] Política de release (tags vs push master) — *release agora só em tag `v*` ou `workflow_dispatch`*
- [x] Changelog no release — *commits desde a tag anterior no corpo do release*
