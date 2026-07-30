# Plano de implementação — SteamKit2 como backend de downloads

**Status:** proposta para revisão técnica  
**Data:** 29 de julho de 2026  
**Projeto:** launcher de jogos para PC  
**Stack conhecida:** TypeScript, Rust e SCSS  
**Objetivo:** autenticar usuários Steam e baixar jogos legitimamente licenciados sem depender do cliente gráfico `steam.exe` durante o download  
**Estratégia:** implantação incremental, mantendo o SteamCMD como fallback até o SteamKit2 atingir critérios objetivos de compatibilidade e confiabilidade

---

## 1. Resumo executivo

A implementação recomendada é adicionar o SteamKit2 por meio de um **worker .NET isolado**, controlado pelo backend Rust do launcher através de IPC local.

O frontend TypeScript/SCSS permanece responsável pela interface. O backend Rust continua como orquestrador de biblioteca, fila, estado, armazenamento e processos. O worker .NET assume exclusivamente as operações específicas da rede Steam:

- conexão e reconexão;
- autenticação por QR Code e Steam Guard;
- armazenamento protegido da sessão;
- leitura das licenças da conta;
- consulta de informações de apps, pacotes e depots;
- resolução de plataforma, arquitetura, idioma, branch e DLCs;
- obtenção de manifestos e chaves de depots;
- download de chunks por CDN;
- reconstrução e validação de arquivos;
- atualização diferencial;
- pausa, retomada e recuperação de falhas.

```text
┌─────────────────────────────────────────────────────────────┐
│ Frontend TypeScript/SCSS                                    │
│ Biblioteca, login, seleção, progresso e mensagens de erro   │
└───────────────────────────┬─────────────────────────────────┘
                            │ comandos do launcher
┌───────────────────────────▼─────────────────────────────────┐
│ Backend Rust                                                │
│ Orquestração, fila, banco local, políticas e supervisão     │
│                                                             │
│  DownloadProvider                                           │
│  ├── SteamCmdProvider  ← fallback atual                     │
│  └── SteamKitProvider                                       │
└───────────────────────────┬─────────────────────────────────┘
                            │ IPC local versionado
┌───────────────────────────▼─────────────────────────────────┐
│ Worker .NET                                                 │
│ SteamKit2 + adaptador de autenticação + motor de conteúdo   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                  Steam CM / PICS / CDN
```

### Decisão recomendada

**Adotar SteamKit2 como provedor experimental e não substituir o SteamCMD em uma única entrega.**

A ativação como provedor padrão deve ocorrer somente depois de:

1. validar acesso e download em uma matriz representativa de jogos;
2. provar atualização diferencial e retomada após interrupções;
3. estabelecer proteção adequada dos tokens;
4. medir desempenho contra o SteamCMD;
5. confirmar requisitos de licença e termos de uso;
6. implementar fallback automático ou manual;
7. garantir que falhas do worker não derrubem o launcher.

---

## 2. Contexto e motivação

O launcher já utiliza SteamCMD. O SteamCMD oferece menor esforço de manutenção de protocolo, mas limita:

- integração granular com a interface;
- eventos estruturados de progresso;
- controle de retries e seleção de CDN;
- diagnóstico de falhas;
- gerenciamento explícito de manifestos;
- planejamento de instalação antes do download;
- controle de concorrência por arquivo ou chunk;
- recuperação de operações interrompidas;
- evolução independente da interface de linha de comando.

O SteamKit2 oferece primitives de baixo nível para interagir com a rede Steam, mas transfere ao projeto responsabilidades atualmente escondidas pelo SteamCMD.

A migração deve ser avaliada como uma troca:

```text
mais controle e melhor integração
                versus
mais complexidade, manutenção e risco de incompatibilidade
```

---

## 3. Objetivos

### 3.1 Objetivos funcionais

- Login sem solicitar que o cliente gráfico da Steam esteja aberto.
- Login preferencial por QR Code usando o aplicativo móvel Steam.
- Reutilização segura de sessão em execuções futuras.
- Listagem dos jogos que a conta pode instalar.
- Validação de acesso antes de iniciar um download.
- Instalação da versão pública atual de um jogo.
- Seleção de:
  - plataforma;
  - arquitetura;
  - idioma;
  - branch;
  - DLCs;
  - diretório de instalação.
- Exibição de:
  - bytes totais;
  - bytes baixados;
  - bytes reutilizados;
  - velocidade;
  - ETA;
  - estado por depot;
  - etapa atual;
  - erro acionável.
- Pausar, retomar, cancelar, validar e atualizar.
- Sobreviver a:
  - fechamento do launcher;
  - queda de rede;
  - expiração de token;
  - indisponibilidade de CDN;
  - espaço em disco insuficiente;
  - corrupção de arquivo;
  - encerramento inesperado do worker.

### 3.2 Objetivos não funcionais

- Isolar credenciais e tokens do frontend.
- Não armazenar senha Steam.
- Não enviar sessão Steam ao backend remoto do projeto.
- Evitar logs com tokens, cookies, senhas ou URLs sensíveis.
- Manter compatibilidade reversível com SteamCMD.
- Versionar o protocolo IPC.
- Permitir substituição do worker sem migração do frontend.
- Ter testes determinísticos para o planejador e o estado local.
- Limitar o impacto de mudanças futuras da rede Steam.
- Oferecer telemetria opcional e anonimizada.
- Garantir escrita transacional dos arquivos instalados.

---

## 4. Fora de escopo da primeira versão

A primeira entrega não deve tentar implementar:

- execução de jogos sem o Steam quando o jogo exige Steamworks ou DRM;
- bypass de DRM, validação de licença ou anti-cheat;
- download de conteúdo que a conta não possui;
- Steam Cloud;
- conquistas;
- overlay;
- multiplayer;
- Workshop;
- Proton/Wine;
- compartilhamento familiar avançado;
- instalação completa de redistribuíveis;
- criação de uma instalação oficialmente reconhecida pelo cliente Steam;
- branches históricas ou manifestos antigos;
- múltiplas contas simultâneas;
- download de jogos enquanto outra sessão usa o mesmo `LoginID`;
- deduplicação global entre jogos;
- delta binário próprio além do reaproveitamento natural de chunks;
- suporte inicial a macOS e Linux.

