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

!macro NSIS_HOOK_POSTINSTALL
  ; Usa um arquivo dedicado para quebrar o cache do ícone embutido no .exe.
  ; Os dois atalhos passam a refletir diretamente Icons/desktopicon.png,
  ; convertido para desktopicon.ico durante o desenvolvimento da build.
  CreateShortCut "$DESKTOP\GhostBox.lnk" "$INSTDIR\ghostbox-tauri.exe" "" "$INSTDIR\icons\desktopicon.ico" 0
  CreateShortCut "$SMPROGRAMS\GhostBox.lnk" "$INSTDIR\ghostbox-tauri.exe" "" "$INSTDIR\icons\desktopicon.ico" 0

  ; O Explorer armazena o icone do atalho pelo caminho do executavel. Notifica
  ; uma mudanca de associacao para descartar o bitmap de versoes anteriores.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Caches de imagens/catalogo e SteamCMD: re-baixaveis, saem sempre.
  RMDir /r "$APPDATA\com.ghostbox.app\cache"
  RMDir /r "$APPDATA\com.ghostbox.app\steamcmd"
!macroend
