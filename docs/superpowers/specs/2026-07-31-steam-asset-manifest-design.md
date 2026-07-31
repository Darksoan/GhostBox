# Steam asset manifest — capas, headers e ícones sem adivinhação

Data: 2026-07-31

## Problema

Jogos publicados depois da migração de assets da Steam não existem mais no caminho
clássico sem hash. `https://.../steam/apps/3602290/library_600x900_2x.jpg` devolve
404 (página de erro nginx). O asset real vive em
`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3602290/b7838add.../library_600x900_2x.jpg`.

Hoje o app adivinha: `src/utils/image.ts` monta listas de 4 a 20 URLs sem hash e
deixa o `<img>` tentar uma a uma. Cada erro custa um round-trip e, quando uma URL
errada carrega antes da certa, a capa troca na tela (flicker) — a dor principal
relatada.

O caminho de resolução que já existe (`src-tauri/src/image_cache.rs:639`) só sabe
ler `appinfo.vdf` local ou rodar `steamcmd.exe`. O caminho de ícones
(`src-tauri/src/catalogue.rs:1997`) chega a **baixar e instalar o steamcmd** para
descobrir o ícone de um item de sidebar.

## Fatos verificados contra a API/CDN real

- `IStoreBrowseService/GetItems/v1` é público, sem API key, aceita 120 appids por
  chamada (testado: 200 OK, ~20KB), responde `Cache-Control: public, max-age=120`
  e **não envia CORS** — só o Rust pode chamar, não o frontend.
- O hash é **por asset**, não por jogo. AppID 3602290: `library_capsule` =
  `b7838add…`, `header` = `6385a10d…`, `hero_capsule` = `f3b6be85…`.
- Jogos legados (413150) devolvem os mesmos campos **sem hash**
  (`"library_capsule": "library_600x900.jpg"`). O mesmo formato serve os dois
  casos: `base + valor do campo`.
- `asset_url_format` já traz o cache-buster `?t=`.
- `community_icon` só resolve como **`.jpg`** 32×32 sem alfa em
  `cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{appid}/{hash}.jpg`.
  O mesmo hash com `.ico` dá 404. O hash de `clienticon` (appinfo.vdf) é de outro
  namespace e esse sim é `.ico`, multi-resolução, com alfa.
- App inexistente volta `success: 15`, sem campo `assets`.

## Arquitetura

### Cascata de resolução (do barato para o caro)

| Nível | Fonte | Custo | Cobertura |
|---|---|---|---|
| 0 | Memória do processo | 0 | sessão atual |
| 1 | Disco `library-asset-manifest.json` + espelho em localStorage | 0 | tudo já visto, offline |
| 2 | `appinfo.vdf` local | 0 | todo app que o Steam já viu |
| 3 | `GetItems` direto do Rust, lote de 120 | 1 request Steam | tudo |
| 4 | Worker Cloudflare | só se o nível 3 falhar | rede bloqueada / Steam fora |

O worker fica fora do caminho normal: **0 requests**. O nível 4 não entra nesta
implementação; fica registrado como extensão futura.

Regime esperado: catálogo de 500 jogos novos = 5 chamadas `GetItems`, uma vez.
Depois disso, disco.

### Contenção

- Fila única com debounce de 50 ms: a viewport inteira vira um request.
- Teto de uma chamada `GetItems` a cada 250 ms; backoff exponencial em 429/5xx.
- Cache negativo (`success != 1`) por 1 h.
- Entradas do manifesto expiram em 30 dias; revalidação é lazy e nunca bloqueia
  render.

### Módulo novo: `src-tauri/src/steam_assets.rs`

Responsabilidade única: dado um conjunto de appIds, devolver o manifesto de
assets de cada um, do cache mais barato disponível.

```
manifests(app, app_ids)      -> HashMap<String, AssetManifest>
asset_url(app, app_id, file) -> Option<String>   // "library_600x900_2x.jpg" -> URL final
community_icon_url(manifest) -> Option<String>
```