Esses itens podem ser avaliados depois que o fluxo Windows/public branch estiver estável.

---

## 5. Premissas a confirmar antes da implementação

O agente revisor deve confirmar ou corrigir estas premissas:

- O backend principal é Rust.
- O frontend conversa apenas com o backend Rust.
- O launcher tem um sistema de fila ou estado de downloads reutilizável.
- O produto inicial é Windows x64.
- É aceitável distribuir um worker .NET self-contained.
- O usuário autoriza o dispositivo por QR Code ou Steam Guard.
- O token de sessão pode ser armazenado localmente com proteção do Windows.
- O launcher pode manter o SteamCMD empacotado durante a migração.
- O projeto aceita depender de uma biblioteca não oficial da Valve.
- Existe um canal para atualizar rapidamente o worker caso a Valve altere o protocolo.
- O produto não pretende contornar DRM nem executar jogos sem verificações exigidas.
- O usuário aceita uma indicação clara de que a integração é não oficial.

---

## 6. Decisão arquitetural

### 6.1 Opções consideradas

#### Opção A — SteamKit2 dentro do backend Rust por FFI

**Não recomendada.**

Problemas:

- mistura runtimes e ciclos de vida;
- debugging difícil;
- propagação complexa de exceções;
- risco de travamento do processo principal;
- packaging e atualização mais frágeis;
- acoplamento excessivo a tipos .NET;
- autenticação assíncrona difícil de mapear com segurança.

#### Opção B — reimplementar SteamKit2 em Rust

**Não recomendada para o escopo atual.**

Problemas:

- reimplementação extensa de protocolos;
- maior risco de segurança;
- manutenção contínua;
- duplicação do conhecimento existente;
- prazo e superfície de bugs muito maiores.

#### Opção C — worker .NET externo com IPC

**Recomendada.**

Benefícios:

- isolamento de falhas;
- uso direto das APIs do SteamKit2;
- atualização independente;
- processo encerrável pelo supervisor Rust;
- testes próprios;
- menor acoplamento de linguagem;
- fácil fallback para SteamCMD;
- possibilidade de restringir permissões e diretórios;
- protocolo interno estável mesmo quando o SteamKit2 mudar.

---

## 7. Estrutura sugerida do repositório

Adapte os nomes ao monorepo existente.

```text
/apps
  /desktop-ui
    /src
      /features/steam-auth
      /features/downloads
      /features/installations

/crates
  /launcher-core
  /download-domain
  /download-provider-steamcmd
  /download-provider-steamkit
  /steamkit-ipc
  /secure-storage
  /installation-registry

/workers
  /steamkit-worker
    /src
      /Api
      /Auth
      /Steam
      /Catalog
      /Planning
      /Content
      /Storage
      /Security
      /Diagnostics
    /tests
      /Unit
      /Contract
      /Integration

/contracts
  steamkit-ipc.schema.json
  steamkit-events.schema.json
  error-catalog.md

/docs
  steamkit-architecture.md
  steamkit-threat-model.md
  steamkit-runbook.md
  steamkit-compatibility-matrix.md
  steamkit-legal-review.md
```

---

## 8. Componentes

### 8.1 Frontend TypeScript/SCSS

Responsabilidades:

- apresentar QR Code;
- exibir estados de autenticação;
- permitir escolha de instalação;
- exibir plano antes da confirmação;
- mostrar progresso e erros;
- disponibilizar pausa, retomada e cancelamento;
- nunca receber refresh token ou credenciais;
- nunca montar comandos SteamKit2 diretamente.

Estados mínimos:

```ts
type SteamAuthUiState =
  | { kind: "signed_out" }
  | { kind: "connecting" }
  | { kind: "qr_required"; challengeUrl: string; expiresAt: string }
  | { kind: "waiting_for_approval" }
  | { kind: "authenticated"; accountName: string; steamId: string }
  | { kind: "reauthentication_required"; reason: string }
  | { kind: "error"; code: string; message: string };
```

A URL do desafio deve ser considerada temporária. A UI precisa substituir o QR Code quando receber um evento de atualização.

### 8.2 Backend Rust

Responsabilidades:

- iniciar e supervisionar o worker;
- verificar versão e integridade do binário;
- controlar fila;
- escolher provedor;
- persistir estado de domínio;
- validar caminhos e espaço em disco;
- expor comandos ao frontend;
- traduzir eventos IPC para eventos internos;
- reiniciar o worker com política limitada;
- acionar fallback;
- impedir dois writers no mesmo diretório;
- reconciliar instalações após reinício.

Interface sugerida:

```rust
#[async_trait]
pub trait DownloadProvider: Send + Sync {
    async fn health(&self) -> Result<ProviderHealth, ProviderError>;
    async fn authenticate(&self, request: AuthRequest)
        -> Result<AuthSession, ProviderError>;
    async fn sign_out(&self, account_id: &str)
        -> Result<(), ProviderError>;
    async fn list_owned_apps(&self)
        -> Result<Vec<OwnedApp>, ProviderError>;
    async fn plan_install(&self, request: InstallRequest)
        -> Result<InstallPlan, ProviderError>;
    async fn start(&self, plan: InstallPlan)
        -> Result<DownloadJobId, ProviderError>;
    async fn pause(&self, job_id: &DownloadJobId)
        -> Result<(), ProviderError>;
    async fn resume(&self, job_id: &DownloadJobId)
        -> Result<(), ProviderError>;
    async fn cancel(&self, job_id: &DownloadJobId)
        -> Result<(), ProviderError>;
    async fn verify(&self, installation_id: &InstallationId)
        -> Result<VerifyResult, ProviderError>;
}
```

### 8.3 Worker .NET

Responsabilidades:

- encapsular todo uso do SteamKit2;
- manter a conexão Steam;
- tratar callbacks;
- produzir eventos estruturados;
- gerenciar tokens e conta ativa;
- resolver licenças e conteúdo;
- executar downloads;
- persistir apenas dados locais necessários;
- não conhecer conceitos visuais do frontend;
- não acessar serviços remotos do launcher.

Submódulos sugeridos:

```text
SteamConnectionService
SteamAuthenticationService
SteamSessionStore
LicenseService
ProductInfoService
InstallPlanner
DepotManifestService
DepotKeyService
ContentServerPool
ChunkDownloadScheduler
FileAssembler
InstallationStateStore
DownloadRecoveryService
WorkerRpcServer
```

