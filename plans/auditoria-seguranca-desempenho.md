# Auditoria de segurança e desempenho

## Context

Auditoria do app inteiro (backend Rust em `src-tauri/src`, frontend React/TS em `src`), focada em dois eixos: segurança (superfície de comando Tauri, integrações externas, manuseio de credenciais) e desempenho (I/O bloqueante no runtime async, render de listas grandes, re-renders).

Dois problemas de desempenho já têm plano próprio e **não são repetidos aqui**:
- [codebase-cleanup-dedupe.md](codebase-cleanup-dedupe.md) — `app.css` morto, SCSS duplicado, exports mortos.
- [home-wishlist-cycle.md](home-wishlist-cycle.md) — pipeline serial de recomendações da wishlist (~150 requests para 3 cards).

Ordem de correção proposta: segurança por severidade, depois desempenho por impacto no usuário comum. Etapas são independentes entre si.

---

## Parte 1 — Segurança

### 1.1 LuaTools busca script por HTTP puro e injeta sem validar conteúdo (Crítico)

[luatools.rs:22](../src-tauri/src/luatools.rs:22), [luatools.rs:38-48](../src-tauri/src/luatools.rs:38), [luatools.rs:217-236](../src-tauri/src/luatools.rs:217) — `luatools_add_game` busca o pacote do jogo em `http://167.235.229.108/<appid>` (HTTP puro, sem TLS) e grava o `.lua` retornado, **sem validar o conteúdo**, em `<steam>/config/stplug-in/<appid>.lua` — pasta lida por loaders Lua estilo SteamTools com hooks no cliente Steam. Um MITM (wifi pública, DNS malicioso, roteador comprometido) troca a resposta e injeta Lua arbitrário no processo do Steam. É o app entregando um vetor de supply-chain contra o próprio usuário.

Correção: forçar HTTPS nesse endpoint (ou descontinuar a fonte HTTP), e no mínimo validar que o payload é um `.lua` bem formado / assinado antes de gravar em pasta com hook no Steam.

### 1.2 Fonte HTTPS do LuaTools é repositório GitHub de terceiro anônimo, sem checagem de conteúdo (Alto)

[luatools.rs:19-32](../src-tauri/src/luatools.rs:19) — mesmo a fonte HTTPS (`raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt`) é confiada sem qualquer validação de conteúdo do zip além de nome/extensão de arquivo. Comprometimento desse repo compromete todo usuário que adicionar jogo via LuaTools.

Correção: pin de hash conhecido por jogo (allowlist assinada) em vez de confiar cegamente no conteúdo do repo, ou pelo menos logging/alerta se o conteúdo mudar entre execuções.

### 1.3 Bootstrap de binários externos valida hash contra a mesma fonte que os serve (Médio)

[luatools_bootstrap.rs:143-154](../src-tauri/src/luatools_bootstrap.rs:143), [luatools_bootstrap.rs:176-204](../src-tauri/src/luatools_bootstrap.rs:176) — releases do GitHub (`madoiscool/LuaTools`, `OpenSteam001/OpenSteamTool`) são conferidos por SHA-256 **reportado pela própria API do GitHub**, não um valor independente/fixo no código. `OpenSteamTool` instala `dwmapi.dll`/`xinput1_4.dll` direto na pasta de instalação do Steam — alvo clássico de DLL hijacking. Conta comprometida em qualquer um dos dois repositórios de terceiro passa a publicar binário malicioso que ainda "valida" nesse esquema.

Correção: pin do hash esperado no próprio código do GhostBox (atualizado a cada release oficial suportada), não derivado da mesma resposta de rede que entrega o binário.

### 1.4 CSP desabilitada (Médio)

[tauri.conf.json:30](../src-tauri/tauri.conf.json:30) — `"csp": null` desliga toda a Content Security Policy da webview. Sem CSP, qualquer conteúdo injetado (XSS via dado de rede renderizado sem escape, por exemplo texto de loja/appinfo) pode carregar script/recurso externo sem restrição.

Correção: definir uma CSP explícita (`default-src 'self'`, liberando só os hosts realmente usados — `asset:`, endpoints de assinatura/cloud-save/updater).

### 1.5 Segredos em texto puro fora do Windows (Médio, risco futuro)

