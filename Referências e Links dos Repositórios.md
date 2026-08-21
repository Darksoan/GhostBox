# Referências e Links dos Repositórios

Esta seção reúne os repositórios, APIs e projetos identificados durante a pesquisa.

---

## 1. SteamTools.games / ManifestHub3

### Repositório principal

[steamtools-games/ManifestHub3](https://github.com/steamtools-games/ManifestHub3?utm_source=chatgpt.com)

Projeto utilizado como camada de dados para o SteamTools.games.

Principais arquivos:

- `depotkeys.json`
- `appaccesstokens.json`
- branches organizadas por AppID
- dados utilizados para geração de manifests
- suporte à geração de `.lua`
- suporte à geração de `key.vdf`

O projeto documenta uma API pública sem necessidade de autenticação, incluindo endpoints de busca e geração.

### Site/API

[SteamTools.games](https://steamtools.games/?utm_source=chatgpt.com)

### Documentação da API

[SteamTools.games Developers](https://steamtools.games/developers?utm_source=chatgpt.com)

---

# 2. sadabx / ManifestHub

### Repositório

[sadabx/ManifestHub](https://github.com/sadabx/ManifestHub?utm_source=chatgpt.com)

Esse projeto é especialmente importante porque documenta várias fontes externas utilizadas para resolver dados.

Entre as fontes utilizadas estão:

- `api.steamcmd.net`
- `fylsdy/ManifestHub`
- `qwe213312/k25FCdfEOoEJ42S6`
- `SSMGAlt/ManifestHub2`

O projeto funciona como uma boa referência arquitetural para construir um sistema de múltiplos providers.

---

# 3. SSMGAlt / ManifestHub2

### Repositório

[SSMGAlt/ManifestHub2](https://github.com/SSMGAlt/ManifestHub2?utm_source=chatgpt.com)

Fork do banco original ManifestHub.

Contém:

- `appaccesstokens.json`
- `depotkeys.json`
- dados de manifests
- API para consulta de manifests

O README também documenta uma API baseada em:

```text
depotId
+
manifestId
+
API Key
```

A API documentada utiliza uma chave temporária.

---

# 4. SteamTools-Team / GameList

### Repositório

[SteamTools-Team/GameList](https://github.com/SteamTools-Team/GameList?utm_source=chatgpt.com)

Esse repositório contém o `games.json` utilizado pelo ecossistema SteamTools.

Pode ser útil como fonte adicional para:

- descoberta de jogos;
- mapeamento de nomes;
- AppIDs;
- integração com o ecossistema SteamTools.

O repositório é atualizado regularmente e faz parte da organização SteamTools-Team.

### Organização SteamTools-Team

[SteamTools-Team no GitHub](https://github.com/SteamTools-Team?utm_source=chatgpt.com)

---

# 5. Fontes externas utilizadas pelo ManifestHub

O repositório `sadabx/ManifestHub` documenta outras fontes que devem ser investigadas individualmente e potencialmente adicionadas como providers.

## SteamCMD API

```text
https://api.steamcmd.net
```

Pode ser utilizada para descobrir informações atualizadas sobre aplicações, depots e manifests.

## fylsdy / ManifestHub

```text
https://github.com/fylsdy/ManifestHub
```

Referenciado como fonte de:

```text
depotkeys.json
```

## qwe213312 / k25FCdfEOoEJ42S6

```text
https://github.com/qwe213312/k25FCdfEOoEJ42S6
```

Referenciado pelo projeto ManifestHub como repositório contendo arquivos `.manifest`.

## SSMGAlt / ManifestHub2

[SSMGAlt/ManifestHub2](https://github.com/SSMGAlt/ManifestHub2?utm_source=chatgpt.com)

Utilizado como arquivo/backup legado.

A arquitetura do ManifestHub confirma essas fontes como parte do sistema de agregação de dados.

---

# 6. Mirrors e forks adicionais

Além do repositório principal, existem forks e mirrors que podem ser utilizados como redundância.

## youxiya / ManifestHub2

```text
https://github.com/youxiya/ManifestHub2
```

Fork do:

```text
SSMGAlt/ManifestHub2
```

## youxiya / ManifestHub

```text
https://github.com/youxiya/ManifestHub
```

Fork relacionado ao banco ManifestHub.

Esses mirrors podem ser utilizados dentro de uma lista de fallback, desde que sejam testados individualmente para verificar disponibilidade e atualização dos dados.

---

# 7. Arquitetura de fontes recomendada

A lista de providers pode ser estruturada da seguinte forma:

```text
SteamCMD Metadata Provider
│
├── SteamTools.games
│   ├── https://steamtools.games
│   └── https://github.com/steamtools-games/ManifestHub3
│
├── ManifestHub Providers
│   ├── https://github.com/sadabx/ManifestHub
│   ├── https://github.com/SSMGAlt/ManifestHub2
│   ├── https://github.com/youxiya/ManifestHub2
│   └── https://github.com/youxiya/ManifestHub
│
├── External Manifest Sources
│   ├── https://github.com/fylsdy/ManifestHub
│   └── https://github.com/qwe213312/k25FCdfEOoEJ42S6
│
└── SteamTools Metadata
    └── https://github.com/SteamTools-Team/GameList
```

---

# 8. Prioridade inicial sugerida

## Tier 1 — Fontes principais

1. [SteamTools.games / ManifestHub3](https://github.com/steamtools-games/ManifestHub3?utm_source=chatgpt.com)
2. `https://api.steamcmd.net`
3. [SSMGAlt/ManifestHub2](https://github.com/SSMGAlt/ManifestHub2?utm_source=chatgpt.com)

## Tier 2 — Fontes secundárias

4. [sadabx/ManifestHub](https://github.com/sadabx/ManifestHub?utm_source=chatgpt.com)
5. `https://github.com/qwe213312/k25FCdfEOoEJ42S6`
6. `https://github.com/fylsdy/ManifestHub`

## Tier 3 — Mirrors/Fallback

7. `https://github.com/youxiya/ManifestHub2`
8. `https://github.com/youxiya/ManifestHub`

---

# 9. Fontes que devem receber testes automatizados

Antes de integrar qualquer fonte como provider oficial, executar testes usando o AppID:

```text
2713000
```

E validar:

```text
AppID: 2713000
        │
        ▼
Descoberta de Depot
        │
        ▼
Descoberta de Manifest
        │
        ▼
Teste de cada URL
        │
        ├── HTTP 200?
        ├── Conteúdo válido?
        ├── Manifest utilizável?
        ├── Lua disponível?
        ├── Key disponível?
        └── Tempo de resposta?
```

Cada resultado deve ser armazenado para determinar a prioridade real dos providers.

---

# Links resumidos

| Projeto | Link |
|---|---|
| ManifestHub3 | [GitHub](https://github.com/steamtools-games/ManifestHub3?utm_source=chatgpt.com) |
| ManifestHub | [GitHub](https://github.com/sadabx/ManifestHub?utm_source=chatgpt.com) |
| ManifestHub2 | [GitHub](https://github.com/SSMGAlt/ManifestHub2?utm_source=chatgpt.com) |
| SteamTools GameList | [GitHub](https://github.com/SteamTools-Team/GameList?utm_source=chatgpt.com) |
| SteamTools.games | [Website](https://steamtools.games/?utm_source=chatgpt.com) |
| SteamTools API Docs | [Developers](https://steamtools.games/developers?utm_source=chatgpt.com) |
| SteamCMD API | [API](https://api.steamcmd.net/?utm_source=chatgpt.com) |
| youxiya/ManifestHub2 | [GitHub](https://github.com/youxiya/ManifestHub2?utm_source=chatgpt.com) |
| youxiya/ManifestHub | [GitHub](https://github.com/youxiya/ManifestHub?utm_source=chatgpt.com) |
| fylsdy/ManifestHub | [GitHub](https://github.com/fylsdy/ManifestHub?utm_source=chatgpt.com) |
| qwe213312/k25FCdfEOoEJ42S6 | [GitHub](https://github.com/qwe213312/k25FCdfEOoEJ42S6?utm_source=chatgpt.com) |