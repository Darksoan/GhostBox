# Design Tokens do GhostBox

**A fonte da verdade sao os arquivos SCSS, nao este documento.**

| Camada | Arquivo | O que tem |
| --- | --- | --- |
| Primitivos | [`src/styles/_primitives.scss`](src/styles/_primitives.scss) | Rampas e escalas base: neutros `--n-*`, alfas `--a-*`, acentos/status, `--space-*`, `--radius-*`, tipografia, sombras, z-index e motion |
| Semanticos | [`src/styles/_semantic.scss`](src/styles/_semantic.scss) | Tokens de uso: `--surface-*`, `--border-*`, `--text-*`, `--overlay-*`, `--focus-ring`, aliases legados e regras de consumo |

Este arquivo ja listou valores individuais de tokens. A tabela ficou obsoleta depois que os valores reais mudaram no SCSS, entao os valores nao sao mais duplicados aqui. Para criar ou alterar tokens, edite os arquivos canônicos acima.

## Regras de uso

1. Use tokens semanticos em componentes. Primitivos como `--n-*`, `--a-*` e `--gold-*` pertencem a `src/styles/`.
2. Texto comum deve usar os tokens semanticos `--text-primary`, `--text-secondary` e `--text-tertiary`; use `--text-inverse` quando o contexto exigir contraste invertido.
3. Espacamento usa a escala `--space-*`. O token antigo `--spacing` nao existe mais.
4. Movimento deve usar `--motion-*` e `--ease`, respeitando `html.no-animations` e `prefers-reduced-motion`.

## Validacao

`scripts/check-tokens.mjs` roda em `npm run build` e compara cada arquivo/regra com `scripts/token-baseline.json`. Ele falha quando uma contagem de violacoes sobe, permite reducoes e aceita atualizacao de baseline somente quando isso for uma escolha explicita.

```bash
npm run build
```