[settings.rs:170-179](../src-tauri/src/settings.rs:170) — `encrypt_secret_for_current_user`/`decrypt_secret_for_current_user` são no-op fora do Windows (grava UTF-8 puro). Hoje o app é Windows-only na prática, mas se macOS/Linux forem suportados, API key da Steam, chave Hubcap/Morrenus, token de sessão de cloud-save e cache de status de assinatura ficam gravados sem proteção, legíveis por qualquer processo local.

Correção: usar Keychain (macOS) / Secret Service (Linux) equivalente ao DPAPI já usado no Windows, antes de qualquer build não-Windows sair de teste interno.

### 1.6 `game_launch` com caminho customizado sem contenção (Baixo-Médio)

[lib.rs:1297-1345](../src-tauri/src/lib.rs:1297) — o branch de `customExePath` em `game_launch` executa um caminho local vindo do JSON de `game` só com `is_file()`/`canonicalize()`, sem checar que o executável está dentro de um diretório de instalação esperado — inconsistente com `cdndownload_launch_game`, que já faz essa contenção. Impacto baixo (exige já ter escrita local em `ghostbox-library.json`), mas é a exceção que quebra um padrão bom já estabelecido no resto do código.

Correção: aplicar a mesma checagem `starts_with` contra diretório de instalação esperado usada em `cdndownload.rs`.

### 1.7 Confirmar enforcement de assinatura é server-side (Informativo)

`subscription.rs` cacheia `is_premium` localmente só como fallback de rede; nenhum comando Rust hoje re-valida a assinatura antes de ação premium — o enforcement real depende do worker (`ghostbox-subscriptions.hella.workers.dev`) validar o bearer token a cada request. Isso é correto em princípio, mas fora do escopo desta auditoria (que cobriu só o Rust local). Vale confirmar no lado do worker que toda rota premium (cloud-save incluso) rejeita token expirado/ausente, e não só a UI.

**Checado e sem achados**: `cdndownload.rs` (canonicalize + `starts_with` em todo path de instalação/delete/move), `cloud_save.rs` (zip-slip prevenido via `enclosed_name()`, SHA-256 nos backups), `steam_appinfo.rs` (`sanitize_install_dir` remove caracteres inválidos antes de montar path), `capabilities/default.json` (sem `shell:allow-execute`, `process:default` só expõe relaunch/exit), `shell_open_external` (allowlist estrita: `steam://` e `discord.gg`/`discord.com`).

---

## Parte 2 — Desempenho

### 2.1 I/O síncrono dentro de comandos async bloqueia o runtime (Alto)

Padrão repetido: chamadas `std::fs` síncronas direto dentro de `async fn` de comando Tauri, sem `tokio::task::spawn_blocking` — trava a worker thread do runtime async (e por consequência a resposta de IPC de todo o app) enquanto o disco responde. O próprio código já sabe corrigir isso: [catalogue.rs:1943-1948](../src-tauri/src/catalogue.rs:1943) envolve um scan comparável em `spawn_blocking` com comentário explicando o porquê — só não foi aplicado nos pontos abaixo:

- [image_cache.rs:305](../src-tauri/src/image_cache.rs:305) e [image_cache.rs:327](../src-tauri/src/image_cache.rs:327) — `resolve_library_asset_url`/`cache_image_url`, chamado do comando `cache_get_image` a cada capa não resolvida, sem cache em memória — relê e reparseia o mesmo JSON a cada chamada.
- [catalogue_cache.rs:151,157,169,175](../src-tauri/src/catalogue_cache.rs:151) — `fetch_json_with_cache` faz I/O síncrono a cada leitura/escrita de cache, disparado a cada mudança de página/busca/filtro do catálogo.
- [cloud_save.rs:155,259,480](../src-tauri/src/cloud_save.rs:155) — leitura/escrita de zip de save e listagem de diretório, síncronas dentro de handlers async.

Correção: envolver essas chamadas em `tokio::task::spawn_blocking`, seguindo o padrão já usado em `catalogue.rs:1943`.

### 2.2 `prune_expired_entries` rescaneia cache inteiro a cada refresh (Médio)

[catalogue_cache.rs:201](../src-tauri/src/catalogue_cache.rs:201) — lê e parseia **toda** entrada de cache a cada warm-refresh em vez de usar o índice de metadados já existente. Cresce linear com o cache acumulado, e bloqueia o runtime enquanto roda (mesmo problema do item 2.1).

