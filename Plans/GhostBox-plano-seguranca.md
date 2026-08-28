# Plano de segurança — GhostBox

**Repositório:** https://github.com/Darksoan/GhostBox  
**Versão analisada:** 0.1.6  
**Data:** 2026-08-27  

Auditoria focada em: secrets, autenticação, sessão, CSP/Tauri capabilities, workers, updater, filesystem e superfície de ataque do desktop.

---

## Resumo executivo

O projeto já aplica várias práticas boas:

- Steam Web API key **não** vai no cliente desktop por padrão; fica no Worker (`steam-stats`).
- Chaves de assinatura do updater em `src-tauri/keys/` estão no `.gitignore`.
- Sessão cloud e cache de assinatura usam **DPAPI** (`CryptProtectData`) no Windows (`encrypt_secret_for_current_user`).
- Dados de pagador Pix **não** são persistidos localmente.
- Stripe webhook com secret; Cakto revalida pedido no servidor (secret no body não basta sozinho).
- CSP presente; `assetProtocol` limitado a `$APPDATA` / `$APPLOCALDATA`.
- Feedback não expõe a URL do Discord webhook ao app.
- Password reset responde sempre 200 (mitiga enumeração de contas).

Ainda há melhorias importantes de endurecimento (allowlists, rate limit, política de senha, CORS, path safety e auditoria contínua).

---

## 1. O que já está bem

| Área | Prática observada |
|------|-------------------|
| Secrets de build | `src-tauri/keys/` ignorado; README orienta `wrangler secret put` para Steam key |
| Sessão local | `cloud-session.bin` e status de assinatura criptografados com DPAPI no Windows |
| Auth backend | Firebase Identity Toolkit via worker; token de sessão HMAC 7 dias no Bearer |
| Premium | Checkout/portal só com Bearer; refresh de checkout só do dono (404 para outros) |
| Cloud saves | Endpoints exigem Bearer + premium |
| Updater | Assinatura Tauri (`pubkey` + `.sig`); endpoint dedicado no worker feedback |
| Feedback | Webhook Discord só no worker; mensagem truncada; `allowed_mentions: { parse: [] }` |
| CSP base | `script-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'` |
| Asset protocol | Scope em dirs de app data, não disco inteiro |

---

## 2. Achados e melhorias recomendadas

### S1 — Alta: `openExternalUrl` sem allowlist ✅ **corrigido em 27/08/2026**

> **Correção aplicada.** Já existia `is_allowed_external_url` em
> `window_lifecycle.rs`, mas guardava só o comando `shell_open_external`, que
> quase não era usado — todos os fluxos reais passavam por `openExternalUrl`,
> que chamava o plugin direto do JS e ainda caía em `window.open`. Agora a
> allowlist cobre esquema (`https:` + `steam://`) e host (domínio e
> subdomínios), `openExternalUrl` passa pelo comando Tauri e o fallback
> `window.open` foi removido. O alias `openExternal` foi eliminado para não
> deixar uma segunda porta que falha em silêncio. 6 testes em
> `external_url_tests` cobrem esquemas perigosos, hosts sósias
> (`notdiscord.com`, `discord.com.evil.example`) e os truques de
> userinfo/path/query/fragmento.

**Onde:** `ghostboxApi.openExternalUrl` → `openUrl` / `window.open`; capability `opener:default`.

**Risco:** qualquer URL (incluindo esquemas perigosos ou phishing) pode ser aberta se um fluxo futuro ou dados remotos controlarem a string.

**Ação:**

- Permitir só `https:` (e, se necessário, `http://localhost` em dev).
- Allowlist de hosts: Stripe, Discord OAuth, Cakto, Steam OpenID, domínio do worker de subscriptions, GitHub releases.
- Rejeitar `javascript:`, `file:`, `ms-settings:`, etc.
- Preferir permissões Tauri mais restritas que `opener:default` quando a API do plugin permitir escopo por domínio.

---

### S2 — ~~Alta~~ → Média: endpoints públicos do `steam-stats` por `steamId`

> **Verificação (27/08/2026):** o rate limit **já existe** —
> `rateLimitExceeded` ([steam-stats/src/index.ts:433](../workers/steam-stats/src/index.ts))
> aplica janela de 1 minuto por IP via `RATE_LIMIT_PER_MINUTE` em ~12 rotas.
> Sobra da ação original só o limite por `steamId` e o token de app.

**Onde:** Worker `steam-stats` — rotas `/steam/account-stats`, `/owned-games`, `/wishlist`, etc. autenticam só com a **key do servidor**, não do usuário final.

**Risco:** qualquer cliente que conheça a URL do worker pode varrer Steam IDs e consumir cota da Web API / KV / Durable Objects (abuso e custo).

**Ação:**

