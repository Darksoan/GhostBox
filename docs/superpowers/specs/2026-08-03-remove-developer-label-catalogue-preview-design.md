# Remover rótulo de desenvolvedora do preview do catálogo

## Objetivo

Manter preview hover do catálogo e exibir somente nomes de desenvolvedoras, por exemplo `Rockstar Games`, sem o prefixo `Desenvolvedora:`.

## Abordagem

Alterar apenas `src/components/ui/CatalogueHoverPreview.tsx`, removendo o elemento visual que renderiza `t("catalogue.preview.developer")` e preservando a lista `developers`, o layout, controles, acessibilidade e comportamento do preview.

Não alterar filtros, modal de jogo, outras telas ou estrutura de traduções.

## Validação

Executar teste específico de preview e verificação de tipos/build disponível. Confirmar que o componente ainda renderiza nome da desenvolvedora quando presente e não renderiza o rótulo.
