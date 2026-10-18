# GhostBox

Aplicativo desktop (Tauri + React) para gerenciar sua biblioteca Steam pessoal: catálogo, saves (via Ludusavi), conquistas, calendário pessoal, recomendações e um plano Premium opcional (Stripe) com backup/restore de saves na nuvem.

> **Aviso legal:** GhostBox é uma ferramenta de biblioteca e gerenciamento de progresso para jogos e apps que o usuário já está autorizado a executar. Não vende, distribui, fornece acesso ou modifica jogos. Veja [POLICIES.md](POLICIES.md).

## Arquitetura

- **Frontend**: React + TypeScript + Vite, rodando dentro do shell Tauri (Rust).
- **Backend local (Rust, `src-tauri/`)**: leitura da instalação Steam local (appinfo, appcache, manifests, paths), saves via `ludusavi` (binário externo empacotado), backup/cloud save, monitor de conquistas, ciclo de vida da janela.
- **Backend remoto (Cloudflare Workers, `workers/`)**: proxies para `catalogue`, `steam-details`, `steam-stats`, `subscriptions` (Stripe) e `feedback`/updater. Mantêm a chave da Steam Web API fora do desktop e adicionam cache/fallback para o Steam Store público.
- **Design system**: documentado em [design.md](design.md) — tokens em `src/styles/_primitives.scss` e `src/styles/_semantic.scss`, validados por `npm run check:tokens`.

## Setup

Pré-requisitos: Node 22+, Rust (toolchain estável), .NET SDK 8 para o worker de downloads e as dependências do [Tauri v2](https://v2.tauri.app/start/prerequisites/) para Windows.

```bash
npm install
npm run tauri:dev
```

O app não exige uma chave da Steam Web API no desktop: ele usa os proxies dos Workers primeiro e cai para os endpoints públicos do Steam Store quando o proxy retorna dado incompleto.

### Downloads pelo launcher

- Adicione o jogo à biblioteca e use **Baixar** na página dele. A ação **Adicionar** continua sem iniciar downloads automaticamente.
- Escolha uma pasta; a instalação usa `<pasta>\steamapps\common\<installdir>`. A aba **Downloads** permite acompanhar progresso, pausar, retomar, reordenar a fila e consultar o histórico.
- Em **Ajustes → Downloads**, selecione um disco/biblioteca Steam com indicação de espaço livre ou escolha uma pasta personalizada. Discos sem biblioteca usam `GhostBoxLibrary`; a escolha é compartilhada com o painel e só afeta novos downloads.
- Ao reabrir o launcher, tarefas interrompidas voltam **pausadas**. A retomada valida e reaproveita os chunks em disco.
- O download nativo baixa todos os depots selecionados, sem o limite do bootstrap. Ainda depende dos manifests/chaves disponíveis na instalação Steam configurada e do acesso autorizado ao conteúdo.
- A integração final grava o appmanifest Steam. Caso o registro da biblioteca falhe, os arquivos são preservados e o painel oferece repetir o registro; pode ser necessário fechar/reiniciar a Steam.
- Remover o registro do painel não apaga o jogo. Apagar arquivos exige confirmação separada e não remove saves externos à instalação.

O worker é compilado por `npm run sidecar:build` (também executado nos builds/dev Tauri).

### Variáveis de ambiente (opcional)

Para desenvolver contra outro deployment dos Workers:

```powershell
$env:GHOSTBOX_STEAM_STATS_API_URL="https://ghostbox-steam-stats.hella.workers.dev"
$env:GHOSTBOX_STEAM_DETAILS_PROXY_URL="https://piratebox-steam-details.hella.workers.dev"
npm run tauri:dev
```

**Nunca** commitar a Steam Web API key nem colocá-la em `.env` do desktop — ela vive só como secret do Worker `steam-stats`:

```powershell
wrangler secret put STEAM_WEB_API_KEY --config workers/steam-stats/wrangler.toml
wrangler deploy --config workers/steam-stats/wrangler.toml
```

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` / `npm run tauri:dev` | Sobe o frontend (Vite) / o app Tauri completo em modo dev |
| `npm run build` | `check:tokens` + `tsc` + `vite build` (gate local antes de empacotar) |
| `npm run tauri:build` | Build de produção do instalador |
| `npm test` / `npm run test:watch` | Roda a suíte Vitest |
| `npm run check:tokens` | Valida uso de tokens de design (sem hex cru em componentes) |
| `npm run site:dev` / `site:build` | Site público (`GhostBoxSite/`) |

## Testes e CI

- Suíte de testes em `tests/` (Vitest) cobre layout, catálogo, hover, profile, wishlist, tipografia/tokens, entre outros.
- `.github/workflows/ci.yml` roda `check:tokens`, `tsc --noEmit` e `npm test` em push/PR para `master`.
- `.github/workflows/release.yml` builda e publica o instalador Windows (NSIS) em push para `master`.

## Estrutura de pastas (alto nível)

```
src/            frontend React (pages, components, utils, i18n)
src-tauri/      backend Rust (comandos Tauri, integrações Steam/Ludusavi)
workers/        Cloudflare Workers (proxies e Stripe)
scripts/        scripts de manutenção (check-tokens, set-release-version, etc.)
tests/          testes Vitest
docs/email-templates/  fonte versionada dos templates de e-mail (Firebase Console)
```

## Documentação relacionada

- [design.md](design.md) — design system e tokens.
- [POLICIES.md](POLICIES.md) — Termos, Privacidade e Reembolso.
- [AGENTS.md](AGENTS.md) — convenções para trabalhar no código com agentes/IA.
- [Referências e Links dos Repositórios.md](./Refer%C3%AAncias%20e%20Links%20dos%20Reposit%C3%B3rios.md) — providers de manifest usados no catálogo.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
