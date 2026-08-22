# Playbook Global de Avaliação de Segurança — Perspectiva do Atacante

## Objetivo

Este documento representa um processo mental global que eu seguiria para avaliar a segurança de praticamente qualquer jogo multiplayer.

Não parto de um jogo específico, engine específica ou plataforma específica.

Minha premissa é:

> **Eu controlo o computador onde o cliente do jogo está executando.**

Portanto, considero o cliente um ambiente potencialmente hostil e procuro descobrir:

1. O que posso observar.
2. O que posso modificar.
3. O que o servidor aceita.
4. Onde existem inconsistências.
5. Onde uma decisão importante está sendo tomada no lugar errado.

---

# FASE 0 — Definir o alvo

## Meu primeiro passo

Antes de analisar qualquer detalhe, eu separaria o sistema em categorias.

- [ ] Cliente do jogo.
- [ ] Launcher.
- [ ] Sistema de autenticação.
- [ ] Matchmaking.
- [ ] Servidor dedicado ou P2P.
- [ ] APIs.
- [ ] Banco de dados.
- [ ] Inventário.
- [ ] Economia.
- [ ] Progressão.
- [ ] Chat/social.
- [ ] Leaderboards.
- [ ] Serviços externos.
- [ ] Anti-cheat.
- [ ] Sistema de atualização.

Meu objetivo seria montar:

```text
CLIENTE
   │
   ├── Autenticação
   │
   ├── APIs
   │
   ├── Matchmaking
   │
   ├── Servidor
   │
   ├── Economia
   │
   └── Persistência
```

### Pergunta principal

> **Onde estão as fronteiras de confiança?**

---

# FASE 1 — Inventário completo

Eu começaria observando tudo que faz parte do sistema.

## Checklist

- [ ] Identificar executáveis.
- [ ] Identificar processos auxiliares.
- [ ] Identificar arquivos de configuração.
- [ ] Identificar logs.
- [ ] Identificar atualizadores.
- [ ] Identificar bibliotecas carregadas.
- [ ] Identificar serviços locais.
- [ ] Identificar conexões externas.
- [ ] Identificar domínios e endpoints.
- [ ] Identificar portas utilizadas.
- [ ] Identificar protocolos.
- [ ] Identificar dependências externas.

## Resultado esperado

Ao final, quero conseguir responder:

```text
O que existe?
Quem fala com quem?
Quem controla cada parte?
Onde cada decisão é tomada?
```

---

# FASE 2 — Criar um mapa de confiança

Agora eu classificaria cada componente.

```text
[ NÃO CONFIÁVEL ]

Cliente
Arquivos locais
Memória
Configurações
Inputs
Parâmetros
Estado informado pelo jogador

        │

        ▼

[ PARCIALMENTE CONFIÁVEL ]

Gateway
Sessão
Serviços intermediários

        │

        ▼

[ CONFIÁVEL ]

Servidor autoritativo
Backend
Banco de dados
Sistema interno de autorização
```

## Checklist

Para cada informação enviada pelo cliente:

- [ ] Quem criou esse valor?
- [ ] O cliente pode modificá-lo?
- [ ] O servidor valida?
- [ ] O servidor recalcula?
- [ ] O valor pode ser repetido?
- [ ] O valor pode chegar fora de ordem?
- [ ] O valor possui prazo de validade?

---

# FASE 3 — Mapear o fluxo normal

Antes de procurar problemas, eu entenderia o funcionamento legítimo.

## Fluxo genérico

```text
INICIAR
   │
   ▼
AUTENTICAR
   │
   ▼
CRIAR SESSÃO
   │
   ▼
ENTRAR NO MATCHMAKING
   │
   ▼
ENTRAR NA PARTIDA
   │
   ▼
EXECUTAR AÇÕES
   │
   ▼
SERVIDOR PROCESSA
   │
   ▼
PARTIDA TERMINA
   │
   ▼
RECOMPENSAS
   │
   ▼
PERSISTÊNCIA
```

## Checklist

- [ ] Registrar cada transição.
- [ ] Identificar entradas.
- [ ] Identificar respostas.
- [ ] Identificar mudanças de estado.
- [ ] Identificar operações críticas.
- [ ] Identificar operações irreversíveis.

---

# FASE 4 — Procurar confiança excessiva

Agora eu perguntaria para cada ação:

> **O que acontece se o cliente estiver mentindo?**

## Categorias prioritárias

### Movimento

- [ ] Posição.
- [ ] Velocidade.
- [ ] Teleporte.
- [ ] Colisão.
- [ ] Estados impossíveis.

### Combate

