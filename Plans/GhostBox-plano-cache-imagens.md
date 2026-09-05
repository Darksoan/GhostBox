# Plano de cache de imagens

## Objetivo

Fazer cada imagem remota ser resolvida, baixada, validada e armazenada uma unica vez por versao, independentemente de aparecer na Biblioteca, Catalogo, Home, Downloads, Perfil, notificacoes ou modais.

## Implementado nesta etapa

- escrita temporaria e substituicao segura do cache de imagens, incluindo Windows;
- protecao contra dois downloads concorrentes da mesma identidade;
- identidade de disco compartilhada entre hosts Steam e o proxy do Catalogo;
- endpoint `cache_get_images` com deduplicacao e concorrencia limitada a quatro tarefas;
- pre-resolucao frontend agrupada em um unico IPC por lote;
- indice O(1) para aliases no frontend, sem varrer o cache por card/fallback;
- limite de 4.096 imagens decodificadas mantidas no cache de sessao;
- limpeza sincronizada dos indices Rust, manifestos Steam, icones e mapas de sessao;
- cache negativo e TTL separado para imagens versionadas no Worker;
- testes Rust e Worker para as politicas novas.

## Restante do plano

Ainda ficam para uma proxima etapa o indice de metadados v2 com `ETag`/`Last-Modified`, stale-while-revalidate no cache Rust, blobs por hash do conteudo, telemetria de hits/misses e a migracao integral de todas as fontes para chaves logicas (em vez de URL).

## Estado atual

Hoje a mesma imagem pode passar por quatro caches independentes:

1. cache HTTP do WebView2;
2. cache em disco do Rust (`cache/images`), indexado pela URL completa;
3. mapas em memoria e `localStorage` (`imageSourceCache`, manifestos Steam e icones);
4. cache de borda do Worker de catalogo.

Isso ja reduz parte das requisicoes, mas nao existe uma identidade unica do asset. Hosts Steam diferentes, URL do Worker e URL direta podem representar os mesmos bytes e ocupar caches diferentes.

### Pontos concretos a corrigir

- `write_library_asset_cache_url` reescreve o JSON inteiro para cada asset. No Windows, `rename` sobre um destino existente pode falhar; alem disso, um lote gera varias reescritas sequenciais.
- `cache_resolve_steam_library_assets_batch` recebe um lote, mas resolve os itens sequencialmente.
- Downloads concorrentes do mesmo asset nao sao agrupados no Rust.
- O arquivo final e gravado diretamente; uma interrupcao pode deixar arquivo parcial tratado como hit.
- A chave do cache e o hash da URL bruta. Aliases de host e proxy duplicam o mesmo asset.
- O LRU usa `mtime`, mas carregamentos posteriores via `asset://` nao renovam necessariamente esse valor.
- A limpeza de `cache/images` nao invalida imediatamente os mapas do frontend nem inclui `steamcmd-library-asset-cache.json` e os manifestos guardados no `localStorage`.
- Falhas/404 de capas, heroes e logos nao possuem cache negativo persistente. A mesma cadeia de fallbacks pode ser repetida em varias telas.
- `loadedImageSources`, preloads bem-sucedidos e alguns mapas de sessao podem crescer durante uma navegacao longa.
- O Worker guarda sucessos, mas responde 404 sem cache e aplica a mesma politica a URLs mutaveis e assets versionados.
- Icones de jogos possuem um fluxo separado, embora sejam outra classe do mesmo problema.

## Arquitetura alvo

O Rust passa a ser a fonte de verdade do cache persistente do desktop. O WebView mantem somente estado efemero de exibicao e imagens decodificadas; o Worker continua como origin shield compartilhado.

### Identidade canonica

Criar `ImageAssetKey` por recurso logico, sem depender do host:

```text
steam:{appId}:{asset}:{version}
steam-screenshot:{hash}
steam-achievement:{appId}:{hash}
profile:{accountId}:{kind}:{version}
url:{sha256(urlNormalizada)}
```

- Normalizar aliases (`library_capsule` -> `library_600x900`) e hosts Steam equivalentes.
- Preservar variante e densidade (`header`, `header_2x`, portrait, hero, logo); nunca trocar orientacao ou qualidade na chave.
- Para URLs gerais ou assinadas, nao remover query string sem regra especifica do provedor.
- Armazenar blobs pelo hash do conteudo para que duas chaves com bytes iguais compartilhem um arquivo.

