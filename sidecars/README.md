# sidecars

## steamkit-poc

Worker de download de depots da Steam. O GhostBox o executa em modo `--worker`
(`src-tauri/src/cdndownload.rs`), falando JSON por linha via stdin/stdout.

### Por que o binario esta versionado

`bin/Debug/net8.0/` esta commitado de proposito. O `.csproj` referencia
`..\depotdownloader-mod\DepotDownloader\DepotDownloaderMod.csproj`, e esse projeto
**nunca fez parte deste repositorio** — nao ha como recompilar o worker so com o
que esta aqui. O binario pre-compilado e a unica forma de a feature de downloads
funcionar a partir de um clone limpo.

Por isso **nao existe** script `sidecar:build` no `package.json`. Rodar
`dotnet build sidecars/steamkit-poc/steamkit-poc.csproj` falha na resolucao do
`ProjectReference`.

Consequencia pratica: o worker e tratado como dependencia binaria congelada.
Qualquer evolucao da feature de downloads deve acontecer no lado Rust
(`src-tauri/src/cdndownload.rs`, `steam_appinfo.rs`, `steam_appmanifest.rs`), que
controla o `OutputDir` entregue ao worker e tudo que acontece depois do download.

### Licenca

`DepotDownloaderMod` deriva do DepotDownloader (GPL). A licenca acompanha o
binario em `bin/Debug/net8.0/LICENSE`.

### Protocolo do worker

Comandos aceitos em stdin (um objeto JSON por linha):

- `{"Type":"downloadDepot","AppId":<u32>,"DepotId":<u32>,"ManifestId":<u64>,"SteamPath":"...","OutputDir":"...","ParallelChunks":<u32>}`
- `{"Type":"cancel","AppId":<u32>}`
- `{"Type":"shutdown"}`

O worker exige que `<SteamPath>/depotcache/<DepotId>_<ManifestId>.manifest` ja
exista em disco — ou seja, `luatools_add_game` precisa ter rodado antes.
