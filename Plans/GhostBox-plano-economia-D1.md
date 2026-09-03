# Plano de economia do D1

Data: 02/09/2026, horário de Brasília. Diagnóstico por consultas de leitura na Cloudflare e inspeção do código. Implementação revisada e publicada.

## Publicação concluída

- Worker: `piratebox-catalogue`, versão `381535ce-c859-425a-88a2-d4ccfa659a0d`.
- URL: https://piratebox-catalogue.hella.workers.dev
- Cron diário: `0-44/2 0 * * *` (00h00–00h44 UTC); 20 páginas e três oportunidades de recuperação/publicação. A rotina agendada não grava mais no D1.
- Snapshot inicial no KV: 20.000 jogos, com 10.898 CCUs positivos, reaproveitando a amostra existente de `2026-09-03T01:15:36.495Z`. A inicialização gravou zero linhas no D1.
- A busca `playingNow` usa `json_each` do snapshot e JOIN pela chave primária do D1, preservando filtros e paginação sem varrer a tabela inteira. Esta implementação substitui a proposta de metadados de filtragem em cache abaixo; nenhum índice ou migração foi aplicado.
- Recuperação: snapshot anterior, última versão válida em memória e leitura das amostras antigas no D1 quando o KV estiver indisponível. Coletas incompletas não substituem um snapshot válido.
- Validação: 76 testes, typecheck e sete consultas em produção, cobrindo ranking, paginação, filtros, busca, detalhe, home e estatísticas.

A economia efetiva deve ser medida após um ciclo diário completo. O restante do documento registra o diagnóstico e o planejamento original; as alternativas de atualização e indexação do D1 não foram adotadas.

## Diagnóstico confirmado

O cron da SteamSpy é o principal responsável identificado pelo consumo de gravações.

| Evidência em produção | Resultado |
| --- | ---: |
| `UPDATE games SET steamspy_ccu = ?, steamspy_owners_max = ? WHERE app_id = ?` | 95.968 execuções e **80.174 linhas gravadas** nas últimas 24h |
| UPSERT genérico de `catalogue_meta` | 309 linhas gravadas no mesmo intervalo |
| Maior operação de escrita em `ghostbox-subscriptions` | 49 linhas, em 7 uploads de saves |
| Busca por `playingNow` | **1.960.676 linhas lidas** em apenas 16 execuções |
| Catálogo atual | 111.660 jogos; 10.898 com `steamspy_ccu > 0` |
| Índice `idx_games_ccu` | Ausente em produção |
| Plano da busca por CCU | `SCAN games` e `USE TEMP B-TREE FOR ORDER BY` |

Fonte das métricas: `wrangler d1 insights`, janela móvel `--timePeriod=1d`; índices e cardinalidade consultados diretamente. Essa janela não coincide exatamente com o dia UTC do alerta. As consultas desta auditoria gravaram zero linhas; a contagem do catálogo leu 111.660 linhas.