### Indice persistente

Substituir os JSONs e mapas persistentes paralelos por `cache/images/index-v2.json`, carregado uma vez e salvo com debounce:

```ts
type ImageCacheEntry = {
  key: string;
  blob: string;
  sourceUrl: string;
  contentType: string;
  size: number;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  lastAccessAt: number;
  freshUntil: number;
  staleUntil: number;
  negativeUntil?: number;
};
```

- Escrita em arquivo temporario, `flush` e substituicao atomica compativel com Windows.
- Arquivo baixado tambem usa temporario; somente resposta completa e validada vira blob final.
- Atualizacoes de `lastAccessAt` ficam em memoria e sao consolidadas, sem escrita por hit.
- Sem nova dependencia de banco: o indice JSON e suficiente para o limite atual de cache.

### API unica

Criar um comando batched:

```ts
resolveImageAssetsBatch([
  { id, key, kind, candidates, priority }
]) -> Record<id, { source, state }>
```

Comportamento:

1. hit fresco: retorna `asset://` imediatamente;
2. hit stale: retorna o arquivo local e revalida em background;
3. miss: agrupa chamadas iguais, baixa uma vez e compartilha o resultado;
4. 404 conhecido: pula a origem ate `negativeUntil`;
5. falha de rede: serve stale se existir;
6. atualizacao: grava novo blob e emite `image-cache-updated` para trocar a source sem piscar.

O lote deve remover duplicatas e executar recursos distintos com concorrencia limitada (padrao 4; configuracao atual 2/4/6). As candidatas de um mesmo recurso continuam sequenciais para preservar prioridade e evitar baixar fallbacks desnecessarios.

## Politicas por tipo

| Tipo | Fresh | Stale/offline | Cache negativo |
|---|---:|---:|---:|
| Steam com hash no caminho/manifesto | 180 dias | ate LRU remover | 1 hora |
| Screenshot/achievement com hash | 180 dias | ate LRU remover | 1 hora |
| Header/capa Steam sem versao | 24 horas | 30 dias | 30 minutos |
| Avatar/banner versionado | 30 dias | 90 dias | 10 minutos |
| Avatar/banner mutavel | 6 horas | 7 dias | 10 minutos |
| URL remota generica | 24 horas | 30 dias | 10 minutos |

Respeitar `ETag` e `Last-Modified` com `If-None-Match`/`If-Modified-Since`. Um `304` renova metadados sem regravar bytes.

Manter o teto inicial de 512 MiB. A poda usa `lastAccessAt` real, remove expirados primeiro e depois LRU. Arquivos temporarios, blobs sem entrada e entradas sem blob sao reconciliados na inicializacao.

## Cobertura por area

Todas estas areas devem usar a mesma API e a mesma chave:

- Biblioteca, Favoritos e colecoes: portrait, header e icone;
- Catalogo em grade/lista e hover preview: header e screenshots;
- Home: banners, heroes, capas, wishlist e avatares;
- detalhes do jogo: hero, logo, galeria, achievements;
- Downloads, backup, notificacoes e toasts: header/capsule/icone;
- Perfil, sidebar e edicao: avatar e banner;
- Tray: icone local/remoto do jogo.

Assets empacotados no app e `data:` URLs ficam fora do cache remoto.

## Etapas de implementacao

### P0 — Corrigir consistencia atual

Arquivos principais: `src-tauri/src/image_cache.rs`, `src-tauri/src/catalogue.rs`, `src-tauri/src/storage_audit.rs`.

- Corrigir substituicao atomica do JSON no Windows.
- Consolidar escritas do cache de URLs por lote/debounce.
- Deduplicar requisicoes no batch e processar recursos distintos com concorrencia limitada.
- Baixar em `.tmp`, validar tamanho/tipo e promover atomicamente.
- Fazer "Limpar cache" remover tambem os indices associados e notificar o frontend.

Esta etapa e independente da migracao completa e elimina risco de cache truncado, atualizacao perdida e I/O quadratico.

### P1 — Criar o cache unificado no Rust

Arquivos principais: `src-tauri/src/image_cache.rs`, `src-tauri/src/catalogue.rs`, `src/lib/ghostboxApi.tauri.ts`, `src/lib/ghostboxApi.types.ts`.