- [ ] Ataques.
- [ ] Dano.
- [ ] Cadência.
- [ ] Alcance.
- [ ] Munição.
- [ ] Cooldown.

### Economia

- [ ] Moedas.
- [ ] Compras.
- [ ] Recompensas.
- [ ] Trocas.
- [ ] Inventário.

### Progressão

- [ ] XP.
- [ ] Missões.
- [ ] Achievements.
- [ ] Ranking.
- [ ] Resultados.

Minha pergunta seria sempre:

```text
CLIENTE INFORMA
        │
        ▼
SERVIDOR CONFIRMA?
        │
   ┌────┴────┐
   │         │
  NÃO       SIM
   │         │
Risco    Mais seguro
```

---

# FASE 5 — Testar estados inesperados

Eu não assumiria que o sistema sempre será usado na ordem planejada.

## Checklist global

- [ ] Repetir ações.
- [ ] Interromper ações.
- [ ] Reconectar.
- [ ] Encerrar o cliente.
- [ ] Executar ações simultâneas.
- [ ] Trocar de sessão.
- [ ] Alterar de estado rapidamente.
- [ ] Voltar para estados anteriores.
- [ ] Tentar ações fora da sequência normal.

Meu objetivo seria encontrar:

```text
ESTADO A
   │
AÇÃO
   │
   ▼
ESTADO B
   │
INTERRUPÇÃO
   │
   ▼
ESTADO DESCONHECIDO
```

---

# FASE 6 — Avaliar autenticação

Eu analisaria se a identidade realmente é validada por um componente confiável.

## Checklist

- [ ] Como uma sessão é criada?
- [ ] Quanto tempo ela dura?
- [ ] Como ela expira?
- [ ] O servidor valida a sessão?
- [ ] Sessões antigas são invalidadas?
- [ ] Duas sessões podem coexistir?
- [ ] Uma ação está vinculada ao usuário correto?
- [ ] O backend verifica autorização em operações críticas?
- [ ] Existe proteção contra reutilização indevida?

## Regra de avaliação

```text
CLIENTE DECLARA IDENTIDADE
        │
        ▼
BACKEND VALIDA?
        │
   ┌────┴─────┐
   │          │
  NÃO        SIM
   │          │
CRÍTICO     OK
```

---

# FASE 7 — Avaliar integridade

Eu assumiria que o cliente pode ser alterado.

Portanto, não perguntaria:

> "É possível modificar o cliente?"

Eu assumiria que sim.

Minha pergunta seria:

> **O que acontece quando um cliente alterado conversa com o servidor?**

## Checklist

- [ ] O servidor detecta versões incompatíveis?
- [ ] O protocolo possui validação?
- [ ] Estados impossíveis são rejeitados?
- [ ] O servidor recalcula informações críticas?
- [ ] A alteração do cliente permite alterar o backend?
- [ ] O sistema depende exclusivamente de proteção local?

---

# FASE 8 — Avaliar mensagens e ações

Para cada tipo de ação:

```text
AÇÃO
 │
 ├── Quem pode enviar?
 ├── Quando pode enviar?
 ├── Quantas vezes?
 ├── Em qual estado?
 ├── Qual o limite?
 └── Como o servidor valida?
```

## Checklist

- [ ] Validação de schema.
- [ ] Validação de tipo.
- [ ] Validação de tamanho.
- [ ] Validação de estado.
- [ ] Validação de autorização.
- [ ] Rate limiting.
- [ ] Proteção contra repetição.
- [ ] Ordem correta de eventos.

---

# FASE 9 — Procurar condições de corrida

Eu tentaria descobrir se duas operações simultâneas produzem resultados inconsistentes.

## Checklist

- [ ] Duas compras simultâneas.
- [ ] Duas recompensas simultâneas.
- [ ] Duas sessões.
- [ ] Reconexão durante atualização.
- [ ] Operações concorrentes no inventário.
- [ ] Operações concorrentes sobre o mesmo recurso.
- [ ] Confirmação duplicada.

O cenário que eu procuraria:

```text
REQUEST A ─────┐
               ├──► BACKEND
REQUEST B ─────┘

Ambas acreditam que possuem
o mesmo estado inicial.
```

---

# FASE 10 — Avaliar economia

Se existe qualquer recurso com valor, eu trataria como alvo prioritário.

## Checklist

- [ ] Como recursos são criados?
- [ ] Como recursos são removidos?
- [ ] Existe histórico?
- [ ] Existe ID único por transação?
- [ ] Operações são idempotentes?
- [ ] Uma recompensa pode ser processada novamente?
- [ ] Existe rollback?
- [ ] O saldo é recalculável?
- [ ] O servidor é a fonte da verdade?