Correção: usar o índice de metadados para decidir expiração sem reabrir/parsear cada arquivo.

### 2.3 Grid da biblioteca sem virtualização (Alto)

[GameCard.tsx:203](../src/components/ui/GameCard.tsx:203) (usado por `GameGrid`) e [LibraryPage.tsx:345](../src/pages/LibraryPage.tsx:345) — biblioteca renderiza todo jogo como nó DOM `<article>` vivo com seus próprios hooks, sem paginação nem windowing — diferente de `CataloguePage.tsx`, que é paginado no servidor. Só o carregamento de *imagem* é gated por IntersectionObserver; o custo de DOM/render não é. Usuário com biblioteca grande (centenas de jogos, comum em quem tem Steam há anos) sente isso a cada abertura da tela.

Correção: virtualização (windowing) na grid da biblioteca, mesmo padrão de outras listas grandes do app.

### 2.4 Reflow forçado a cada sort/filtro da biblioteca (Médio)

[useFlipLayout.ts:22](../src/hooks/useFlipLayout.ts:22) — com `animateLayout=true`, chama `getBoundingClientRect()` em todo card renderizado, de forma síncrona, a cada troca de ordenação/filtro/coleção — força reflow do layout inteiro antes do paint, e escala linear com o tamanho da biblioteca. Some com a virtualização do item 2.3 (menos cards no DOM = menos custo), mas é uma causa própria que vale corrigir independente.

Correção: medir só os cards visíveis, ou usar `ResizeObserver`/cache de posição em vez de recalcular tudo a cada troca.

### 2.5 Contexto único e monolítico causa re-render amplo (Médio)

[AppDataContext.tsx:442](../src/context/AppDataContext.tsx:442) — um único valor de contexto (~25 campos: favoritos, coleções, stats da Steam, config de backup, playtime, etc.) sem split. Qualquer consumidor recebe re-render em qualquer mudança de campo, inclusive de polling de fundo (stats da Steam, snapshot de playtime) que não tem relação com o que o componente realmente usa.

Correção: dividir em contextos menores por domínio (coleções, stats, backup), ou memoizar seletores por campo.

### 2.6 Resolução de capa sem batch, um invoke por card (Baixo-Médio)

`ghostboxApi.tauri.ts` — não existe comando de resolução de capa em lote; cada `GameCard` dispara seu próprio `invoke(cache_get_image)` por fonte não resolvida, multiplicando o custo do item 2.1 (I/O síncrono por chamada) pelo número de cards visíveis no primeiro paint.

Correção: comando Rust que resolve capas em lote (lista de app IDs → lista de URLs), chamado uma vez por tela em vez de por card.

**Checado e adequado**: eviction do `image_cache.rs` (limite 512MB, 30 dias, roda em thread de fundo dedicada, não no runtime async); `i18n.ts` (1179 linhas, só strings, custo de bundle desprezível); `queries/games.ts` e resolução de jogos em `AppDataContext.tsx:132` (já usam `Promise.all`/batching em vez de loop serial).

---

## Ordem sugerida de execução

| Prioridade | Item | Motivo |
|---|---|---|
| 1 | 1.1, 1.2 (LuaTools HTTP/conteúdo não validado) | Único vetor com caminho de exploração remoto (MITM) contra o processo do Steam |
| 2 | 1.4 (CSP null) | Mudança de config, baixo esforço, fecha uma classe inteira de risco |
| 3 | 1.3, 1.6 (pin de hash, contenção de path) | Mecânico, sem mudança de comportamento visível |
| 4 | 2.1, 2.2 (I/O síncrono em comando async) | Afeta responsividade do app inteiro, não só uma tela; padrão de correção já existe no código (`spawn_blocking`) |
| 5 | 2.3, 2.4 (virtualização + reflow da biblioteca) | Maior impacto percebido pelo usuário com biblioteca grande |
| 6 | 2.5, 2.6 (contexto, batch de capas) | Ganho real, mas menos urgente que os anteriores |
| — | 1.5, 1.7 | Sem ação imediata — 1.5 só importa se builds não-Windows saírem de teste interno; 1.7 é confirmação fora do escopo Rust |
