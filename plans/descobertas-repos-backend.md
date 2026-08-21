# Descobertas de Repositórios — Backend GhostBox

Data da pesquisa: 21/08/2026
Método: `gh search repos` (GitHub CLI, conta Darksoan), filtrado por aderência às áreas do backend (`src-tauri/src` e `workers/`).
Objetivo: mapear repositórios públicos que podem agregar usabilidade, robustez ou fontes de dados ao backend do GhostBox.

---

## Contexto do backend auditado

Áreas identificadas em `src-tauri/src`:

- Integração Steam: `steam.rs`, `steam_appcache.rs`, `steam_appinfo.rs`, `steam_appmanifest.rs`, `steam_pics.rs`, `steam_localconfig.rs`, `steam_assets.rs`
- Downloads CDN: `cdndownload.rs`, `chunk_index.rs`
- Manifests/Lua: `manifest_sources.rs`, `luatools.rs`, `luatools_bootstrap.rs`
- Saves/backup: `backup.rs`, `cloud_save.rs`, `ludusavi.rs`
- Tracking: `playtime.rs`, `achievement_monitor.rs`
- Premium: `subscription.rs`

Workers Cloudflare: `catalogue`, `feedback`, `steam-details`, `steam-stats`, `subscriptions`.

---

## 🎯 Alta aderência (áreas já existentes no backend)

### Downloads CDN / Manifests / Lua

| Repo | ⭐ | Licença | Linguagem | Agregação |
|---|---|---|---|---|
| [SteamRE/DepotDownloader](https://github.com/SteamRE/DepotDownloader) | 3.300 | GPL-2.0 | C# | Referência canônica de autenticação na CDN Steam, resolução de manifests e download de depots por chunks. Útil para validar a estratégia de chunked download/resume do `cdndownload.rs`. **GPL — apenas referência, não copiar código.** |
| [fairy-root/steam-depot-online](https://github.com/fairy-root/steam-depot-online) | 242 | MIT | Python | Busca `manifest`/`key.vdf` em repos GitHub e gera scripts `.lua` — mesmo domínio de `manifest_sources.rs` + `luatools.rs`. Bom modelo para expandir a lista de providers/mirrors. |
| [SteamRE/SteamKit](https://github.com/SteamRE/SteamKit) | 3.164 | .NET | C# | Biblioteca de interoperabilidade com a rede Steam (protocolo Steam3). Referência de protocolo para evoluções do downloader e autenticação anônima. |

### Integração Steam local

| Repo | ⭐ | Licença | Linguagem | Agregação |
|---|---|---|---|---|
| [CosmicHorrorDev/vdf-rs](https://github.com/CosmicHorrorDev/vdf-rs) | 46 | Apache-2.0 | Rust | Parsing e (de)serialização de VDF. Candidato a substituir parsing manual de `appmanifest.acf` / `localconfig.vdf` por parser testado e tipado. |
| [WilliamVenner/steamlocate-rs](https://github.com/WilliamVenner/steamlocate-rs) | 59 | MIT | Rust | Localiza instalações Steam e bibliotecas multi-plataforma (inclui Proton compat-data). Torna o `steam.rs` mais robusto com bibliotecas fora do padrão e múltiplos drives. |
| [garhow/steam-rs](https://github.com/garhow/steam-rs) | 39 | MIT | Rust | Bindings seguros da Steam Web API em Rust. Útil se chamadas hoje nos workers migrarem parcialmente para o backend Rust local. |

### Saves / Backup / Cloud sync

| Repo | ⭐ | Licença | Linguagem | Agregação |
|---|---|---|---|---|
| [mtkennerly/ludusavi-manifest](https://github.com/mtkennerly/ludusavi-manifest) | 164 | MIT | Dados | Banco atualizado de caminhos de saves de milhares de jogos. O GhostBox já integra ludusavi (`ludusavi.rs`) — consumir o manifest direto mantém a cobertura sempre atualizada. |
| [Fldicoahkiin/SteamCloudFileManager](https://github.com/Fldicoahkiin/SteamCloudFileManager) | 214 | GPL-3.0 | Rust | GUI Rust para o armazenamento remoto do Steam Cloud (download/upload/delete via árvore de arquivos). Referência para evoluir o `cloud_save.rs` em sincronização bidirecional real. **GPL — apenas referência.** |
| [selesse/steam-crossplatform-sync](https://github.com/selesse/steam-crossplatform-sync) | 19 | — | Java | Força sync de saves que o Steam não sincroniza automaticamente. Padrão útil para restore points do Premium. |
| [Drackrath/Aurelia](https://github.com/Drackrath/Aurelia) | 26 | Custom | Rust | Cliente Steam headless em Rust com saída `--json`: instala, atualiza, lança jogos; acessa Steam Cloud/Workshop/DLC/collections/friends. Praticamente um "backend Steam" completo open-source em Rust — excelente referência arquitetural. **Licença custom — verificar antes de reuso.** |

---

## 🔧 Infraestrutura

### Workers Cloudflare

| Repo | ⭐ | Agregação |
|---|---|---|
| [honojs/hono](https://github.com/honojs/hono) | 31.757 | Framework web padrão para Workers. Se os 5 workers usam handlers crus, Hono traz roteamento tipado, middleware de auth e validação (com Zod) com cold-start mínimo. |
| [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) | 1.798 | Plugins oficiais Tauri v2. Vale auditar o que falta (ex.: `tauri-plugin-notification` para alerta de download concluído). |
| [twitchtv/igdb-api-node](https://github.com/twitchtv/igdb-api-node) | 136 | Wrapper oficial IGDB em Node. Fonte de metadados adicional para o worker `catalogue` quando a Steam não cobrir (ex.: jogos removidos da loja). |

### Metadados de arte

- [SteamGridDB/SGDBoop](https://github.com/SteamGridDB/SGDBoop) (489⭐, C) e
  [SteamGridDB/steamgriddb-manager](https://github.com/SteamGridDB/steamgriddb-manager) (412⭐, JS) —
  ecossistema oficial SteamGridDB. A API deles pode enriquecer `image_cache.rs`/catálogo com hero/logo/tile quando a capa Steam estiver indisponível.

---

## ⚠️ Observações sobre licenças

1. **Não copiar código** de: `DepotDownloader` (GPL-2.0), `SteamCloudFileManager` (GPL-3.0), `Aurelia` (licença custom). Tratar como referência de protocolo/arquitetura.
2. **Integráveis diretamente** (MIT/Apache): `vdf-rs`, `steamlocate-rs`, `steam-rs`, `ludusavi-manifest`, `steam-depot-online`.
3. O `steam-depot-online` complementa a hierarquia de providers definida em
   `Referências e Links dos Repositórios.md` — ele já implementa o padrão de fallback entre mirrors GitHub de manifests.

---

## Próximos passos sugeridos

Seguindo a política de validação do doc de referências, antes de integrar qualquer provider novo:

1. Validar com AppID de teste `2713000`:
   - HTTP 200? Conteúdo válido? Manifest utilizável? Lua disponível? Key disponível? Tempo de resposta?
2. Prioridades sugeridas de avaliação:
   - **Quick win:** trocar parsing VDF manual pelo crate `vdf-rs` (Apache-2.0).
   - **Robustez:** adotar `steamlocate-rs` na detecção de bibliotecas Steam.
   - **Providers:** estudar o fluxo do `steam-depot-online` para ampliar fallbacks de manifest/lua.
   - **Workers:** avaliar migração incremental dos handlers para Hono.
