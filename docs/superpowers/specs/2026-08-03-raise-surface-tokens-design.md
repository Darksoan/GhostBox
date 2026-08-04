# Elevar tokens de superfície

## Objetivo

Clarear superfícies da interface em um degrau da rampa neutra, mantendo todos os tokens de texto intactos.

## Escopo

Alterar somente definições estruturais `--surface-*` em `src/styles/_semantic.scss` que apontam diretamente para um degrau neutro ou preto:

- `--black` passa para `--n-000`.
- `--n-000` passa para `--n-0`.
- Cada referência de `--n-0` até `--n-11` passa para o degrau seguinte.
- `--surface-option: #0f0f0f`, valor intermediário atual, passa para `--n-1`.

Aliases de superfície continuam iguais e herdam os novos valores. Tokens alpha, misturas, estados que não usam degraus neutros diretamente, dropdowns sem prefixo `--surface-*`, bordas, textos e primitivos permanecem intactos.

## Validação

Executar verificação de tokens e build. Confirmar no diff que nenhuma definição `--text-*` ou primitivo neutro foi alterada.
