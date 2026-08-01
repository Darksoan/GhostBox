# Plano — Jogos baixados reconhecidos como oficiais no Steam (appmanifest)

## Problema

Hoje o download termina em:

```
E:\GhostBoxDownloads\367520\
  depot_367521\
  depot_367522\
  depot_367523\
```

Steam não enxerga nada disso. Faltam três coisas:

1. Layout de biblioteca Steam (`steamapps\common\<installdir>`) com os depots **mesclados** numa única pasta.
2. `appmanifest_<appid>.acf` em `steamapps\`.
3. A pasta raiz registrada como Steam Library em `libraryfolders.vdf`.

`src-tauri/src/cdndownload.rs:428` grava cada depot num diretório separado — é a causa raiz do item 1.

## Layout alvo

```
E:\GhostBoxDownloads\                      <- vira uma Steam Library
  libraryfolders.vdf                       (opcional, Steam recria)
  steamapps\
    appmanifest_367520.acf
    common\
      Hollow Knight\                       <- installdir do appinfo, depots mesclados
    depotcache\
      367521_<manifestid>.manifest
```

Depots do mesmo app têm caminhos relativos disjuntos — mesclar na mesma raiz é exatamente o que o Steam faz.

## Formato do ACF

```
"AppState"
{
	"appid"		"367520"
	"Universe"		"1"
	"name"		"Hollow Knight"
	"StateFlags"		"4"
	"installdir"		"Hollow Knight"
	"LastUpdated"		"<unix ts>"
	"SizeOnDisk"		"<bytes reais em disco>"
	"StagingSize"		"0"
	"buildid"		"<buildid do branch public>"
	"LastOwner"		"<steamid64 do usuário>"
	"UpdateResult"		"0"
	"BytesToDownload"		"0"
	"BytesDownloaded"		"0"
	"BytesToStage"		"0"
	"BytesStaged"		"0"
	"TargetBuildID"		"<mesmo buildid>"
	"AutoUpdateBehavior"		"1"
	"AllowOtherDownloadsWhileRunning"		"0"
	"ScheduledAutoUpdate"		"0"
	"InstalledDepots"
	{
		"367521"
		{
			"manifest"		"<manifestid>"
			"size"		"<bytes do depot>"
		}
		...
	}
	"UserConfig"
	{
		"language"		"english"
	}
	"MountedConfig"
	{
		"language"		"english"
	}
}
```

Campos críticos:

- `StateFlags` `4` = **fully installed**. Qualquer outro valor faz o Steam entrar em "update required"/"validating".
- `AutoUpdateBehavior` `1` = só atualiza quando o jogo é iniciado. Evita o Steam disparar update automático e apagar/re-baixar o conteúdo.
- `buildid` / `TargetBuildID` iguais. Se `buildid` < build atual do branch public, Steam marca update pendente.
- `InstalledDepots` deve bater com os `manifestid` realmente baixados (os mesmos pares que `resolve_depots` devolve em `cdndownload.rs:162`).
- `installdir` **tem que** ser o valor do appinfo, não o nome de exibição do jogo — o Steam resolve o executável por esse caminho.

Escrever com tabs (VDF real usa `\t\t` entre chave e valor); o parser do Steam é tolerante, mas manter o formato evita surpresa em ferramentas de terceiros.

## Etapas

### 1. Metadados do app (installdir, buildid, name)

Origem: `appinfo.vdf` (`config/installdir`, `depots/branches/public/buildid`).

- Preferir novo comando `appInfo` no worker SteamKit (`sidecars/steamkit-poc/Program.cs`, junto de `inspectDepot` na linha 150) — PICS já está autenticado ali e devolve dado fresco.
- Fallback: parse local do `appcache/appinfo.vdf` (formato binário KV, versão 0x07564429+), reaproveitando estilo de `steam_appcache.rs`.
- Fallback final: `installdir` = nome do catálogo sanitizado (remover `<>:"/\|?*`, trailing dots). Marcar no ACF com um comentário próprio não é possível — registrar em log interno do app.

### 2. Mesclar depots num único destino

Em `cdndownload.rs`:

- Resolver `installdir` **antes** do loop de download.
- Trocar `let depot_output = format!("{}\\depot_{}", ...)` (linha 428) por um destino único: `<downloads_root>\steamapps\common\<installdir>`, igual para todos os depots.
- Manter `depot_sizes` por depot (já existe) para preencher `InstalledDepots.size` e somar `SizeOnDisk`.
- Colisão de arquivo entre depots: last-write-wins, mesmo comportamento do Steam.

### 3. Escrever o ACF

Novo módulo `src-tauri/src/steam_appmanifest.rs`:

