# sidecars

## steamkit-poc

Worker de download de depots da Steam. O GhostBox o executa em modo `--worker`
(`src-tauri/src/cdndownload.rs`), falando JSON por linha via stdin/stdout.

### Build e empacotamento

O `.csproj` usa o projeto em
`..\depotdownloader-mod\DepotDownloader\DepotDownloaderMod.csproj` quando ele
existe. Como esse fork nao faz parte deste repositorio, o clone normal compila
contra o `DepotDownloaderMod.dll` preservado em `lib/`.

O script `npm run sidecar:build` publica o worker para Windows x64 em
`sidecars/steamkit-worker/` como executavel self-contained e single-file. O
Tauri inclui esse diretorio em `steamkit-worker/`, portanto o app instalado nao
depende de um runtime .NET presente na maquina do usuario.

O worker continua usando o fork binário de DepotDownloader, mas o código de
orquestração e conexão em `steamkit-poc` é recompilável. O lado Rust controla o
destino entregue ao worker e tudo que acontece depois do download.

### Licenca

`DepotDownloaderMod` deriva do DepotDownloader (GPL). A licenca em
`steamkit-poc/LICENSE` acompanha o worker publicado.

### Protocolo do worker

Comandos aceitos em stdin (um objeto JSON por linha):

- `{"Type":"inspectDepot","AppId":<u32>,"DepotId":<u32>,"ManifestId":<u64>,"SteamPath":"..."}`
  — le o manifest do disco e responde com o evento
  `{"Type":"depot-inspected","AppId":<u32>,"DepotId":<u32>,"TotalBytes":<u64>}`.
  `TotalBytes` e a soma do `UncompressedLength` de todos os chunks, usada pelo
  Rust para calcular o tamanho total antes de iniciar o download.
- `{"Type":"downloadDepot","AppId":<u32>,"DepotId":<u32>,"ManifestId":<u64>,"SteamPath":"...","OutputDir":"...","ParallelChunks":<i32>,"MaxDownloadBytes":<u64>}`
  — `ParallelChunks` e opcional (default `32`, que e tambem o teto).
  `MaxDownloadBytes` limita o total de chunks completos validados/baixados;
  zero ou ausente baixa o depot inteiro. Ao atingir o limite, o worker responde
  `partial-complete` em vez de tratar o corte como erro. Se ja houver download
  ativo para o mesmo `AppId`, ele e cancelado antes de o novo comecar.
- `{"Type":"cancelDownload","AppId":<u32>}` e `{"Type":"pauseDownload","AppId":<u32>}`
  — tratados de forma identica: cancelam o download ativo daquele `AppId`.
- `{"Type":"shutdown"}` — cancela todos os downloads ativos, encerra a sessao
  Steam e termina o loop do worker.

Qualquer linha com um `Type` desconhecido e ignorada em silencio. Erros ao
processar um comando viram o evento
`{"Type":"error","Status":"worker-command-failed","Message":"..."}`.

O worker exige que `<SteamPath>/depotcache/<DepotId>_<ManifestId>.manifest` ja
exista em disco — ou seja, `luatools_add_game` precisa ter rodado antes.