---

## 9. IPC entre Rust e .NET

### 9.1 Transporte

Para Windows, começar com **Named Pipes**.

Motivos:

- tráfego local;
- suporte a ACL;
- sem porta TCP exposta;
- integração razoável em Rust e .NET;
- permite streaming de eventos;
- fácil encerramento com o processo pai.

Alternativas:

- stdio com JSON Lines: útil para protótipo, menos robusto;
- gRPC sobre Named Pipes: bom, porém aumenta dependências;
- localhost TCP: evitar inicialmente;
- arquivo compartilhado: inadequado para comandos em tempo real.

### 9.2 Protocolo

Usar mensagens request/response e eventos assíncronos.

Envelope:

```json
{
  "protocolVersion": 1,
  "messageId": "01J...",
  "type": "request",
  "method": "downloads.planInstall",
  "timestamp": "2026-07-29T14:00:00Z",
  "payload": {}
}
```

Resposta:

```json
{
  "protocolVersion": 1,
  "messageId": "01J...",
  "correlationId": "01J...",
  "type": "response",
  "ok": true,
  "payload": {}
}
```

Erro:

```json
{
  "protocolVersion": 1,
  "messageId": "01J...",
  "correlationId": "01J...",
  "type": "response",
  "ok": false,
  "error": {
    "code": "STEAM_AUTH_SESSION_EXPIRED",
    "category": "authentication",
    "retryable": true,
    "userAction": "reauthenticate",
    "technicalMessage": "Refresh token was rejected."
  }
}
```

Evento:

```json
{
  "protocolVersion": 1,
  "messageId": "01J...",
  "type": "event",
  "event": "download.progress",
  "payload": {
    "jobId": "job_123",
    "phase": "downloading",
    "downloadedBytes": 1073741824,
    "totalDownloadBytes": 5368709120,
    "writtenBytes": 2147483648,
    "reusedBytes": 536870912,
    "bytesPerSecond": 52428800,
    "activeChunks": 8
  }
}
```

### 9.3 Regras de contrato

- Tipos devem ser definidos por JSON Schema ou Protobuf.
- Campos novos devem ser opcionais dentro da mesma versão.
- Mudança semântica exige nova versão.
- O worker deve recusar versões incompatíveis.
- Toda operação longa deve ter `jobId`.
- Toda operação cancelável deve aceitar `CancellationToken`.
- Eventos não podem conter tokens ou credenciais.
- O Rust deve validar todas as mensagens recebidas.
- Tamanho máximo por mensagem deve ser limitado.
- O pipe deve aceitar apenas o usuário atual.
- O worker deve encerrar quando o processo pai morrer.

---

## 10. Autenticação

### 10.1 Fluxo principal — QR Code

Fluxo recomendado:

```text
UI solicita login
      ↓
Rust envia auth.beginQr
      ↓
Worker conecta ao Steam
      ↓
SteamKit2 inicia sessão QR
      ↓
Worker envia auth.qrUpdated
      ↓
UI renderiza challenge URL como QR
      ↓
Usuário escaneia e aprova no Steam Mobile
      ↓
Worker recebe resultado
      ↓
Worker efetua LogOn com token
      ↓
Worker confirma LoggedOn
      ↓
Token protegido é persistido localmente
```

Implementação conceitual no worker:

1. Criar `SteamClient`.
2. Criar `CallbackManager`.
3. Registrar callbacks de conexão, desconexão, logon e logoff.
4. Conectar.
5. Executar `BeginAuthSessionViaQRAsync`.
6. emitir cada nova `ChallengeURL`.
7. aguardar `PollingWaitForResultAsync`.
8. efetuar `SteamUser.LogOn` com o token recebido.
9. considerar login concluído somente após `LoggedOnCallback` com sucesso.
10. armazenar o token de forma protegida.

### 10.2 Renovação e expiração

Implementar estados explícitos:

```text
NoSession
Connecting
AwaitingQrScan
AwaitingApproval
LoggingOn
Authenticated
Refreshing
ReauthenticationRequired
SigningOut
Faulted
```

Regras:

- Não assumir que token persistido continuará válido.
- Em rejeição, limpar somente o material inválido e solicitar novo login.
- Reconexão não deve gerar vários fluxos QR simultâneos.
- Impedir logins concorrentes da mesma conta dentro do launcher.
- Atribuir `LoginID` próprio e configurável.
- Documentar possível conflito com outras sessões que usem o mesmo `LoginID`.
- Não realizar retry infinito em credenciais rejeitadas.
- Limitar tentativas de reconexão com backoff e jitter.

### 10.3 Armazenamento de sessão

No Windows:

- usar DPAPI com escopo do usuário ou Windows Credential Manager;
- persistir token cifrado, SteamID, nome da conta e metadados mínimos;
- não persistir senha;
- não persistir token em JSON legível;
- impedir que o frontend leia o token;
- permitir “remover conta deste dispositivo”;
- apagar material protegido no logout explícito;
- aplicar permissões restritas aos arquivos;
- nunca incluir o token em crash dump ou log.

Formato lógico:

```text
SteamSessionRecord
├── schemaVersion
├── steamId
├── accountName
├── encryptedRefreshToken
├── createdAt
├── lastSuccessfulLoginAt
└── tokenFingerprint
```

O `tokenFingerprint` deve ser um hash parcial usado apenas para diagnóstico local, nunca o token.

---

## 11. Catálogo, licenças e autorização

### 11.1 Fonte de verdade

O launcher não deve confiar apenas em uma biblioteca importada previamente ou em dados públicos de AppID.

Antes de baixar:

- obter licenças/pacotes da sessão;
- consultar dados de pacote;
- consultar AppInfo/PICS;
- resolver quais depots estão acessíveis;
- solicitar chaves somente para depots autorizados;
- falhar de forma explícita quando o acesso for negado.

### 11.2 Modelo de dados

```rust
pub struct OwnedApp {
    pub app_id: u32,
    pub name: Option<String>,
    pub license_sources: Vec<u32>,
    pub installable_on_windows: bool,
    pub supports_public_branch: bool,
}

pub struct DepotCandidate {
    pub depot_id: u32,
    pub source_app_id: u32,
    pub platform: Option<String>,
    pub architecture: Option<String>,
    pub language: Option<String>,
    pub is_shared: bool,
    pub is_dlc: bool,
    pub manifest_id: u64,
}
```

