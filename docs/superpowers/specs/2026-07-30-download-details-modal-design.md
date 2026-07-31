# Modal de detalhes do download

## Objetivo

Abrir um modal dedicado ao clicar em um card da pagina Downloads. O modal apresenta arte maior, dados do download e uma acao segura para cancelar ou desinstalar, conforme o estado da tarefa.

## Interacao

- Clicar em uma area neutra do card abre o modal.
- Botoes de pausar, retomar, cancelar ou remover continuam executando sua acao sem abrir o modal.
- Clique no backdrop, botao fechar ou tecla Escape fecha o modal, exceto durante exclusao de arquivos.
- O modal usa `role="dialog"`, `aria-modal="true"`, titulo associado e foco visivel.

## Conteudo

- Header panoramico maior usando a primeira imagem disponivel em `headerSources`.
- Titulo do jogo e status atual sobre ou abaixo da arte, seguindo tokens existentes.
- Espaco alocado: usa `totalBytesAll`, depois `bytesTotal`, depois `totalBytesDownloaded` como fallback.
- Data e horario derivados de `finishedAt`, `startedAt` ou `queuedAt`, nesta ordem.
- Pasta de destino exibida com truncamento visual, preservando caminho completo em `title`.
- Estado atual traduzido.

## Acoes

- Tarefas `completed` ou `error`: botao `Desinstalar`.
- Tarefas `downloading`, `paused` ou `queued`: botao `Cancelar`.
- Toda acao destrutiva abre uma confirmacao obrigatoria.
- Confirmacao explica que arquivos baixados serao removidos permanentemente.
- Durante operacao, botoes de fechar e confirmar ficam bloqueados e mostram estado de carregamento.
- Sucesso fecha confirmacao e modal.
- Falha mantem modal aberto e exibe mensagem acionavel.

## Fluxo de dados

- `DownloadsPage` guarda a tarefa selecionada por ID, nao por copia, para refletir progresso ao vivo.
- Modal resolve tarefa atual a partir de `tasks` em cada render.
- Novo metodo do gerenciador executa exclusao e atualiza tarefa/historico somente apos sucesso do backend.
- Cancelamento ativo solicita parada do worker, aguarda encerramento e entao exclui a pasta antes de concluir a operacao no modal.
- Cancelamento de tarefa pausada ou na fila exclui a pasta imediatamente.
- Desinstalacao de tarefa finalizada chama backend, depois remove tarefa do historico e emite `downloadTasksChangedEvent`.

## Seguranca da exclusao

- Backend rejeita caminho vazio, inexistente ou que nao seja diretorio.
- Frontend envia exatamente `task.outputDir` persistido no inicio do download.
- Frontend envia tambem `appId` e raiz configurada de downloads.
- Backend valida que nome final da pasta corresponde ao `appId` e que o destino esta contido na raiz informada.
- Backend nao permite remover a propria raiz de downloads; somente subpasta especifica do jogo.
- Pasta ja inexistente conta como exclusao bem-sucedida, tornando repeticao segura.
- Historico so e removido depois de exclusao confirmada pelo backend.

## Componentes

- Novo `DownloadDetailsModal`, co-localizado com pagina ou em `components/modals` conforme padrao existente.
- Confirmacao destrutiva interna usa estilo de `.confirm-modal` e portal para `document.body`.
- `DownloadCard` ganha semantica de botao acessivel na area neutra, com Enter/Espaco abrindo detalhes.

## Visual

- Superficies, cores, espacamentos, raios, sombras e tipografia usam tokens existentes.
- Header maior preserva proporcao panoramica e usa fallback visual quando imagem nao carregar.
- Bloco de informacoes usa cards discretos alinhados ao design atual.
- Acao destrutiva usa tokens semanticos de perigo; nenhum valor de cor cru novo.
- Layout responsivo empilha metricas e acoes em largura estreita.

## Verificacao

- TypeScript via `npx tsc -p tsconfig.json`.
- Rust via `cargo check --manifest-path src-tauri/Cargo.toml`.
- Build via `npm run build`, descontando somente falhas pre-existentes documentadas.
- Teste manual: abrir por clique e teclado, fechar, progresso ao vivo, confirmacao, cancelar ativo, desinstalar concluido, falha de exclusao e layout estreito.

## Fora de escopo

- Calcular tamanho real da pasta por varredura no momento de abrir o modal.
- Abrir pasta no Explorer.
- Reinstalar pelo modal.
- Exibir detalhes completos do catalogo do jogo.