- Introduzir `ImageAssetKey`, `index-v2.json`, blobs por conteudo e metadados HTTP.
- Implementar fresh/stale, revalidacao condicional, cache negativo e single-flight.
- Implementar batch com prioridade `visible > interaction > idle`.
- Migrar entradas validas de `steamcmd-library-asset-cache.json`; ignorar com seguranca entradas orfas/corrompidas.

### P2 — Unificar o frontend

Arquivos principais: `src/utils/imageCache.ts`, `src/hooks/useCachedImageSources.ts`, `src/utils/image.ts`, `src/hooks/useGameIconUrl.ts`.

- Manter uma facade unica para resolver, preloadar, marcar uso e invalidar imagens.
- Trocar URL bruta como chave por recurso logico.
- Agrupar a viewport em um batch; nenhum card faz IPC individual.
- Manter somente caches de sessao limitados em memoria; remover os indices de arquivos do `localStorage` apos a migracao.
- Aplicar cache negativo tambem antes de montar cadeias de `Image()`.
- Cancelar/remover preloads que ainda estao na fila quando o consumidor desmontar; download ja iniciado pode terminar e popular o cache.
- Preservar as regras atuais de orientacao, densidade, `preferOrder` e carregamento progressivo.

Migrar por consumidor nesta ordem: `GameCard`/Biblioteca, Catalogo, Home, `GameModal`, Downloads/notificacoes, Perfil e por ultimo icones/Tray.

### P3 — Melhorar o Worker de imagens

Arquivos principais: `workers/catalogue/src/index.ts`, `workers/catalogue/src/cache.ts`, testes do Worker.

- Cachear 404 por 30 minutos e 5xx por no maximo 30 segundos.
- Separar politica de asset versionado (`immutable`) da URL mutavel (`stale-while-revalidate`).
- Revalidar upstream com `ETag`/`Last-Modified` quando aplicavel.
- Canonicalizar a chave sem fragmentos/parametros irrelevantes, mantendo variante e versao.
- Garantir que variantes de `Accept` nao compartilhem uma resposta incompativel.
- Expor `Age`/`x-ghostbox-image-cache: HIT|MISS|STALE|NEGATIVE` para diagnostico.

### P4 — Limpeza e observabilidade

- A tela de armazenamento deve mostrar um unico "Cache de imagens" com bytes, entradas e data da ultima poda.
- A limpeza deve zerar disco, indice Rust e caches de sessao no mesmo fluxo.
- Em desenvolvimento, registrar contadores agregados: hit fresco, hit stale, miss, 304, download, negativo, bytes baixados e bytes evitados.
- Nao registrar URLs assinadas, tokens ou dados de perfil.

## Validacao

### Testes Rust

- duas requisicoes simultaneas da mesma chave geram um download;
- aliases Steam convergem para o mesmo blob;
- arquivo parcial nunca vira hit;
- substituicao repetida do indice funciona no Windows;
- `304` renova a entrada sem alterar o blob;
- stale funciona offline;
- 404 respeita TTL negativo;
- LRU usa `lastAccessAt` e respeita 512 MiB;
- limpar cache remove blobs, indice e referencias.

### Testes frontend

- cards repetidos geram uma entrada no batch;
- Biblioteca, Home e Catalogo reutilizam a mesma chave;
- ordem/orientacao/densidade dos fallbacks nao muda;
- invalidacao e limpeza removem estado em memoria;
- mapas e sets respeitam os limites;
- preload desmontado nao ocupa a fila.

### Testes Worker

- HIT nao consulta a Steam;
- 404 repetido usa cache negativo;
- TTL de asset versionado e mutavel e correto;
- limite de tamanho continua aplicado;
- variantes de resposta possuem chaves compativeis.

### Criterios de aceite

- Segunda visita a uma tela nao faz rede para imagens ja armazenadas e ainda validas.
- O mesmo asset exibido em Biblioteca, Home e Catalogo ocupa um unico blob local.
- Uma chave possui no maximo um download em andamento.
- Recursos ausentes fazem no maximo uma tentativa por TTL negativo.
- O app abre e exibe o cache stale sem internet.
- Cache nunca ultrapassa o teto apos a poda.
- Limpar cache nao deixa `asset://` orfao nem indice divergente.

## Fora do primeiro ciclo

Geracao de thumbnails/WebP/AVIF deve ser avaliada depois das metricas do cache unificado. Ela altera qualidade, CPU e dependencias e nao e necessaria para eliminar downloads repetidos.