### 11.3 Cache

Separar caches:

```text
cache/
├── appinfo/
├── packageinfo/
├── manifests/
├── server-list/
└── cdn-metadata/
```

Regras:

- cada entrada deve ter versão e timestamp;
- dados de licença devem ser considerados por conta;
- invalidar após eventos relevantes de licença;
- permitir “atualizar biblioteca”;
- cache nunca substitui a verificação de acesso no download;
- dados corrompidos devem ser descartáveis e reconstruíveis.

---

## 12. Planejador de instalação

O planejador deve transformar uma intenção do usuário em um plano imutável e auditável.

Entrada:

```json
{
  "appId": 123,
  "target": {
    "os": "windows",
    "architecture": "64",
    "language": "brazilian",
    "branch": "public"
  },
  "includeOwnedDlc": true,
  "installDirectory": "D:\\Games\\Example"
}
```

Saída:

```json
{
  "planId": "plan_123",
  "appId": 123,
  "buildId": 456789,
  "branch": "public",
  "depots": [
    {
      "depotId": 124,
      "manifestId": 987654321,
      "estimatedDownloadBytes": 1000000,
      "estimatedInstalledBytes": 2000000
    }
  ],
  "requiredDiskBytes": 2500000,
  "warnings": [],
  "createdAt": "2026-07-29T14:00:00Z"
}
```

### 12.1 Regras de seleção

- Escolher apenas depots compatíveis com Windows.
- Respeitar arquitetura quando declarada.
- Preferir idioma solicitado.
- Incluir depots sem filtro de idioma quando forem comuns.
- Resolver depots compartilhados.
- Não baixar todas as plataformas por padrão.
- Não baixar todos os idiomas por padrão.
- Incluir DLC somente se:
  - for selecionada;
  - a conta possuir acesso;
  - o depot for aplicável.
- Fixar manifest IDs no plano para evitar mudança durante a operação.
- Invalidar o plano se a autorização mudar.
- Replanejar após expiração configurável.
- Mostrar estimativa de espaço e download antes de iniciar.

### 12.2 Idempotência

O mesmo plano aplicado ao mesmo estado local deve resultar em:

- nenhum download quando tudo já está correto;
- download apenas dos chunks ausentes ou inválidos;
- remoção de arquivos obsoletos somente na etapa de commit;
- resultado final consistente.

---

## 13. Motor de download

### 13.1 Pipeline

```text
Obter plano
   ↓
Criar lock da instalação
   ↓
Carregar estado local
   ↓
Baixar/validar manifestos
   ↓
Calcular diff de arquivos e chunks
   ↓
Validar espaço em disco
   ↓
Selecionar servidores de conteúdo
   ↓
Baixar chunks concorrentes
   ↓
Validar hashes
   ↓
Escrever em staging
   ↓
Montar arquivos
   ↓
Commit transacional
   ↓
Remover arquivos obsoletos
   ↓
Persistir estado instalado
```

### 13.2 Concorrência

Configuração inicial recomendada:

- concorrência global de chunks configurável;
- limite conservador padrão;
- limite por servidor;
- fila com prioridade;
- backpressure de escrita;
- buffer pool para reduzir alocações;
- cancelamento cooperativo;
- medição separada de rede e disco.

Não otimizar agressivamente antes de medir.

### 13.3 Seleção de CDN

Implementar pool com:

- lista de servidores;
- latência;
- throughput recente;
- falhas consecutivas;
- cooldown;
- autenticação de CDN quando exigida;
- rotação em 401/403/timeout;
- atualização de token quando necessário;
- fallback para outro servidor;
- suporte futuro a LAN cache atrás de feature flag.

### 13.4 Integridade

Para cada chunk:

- validar tamanho;
- validar checksum/hash esperado;
- rejeitar conteúdo inválido;
- repetir em outro servidor;
- limitar número de tentativas;
- marcar falha permanente quando excedido.

Para cada arquivo:

- escrever em arquivo temporário;
- manter mapa de chunks;
- flush conforme política;
- trocar atomically quando possível;
- não sobrescrever a versão válida antes da conclusão.

### 13.5 Staging

Estrutura:

```text
<GameDir>/
├── .launcher/
│   ├── install-state.json
│   ├── active-plan.json
│   ├── manifests/
│   ├── staging/
│   ├── journal/
│   └── locks/
└── arquivos do jogo
```

Alternativa preferível quando possível:

```text
<LibraryRoot>/.launcher/apps/<appId>/
```

Evita misturar metadados com arquivos do jogo, mas requer mapeamento robusto.

### 13.6 Journal

Registrar operações antes de aplicá-las:

```json
{
  "jobId": "job_123",
  "phase": "assembling",
  "operations": [
    {
      "type": "replace",
      "source": "staging/file.tmp",
      "target": "game/file.bin",
      "status": "pending"
    }
  ]
}
```

Após crash:

- detectar journal incompleto;
- verificar destino;
- concluir ou reverter;
- nunca assumir que a última etapa terminou.

---

## 14. Pausa, retomada e cancelamento

### Pausa

- parar agendamento de novos chunks;
- aguardar chunks ativos chegarem a um ponto seguro;
- persistir progresso;
- manter staging;
- emitir evento `paused`.

### Retomada

- recarregar plano;
- verificar se manifest IDs continuam válidos;
- reconciliar staging;
- revalidar chunks incompletos;
- continuar sem redownload completo.

### Cancelamento

Opções distintas na UI:

1. **Cancelar e manter dados temporários**, permitindo retomada.
2. **Cancelar e remover dados temporários**.

Nunca apagar uma instalação válida ao cancelar uma atualização.

---

## 15. Atualizações

Fluxo:

1. consultar build atual da branch;
2. comparar com o estado instalado;
3. gerar novo plano;
4. comparar manifestos antigos e novos;
5. reaproveitar chunks válidos;
6. baixar diferenças;
7. montar em staging;
8. aplicar commit;
9. atualizar `buildId` e manifest IDs;
10. manter possibilidade de recuperação até o commit concluir.

Estado instalado:

