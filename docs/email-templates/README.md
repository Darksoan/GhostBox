# Templates de e-mail — GhostBox

E-mails transacionais (verificação de endereço, redefinição de senha) são
enviados pelo **Firebase Identity Toolkit**, disparados em
[`workers/subscriptions/src/auth.ts`](../../workers/subscriptions/src/auth.ts)
via `accounts:sendOobCode`. O corpo do e-mail **não vem do código** — ele mora
no Firebase Console. Estes arquivos são a fonte da verdade versionada; o Console
é só o destino de colagem.

## Como aplicar

1. Firebase Console > projeto `ghostbox-app` > **Authentication** > **Templates**.
2. Escolher o template (`Verificação de endereço de e-mail` ou `Redefinição de senha`).
3. Selecionar o idioma no seletor do topo (Português / English).
4. Editar, colar o conteúdo do arquivo correspondente no campo **Mensagem**, salvar.

| Template | pt-BR | en |
|---|---|---|
| Verificação de e-mail | `verify-email.pt-BR.html` | `verify-email.en.html` |
| Redefinição de senha | `password-reset.pt-BR.html` | `password-reset.en.html` |

Ao alterar o visual, editar o arquivo aqui **e** recolar no Console — não há
sincronização automática.

## Decisões de estilo

Espelham os tokens de [`_semantic.scss`](../../src/styles/_semantic.scss), com os
hex resolvidos porque e-mail não tem custom properties:

| Papel | Token do app | Hex |
|---|---|---|
| Canvas | `--surface-canvas` | `#101010` |
| Card | `--surface-modal-control` | `#151515` |
| Título | `--text-primary` | `#e9e9e9` |
| Corpo | `--text-secondary` | `#a3a3a3` |
| Rodapé | `--n-7` | `#6e6e6e` |
| CTA (fundo/texto) | `--text-strong` / `--surface-canvas` | `#e9e9e9` / `#101010` |
| Raio | `--radius-sm` | `5px` |

Sem bordas em lugar nenhum: separação vem de espaçamento e de um degrau de
superfície (`#151515` sobre `#101010`), mesma regra do app.

## Restrições de e-mail que ditaram o markup

- **Tudo inline como base**, com um `<style>` solto no topo do fragmento
  (não em `<head>`, que os templates não têm) só para o hover do botão
  (`.ghostbox-cta:hover`). É reforço progressivo: Gmail, Apple Mail e
  Outlook.com aplicam; Outlook desktop ignora o bloco inteiro e o botão some
  sem quebrar — continua com o fundo/cor inline normais, só sem o hover.
- **Tudo em `<table>` com `bgcolor`.** O motor do Outlook (Word) ignora
  `background` e `padding` em `<div>`, e ignora `border-radius` — o botão fica
  retangular lá, o resto se mantém.
- **Sem imagens.** Não há asset hospedado em URL pública; o wordmark é texto.
  Se um logo entrar depois, precisa de URL absoluta e `alt` legível — clientes
  bloqueiam imagem por padrão e o e-mail tem que continuar lendo bem sem ela.
- **Acentos como entidades HTML** (`&ccedil;`, `&atilde;`, `&mdash;`) nos
  templates pt-BR. O arquivo é UTF-8 e o Firebase declara o charset, mas
  entidade não depende de nenhum dos dois — sobrevive a cliente e a ferramenta
  intermediária que erre a decodificação.
- **Sem link cru visível.** O botão é o único caminho, por decisão de layout.
  O custo: cliente corporativo que remova o `<a>` deixa o usuário sem saída —
  se aparecer relato desse tipo, o bloco de fallback volta.

## Pendência conhecida: entrega na caixa de spam

O remetente é `noreply@ghostbox-app.firebaseapp.com` — domínio compartilhado do
Firebase, sem SPF/DKIM sob nosso controle, historicamente marcado como spam.
Estilizar o corpo não resolve isso. A correção é configurar **domínio
personalizado de remetente** no Firebase Console (Authentication > Templates >
"Personalizar domínio") com os registros DNS do domínio do GhostBox.
