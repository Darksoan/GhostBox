# GhostBox Design System

Este documento define linguagem visual e regras de implementação do GhostBox. É a referência de produto para novas telas, componentes e ajustes de interface.

## Princípio

GhostBox é uma biblioteca Steam pessoal, densa e silenciosa. Interface deve priorizar descoberta rápida, leitura clara e sensação de controle, sem competir com arte dos jogos.

Direção central: **biblioteca escura, precisa e personalizável**.

## Linguagem visual

- Tema escuro permanente, com preto e neutros carvão como base.
- Contraste vem de degraus de superfície, não de bordas brilhantes ou sombras pesadas.
- Arte de jogos é elemento de maior destaque; UI deve enquadrá-la.
- Dourado fica reservado para Premium e conquistas raras.
- Vermelho indica perigo ou estado próprio da Steam, nunca decoração.
- Cantos quase retos reforçam ferramenta desktop: usar raios pequenos, nunca cartões excessivamente arredondados.
- Open Sans é família tipográfica canônica.
- Hierarquia usa peso, escala e espaçamento; não usar caixa alta em blocos longos.

## Fonte de verdade

Tokens vivem em:

- `src/styles/_primitives.scss`: rampas neutras, alpha, status, espaçamento, tipografia, raios, sombras, motion e z-index.
- `src/styles/_semantic.scss`: tokens consumidos pela UI.
- `src/app.scss`: estilos globais e mixins compartilhados.

Componentes devem usar tokens semânticos (`--surface-*`, `--text-*`, `--border-*`, `--space-*`, `--type-*`, `--motion-*`). Não usar `--n-*`, `--a-*`, `--gold-*` ou valores de cor crus em componentes.

Não criar token duplicado para resolver um caso isolado. Se papel visual se repetir, adicionar token semântico nos arquivos canônicos e atualizar testes de tokens quando necessário.

## Cor e superfície

Paleta estrutural atual:

- `--surface-canvas`: `#0d0d0d`, fundo principal do app.
- `--surface-sidebar`: `#101010`, fundo da sidebar.
- `--surface-titlebar`: `#0d0d0d`, fundo da titlebar.
- `--sidebar-option-hover`: `#1a1a1a`, hover de opções da sidebar.
- `--sidebar-option-selected`: `#2a2a2a`, opção selecionada da sidebar.
- `--surface-dropdown-menu`: `#1a1a1a`, painel/menu dos dropdowns.
- `--settings-dropdown-menu`: `#252525`, painel/menu dos dropdowns da aba Ajustes.
- `--settings-dropdown-trigger-hover`: `#252525`, hover e estado aberto do trigger em Ajustes.

Esses valores pertencem à rampa neutra (`--n-0` até `--n-4`) e devem continuar sendo consumidos por tokens semânticos. Não usar os hexadecimais diretamente em componentes.

Hierarquia, da mais profunda à mais elevada:

1. `--surface-canvas`: fundo de página e shell principal.
2. `--surface-panel`: painéis estruturais e áreas laterais.
3. `--surface-raised`: cards e áreas destacadas.
4. `--surface-popover`: menus, dropdowns e popovers.
5. `--surface-modal`: diálogos e fluxos de confirmação.

Estados interativos devem subir um degrau ou usar tokens de estado (`--surface-hover`, `--surface-active`, `--surface-strong`). Não usar hover que apague separação entre painel e controle.

Surfaces e cards não usam borda visível por padrão. Separação deve vir de contraste entre superfícies, espaçamento, agrupamento e elevação sutil. Cada elemento deve manter tratamento visual próprio e contrastado em relação ao vizinho, sem transformar toda interface em uma coleção de caixas iguais.

Bordas ficam reservadas para foco, controles que exigem delimitação, indicadores de status e estados de erro. Não adicionar bordas decorativas para compensar falta de contraste.

Texto:

- `--text-primary`: títulos, conteúdo principal e controles ativos.
- `--text-secondary`: metadados, descrições e navegação secundária.
- `--text-tertiary`: informação auxiliar de baixa prioridade.
- Se uma superfície clara for criada no futuro, adicionar papel semântico específico antes de usá-la; não inserir cor direta no componente.

Bordas devem ser econômicas: `--border-subtle` para separação estrutural, `--border-default` para controles e `--border-interactive` para foco ou interação evidente.

## Tipografia e espaçamento