- Rate limit por IP (e, se possível, por `steamId`) no edge.
- Circuit breaker já existe para Steam 429 — reforçar limites de entrada.
- Considerar token de app de curta duração ou assinatura HMAC do desktop (segredo no binário é frágil, mas reduz abuso casual).
- Métricas (`/steam/metrics`) já usam Bearer `METRICS_TOKEN` — manter e não documentar em README público além do necessário.

---

### S3 — Média/Alta: política de senha fraca no cliente

> **Verificação (27/08/2026):** o rate limit de auth **já existe** —
> `handleRegister` e `handleLogin` respondem `too_many_attempts` 429. E
> `/auth/password-reset` **não existe mais**: foi substituído por
> `/auth/recover/*` ([index.ts:3128](../workers/subscriptions/src/index.ts)).
> O que de fato falta é só a política de senha: `validPassword`
> ([auth.ts:237](../workers/subscriptions/src/auth.ts)) checa apenas
> `length >= 8`, sem bloquear senhas comuns.

**Onde:** registro com `minLength={8}` apenas; username `pattern="[a-zA-Z0-9_]{3,20}"`.

**Risco:** senhas comuns; brute-force depende só do backend.

**Ação:**

- Exigir no **worker** (fonte de verdade): mínimo 8–12, bloquear senhas muito comuns; opcionalmente exigir complexidade moderada.
- Rate limit agressivo em `/auth/login`, `/auth/register`, `/auth/password-reset` (por IP + identifier).
- Considerar lockout progressivo ou CAPTCHA após N falhas (Cloudflare Turnstile no worker).
- Manter sempre 200 no password-reset (já documentado).

---

### S4 — Média: CSP permissiva em rede e estilo

**Onde:** `tauri.conf.json`

```
connect-src 'self' ipc: http://ipc.localhost https: ws: wss:
style-src 'self' 'unsafe-inline'
img-src ... https:
```

**Risco:** `connect-src https:` permite qualquer HTTPS (exfiltração se XSS no webview). `unsafe-inline` em style facilita alguns vetores de UI injection.

**Ação:**

- Restringir `connect-src` aos workers e APIs conhecidos (`*.hella.workers.dev`, Steam CDN/store se necessário, Stripe/Discord só se o webview chamar direto — preferir abrir no browser externo).
- Avaliar remover `unsafe-inline` de style (tokens/SCSS compilados devem bastar); se inevitável, documentar por quê.
- Revisar periodicamente CSP após novas integrações.

---

### S5 — Média: CORS `ALLOWED_ORIGIN` opcional com fallback `*`

**Onde:** feedback worker (`access-control-allow-origin: env.ALLOWED_ORIGIN || "*"`). Subscriptions documenta `ALLOWED_ORIGIN` opcional.

**Risco:** browsers de terceiros podem chamar o endpoint de feedback (spam no Discord). Desktop Tauri não depende de CORS da mesma forma, mas o endpoint é público na internet.

**Ação:**

- Definir `ALLOWED_ORIGIN` em produção (origem do site, se houver) **ou** exigir um header/token simples no POST de feedback.
- Rate limit por IP no `/feedback`.
- Validar tamanho (já há 1800) e rejeitar payloads repetidos.

---

### S6 — Média: capabilities Tauri amplas

**Onde:** `capabilities/default.json` — `opener:default`, `process:default`, `dialog:default`, várias window allows.

**Risco:** superfície IPC maior que o mínimo; `process:default` pode incluir restart/exit úteis, mas deve ser justificado.

**Ação:**

- Inventariar cada permissão usada de fato no frontend/Rust.
- Remover permissões não usadas.
- Separar capability da janela `tray-menu` se ela precisar de menos direitos que `main`.

---

### S7 — Média: path traversal e escrita em disco (downloads / backups / restores)

**Onde:** `cdndownload`, `backup`, `cloud_save` (restore), `ludusavi`, paths Steam/custom exe.

**Risco:** nomes de arquivo ou caminhos vindos de manifest/API maliciosos ou corrompidos poderiam escrever fora do diretório alvo.

> **Nota de verificação (27/08/2026):** o zip slip do restore **já estava
> mitigado** — `unzip_to_directory` ([cloud_save.rs:176](../src-tauri/src/cloud_save.rs))
> usa `file.enclosed_name()`, a API do crate `zip` que recusa `..` e caminhos
> absolutos.
>
> Em compensação, o helper recomendado abaixo era **inseguro** para o caso de
> escrita: com `canonicalize()` falhando (todo destino novo ainda não existe),
> ele caía no caminho cru, e como `Path::starts_with` compara componente a
> componente sem interpretar `..`, `C:\downloads\..\..\evil` passava como
> "dentro de `C:\downloads`". Corrigido em 27/08/2026 com normalização lexical
> dos dois lados (e comparação case-insensitive no Windows). **Endurecer o
> helper era pré-requisito para espalhá-lo pelos writes.**

