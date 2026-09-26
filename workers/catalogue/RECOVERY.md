# Recuperação D1 do catálogo (v1 → v2)

## Estado inicial verificado em 2026-09-26

- Produção: Worker `piratebox-catalogue` → `piratebox-games` (`38bcabba-004a-4e75-bef0-4a1c0559f52c`); 513.740.800 bytes. Busca FTS incompleta (99.825 de 113.756 jogos), sem `searchIndexVersion`.
- Cron FTS `*/2 * * * *` removido **dos triggers em produção** sem trocar o código: `wrangler triggers deploy --name piratebox-catalogue --triggers '0-44/2 0 * * *'`. `wrangler.toml` também foi atualizado.
- Novo banco: `piratebox-games-v2` (`16334986-75dd-44a2-84c6-6c85bd97cfa4`) criado com `schema-v2.sql`. Migração em `piratebox-catalogue-migrator` (`migrator.wrangler.toml`), cron a cada cinco minutos. O Worker público **continua no banco v1**.
- A exportação integral do v1 com Wrangler excedeu 10 minutos; medidas obtidas por SQL remoto: `screenshots_json` 159 MB, `search_text` 30 MB, `genres_text+tags_text` 17 MB, conteúdo FTS 46 MB. Amostra de 25 jogos: URLs compactadas reduzem o campo screenshots em 57%; todas são reconstruídas na resposta.

## Acompanhar (somente leitura)

Executar de `workers/catalogue` (CLI `scripts/migrate-v2.mjs` requer Node 24 para importar o helper TypeScript; o Worker migrador não depende do computador):

```sh
npx wrangler d1 info piratebox-games-v2
npx wrangler d1 execute piratebox-games-v2 --remote --command "SELECT key,value FROM catalogue_meta WHERE key IN ('v2MigrationCursor','v2MigrationWriteBudget','v2MigrationPaused','searchIndexVersion'); SELECT COUNT(*) AS games FROM games;"
```

`v2MigrationWriteBudget` reserva até 60.000 escritas por dia UTC neste banco (220 por lote de 25 jogos), deixando margem para as demais bases da conta Free. O migrador lê `meta.size_after` em **cada cron** e para acima de 375.000.000 bytes; não habilitar ingestão nem promover esse banco se atingir esse patamar. Falha ou pausa fica visível nos logs e/ou na chave `v2MigrationPaused`. Não rodar `npm run migrate:v2 -- --apply` enquanto o migrador automático estiver ativo (ambos usam o mesmo cursor e orçamento).

Se o progresso parar no orçamento diário, o cron retoma no próximo dia UTC. Se houver pausa por capacidade, **não** apagar o marcador para forçar a continuação: reavaliar schema. Assim que o cursor atingir o fim da origem, o cron apenas lê o estado; a ativação é manual depois da validação.

## Ativação — apenas após copiar tudo

1. Verificar que o Worker migrador informou `complete` e que `piratebox-games-v2` tem menos de 300.000.000 bytes (`d1 info`). Checar que a origem não recebeu novos jogos após o cursor.
2. Num período com margem de leitura D1, executar `npm run migrate:v2 -- --finalize`. O comando confere contagens da origem, cobertura FTS, IDs e 12 amostras, reconstrói `totalGames` e metadados e ativa `searchIndexVersion=2` **somente** abaixo de 300 MB. Não editar manualmente a chave.
3. `npx wrangler deploy --config wrangler.v2.toml --dry-run`; confirmar binding `DB (piratebox-games-v2)`. Publicar com `npx wrangler deploy --config wrangler.v2.toml` e comparar busca, filtros, home e `/games/:id` com v1. Copiar o binding validado de `wrangler.v2.toml` para `wrangler.toml` antes dos próximos deploys normais; o arquivo padrão ainda aponta para v1.
4. Observar D1 Insights (ordenar por reads), uso de armazenamento, erros e crescimento por ao menos 48h. Voltar ao v1 via deploy compatível apenas se necessário; não publicar a versão v2 do código apontando para o schema v1 (falta `app_type`). Depois do período de rollback, remover o Worker migrador e, após backup/validação, o banco v1 para devolver armazenamento à conta.

## Orçamento permanente

- Ingestão no v2 limitada no Worker a 115.000 jogos **armazenados**, 400.000.000 bytes físicos (via `D1Result.meta.size_after`) e 25 classificações/novos jogos por dia, com máximo de 30 KB por payload. A migração traz as linhas antigas como `app_type='unclassified'`, reproduzindo a visibilidade anterior; jogos novos são classificados pela Steam e demos são rejeitadas. Não existe classificação confiável para todas as 113 mil linhas legadas na fonte v1. `storedGames` conta as linhas reais para o limite; `totalGames` só as visíveis para a UI.
- Com `searchIndexVersion` ausente/inválido, filtros ou texto retornam HTTP 503, sem consulta `LIKE` de 113 mil linhas. Listagens sem filtro usam `totalGames`, sem COUNT completo.
- Tamanho-alvo <=300 MB. Investigar a partir de 350 MB; pausar ingestão antes de 400 MB. A contagem de 115.000 é um limite adicional, não substitui observar o tamanho físico no D1.
