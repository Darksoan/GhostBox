Quero implementar um sistema completo de assinaturas (Ghost Premium) no Ghostbox.
Planos disponíveis:

Plano Mensal: R$ 6,99/mês
Plano Trimestral: R$ 14,99 a cada 3 meses (equivalente a R$ 4,99/mês → economia de R$ 5,98 a cada 3 meses)

Requisitos funcionais:

Modal de Assinatura (Principal)
Criar um modal bonito e dedicado para exibir os planos de assinatura.
O modal deve mostrar claramente:
Comparação entre os dois planos (tabela ou cards lado a lado)
Preços com destaque
Economia oferecida no plano trimestral
Lista de benefícios do Ghost Premium (com ícones)
Botão destacado "Assinar agora" para cada plano


Fluxo de Ativação
Ao clicar na aba "Backup" no menu lateral, se o usuário não for premium, deve abrir automaticamente o Modal de Assinatura.
Adicionar uma aba chamada "Assinatura" dentro da seção Ajustes do app.

Integração com SumUp
Integrar o checkout via SumUp API.
Suportar pagamentos via cartão de crédito, Pix e boleto (quando disponível).
Implementar verificação robusta de pagamento (webhook + polling de status).
Após pagamento confirmado, ativar imediatamente o status Premium do usuário.
Tratar casos de falha, reembolso e renovação automática.


Requisitos técnicos e de UX:

O status de assinatura deve ser salvo no backend e sincronizado com o app.
Incluir tela de "Gerenciar Assinatura" (ver plano atual, data de renovação, cancelar, etc).
Tratar edge cases: pagamento pendente, cartão recusado, erro de conexão, etc.


Me pergunte qualquer coisa antes de validar e implementar, se caso tiver alguma minima duvida.

---

# ANÁLISE TÉCNICA — Dependências e Observações (preencher antes de implementar)

> Revisão feita contra o codebase real (GhostBox / Tauri 2 + React 18 + Rust).
> Resumo: o app hoje é 100% local; vários requisitos do plano dependem de
> infraestrutura que ainda NÃO existe. Anotado aqui para retomarmos depois.

## 1. Estado atual do codebase (fatos verificados)

- App desktop **100% local**. Frontend React 18 + TS (Vite, Tanstack Query,
  Framer Motion, SCSS); backend **Tauri 2 / Rust**.
- **Não existe servidor backend** próprio: sem Node/API, sem banco de dados,
  sem endpoint HTTP público. Toda persistência é:
  - Arquivos JSON no `app_data_dir` via `src-tauri/src/settings.rs`
    (ex.: `startup-settings.json`, `notification-settings.json`).
  - `localStorage` no frontend (ex.: drafts de Ajustes em `SettingsPage.tsx`).
- **Autenticação é Steam OpenID e é OPCIONAL.** `steamProfile` pode ser `null`.
  Única identidade disponível é o `steamId`. Não há conta própria / e-mail /
  senha. (`src-tauri/src/steam.rs`, `src/context/AppDataContext.tsx`.)