**Ação:**

- Após resolver path, exigir `is_path_inside_or_equal(raiz_permitida, path_final)` (helper em `lib.rs`, já endurecido — **usar em todos** os writes; hoje só `backup.rs` usa).
- Rejeitar `..`, links simbólicos inesperados e paths absolutos vindos do remoto.
- Downloads: só gravar sob o diretório configurado pelo usuário + sanitizar nomes.
- Restore de cloud save: extrair zip só dentro de temp + destino validado (zip slip).

---

### S8 — Média: session token e dados em localStorage

**Onde:** sessão principal em `cloud-session.bin` (DPAPI). Premium/Discord caches e fingerprint em **localStorage** do webview.

**Risco:** XSS no webview lê localStorage (não o bin DPAPI). Caches de premium não são segredo crítico, mas vazam estado de conta.

**Ação:**

- Manter tokens **só** no lado Rust (já é o caminho principal).
- Não colocar Bearer/session token em `localStorage`/`sessionStorage`.
- Tratar XSS como prioridade zero: CSP mais estrita, sem HTML remoto não sanitizado, cuidado com `innerHTML`/markdown de reviews se houver.

---

### S9 — Baixa/Média: crypto em non-Windows

**Onde:** `encrypt_secret_for_current_user` / `decrypt` em non-Windows = **pass-through** (bytes em claro).

**Risco:** se o app rodar em Linux/macOS no futuro, sessão e keys locais ficam legíveis no filesystem.

**Ação:**

- Antes de ship multiplataforma: keyring do SO (Windows Credential Manager já via DPAPI; Linux Secret Service; macOS Keychain) ou lib tipo `keyring` crate.
- Documentar “Windows-first; secrets at rest só com DPAPI hoje”.

---

### S10 — Baixa/Média: Steam Web API key ainda carregável no desktop

**Onde:** `load_steam_web_api_key` lê env `GHOSTBOX_STEAM_WEB_API_KEY` / `STEAM_WEB_API_KEY` e arquivo local criptografado.

**Risco:** usuários avançados podem colocar key no cliente; aumenta chance de vazamento se alguém distribuir build com key embutida.

**Ação:**

- Manter proxy como caminho oficial; documentar que key local é só debug.
- Em release builds, ignorar arquivo local e exigir proxy (feature flag / `cfg(debug_assertions)`).
- Nunca commitar key (já alinhado com README).

---

### S11 — Baixa: feedback e updates sem autenticação de app

**Onde:** POST `/feedback` e GET `/updates/*` públicos.

**Risco:** spam de feedback; scraping de manifest de update (baixo impacto se assinatura for verificada no cliente).

**Ação:**

- Rate limit + opcional token de app no header.
- Updater: cliente Tauri **deve** verificar assinatura (já configurado); nunca instalar sem `.sig` válida.
- Não confiar só em HTTPS do worker.

---

### S12 — Baixa: dependências e supply chain

**Onde:** npm + crates + `vendor/tao-0.35.3` + `externalBin: ludusavi` + sidecars.

**Risco:** CVE em deps; binário Ludusavi trocado; patch tao sem rastreio.

**Ação:**

- CI: `npm audit` / `cargo audit` (ou `cargo deny`) em PR.
- Fixar versões de Ludusavi; checksum no build; documentar origem.
- Anotar no repo **por que** o patch de `tao` existe e quando pode ser removido.
- Preferir `npm ci` e lockfiles commitados (já há).

---

### S13 — Baixa: instalador Windows e code signing

**Onde:** release NSIS + assinatura **do updater** Tauri; não ficou claro se o `.exe` do instalador é assinado com certificado Authenticode.

**Risco:** SmartScreen / aviso de “publisher unknown”; trojanização se o canal de download for comprometido (mitigado em parte pela sig do updater).

**Ação:**

- Assinar o instalador NSIS com certificado Authenticode em produção.
- Manter `TAURI_SIGNING_PRIVATE_KEY` só em secrets do CI.
- Publicar hashes no release notes.

---

### S14 — Informativo: dados em `wrangler.toml`

IDs de D1, KV e Discord guild/role estão em vars versionadas.

> **Verificação (27/08/2026):** a Cakto, citada na auditoria original, não existe
> mais no código — sobrou só a migration `0014_cakto_provider.sql`. Os workers
> usam Stripe.

**Risco baixo** (não são secrets de autenticação), mas guild/role facilitam fingerprint do servidor Discord.

**Ação:** aceitável; secrets reais só via `wrangler secret put` (já documentado).

---

## 3. Matriz de prioridade