```json
{
  "schemaVersion": 1,
  "provider": "steamkit",
  "appId": 123,
  "buildId": 456,
  "branch": "public",
  "language": "brazilian",
  "architecture": "64",
  "depots": {
    "124": {
      "manifestId": 987654321
    }
  },
  "installedAt": "2026-07-29T14:00:00Z",
  "verifiedAt": "2026-07-29T14:10:00Z"
}
```

---

## 16. Compatibilidade com instalações existentes

### 16.1 Instalações feitas pelo SteamCMD

Criar um importador:

- localizar diretório;
- identificar AppID conhecido;
- consultar manifestos atuais;
- verificar arquivos;
- criar estado local do launcher;
- não confiar apenas na presença do executável;
- não redownloadar tudo quando os arquivos forem reutilizáveis.

### 16.2 Instalações feitas pelo Steam

Na primeira versão:

- tratar como diretório externo importável;
- não modificar `appmanifest_*.acf`;
- não escrever diretamente em bibliotecas Steam;
- não prometer reconhecimento automático pelo cliente Steam;
- exigir confirmação para usar uma pasta gerenciada pela Steam.

### 16.3 Migração de provedor

Estados:

```text
steamcmd_managed
steamkit_managed
external_steam
unknown
```

A migração deve:

- criar backup do estado do launcher;
- verificar arquivos;
- gerar novo estado sem alterar conteúdo válido;
- permitir retorno ao SteamCMD;
- nunca apagar arquivos apenas porque o provedor mudou.

---

## 17. Fallback para SteamCMD

Manter feature flags:

```text
steamkit.auth.enabled
steamkit.catalog.enabled
steamkit.download.enabled
steamkit.update.enabled
steamkit.defaultProvider
```

Política inicial:

```text
catálogo: SteamKit2
planejamento: SteamKit2
downloads internos/testes: SteamKit2
downloads públicos: SteamCMD
```

Evolução:

```text
canary SteamKit2
→ opt-in
→ padrão para jogos aprovados
→ padrão geral
→ SteamCMD somente fallback
```

Fallback automático somente quando seguro.

Exemplos seguros:

- falha antes de qualquer escrita;
- falha de conexão sem staging significativo;
- incompatibilidade conhecida detectada no planejamento.

Exemplos que exigem confirmação ou recuperação:

- falha durante commit;
- arquivos parcialmente substituídos;
- branch privada;
- plano já iniciado com manifest IDs diferentes;
- diretório compartilhado com outro provedor.

---

## 18. Modelo de erros

Categorias:

```text
authentication
authorization
network
cdn
manifest
planning
storage
integrity
process
protocol
compatibility
legal_policy
unknown
```

Códigos mínimos:

```text
STEAM_CONNECTION_FAILED
STEAM_DISCONNECTED
STEAM_AUTH_QR_EXPIRED
STEAM_AUTH_REJECTED
STEAM_AUTH_SESSION_EXPIRED
STEAM_ACCOUNT_ACCESS_DENIED
STEAM_APP_NOT_OWNED
STEAM_DEPOT_ACCESS_DENIED
STEAM_APPINFO_UNAVAILABLE
STEAM_MANIFEST_UNAVAILABLE
STEAM_MANIFEST_CHANGED
STEAM_CDN_AUTH_FAILED
STEAM_CDN_TIMEOUT
STEAM_CHUNK_INTEGRITY_FAILED
INSTALL_PATH_INVALID
INSTALL_PATH_LOCKED
DISK_SPACE_INSUFFICIENT
FILE_PERMISSION_DENIED
FILE_IN_USE
INSTALL_STATE_CORRUPTED
WORKER_PROTOCOL_MISMATCH
WORKER_CRASHED
PROVIDER_UNSUPPORTED
```

Cada erro deve conter:

- código estável;
- categoria;
- retryable;
- ação sugerida;
- mensagem para usuário;
- detalhe técnico sanitizado;
- contexto não sensível;
- identificador de correlação.

---

## 19. Segurança

### 19.1 Threat model mínimo

Ameaças:

- roubo de refresh token;
- processo local não autorizado acessando o pipe;
- injeção de comandos IPC;
- path traversal vindo de manifestos;
- symlink/junction attack;
- sobrescrita fora da biblioteca;
- DLL hijacking;
- worker adulterado;
- logs com segredos;
- atualização maliciosa;
- diretório controlado por outro usuário;
- arquivos especiais ou nomes inválidos;
- exaustão de disco;
- zip/decompression bomb equivalente em chunks;
- escalada causada por execução privilegiada.

### 19.2 Controles

- executar sem privilégios administrativos;
- pipe com ACL do usuário atual;
- nonce de inicialização entre Rust e worker;
- validar schema e tamanho de mensagem;
- canonicalizar caminhos;
- garantir que todo destino permaneça dentro da raiz permitida;
- rejeitar caminhos absolutos e traversal;
- tratar junctions e symlinks explicitamente;
- assinatura de código dos binários distribuídos;
- hash do worker validado pelo launcher;
- atualizações assinadas;
- dependências com versões fixadas;
- SBOM;
- secret scanning;
- logs redigidos;
- crash dumps desativados ou sanitizados para o worker;
- tokens protegidos por DPAPI/Credential Manager;
- não executar arquivos baixados automaticamente;
- não rodar instaladores ou scripts de terceiros na primeira versão.

### 19.3 Fronteira de confiança

```text
Frontend: não confiável para segredos
Rust: orquestrador confiável
Worker: componente privilegiado apenas sobre sessão e biblioteca
Steam network: remota
Manifestos: dados remotos que precisam de validação
Arquivos locais existentes: potencialmente hostis
```

---

## 20. Privacidade

- Explicar que a autenticação ocorre com a Steam.
- Indicar que o SteamKit2 é uma integração não oficial.
- Não transmitir credenciais ao servidor do launcher.
- Telemetria deve ser opt-in quando contiver dados detalhados.
- Não coletar:
  - nome de usuário Steam;
  - SteamID;
  - lista completa de jogos;
  - caminhos locais;
  - nomes de arquivos;
  - tokens;
  - IPs de CDN;
  sem necessidade explícita e consentimento.
- Eventos agregados permitidos:
  - versão do worker;
  - categoria de erro;
  - duração;
  - volume total aproximado;
  - provedor;
  - sucesso/falha;
  desde que anonimizados.

---

## 21. Licenças e revisão jurídica

