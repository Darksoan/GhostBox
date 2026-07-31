# Plano — Acelerar download de jogos (GhostBox)

## Contexto

Download roda no sidecar C# (`steamkit-poc.exe --worker`), não no Rust nem no DepotDownloader CLI. Rust só orquestra via JSON sobre stdin/stdout.

Pipeline hoje é serial em quase todo nível:

- Frontend: 1 jogo por vez (`downloadManager.ts:209-228`)
- Rust: 1 depot por vez, bloqueando em `read_worker_event` (`cdndownload.rs:389`)
- C#: loop **por arquivo** sequencial (`SteamKitPocRunner.cs:590`), com `Task.WhenAll` drenando cada arquivo antes do próximo (`:803`)
- Semáforo de 8 chunks (`:576-577`) só paraleliza *dentro* de um arquivo — maioria dos arquivos tem 1-2 chunks, então paralelismo efetivo cai perto de 1
- Todos os chunks vão para **um único host CDN** a sessão inteira (`CDNClientPool.cs:66-69` + nunca chama `ReturnBrokenConnection` em `SteamKitPocRunner.cs:706`)

Resultado: banda muito abaixo do disponível. Objetivo é saturar o link.

## Mudanças (ordem de impacto)

### 1. Fila global de chunks (maior ganho) — `SteamKitPocRunner.cs:590-803`

Trocar "loop por arquivo → WhenAll" por um produtor/consumidor único no depot inteiro:

- Achatar todos os `(file, chunk)` do manifest numa `Channel<ChunkWorkItem>` (bounded, ~4× workers).
- N workers consomem o channel; cada um abre/reusa o `SafeFileHandle` do arquivo alvo.
- Manter `FileStream`/`RandomAccess.WriteAsync` atual (`:615-621`, `:745`) — só mover a criação dos handles para um cache `ConcurrentDictionary<string, SafeFileHandle>` com fechamento no fim do depot.
- Contabilidade de "arquivo completo" vira contador atômico de chunks restantes por arquivo, em vez do `WhenAll`.

Isso mantém o semáforo saturado independentemente do tamanho dos arquivos.

### 2. Rotação de CDN + mais conexões — `SteamKitPocRunner.cs:679-708`, `CDNClientPool.cs:32-69`

- Chamar `ReturnBrokenConnection` no catch de falha para o `nextServer` avançar.
- `GetConnection()` passar a distribuir round-robin real por worker (`Interlocked.Increment(ref nextServer)`), não fixar em um host.
- Configurar `MaxConnectionsPerServer` no `SocketsHttpHandler` do SteamKit2 (hoje default; ver `HttpClientFactory.cs:17-28` como referência) para ≥ número de workers.
- Backoff: trocar `150 * attempt` linear por exponencial com jitter, e rotacionar host antes de repetir.

### 3. Expor e elevar `ParallelChunks` — `cdndownload.rs:414-421`, `Program.cs:243`

Rust nunca envia `ParallelChunks`, então fica sempre 8. Passar no comando `downloadDepot`, default novo 24-32 (clamp já existe em `:576-577`), e expor como setting no frontend.

### 4. Verificação de resume mais barata — `SteamKitPocRunner.cs:625-660`, `:907-917`

- `ComputeAdler32` é escalar byte-a-byte com dois `%65521` por byte. Trocar por versão em blocos de 5552 bytes (módulo adiado) — padrão zlib, ~5-10× mais rápido.
- Rodar a pré-passagem de verificação em paralelo (mesmo pool), não serialmente dentro do loop de arquivos.
- Persistir um índice de chunks já validados (arquivo JSON ao lado do download) para pular releitura de disco em resumes seguidos.

### 5. Reuso de sessão entre depots — `SteamKitPocRunner.cs:530-558`

Hoje cada `downloadDepot` cria `Steam3Session` + `CDNClientPool` + `UpdateServerList()` novos, com poll de conexão de até 15 s. Cachear sessão e lista de servidores por processo worker; recriar só em falha.

### 6. Reduzir ruído de IPC/UI — `SteamKitPocRunner.cs:862-875`, `downloadManager.ts:163-167`

Não acelera bytes, mas evita travar a UI e roubar CPU no fim (depots com dezenas de milhares de arquivos):

- Remover o evento `progress` não-throttled por arquivo (`:862-875`); deixar só o throttle de 1 s (`:754-757`).
- `notifyChanged` faz `JSON.stringify` + `localStorage.setItem` da lista inteira a cada evento — debounce a persistência (~2 s) e manter só o `CustomEvent` no caminho quente.

## Arquivos críticos

- `sidecars/steamkit-poc/SteamKitPocRunner.cs` (itens 1, 2, 4, 5, 6)
- `sidecars/depotdownloader-mod/DepotDownloader/CDNClientPool.cs` (item 2)
- `src-tauri/src/cdndownload.rs` (item 3)
- `sidecars/steamkit-poc/Program.cs` (item 3)
- `src/lib/downloadManager.ts` (itens 3, 6)

## Fora de escopo

Downloads paralelos de múltiplos depots/jogos. O IPC do worker é serializado por um único `Mutex` de stdin/stdout (`cdndownload.rs:111-128`); paralelizar exige multiplexar comandos por id — trabalho separado, e itens 1+2 já devem saturar o link.

## Verificação

1. Build sidecar: `dotnet build sidecars/steamkit-poc`
2. Baixar um jogo grande (>20 GB, muitos arquivos pequenos) e medir MB/s no `DownloadsPage`; comparar com baseline atual gravado antes das mudanças.
3. Confirmar rotação de CDN: log do host por chunk deve mostrar >1 host distinto.
4. Testar resume: cancelar em ~40%, reiniciar — bytes já baixados devem ser pulados e o tempo da pré-passagem deve cair vs. hoje.
5. Verificar integridade: hash dos arquivos finais contra o manifest, para garantir que a fila global não corrompeu offsets.
6. UI: durante depot com muitos arquivos, confirmar que `DownloadsPage`/`GameModal` não travam.