`AssetManifest { base, assets: HashMap<campo, caminho>, community_icon, fetched_at_ms }`,
persistido em `library-asset-manifest.json` no `app_data_dir`.

Mapa nome-de-arquivo → campo da API:

| Arquivo | Campo |
|---|---|
| `library_600x900.jpg`, `library_capsule.jpg` | `library_capsule` |
| `library_600x900_2x.jpg`, `library_capsule_2x.jpg` | `library_capsule_2x` |
| `header.jpg` | `header` |
| `header_2x.jpg` | `header_2x` |
| `capsule_616x353.jpg` | `main_capsule` |
| `capsule_616x353_2x.jpg` | `main_capsule_2x` |
| `capsule_231x87.jpg` | `small_capsule` |
| `hero_capsule.jpg` | `hero_capsule` |
| `hero_capsule_2x.jpg` | `hero_capsule_2x` |
| `library_hero.jpg` | `library_hero` |
| `library_hero_2x.jpg` | `library_hero_2x` |

### Ícone de jogo

Mesma chamada `GetItems` já traz `community_icon` — ícone deixa de ter pipeline
próprio e não custa request extra. Ordem em `resolve_local_game_icon_urls`:

1. `clienticon` do `appinfo.vdf` → `.ico` (alfa, multi-resolução)
2. Arquivo local: `{Steam}/steam/games/{appid}.ico`, `appcache/librarycache/{appid}/icon.*`
3. `community_icon` do manifesto → `.jpg` 32×32 (degradação aceitável, sempre resolve)
4. Placeholder

A ordem entre 1 e 2 é a que já existia; ambos dão `.ico` com alfa e trocá-las é
ortogonal a este trabalho.

Removidos: `get_game_icons_from_steamcmd`, `get_game_icons_from_steamcmd_or_install`,
`resolve_missing_game_icon_urls_with_steamcmd`, `STEAMCMD_ICON_BATCH_SIZE`.
`app_is_steamtools_installed` e `app_install_steamtools` ficam — pertencem a outro fluxo.

Bug corrigido de passagem: `extract_community_icon_url_from_text`
(`catalogue.rs:1255`) monta `.ico` a partir de hash de community icon. Cada hash
passa a ser usado só com sua extensão.

O cache negativo de ícone passa a ser por nível, não por appId: os níveis 1 e 2
falham permanentemente sem Steam instalado, então marcá-los junto com o appId
impediria a reavaliação depois que o usuário instalasse o Steam. Re-tentativa
quando o mtime de `appinfo.vdf` mudar (já rastreado em `catalogue.rs:1397`).

### Frontend

Novo `src/utils/steamAssetManifest.ts`: cache em memória + localStorage, fila de
lote com debounce, dedup de requests em voo, chamada via
`ghostboxApi.getSteamAssetManifests`.

`src/utils/image.ts` passa a colocar a URL resolvida do manifesto na frente da
lista. As cadeias de adivinhação continuam existindo como fallback para quando o
manifesto ainda não chegou ou a Steam não respondeu.

Contra o flicker: enquanto o manifesto de um appId estiver pendente e não houver
nada em cache, a lista de portrait não emite candidatos landscape. Prefere
placeholder por alguns frames a emitir uma imagem horizontal que será trocada.

`useGameIconUrl` e os três consumidores (Sidebar:549, TrayMenu:17,
ProfilePage:275) mantêm assinatura e o evento `game-icon-urls-resolved`. Só a
fonte por trás muda.

## Fora de escopo

- Endpoint `/assets` no worker (nível 4).
- Proxy de bytes de imagem pelo worker.
- Ícones de conquista (`icon`/`icongray`): vêm da `ISteamUserStats` como URL
  absoluta, não passam por hash.

## Verificação

- Testes Rust do mapeamento nome→campo, da montagem de URL (com e sem hash) e do
  parse de `success: 15`.
- Checagem manual: 3602290 (migrado) e 413150 (legado) resolvem capa, header e
  ícone.
- Sem Steam instalado, ícone cai no `.jpg` e nenhuma instalação de steamcmd é
  disparada.