- Usar escala semântica `--type-size-*` com sua interlinha `--type-line-*` correspondente.
- Texto de interface deve permanecer compacto; títulos de página podem ganhar mais respiro.
- Usar `--space-*` para padding, gap e margem. `--spacing` não existe.
- Alinhar grupos por uma mesma unidade de espaçamento; evitar valores arbitrários para corrigir desalinhamentos locais.
- Metadados nunca devem ter mais destaque que título, capa ou ação primária.

## Layout do produto

Shell compartilhado deve manter titlebar, navegação lateral e área de conteúdo previsíveis. Páginas atuais incluem Home, Library, Catalogue, Favorites, Profile, Notifications, Settings e achievements.

- Conteúdo principal usa largura disponível sem esticar texto ou cards além do necessário.
- Listas e catálogos privilegiam escaneabilidade, alinhamento e densidade consistente.
- Capas preservam proporção original; fundos letterbox usam `--surface-media-letterbox`.
- Último conteúdo de cada página respeita `--page-bottom-space`.
- Modais, menus e tooltips usam camadas nomeadas de `--z-*`; não inventar z-index.
- Estados vazios devem explicar situação e próxima ação, sem ocupar espaço visual de conteúdo real.

## Componentes

### Navegação

Navegação ativa deve ser identificável por superfície, texto e ícone. Não depender somente de cor. Itens precisam de foco visível, área de clique confortável e estado desabilitado legível.

### Cards e capas

Cards são contêineres funcionais, não painéis ornamentais. Manter título, estado e ação na mesma lógica de alinhamento. Overlay sobre arte serve para legibilidade e deve permanecer sutil.

### Controles

Botões devem declarar prioridade visual: ação primária, secundária, discreta ou perigosa. Campos, selects, toggles e abas devem compartilhar altura, foco e feedback de estado.

### Tags e badges

Tags informativas usam `tag-chip` ou padrão equivalente. Não transformar cada metadado em badge colorido. Premium usa `--premium-gold`; status usa tokens de status.

### Modal e popover

Modal bloqueia contexto apenas quando fluxo exige decisão. Deve ter título, ação de fechamento, foco administrado e retorno de foco. Popover contextual não deve virar modal improvisado.

## Interação e movimento

- Feedback de hover, foco, seleção, carregamento e erro deve ser explícito.
- Transições usam `--motion-fast`, `--motion-base`, `--motion-slow` ou `--motion-emphasis` com `--ease` apropriado.
- Movimento deve reforçar causa e efeito, nunca atrasar ação ou leitura.
- Respeitar `prefers-reduced-motion` e `html.no-animations`.
- Não adicionar transição ornamental em troca de aba, lista ou navegação sem necessidade funcional.
- Foco de teclado deve usar anel visível e não depender de hover.

## Responsividade

Desktop é contexto principal, mas nenhuma tela pode exigir largura fixa para funcionar.

- Em larguras menores, reduzir colunas antes de reduzir legibilidade.
- Navegação lateral pode virar fluxo compacto; ações importantes continuam acessíveis.
- Grids devem preservar tamanho mínimo útil de capa e texto.
- Modais e popovers devem caber no viewport, respeitando áreas seguras e rolagem interna.
- Não usar hover como único caminho para revelar informação ou ação.

## Acessibilidade

- Usar elementos semânticos e nomes acessíveis para ícones e controles.
- Manter contraste suficiente para texto, foco e estados essenciais.
- Todos os fluxos devem funcionar por teclado.
- Imagens informativas precisam de texto alternativo; imagens decorativas devem ser ignoradas por tecnologias assistivas.
- Estados de carregamento, erro, sucesso e expansão devem ser comunicados além da cor.
- Respeitar zoom e reflow sem esconder conteúdo.

## Regra de implementação

Antes de criar UI nova:

1. Reutilizar componente, mixin e token existentes.
2. Confirmar que papel visual não já existe com outro nome.
3. Implementar estados padrão, hover, foco, desabilitado, carregamento, vazio e erro conforme aplicável.
4. Verificar desktop, viewport estreito, teclado e redução de movimento.
5. Executar `npm run check:tokens`, `npm run test` e `npm run build` quando alteração envolver estilos ou layout.

Se uma decisão nova contradizer este documento, atualizar `design.md` e os tokens canônicos na mesma mudança. Specs temporários não substituem esta referência.