Antes de distribuição pública:

- revisar a licença LGPL-2.1 do SteamKit2;
- preservar avisos e textos de licença;
- garantir que a estratégia de distribuição permita cumprir as obrigações aplicáveis;
- revisar a licença de qualquer código copiado ou adaptado;
- não copiar código GPL do DepotDownloader para componente proprietário sem avaliação jurídica;
- usar DepotDownloader como referência técnica, não como fonte copiada por padrão;
- documentar modificações no SteamKit2, caso existam;
- revisar o Steam Subscriber Agreement vigente;
- avaliar autorização da Valve para produto público ou comercial;
- deixar claro que a integração não é afiliada ou endossada pela Valve;
- revisar uso de marcas e elementos visuais da Steam.

**Gate obrigatório:** nenhuma disponibilização pública do provedor SteamKit2 antes da aprovação jurídica/política documentada.

---

## 22. Observabilidade

Logs estruturados:

```json
{
  "timestamp": "2026-07-29T14:00:00Z",
  "level": "info",
  "component": "chunk-scheduler",
  "event": "chunk.retry",
  "jobId": "job_123",
  "depotId": 124,
  "attempt": 2,
  "reason": "timeout",
  "correlationId": "corr_123"
}
```

Nunca registrar:

- senha;
- refresh token;
- access token;
- cookies;
- challenge URL completa após expiração;
- headers de autenticação;
- branch password;
- argumentos contendo segredos.

Métricas:

- tempo de conexão;
- tempo de login;
- tempo de planejamento;
- throughput de rede;
- throughput de escrita;
- chunks reutilizados;
- retries por servidor;
- falhas de checksum;
- tempo de pausa;
- recuperação após crash;
- taxa de sucesso por AppID em ambiente de teste;
- comparação SteamKit2 versus SteamCMD.

---

## 23. Testes

### 23.1 Testes unitários

- seleção de depots;
- filtros de OS/arquitetura/idioma;
- DLCs;
- depots compartilhados;
- branches;
- cálculo de espaço;
- diff de manifestos;
- path normalization;
- traversal;
- journal;
- máquina de estados;
- serialização IPC;
- redaction de logs;
- retry/backoff;
- rate limiting.

### 23.2 Testes de contrato

Rust e .NET devem executar a mesma suíte de fixtures:

- request válido;
- campo opcional desconhecido;
- versão incompatível;
- resposta fora de ordem;
- eventos antes da resposta;
- cancelamento;
- payload acima do limite;
- erro estruturado;
- desconexão do pipe;
- reinício do worker.

### 23.3 Testes de integração

Usar uma conta de teste dedicada e jogos autorizados.

Cenários:

- login QR aprovado;
- QR expirado;
- aprovação recusada;
- token persistido válido;
- token revogado;
- app possuído;
- app não possuído;
- app gratuito;
- depot sem acesso;
- download pequeno;
- download grande;
- queda de rede;
- timeout;
- CDN inválida;
- corrupção induzida;
- pouco espaço;
- arquivo bloqueado;
- pausa;
- retomada após reinício;
- cancelamento;
- atualização;
- validação;
- logout.

### 23.4 Matriz de jogos

Incluir ao menos:

- jogo pequeno sem DLC;
- jogo grande;
- jogo com vários depots;
- jogo com idioma separado;
- jogo 32-bit;
- jogo 64-bit;
- jogo com DLC;
- jogo com depot compartilhado;
- jogo gratuito;
- jogo que exige launcher adicional;
- jogo com arquivos muito grandes;
- jogo com muitos arquivos pequenos.

Não armazenar credenciais da conta de teste no CI.

### 23.5 Chaos tests

- matar worker durante download;
- matar worker durante montagem;
- matar launcher;
- remover rede;
- tornar disco read-only;
- preencher disco;
- alterar permissões;
- corromper estado;
- truncar arquivo temporário;
- devolver mensagens IPC atrasadas;
- simular relógio incorreto.

---

## 24. Benchmarks contra SteamCMD

Executar nas mesmas condições:

- mesma máquina;
- mesma rede;
- cache limpo;
- mesmo jogo;
- mesmo diretório;
- mesma linguagem e plataforma;
- ao menos três repetições.

Métricas:

| Métrica | SteamCMD | SteamKit2 | Critério |
|---|---:|---:|---|
| Tempo até iniciar download | | | não piorar significativamente |
| Throughput médio | | | ≥ 90% do SteamCMD inicialmente |
| Pico de memória | | | dentro do orçamento definido |
| Uso de CPU | | | aceitável |
| Dados baixados em atualização | | | igual ou menor |
| Retomada após crash | | | sem redownload integral |
| Taxa de sucesso | | | ≥ 99% na matriz aprovada |
| Qualidade dos erros | | | superior ao SteamCMD |
| Tempo de autenticação | | | aceitável |
| Integridade final | | | 100% |

A adoção não deve depender apenas de velocidade. Controle, retomada e diagnósticos também contam.

---

## 25. Fases de implementação

## Fase 0 — investigação e gates

**Entregáveis:**

- ADR de arquitetura;
- prova mínima de login;
- prova mínima de consulta de licenças;
- prova mínima de download de um depot pequeno;
- revisão de licença;
- revisão dos termos aplicáveis;
- threat model inicial;
- benchmark baseline do SteamCMD.

**Critérios de saída:**

- login QR funciona;
- sessão pode ser reutilizada;
- acesso é negado para conteúdo não licenciado;
- um arquivo baixado é validado;
- não há senha persistida;
- decisão jurídica permite seguir para ambiente interno.

---

## Fase 1 — worker e IPC

**Implementar:**

- projeto .NET;
- bootstrap;
- Named Pipe;
- handshake;
- versionamento;
- health check;
- shutdown;
- supervisor Rust;
- logs estruturados;
- pacote self-contained;
- validação de hash.

**Critérios de aceite:**

- Rust inicia e encerra o worker;
- worker encerra com o pai;
- mensagens incompatíveis são rejeitadas;
- crash é detectado;
- restart tem limite;
- nenhuma porta de rede local é aberta.

---

## Fase 2 — autenticação

**Implementar:**

- QR Code;
- atualização do challenge;
- callbacks;
- login;
- token protegido;
- reconexão;
- logout;
- revogação local;
- estados UI.

