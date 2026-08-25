; Hooks do instalador NSIS do GhostBox (Tauri v2).
;
; O Tauri chama estas macros automaticamente se existirem no arquivo apontado
; por bundle.windows.nsis.installerHooks.
;
; Politica de residuos no desinstalar: removemos UNICAMENTE o que e cache puro
; (re-baixavel). O template do Tauri ja pergunta ao usuario se ele quer apagar
; os dados do aplicativo ($DeleteAppDataCheckboxState) e, quando marcado, remove
; $APPDATA\com.ghostbox.app e $LOCALAPPDATA\com.ghostbox.app inteiros. Nosso hook
; roda DEPOIS disso, incondicionalmente — entao NADA aqui pode ser dado do
; usuario (localStorage, configuracoes, progresso offline), senao destruiriamos
; exatamente o que o usuario escolheu manter.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Caches de imagens/catalogo e SteamCMD: re-baixaveis, saem sempre.
  RMDir /r "$APPDATA\com.ghostbox.app\cache"
  RMDir /r "$APPDATA\com.ghostbox.app\steamcmd"
!macroend