O alerta mostra cerca de 81 mil das 100 mil gravações diárias permitidas. O limite é da conta; separar os serviços em bancos não cria uma nova franquia. O reset indicado, 03/09 às 00h UTC, corresponde a 02/09 às 21h em Brasília. `UPDATE`, `INSERT`, `DELETE` e manutenção de índices podem consumir gravações. [Regras do D1](https://developers.cloudflare.com/d1/platform/pricing/).

## Fluxo recomendado para economia máxima: snapshots no KV

Esta proposta substitui as etapas 1 e 2 abaixo quando a prioridade for eliminar as gravações da SteamSpy no D1. As etapas anteriores ficam como alternativa de intervenção menor.

```text
SteamSpy → coleta diária das 20 páginas → snapshot validado no KV
                                        ↓
                             ranking e estatísticas em cache
                                        ↓
                  D1 fornece os dados dos jogos selecionados

Steam → contagem ao vivo dos jogos exibidos → cache curto existente
```

- Fazer um ciclo diário, com requisições espaçadas conforme o limite da SteamSpy. Persistir cada página como um bloco, nunca uma chave por jogo.
- Consolidar mapa `appId → ccu/owners` e ranking ordenado em um snapshot versionado. Cursor, versão e horário da coleta também ficam fora do D1.
- Publicar somente após validar todas as páginas. Manter a versão anterior durante falhas e durante a propagação do KV; não depender de atualização atômica entre chaves. Limitar retenção das versões antigas.
- Nas listagens normais, acrescentar as estatísticas do snapshot aos jogos retornados pelo D1. Para `playingNow`, adaptar a busca para filtrar o conjunto completo antes de paginar, usando metadados compactos em cache e buscando no D1 os detalhes dos IDs selecionados. Preservar contagem, desempate e comportamento da busca textual.
- Carregar os metadados de filtragem em lote na geração do snapshot, com orçamento de leituras medido. Evitar uma varredura do D1 por requisição. Invalidar o cache correspondente quando a ingestão alterar esses metadados.
- Reutilizar a consulta ao vivo já existente em `src/hooks/useSteamPlayerCounts.ts` e na rota de detalhe. Ranking é uma amostra periódica; o número exibido pode continuar atualizado pela Steam.

**Resultado projetado:** ~80 mil gravações diárias de jogos passam a **zero gravações dessa rotina no D1** e algumas dezenas de gravações de blocos no KV por ciclo diário, mais eventuais tentativas de recuperação. Permanecem custos de leitura, requisições e cache. O KV gratuito permite 1.000 gravações e 100.000 leituras de chaves por dia, compartilhadas com seu uso existente. [Preços do KV](https://developers.cloudflare.com/kv/platform/pricing/).

Antes do deploy: verificar tamanho dos blocos, tempo de processamento e orçamento de leituras; testar filtros, paginação, jogos ausentes, mudanças de metadados e coleta incompleta. O KV tem propagação eventual, adequada ao snapshot diário, mas exige fallback para uma versão completa. [Funcionamento do KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

Publicar primeiro o consumidor com fallback, gerar e validar o primeiro snapshot e então desativar o cron que atualiza as colunas do D1. Confirmar ausência dos UPDATEs nas métricas. Esse fluxo dispensa criar o índice de CCU proposto abaixo quando todos os consumidores tiverem migrado.

## 1. Alternativa de intervenção menor: reduzir as gravações da SteamSpy

Arquivos: `workers/catalogue/wrangler.toml`, `workers/catalogue/src/steamspy.ts` e `workers/catalogue/src/index.ts`.

- Trocar o cron de `*/15 * * * *` para `0 * * * *`: 96 → 24 execuções por dia. Manter uma página por execução e as 20 páginas; o ciclo passa de 5h para 20h.
- Atualizar somente registros cujos valores mudaram, sem inserir jogos novos:

```sql
UPDATE games
SET steamspy_ccu = ?1, steamspy_owners_max = ?2
WHERE app_id = ?3
  AND (steamspy_ccu IS NOT ?1 OR steamspy_owners_max IS NOT ?2);
```

- Avançar o cursor após concluir a página, mesmo sem alterações. Só mudar `steamspySampledAt` e invalidar seu cache quando houver alterações efetivas. Falhas de fetch ou gravação não devem avançar o cursor.
- Somar `meta.rows_written` e `meta.rows_read` dos resultados, incluindo metadados, e registrar um resumo por execução nos logs existentes. O contador atual usa apenas `meta.changes`, que não representa o custo completo dos índices. [Métricas do D1](https://developers.cloudflare.com/d1/observability/metrics-analytics/).

**Economia estimada:** mantendo a distribuição atual, somente a frequência reduz as gravações de jogos de ~80 mil para ~20 mil/dia, antes de novos índices: **75%**. A condição SQL traz economia adicional, ainda não medida. São projeções, não limites garantidos.

Impacto: a ordenação por CCU e a estimativa de proprietários podem ficar até um ciclo de 20h atrás da coleta, além da defasagem da fonte. O detalhe já consulta jogadores ao vivo na Steam, com cache de 5 minutos; esse caminho permanece disponível.

## 2. Reduzir as leituras de “Jogando agora”

Implementar depois da redução do cron. A migração `workers/catalogue/migrations/0003_ccu_index.sql` contém um índice completo, ausente na produção consultada. Planejar um índice parcial compatível com o filtro já usado:

```sql
CREATE INDEX IF NOT EXISTS idx_games_ccu_positive
ON games (steamspy_ccu DESC, CAST(app_id AS INTEGER) ASC)
WHERE steamspy_ccu > 0;
```

Ele abrangeria os atuais 10.898 jogos positivos, cerca de 9,8% do catálogo. Índices parciais contêm somente as linhas que atendem ao filtro. [Documentação do SQLite](https://www.sqlite.org/partialindex.html).

Antes de aplicar, conferir o histórico de migrações e preparar uma migração que evite criar o índice completo pendente ou manter ambos. A criação do índice também precisa entrar no orçamento diário; medir em D1 local com dados representativos e reservar margem na produção.

O índice aumenta o custo das alterações de CCU. Como cenário de planejamento, uma gravação adicional por atualização elevaria os ~20 mil/dia para ~40 mil, antes da deduplicação; o índice parcial restringe as entradas mantidas. Confirmar o custo real com `meta.rows_written`.

Critério: a consulta sem filtros adicionais deve usar o novo índice, sem varredura completa nem ordenação temporária. Medir também a primeira página e a paginação mais profunda usada pelo aplicativo.

## 3. Melhorias posteriores, conforme consumo medido

- **Ingestão:** `workers/catalogue/src/index.ts:156` aceita POST sem autenticação ou limitação no código; `catalogue.ts:224` regrava o jogo, conta toda a tabela e invalida metadados. Adicionar deduplicação por conteúdo, intervalo mínimo de atualização por jogo e limite de chamadas compatível com o cliente. Não há evidência de que essa rota tenha causado o alerta atual.
- **Perfil:** `workers/subscriptions/src/index.ts:2411` apaga e reinsere coleções e favoritos em cada snapshot. Comparar conteúdo no servidor e gravar apenas diferenças, preservando ordenação e consistência. O cliente já tem debounce de 1,5s e guarda de concorrência. Baixa prioridade diante das métricas atuais.
- **Facetas:** a mudança de metadados após ingestão pode disparar reconstruções caras. Recalcular somente quando campos relevantes mudarem, se continuar aparecendo entre as maiores leituras.

## Validação e ordem de entrega

1. Testar a condição SQL em D1 local: valores iguais, alteração de CCU, alteração de proprietários, zero e jogo ausente. Na repetição idêntica, exigir zero gravações em `games`; não depender somente do mock atual de `steamspy.test.ts`.
2. Testar cursor, falha no meio da página e invalidação apenas após mudança; executar testes específicos e typecheck do Worker.
3. Publicar primeiro a redução do cron e as gravações condicionais. Comparar dias UTC completos antes/depois, separando catálogo e assinaturas.
4. Aplicar o índice parcial com margem disponível; validar plano, leituras e gravações reais. Meta operacional inicial: **menos de 50 mil gravações/dia na conta**, com espaço para picos.
5. Só priorizar ingestão/perfis/facetas se suas métricas justificarem. Não é necessário migrar de banco nem contratar outro plano para executar estas otimizações.

Para repetir a medição, no diretório de cada Worker:

```powershell
npx wrangler d1 insights piratebox-games --sort-type=sum --sort-by=writes --limit=5 --timePeriod=1d --json
npx wrangler d1 insights piratebox-games --sort-type=sum --sort-by=reads --limit=5 --timePeriod=1d --json
npx wrangler d1 insights ghostbox-subscriptions --sort-type=sum --sort-by=writes --limit=5 --timePeriod=1d --json
```

Usar Metrics → Row Metrics no painel para comparar dias UTC completos; os comandos acima mostram uma janela móvel. Esta entrega é o diagnóstico e o plano: nenhuma configuração, tabela ou rotina de produção foi alterada.