**Critérios de aceite:**

- nenhuma senha passa pelo frontend;
- token não aparece em logs;
- QR atualizado é refletido na UI;
- reiniciar o launcher reutiliza sessão válida;
- token inválido solicita reautenticação;
- logout remove sessão local.

---

## Fase 3 — catálogo e licenças

**Implementar:**

- licença/pacotes;
- PICS/AppInfo;
- catálogo mínimo;
- cache;
- acesso por app/depot;
- atualização da biblioteca.

**Critérios de aceite:**

- jogos instaláveis são identificados;
- app não possuído não pode ser planejado;
- cache corrompido é reconstruído;
- resultado é consistente após reconexão.

---

## Fase 4 — planejador

**Implementar:**

- resolução de depots;
- branch pública;
- Windows;
- x64/x86;
- idioma;
- depots comuns;
- depots compartilhados;
- DLC opt-in;
- cálculo de espaço;
- plano imutável.

**Critérios de aceite:**

- fixtures cobrem todos os filtros;
- plano mostra bytes e depots;
- dois planejamentos iguais são equivalentes;
- plano inválido não inicia download.

---

## Fase 5 — download mínimo viável

**Implementar:**

- servidores de conteúdo;
- autenticação CDN;
- manifestos;
- chaves;
- download de chunks;
- checksums;
- staging;
- montagem;
- progresso.

**Limitação:** uma operação por vez e branch pública.

**Critérios de aceite:**

- download completo de jogos da matriz inicial;
- arquivos finais correspondem ao manifesto;
- erro de checksum não produz instalação válida;
- cancelamento não corrompe instalação anterior.

---

## Fase 6 — recuperação e atualização

**Implementar:**

- journal;
- pausa;
- retomada;
- crash recovery;
- atualização diferencial;
- validação;
- remoção segura de obsoletos;
- importação SteamCMD.

**Critérios de aceite:**

- matar o worker não exige recomeçar;
- atualização preserva versão anterior até commit;
- instalação SteamCMD é importada sem redownload integral quando possível;
- validação corrige arquivo corrompido.

---

## Fase 7 — canary

**Implementar:**

- feature flag;
- lista de AppIDs aprovados;
- opt-in;
- comparação automática;
- botão “tentar com SteamCMD”;
- coleta opcional de métricas.

**Critérios de saída:**

- taxa de sucesso definida;
- nenhum incidente de perda de instalação;
- nenhum vazamento de sessão;
- suporte consegue diagnosticar falhas;
- rollback testado.

---

## Fase 8 — provedor padrão

Pré-condições:

- revisão jurídica concluída;
- matriz ampliada;
- atualização automática do worker;
- runbook;
- SLA interno;
- fallback estável;
- telemetria aprovada;
- política de compatibilidade publicada.

O SteamCMD permanece disponível por pelo menos um ciclo de versões após a mudança.

---

## 26. Critérios gerais de conclusão

A implementação é considerada pronta quando:

- o cliente gráfico da Steam não é necessário para baixar;
- somente conteúdo autorizado é baixado;
- senha não é armazenada;
- token é protegido pelo sistema operacional;
- download suporta pausa, retomada e recuperação;
- instalação anterior não é destruída por falha;
- progresso é estruturado e confiável;
- worker pode ser atualizado separadamente;
- SteamCMD continua disponível como fallback;
- testes cobrem segurança, integridade e compatibilidade;
- licenças de terceiros são respeitadas;
- riscos dos termos de uso foram avaliados;
- documentação operacional está completa.

---

## 27. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Mudança no protocolo Steam | downloads quebram | worker atualizável, versões fixadas, canary e fallback |
| Token roubado | comprometimento da conta | DPAPI/Credential Manager, ACL, logs redigidos |
| Conteúdo remoto gera path traversal | escrita arbitrária | canonicalização, raiz restrita, testes adversariais |
| Falha durante atualização | instalação corrompida | staging, journal e commit transacional |
| SteamKit2 muda API | build quebrado | pin de versão e suíte de compatibilidade |
| Diferença de seleção de depots | instalação incompleta | fixtures baseadas em casos reais e comparação SteamCMD |
| CDN instável | baixa confiabilidade | pool, retry, cooldown e fallback |
| Licença incompatível | risco de distribuição | revisão jurídica e isolamento de componentes |
| Termos da Valve | risco de bloqueio/proibição | revisão específica e contato formal quando necessário |
| Worker grande | instalador maior | publicar self-contained medido; avaliar runtime compartilhado depois |
| Antivírus bloqueia worker | falhas de execução | assinatura de código, reputação e canal de suporte |
| Dois providers escrevem juntos | corrupção | lock exclusivo por instalação |
| Steam aberto com LoginID conflitante | desconexão | LoginID distinto e tratamento de sessão |

---

## 28. Decisões que o agente revisor deve avaliar

1. Worker .NET separado é preferível a incorporar DepotDownloader como subprocesso?
2. Usar .NET 10 self-contained ou manter compatibilidade com .NET 8?
3. Fixar SteamKit2 estável ou acompanhar builds alpha?
4. JSON sobre Named Pipes é suficiente ou gRPC traz benefício real?
5. A fila deve permanecer no Rust ou migrar parcialmente para o worker?
6. O worker deve suportar múltiplos downloads simultâneos na primeira versão?
7. Qual formato deve representar o estado instalado?
8. Como tratar depots compartilhados e DLCs no MVP?
9. Qual política de remoção de arquivos obsoletos é aceitável?
10. Deve haver integração com bibliotecas Steam existentes?
11. Como o launcher iniciará jogos que exigem o cliente Steam?
12. Qual é o mecanismo oficial de atualização do worker?
13. Quais obrigações LGPL aplicam-se ao packaging escolhido?
14. O modelo de uso exige autorização formal da Valve?
15. Quais AppIDs formarão a matriz de compatibilidade?
16. Quais métricas definem vitória sobre o SteamCMD?
17. O fallback pode ser automático ou sempre explícito?
18. Qual será a política de suporte quando o protocolo quebrar?

---

## 29. Backlog inicial sugerido

### Epic A — arquitetura

- [ ] Criar ADR do provedor SteamKit2.
- [ ] Definir contrato `DownloadProvider`.
- [ ] Mapear integração SteamCMD atual.
- [ ] Definir estados de instalação.
- [ ] Definir feature flags.