| ID | Severidade | Tema | Esforço relativo |
|----|------------|------|------------------|
| S1 | Alta | Allowlist de URLs externas | Baixo |
| S2 | Alta | Rate limit / anti-abuso steam-stats | Médio |
| S3 | Média–Alta | Senha + rate limit auth | Médio |
| S4 | Média | CSP mais restrita | Médio |
| S5 | Média | CORS + rate limit feedback | Baixo |
| S6 | Média | Capabilities mínimas | Médio |
| S7 | Média | Path safety em downloads/backup/restore | Médio–Alto |
| S8 | Média | Tokens só no Rust / anti-XSS | Contínuo |
| S9 | Baixa–Média | Keyring non-Windows | Alto (se multi-OS) |
| S10 | Baixa–Média | Key Steam só no worker em release | Baixo |
| S11 | Baixa | Rate limit feedback/updates | Baixo |
| S12 | Baixa | Audit de deps + Ludusavi checksum | Médio |
| S13 | Baixa | Authenticode no instalador | Médio (processo) |

---

## 4. Checklist de implementação

### Fase 1 — endurecimento rápido

- [x] Allowlist em `openExternalUrl` (https + hosts conhecidos) — *27/08/2026*
- [x] Rate limit IP nas rotas auth do worker subscriptions — *já existia*
- [ ] Rate limit IP em `/feedback` (ainda sem)
- [x] Rate limit IP em `steam-stats` — *já existia*; falta o limite por `steamId`
- [ ] Definir `ALLOWED_ORIGIN` ou token no feedback em produção
- [ ] Política de senha reforçada no worker (fonte de verdade)
- [ ] Release build: não carregar Steam key de arquivo local

### Fase 2 — desktop e filesystem

- [x] Endurecer `is_path_inside_or_equal` (traversal passava em path inexistente) — *27/08/2026*
- [ ] Auditar todos os writes com `is_path_inside_or_equal` (hoje só `backup.rs` usa)
- [x] Proteção zip slip no restore de cloud save — *já existia via `enclosed_name()`*
- [ ] Sanitizar nomes de arquivo de download
- [ ] Revisar e reduzir `capabilities/default.json`
- [ ] Apertar CSP `connect-src` (e avaliar `style-src`)

### Fase 3 — operação e supply chain

- [ ] `npm audit` + `cargo audit` no CI
- [ ] Checksum/versão pinada do Ludusavi
- [ ] Documentar patch `tao` e plano de remoção
- [ ] Authenticode no NSIS (se ainda não houver)
- [ ] Keyring real antes de ship Linux/macOS

### Fase 4 — verificação contínua

- [x] Teste automatizado: abrir URL fora da allowlist deve falhar — *`external_url_tests`, 6 casos*
- [x] Teste: path com `..` deve falhar — *`path_containment_tests`, 4 casos*
- [ ] Revisar secrets no CI (nenhum `.env` commitado)
- [ ] Rodar `gitleaks` / secret scan no pipeline

---

## 5. Testes manuais sugeridos (segurança)

1. **Sessão:** login → confirmar `cloud-session.bin` não é JSON legível no Windows; logout apaga arquivo.
2. **Premium offline:** cache criptografado não eleva usuário após `currentPeriodEnd`.
3. **Open URL:** tentar `javascript:alert(1)` e host desconhecido — deve bloquear.
4. **Feedback spam:** dezenas de POSTs rápidos — deve rate-limitar.
5. **steam-stats:** requests massivos com steamIds aleatórios — deve 429 / throttle.
6. **Restore save:** zip com entrada `../../outside.txt` — não deve escrever fora do destino.
7. **Updater:** manifest com signature inválida — app não instala.
8. **Auth:** 20 logins errados — lockout ou delay; password-reset não revela se o e-mail existe.

---

## 6. Referência rápida de secrets (não commit)

| Secret | Onde |
|--------|------|
| `STEAM_WEB_API_KEY` | Worker steam-stats |
| `STRIPE_*`, `CLOUD_SESSION_SECRET`, `FIREBASE_API_KEY`, `SUPABASE_*`, Discord OAuth/bot | Worker subscriptions |
| `DISCORD_WEBHOOK_URL`, `GITHUB_TOKEN` (updates) | Worker feedback |
| `TAURI_SIGNING_PRIVATE_KEY` | GitHub Actions secrets |
| Chaves em `src-tauri/keys/` | Local, gitignored |

---

## 7. Relação com o plano geral de melhorias

Este documento complementa `GhostBox-plano-melhorias.md`:

- Bugs de fluxo (wishlist, testes, CI) não substituem os itens **S1–S7**.
- CI de segurança (audit + secret scan) encaixa na Fase A/B do plano geral.
- Documentar no README: “Steam API key só no worker; nunca no `.env` do desktop”.

---

*Auditoria estática do código público do repositório. Não inclui teste de penetração ao vivo nos workers em produção nem revisão de infraestrutura Cloudflare/Stripe além do que está no repo.*