- Já existe padrão de **criptografia de segredo local** com Windows DPAPI em
  `settings.rs` (usado na API key do Hubcap's) — reaproveitável para cache de
  token, mas NÃO para a secret key da SumUp.

## 2. Pontos de integração no app (onde mexer)

- Navegação / aba lateral "Backup": array `navigation` em
  `src/components/layout/Sidebar.tsx` (linha ~29) e tipo `Page` em
  `src/types/index.ts`. A página "backup" já existe (`src/pages/BackupPage.tsx`)
  e é roteada em `src/components/routing/PageRouter.tsx`.
- Abas de Ajustes: `src/features/settings/settingsTabsShared.ts`
  (`SettingsTabId`, `settingsNavigationTabs`, `settingsTabLabelKeys`) +
  `src/pages/SettingsPage.tsx` (`settingsTabs`, `buildTabOptions`). Adicionar a
  aba "Assinatura" aqui.
- Modais: renderizados no `PageRouter.tsx`, estado central em
  `src/context/OverlayContext.tsx`. O modal de Assinatura seguiria esse padrão
  (provavelmente um novo flag tipo `subscriptionModalOpen`).
- Gating do Backup: o clique vem de `Sidebar` -> `onNavigate("backup")` em
  `App.tsx`/`useAppNavigation`. Interceptar aqui quando `!isPremium`.
- Textos bilíngues (pt/en) via `src/i18n.ts` e `useSettings().t` — toda string
  nova precisa de pt + en.
- Tokens de design obrigatórios em `src/app.scss` (ver AGENTS.md): sem hex
  cru, sem box-shadow, usar `--accent` só como marca, etc.

## 3. BLOQUEADOR PRINCIPAL — falta backend

A integração SumUp end-to-end **não é implementável só no app desktop**.
Confirmado na doc oficial da SumUp (API de Checkouts):

1. **Secret key (Bearer) + `merchant_code` são obrigatórios** para criar
   checkouts. Essa chave **NÃO pode ser embutida no app** — binário desktop é
   descompilável; vazaria a chave e permitiria cobranças/reembolsos na conta.
   => Tem que viver num servidor.
2. **Webhook (`return_url`) precisa de endpoint HTTPS público.** App desktop
   atrás de NAT não recebe webhook de forma confiável. => Servidor.
3. **"Status salvo no backend e sincronizado"** (linha 33 do plano) pressupõe
   um backend que não existe. Sem ele, o status premium ficaria só em arquivo
   local — editável à mão pelo usuário para liberar premium de graça.
4. **Renovação automática / recorrência** exige servidor agendando cobranças
   com o mandato (`SETUP_RECURRING_PAYMENT` + mandate da SumUp).

Conclusão: **decidir a estratégia de backend é pré-requisito** de tudo que
envolva pagamento e validação real de premium.

## 4. Observações sobre métodos de pagamento

- SumUp suporta `BRL`, `PIX`, `BOLETO` e `RECURRING` na API, **mas** a conta
  do merchant precisa estar habilitada para BRL/Pix/boleto (varia por país/
  conta). Confirmar disponibilidade na conta real antes de prometer na UI.
- Pix e boleto são **pagamentos únicos** por natureza — não há auto-renovação.
  Recorrência automática só com **cartão + mandato**.

## 5. Decisões em aberto (responder antes de implementar)

- [ ] **Backend:** (a) você provê/cria um servidor próprio; (b) eu projeto o
      backend também (Node/Rust + DB + webhook); ou (c) por ora só o
      frontend/UI com status premium mockado/local.
- [ ] **Identidade do usuário:** vincular assinatura ao `steamId` (exige login
      Steam) OU criar contas próprias (e-mail) no backend.
- [ ] **Escopo de pagamento:** cartão recorrente + Pix/boleto avulso; ou só
      cartão recorrente na 1ª fase; confirmar habilitação BRL na conta SumUp.
- [ ] **Fonte da verdade do premium:** como o app valida premium offline sem
      permitir burla (ex.: token assinado pelo servidor com expiração + cache
      local criptografado via DPAPI).

## 6. Fases sugeridas (rascunho, sujeito às decisões acima)

1. **UI/Frontend (sem dependência de backend):** modal de planos, aba
   "Assinatura" em Ajustes, gating do "Backup", estado `isPremium`
   mockado/local, strings pt/en, tokens de design. Entregável e revisável já.
2. **Contrato de API + backend:** definir endpoints (criar checkout, status,
   webhook, cancelar) e implementar/conectar o servidor com a secret key.
3. **Integração real SumUp:** checkout (hosted/widget), polling + webhook,
   ativação do premium, recorrência, reembolso, edge cases (pendente, recusado,
   sem conexão).
4. **Gerenciar Assinatura:** plano atual, data de renovação, cancelar, etc.