### Epic B — worker

- [ ] Criar solução .NET.
- [ ] Adicionar SteamKit2 com versão fixada.
- [ ] Implementar health check.
- [ ] Implementar Named Pipe.
- [ ] Implementar handshake.
- [ ] Implementar logs redigidos.
- [ ] Gerar publicação self-contained.
- [ ] Assinar binário.

### Epic C — autenticação

- [ ] Conectar à Steam.
- [ ] Implementar callback loop.
- [ ] Implementar QR auth.
- [ ] Emitir atualização do QR.
- [ ] Processar resultado do polling.
- [ ] Confirmar `LoggedOn`.
- [ ] Proteger token.
- [ ] Reutilizar sessão.
- [ ] Implementar logout.
- [ ] Testar revogação.

### Epic D — catálogo

- [ ] Capturar licenças.
- [ ] Consultar pacotes.
- [ ] Consultar AppInfo.
- [ ] Construir catálogo.
- [ ] Implementar cache.
- [ ] Verificar acesso por depot.

### Epic E — planejamento

- [ ] Interpretar seção de depots.
- [ ] Resolver branch pública.
- [ ] Resolver idioma.
- [ ] Resolver plataforma.
- [ ] Resolver arquitetura.
- [ ] Resolver depots compartilhados.
- [ ] Resolver DLC.
- [ ] Fixar manifest IDs.
- [ ] Calcular espaço.

### Epic F — conteúdo

- [ ] Obter depot key.
- [ ] Obter manifest.
- [ ] Criar pool CDN.
- [ ] Baixar chunk.
- [ ] Validar chunk.
- [ ] Montar arquivo.
- [ ] Emitir progresso.
- [ ] Implementar staging.
- [ ] Implementar commit.

### Epic G — resiliência

- [ ] Implementar journal.
- [ ] Implementar pausa.
- [ ] Implementar retomada.
- [ ] Implementar cancelamento.
- [ ] Implementar retries.
- [ ] Implementar recuperação.
- [ ] Implementar atualização.
- [ ] Implementar verificação.

### Epic H — migração

- [ ] Importar instalação SteamCMD.
- [ ] Manter fallback.
- [ ] Implementar canary.
- [ ] Criar matriz de compatibilidade.
- [ ] Executar benchmarks.
- [ ] Criar runbook.

### Epic I — segurança e conformidade

- [ ] Threat model.
- [ ] Revisão de paths.
- [ ] ACL de Named Pipe.
- [ ] DPAPI/Credential Manager.
- [ ] SBOM.
- [ ] Revisão LGPL.
- [ ] Revisão dos termos Steam.
- [ ] Política de privacidade.
- [ ] Aviso de integração não oficial.

---

## 30. Sequência recomendada de pull requests

1. **PR 1:** abstração `DownloadProvider` sem mudança de comportamento.
2. **PR 2:** esqueleto do worker e health check.
3. **PR 3:** IPC versionado e supervisor Rust.
4. **PR 4:** autenticação QR sem persistência.
5. **PR 5:** armazenamento protegido e reautenticação.
6. **PR 6:** licenças e catálogo.
7. **PR 7:** planejador com fixtures.
8. **PR 8:** download de um único depot para staging.
9. **PR 9:** montagem e integridade.
10. **PR 10:** múltiplos depots e progresso agregado.
11. **PR 11:** pausa, retomada e cancelamento.
12. **PR 12:** journal e crash recovery.
13. **PR 13:** atualizações diferenciais.
14. **PR 14:** importação SteamCMD.
15. **PR 15:** canary e fallback.
16. **PR 16:** hardening, signing, SBOM e documentação.

Cada PR deve ser reversível e não alterar o provedor padrão até o canary.

---

## 31. Prova de conceito mínima

Antes de construir o motor completo, criar uma aplicação interna que:

1. inicializa SteamKit2;
2. conecta;
3. gera QR;
4. recebe aprovação;
5. realiza logon;
6. lista licenças;
7. consulta AppInfo de um AppID conhecido;
8. verifica acesso a um depot;
9. obtém manifest;
10. baixa um único chunk;
11. valida o chunk;
12. encerra e reutiliza a sessão.

**Não implementar UI final nesta etapa.**

Saídas obrigatórias:

```text
AuthenticatedAccount
LicenseCount
AppInfoResolved
DepotAccessGranted
ManifestResolved
ChunkDownloaded
ChunkHashValid
SessionPersisted
SessionReused
```

Essa prova reduz o risco das áreas mais incertas antes de investir em fila, UI e recuperação.

---

## 32. Referências técnicas primárias

- SteamKit2: https://github.com/SteamRE/SteamKit
- SteamKit2 no NuGet: https://www.nuget.org/packages/SteamKit2
- Exemplo oficial de autenticação por QR:
  https://github.com/SteamRE/SteamKit/tree/master/Samples/001_AuthenticationWithQrCode
- DepotDownloader, referência de implementação:
  https://github.com/SteamRE/DepotDownloader
- Código de referência do motor de conteúdo:
  https://github.com/SteamRE/DepotDownloader/blob/master/DepotDownloader/ContentDownloader.cs
- Código de referência de sessão:
  https://github.com/SteamRE/DepotDownloader/blob/master/DepotDownloader/Steam3Session.cs
- Pool de CDN de referência:
  https://github.com/SteamRE/DepotDownloader/blob/master/DepotDownloader/CDNClientPool.cs
- Steam Subscriber Agreement:
  https://store.steampowered.com/subscriber_agreement/brazilian/

---

## 33. Recomendação final

A migração é tecnicamente justificável quando o objetivo é obter:

- melhor integração com o launcher;
- eventos estruturados;
- controle do plano de instalação;
- recuperação avançada;
- diagnósticos melhores;
- independência da CLI do SteamCMD.

Ela não é automaticamente “mais simples” ou “mais segura” que o SteamCMD. O SteamKit2 deve ser tratado como infraestrutura crítica e não oficial, com:

- worker isolado;
- versões fixadas;
- testes de compatibilidade;
- segurança de sessão;
- escrita transacional;
- fallback;
- atualização rápida;
- revisão jurídica.

A implementação deve começar pelo login, autorização e download de um único chunk. Somente após essa prova deve avançar para um instalador completo.
