# Planejamento: Conquistas Steam offline (mesmo com Steam fechado)

Objetivo simples:  
O launcher baixa jogos e os jogos precisam reconhecer as **mesmas conquistas oficiais da Steam**.  
Não queremos criar conquistas novas.  
Queremos que funcione **mesmo com o Steam fechado**, mostrando um badge/notificação própria.

## Como funciona normalmente
O jogo chama a API Steamworks (funções como `SetAchievement`, `GetAchievement`, etc.) através da `steam_api.dll` (ou `steam_api64.dll`).  
Sem o cliente Steam aberto, essas chamadas falham.

## Solução: interceptar a API
Dá pra interceptar essas chamadas de dois jeitos principais.

### 1. Emulador completo da Steam API (recomendado – mais fácil)
Troca a `steam_api.dll` original por uma versão falsa que:
- Aceita as mesmas conquistas (mesmos nomes/IDs da Steam)
- Salva tudo localmente
- Pode mostrar notificação/badge própria
- Não precisa do Steam aberto

**Repos principais:**

- **Fork mais atualizado e ativo do Goldberg:**  
  https://github.com/Detanup01/gbe_fork  

- Ferramentas auxiliares do mesmo autor:  
  https://github.com/Detanup01/gbe_fork_tools  

- Versão mais antiga do Goldberg (referência):  
  https://github.com/GeospatialDaryl/Goldberemu  

**Ferramentas extras úteis:**
- Ver e gerenciar conquistas de emuladores:  
  https://github.com/Lanzador/Achievements  

- Notificações em tempo real para Goldberg:  
  https://github.com/50t0r25/achievement-watchdog  

### 2. Proxy DLL (mais “cirúrgico”)
Cria uma DLL que:
1. Carrega a `steam_api` original (renomeada)
2. Deixa quase tudo passar normalmente
3. Intercepta só as funções de conquista
4. Quando o jogo chama `SetAchievement`, grava localmente e mostra o badge próprio

**Exemplo de projeto que já faz proxy (só que bloqueia conquistas):**
- https://github.com/Vortyne/Steam-Achievement-Blocker  

Dá pra pegar a ideia dele e inverter: em vez de bloquear, dispara a notificação customizada.

## Como fica no launcher
1. O launcher baixa o jogo normalmente.
2. Na hora de rodar, troca (ou injeta) a `steam_api.dll` pelo emulador/proxy.
3. O jogo chama as funções oficiais da Steamworks.
4. O emulador/proxy responde, salva a conquista e mostra o badge do launcher.
5. As conquistas continuam sendo exatamente as mesmas da Steam (mesmos IDs e nomes).

## Observações importantes
- Funciona com as conquistas oficiais (não cria novas).
- Não precisa do Steam aberto.
- O caminho mais simples e estável hoje é o **gbe_fork**.
- Proxy DLL dá mais controle, mas exige mais trabalho de programação.

## Próximos passos sugeridos
1. Testar o gbe_fork em um jogo simples.
2. Ver como ele grava as conquistas (arquivo JSON local).
3. Adaptar a notificação/badge pro visual do launcher.
4. (Opcional) Criar um proxy próprio baseado no Steam-Achievement-Blocker se quiser controle total.

---

Arquivo gerado em: 24/08/2026  
Conversa original sobre interceptar Steamworks API para conquistas offline.