- `write_appmanifest(library_root, app_id, name, installdir, buildid, depots: &[(depot_id, manifest_id, size)], size_on_disk, last_owner) -> Result<PathBuf, String>`
- `remove_appmanifest(library_root, app_id)` — chamado junto do remove de download existente (`cdndownload.rs:280`).
- Escrita atômica: gravar `.acf.tmp` e renomear, para o Steam nunca ler arquivo pela metade.
- Só escrever ao final, quando todos os depots retornarem `complete`. Download parcial/cancelado ⇒ nenhum ACF.
- `LastOwner`: SteamID64 do usuário logado (já disponível via `steam_localconfig.rs` / `loginusers.vdf`). Sem ele, o Steam ainda monta, mas o jogo aparece "não é seu" na UI.

### 4. Registrar a pasta como Steam Library

O Steam só varre `steamapps\` de bibliotecas conhecidas.

- Ler `<Steam>\steamapps\libraryfolders.vdf` (o parser já existe em `steam.rs:1706`).
- Se `E:\GhostBoxDownloads` não estiver lá, adicionar uma entrada nova com `path`, `label` vazio, `contentid`, `totalsize`, e o bloco `apps` com `"<appid>" "<sizeondisk>"`.
- Fazer backup do `libraryfolders.vdf` antes de escrever (usar padrão de `backup.rs`).
- **Steam precisa estar fechado durante essa escrita** — o cliente reescreve o arquivo em memória ao sair e sobrescreve a alteração. Detectar processo Steam rodando e pedir para fechar.
- Alternativa sem editar VDF: instalar direto dentro de uma library já existente do usuário. Mais seguro, porém força os downloads a irem para o disco do Steam.

### 5. depotcache

Copiar os `.manifest` usados para `<library>\steamapps\depotcache\<depotid>_<manifestid>.manifest`.

Não é obrigatório para o jogo abrir, mas sem isso um "Verify integrity of game files" força re-download completo. O worker SteamKit já tem o manifest em mãos no `downloadDepot` — persistir ali.

### 6. Ownership / licença

O ACF faz o Steam **montar** o jogo; não faz ele ser **owned**. A parte de licença continua sendo o fluxo `luatools_add_game` (`luatools.rs:345`). Ordem correta na UI: adicionar lua/licença ⇒ baixar ⇒ escrever ACF ⇒ reiniciar Steam.

### 7. Refresh do cliente

Steam só relê `steamapps\` no start e em alguns eventos de library. Depois de escrever o ACF, oferecer botão "Reiniciar Steam" no modal de download concluído. `steam://` não tem URL confiável para rescan de biblioteca — restart é o caminho.

### 8. Migração dos downloads já existentes

Um comando one-shot `migrate_legacy_download(app_id)`:

- Detectar `<root>\<appid>\depot_*`.
- Mover (rename, mesmo volume ⇒ instantâneo) o conteúdo de cada `depot_*` para `<root>\steamapps\common\<installdir>`.
- Rodar o passo 3 e 4.
- Remover a pasta `<appid>` vazia.

Rodar sob demanda no primeiro launch pós-update, com dry-run logado antes de mover.

## Verificação

1. `E:\GhostBoxDownloads\steamapps\appmanifest_367520.acf` existe e abre no Notepad com `StateFlags "4"`.
2. `E:\GhostBoxDownloads\steamapps\common\Hollow Knight\hollow_knight.exe` existe (executável na raiz, não dentro de `depot_*`).
3. `libraryfolders.vdf` do Steam lista `E:\\GhostBoxDownloads` e o appid no bloco `apps`.
4. Reiniciar Steam: jogo aparece como **Installed**, botão **PLAY**, tamanho correto em Properties → Installed Files.
5. Properties → Installed Files → Verify: não deve baixar tudo de novo (valida o passo 5).
6. Desinstalar pelo Steam remove os arquivos e o ACF — confirmar que o app não recria o ACF órfão depois.

## Riscos

- Editar `libraryfolders.vdf` com Steam aberto = alteração perdida. Gate obrigatório no processo.
- `buildid` desatualizado dispara update automático que sobrescreve os arquivos. Mitigação: `AutoUpdateBehavior "1"` + buildid vindo do PICS no momento do download.
- `installdir` errado ⇒ Steam mostra instalado mas falha ao iniciar (não acha o exe). É o campo com maior custo de erro; vale um check de "existe pelo menos um `.exe` no installdir" antes de escrever o ACF.
- Se o jogo já estiver instalado de verdade em outra library, escrever um segundo ACF cria conflito. Checar todas as libraries por `appmanifest_<appid>.acf` antes (a varredura já existe em `steam.rs:1809`).
