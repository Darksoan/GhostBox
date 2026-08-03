# GhostBox landing page — design

## Objetivo

Criar uma landing page em português do Brasil que apresente o GhostBox como um app desktop pessoal para organizar, explorar e personalizar a experiência com a biblioteca Steam. A página deve transformar funcionalidades reais do produto em uma narrativa comercial clara, com CTAs para download e assinatura Premium.

## Público e posicionamento

O público são jogadores de PC que têm bibliotecas Steam grandes, gostam de acompanhar conquistas e desejam uma interface própria para organizar jogos, favoritos e coleções. O posicionamento central é: **"Sua biblioteca Steam, do seu jeito."**

O conteúdo não fará alegações sobre funcionalidades que não existam no repositório e não usará marcas, depoimentos ou métricas de terceiros sem fonte.

## Direção visual

A referência aprovada inspira uma página editorial, cinematográfica e escura:

- Base em preto e carvão, com gradientes azul-ardósia profundos.
- Tipografia ampla e limpa, com bastante espaço negativo e hierarquia editorial.
- Lilás frio para interação e dourado reservado aos elementos Premium.
- O ícone `ghost-solid.png` serve como marca; a interface real do produto é reinterpretada em mockups estáticos de alto contraste.
- Movimentos pequenos de entrada e parallax apenas quando não houver preferência por redução de movimento.

## Estrutura da página

1. **Navegação fixa** — marca GhostBox, âncoras para recursos, perfil e planos, além do CTA de download.
2. **Hero** — mensagem "Sua biblioteca Steam, do seu jeito.", subtítulo sobre centralizar a experiência Steam e dois CTAs: "Baixar o GhostBox" e "Explorar recursos". Um mockup amplo contextualiza a interface do app.
3. **Manifesto curto** — contraste entre uma biblioteca dispersa e uma biblioteca que reflete a forma de jogar de cada pessoa.
4. **Recursos essenciais** — cards para biblioteca, catálogo, favoritos e coleções, conquistas e notificações. Cada card terá cópia objetiva e uma pequena representação visual do benefício.
5. **Vitrine do produto** — bloco maior que mostra descoberta de jogos, informações de catálogo e acompanhamento de atividade/conquistas em uma composição de painéis.
6. **Perfil personalizável** — seção dedicada a avatar, banner, posição da capa, coleções, favoritos e métricas pessoais. O tom é de identidade e pertencimento, não apenas de configuração.
7. **Planos** — comparativo entre acesso gratuito e GhostBox Premium. Premium comunica sincronização de perfil, backups automáticos, pontos de restauração e recursos de nuvem. O seletor alterna os preços reais já existentes: mensal por R$ 6,99 e trimestral por R$ 14,99.
8. **FAQ** — perguntas sobre Steam, personalização, dados locais/nuvem e cancelamento do Premium.
9. **CTA final e rodapé** — reforço para download, links de navegação e nota de que a Steam é uma marca de terceiros.

## Comportamento

- Âncoras realizam rolagem suave entre as seções.
- O plano trimestral recebe destaque de economia, sem inventar percentual de desconto caso ele não seja calculado pelo conteúdo final.
- Perguntas frequentes funcionam como acordeão acessível, com estado expandido anunciado corretamente.
- Em telas pequenas, a navegação vira um menu compacto; o conteúdo passa de colunas para uma leitura vertical, e os mockups preservam legibilidade sem depender de hover.
- Todos os botões e controles podem ser usados por teclado; transições respeitam `prefers-reduced-motion`.

## Conteúdo e fontes

O texto parte das capacidades atuais verificadas no repositório: catálogo Steam, biblioteca, favoritos, coleções, perfil editável, conquistas, notificações, assinaturas, backups e sincronização em nuvem. O idioma inicial é português do Brasil, mas a cópia e os dados de planos ficam isolados para facilitar uma versão em inglês posteriormente.

## Limites de escopo

Esta entrega é uma página institucional de uma rota, sem autenticação, checkout integrado ou persistência. Os CTAs de download e assinatura serão links/ações de apresentação, a menos que o repositório já forneça destinos públicos apropriados. A construção mantém a arquitetura e dependências do app existente, sem alterar o produto Tauri em si.

## Validação

- Conferir que a página compila no fluxo de build existente.
- Verificar navegação por teclado, contraste e comportamento em larguras desktop e mobile.
- Revisar a cópia contra as funcionalidades implementadas e os preços definidos no worker de assinaturas.
- Publicar via Sites após a validação, se a configuração e a autorização de hospedagem estiverem disponíveis.
