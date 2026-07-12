# Relatório de Implementação: Migração para Stripe-Only Subscriptions

Este documento relata as modificações efetuadas para migrar completamente o sistema de assinaturas Premium do GhostBox do SumUp para a Stripe.

## 1. Banco de Dados (D1)
- **Nova Migração SQL**: Criada a migração [0007_stripe_subscriptions.sql](file:///e:/GhostBox/workers/subscriptions/migrations/0007_stripe_subscriptions.sql).
- **Alterações de Colunas**:
  - Tabela `subscriptions`:
    - Adicionado `stripe_subscription_id TEXT` (identificador único da assinatura Stripe).
    - Adicionado `stripe_subscription_status TEXT` (status direto da assinatura na Stripe).
    - Adicionado `cancel_at_period_end INTEGER` (booleano para controle de término do ciclo de cobrança).
  - Tabela `payments`:
    - Adicionado `stripe_checkout_session_id TEXT` (id da sessão do checkout Stripe).
    - Adicionado `stripe_invoice_id TEXT` (id da fatura associada).
    - Adicionado `stripe_payment_intent_id TEXT` (id do intento de pagamento).
    - Adicionado `stripe_subscription_id TEXT` (id da assinatura).
    - Adicionado `provider TEXT` (novos pagamentos gravam `stripe`; linhas antigas permanecem sem provider para não mascarar histórico legado).
    - Adicionado `provider_payload TEXT` (para armazenar metadados adicionais da Stripe).
- **Índices**: Criados índices específicos para acelerar buscas nas novas colunas da Stripe nas tabelas `subscriptions` e `payments`.

## 2. Cloudflare Worker (`workers/subscriptions`)
- **Limpeza do SumUp**: Removidas todas as chamadas HTTP para o SumUp, segredos de ambiente (`SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_BASE_URL`), tratamento de QR Code PIX e helpers específicos.
- **Integração com Stripe Checkout**:
  - Atualizado o endpoint `POST /subscription/checkouts` para criar uma Stripe Checkout Session no modo `subscription`.
  - Configurados os preços do sandbox para Monthly (R$ 6,99 / mês) e Quarterly (R$ 14,99 / 3 meses).
  - Passagem dos metadados necessários (`steam_id`, `plan_id`) no nível da sessão e da assinatura.
- **Tratamento de Webhooks Stripe**:
  - Implementada verificação de assinatura do cabeçalho `stripe-signature` via HMAC-SHA256 usando Web Crypto.
  - Adicionado o handler `/stripe/webhook` tratando os eventos:
    - `checkout.session.completed` (inicializa e ativa a assinatura no banco de dados local).
    - `customer.subscription.created` & `customer.subscription.updated` (atualiza período e status local da assinatura).
    - `customer.subscription.deleted` (expira o acesso do usuário no banco local).
    - `invoice.payment_succeeded` (registra a fatura paga subsequente e garante status ativo).
    - `invoice.payment_failed` (trata falhas de renovação e expira acesso se necessário).
  - Sincronização do Discord Premium Role integrada em tempo de webhook.
- **Endpoint de Refresh**: Atualizado `POST /subscription/refresh` para reconciliar as faturas e sessões diretamente com a API da Stripe em caso de atraso na entrega de webhooks.
- **Documentação**: Atualizado o arquivo [README.md](file:///e:/GhostBox/workers/subscriptions/README.md) para remover segredos obsoletos e incluir as novas chaves necessárias da Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
- **Correções pós-revisão**: `last_payment_id` passou a referenciar o id local da tabela `payments`, não a sessão Stripe; os webhooks de invoice agora reconciliam período/status da assinatura diretamente pela API da Stripe.

## 3. Rust Tauri Backend
- **Bindings**: Atualizado o struct `SubscriptionPayment` em [subscription.rs](file:///e:/GhostBox/src-tauri/src/subscription.rs) para mapear os campos Stripe adicionados à tabela D1, permitindo que a resposta do Tauri deserializada do Worker não quebre o runtime do app nativo.
- **Limpeza**: Removidos campos PIX do contrato Tauri ativo.

## 4. Frontend e Interface do Usuário
- **Simplificação de Checkout**: Removido do componente [SubscriptionPlans.tsx](file:///e:/GhostBox/src/components/subscription/SubscriptionPlans.tsx) o código de fallback que verificava código PIX manual do SumUp, dependendo inteiramente da Stripe para lidar com os fluxos e formas de pagamento.
- **Tipagens TypeScript**: Modificado [ghostboxApi.types.ts](file:///e:/GhostBox/src/lib/ghostboxApi.types.ts) adicionando os campos Stripe ao tipo global do frontend `SubscriptionPayment`.
- **Traduções (i18n)**: Modificado [i18n.ts](file:///e:/GhostBox/src/i18n.ts) substituindo todas as referências ao SumUp pela Stripe (português e inglês) nos textos explicativos de termos e processamento de pagamentos.
- **Limpeza**: Removidos campos PIX e `provider: "sumup"` dos tipos ativos do frontend.

## 5. Pendências manuais finais
- Aplicar migrations remotas com Wrangler.
- Configurar `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` no Worker.
- Configurar o webhook sandbox no Dashboard Stripe.
- Remover secrets SumUp remotos depois de confirmar o fluxo Stripe.
- Fazer deploy do Worker após as secrets estarem configuradas.
