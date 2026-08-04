# Igualar fundo da titlebar ao app

## Problema

Após elevar superfícies, `.app-main` usa `var(--app-gradient)`, resolvido para `--n-0`, enquanto `.header` ainda usa `var(--background-dark)`, resolvido para `--n-000`. Isso deixa titlebar mais escura que fundo do app.

## Solução

Alterar somente background de `.header` para `var(--app-gradient)`, compartilhando exatamente mesma fonte usada por `.app-main`.

Não alterar `--background`, `--background-dark`, tokens de texto, configuração Tauri ou demais consumidores desses tokens.

## Regressão e auditoria

Adicionar teste de stylesheet que confirme igualdade entre backgrounds de `.header` e `.app-main`. Auditar também referências diretas de `--surface-*` para confirmar elevação aprovada: preto para `--n-000`, `--n-000` para `--n-0`, e cada degrau neutro para seu sucessor.

Executar verificação de tokens, teste novo, suíte e build.