---

# FASE 11 — Avaliar automação

Mesmo sem modificar nada, eu tentaria descobrir se o sistema pode ser abusado em escala.

## Checklist

- [ ] Ações repetitivas.
- [ ] Criação de contas.
- [ ] Matchmaking.
- [ ] Chat.
- [ ] Recompensas.
- [ ] APIs.
- [ ] Leaderboards.
- [ ] Operações caras.

Para cada uma:

```text
AÇÃO
 │
 ▼
QUAL É O LIMITE?
 │
 ▼
EXISTE RATE LIMIT?
 │
 ▼
EXISTE DETECÇÃO COMPORTAMENTAL?
```

---

# FASE 12 — Procurar inconsistências entre sistemas

Eu compararia:

```text
CLIENTE
  ≠
SERVIDOR
  ≠
BANCO DE DADOS
  ≠
CACHE
  ≠
SERVIÇO EXTERNO
```

## Checklist

- [ ] O que acontece após desconexão?
- [ ] O que acontece após timeout?
- [ ] O que acontece após retry?
- [ ] O que acontece após uma operação parcialmente concluída?
- [ ] O que acontece quando dois sistemas discordam?
- [ ] Qual sistema vence?

Meu alvo seria encontrar inconsistências persistentes.

---

# FASE 13 — Classificar os achados

Para cada problema encontrado:

```text
ID:
COMPONENTE:
AÇÃO:
PRÉ-CONDIÇÃO:
IMPACTO:
REPRODUTIBILIDADE:
DETECÇÃO:
MITIGAÇÃO:
SEVERIDADE:
```

## Classificação

### Crítico

- Compromete identidade.
- Permite alterar estado persistente.
- Permite modificar economia.
- Permite afetar outros jogadores.

### Alto

- Permite vantagem significativa.
- Permite manipular partidas.
- Permite abusar de recursos.

### Médio

- Permite inconsistências.
- Pode causar degradação.
- Exige condições específicas.

### Baixo

- Impacto limitado.
- Sem persistência.
- Facilmente detectável.

---

# FASE 14 — Meu ciclo de ataque

O processo seria contínuo:

```text
MAPEAR
   │
   ▼
ENTENDER
   │
   ▼
QUESTIONAR
   │
   ▼
TESTAR COMPORTAMENTO ANÔMALO
   │
   ▼
OBSERVAR
   │
   ▼
DOCUMENTAR
   │
   ▼
MEDIR IMPACTO
   │
   └───────────────┐
                   │
                   ▼
                 MAPEAR
```

---

# Minha ordem global de prioridade

Se eu estivesse analisando qualquer jogo multiplayer, seguiria esta ordem:

- [ ] 1. Entender arquitetura.
- [ ] 2. Mapear fronteiras de confiança.
- [ ] 3. Mapear autenticação.
- [ ] 4. Identificar decisões controladas pelo cliente.
- [ ] 5. Avaliar validação do servidor.
- [ ] 6. Testar estados inesperados.
- [ ] 7. Avaliar concorrência.
- [ ] 8. Avaliar economia.
- [ ] 9. Avaliar repetição de ações.
- [ ] 10. Avaliar automação.
- [ ] 11. Avaliar inconsistências.
- [ ] 12. Classificar impacto.
- [ ] 13. Documentar evidências.
- [ ] 14. Repetir após cada atualização.

---

# Princípio central

Se eu fosse o atacante, minha pergunta nunca seria apenas:

> **"Como eu quebro essa proteção?"**

Minha pergunta seria:

> **"Onde o sistema está assumindo que eu vou me comportar corretamente?"**

Todo lugar onde a resposta for:

```text
"O cliente não faria isso"
```

viraria um ponto prioritário de investigação.

---

# Tradução direta para defesa

Se eu fosse o desenvolvedor lendo este playbook, trataria cada item como uma pergunta de segurança:

```text
O cliente pode mentir?
→ Validar no servidor.

A ação pode ser repetida?
→ Usar idempotência e proteção contra replay.

Duas ações podem ocorrer ao mesmo tempo?
→ Controlar concorrência.

O cliente pode ser modificado?
→ Não confiar nele para decisões críticas.

A sessão pode ser abusada?
→ Validar autenticação e autorização continuamente.

O estado pode ficar inconsistente?
→ Criar reconciliação e auditoria.

Uma ação pode ser automatizada?
→ Rate limit e análise comportamental.
```

## Regra final

> **O atacante controla o cliente. O servidor deve controlar a verdade.**