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
- Inter é a família tipográfica canônica, carregada como fonte variável única (`@fontsource-variable/inter`, ver `src/main.tsx`). Pesos reais por papel: regular 400 (`--weight-regular`), corpo 450 (`--weight-body`), medium 500 (`--weight-medium`, controles/rótulos) e semibold 600 (`--weight-semibold`, títulos). Não pedir pesos fora desses papéis.
- Hierarquia usa peso, escala e espaçamento; não usar caixa alta em blocos longos.

## Fonte de verdade

Tokens vivem em:

- `src/styles/_primitives.scss`: rampas neutras, alpha, status, espaçamento, tipografia, raios, sombras, motion e z-index.
- `src/styles/_semantic.scss`: tokens consumidos pela UI.
- `src/app.scss`: estilos globais e mixins compartilhados.

Componentes devem usar tokens semânticos (`--surface-*`, `--text-*`, `--border-*`, `--space-*`, `--type-*`, `--motion-*`). Não usar `--n-*`, `--a-*`, `--gold-*` ou valores de cor crus em componentes.

Não criar token duplicado para resolver um caso isolado. Se papel visual se repetir, adicionar token semântico nos arquivos canônicos e atualizar testes de tokens quando necessário.

## Cor e superfície

Rampa neutra de superfície — cinco degraus, `--n-0` até `--n-4`, limitados a `#000000`–`#202020`. Degraus usam contrastes perceptualmente próximos:

- `--n-0`: `#000000` — piso técnico
- `--n-1`: `#0b0b0b` — canvas
- `--n-2`: `#141414` — painel, sidebar, card
- `--n-3`: `#1a1a1a` — popovers, dropdowns, skeletons e controles
- `--n-4`: `#202020` — seleção e estados ativos

Rampa usa quantização por luminância relativa, não interpolação linear de hexadecimal. Contraste entre vizinhos continua abaixo de 3:1; **espaçamento é separador primário, contraste de rampa é secundário**. Onde duas superfícies encostam sem gap, usar salto de dois degraus, nunca borda decorativa.

`--b-0` (`#2a2a2a`) e `--n-5` até `--n-7` ficam fora da rampa de superfícies para bordas e estados de foco. `--n-8` até `--n-12` permanecem reservados para texto e ícones.

### Direção de estado

Regra do protótipo, e ela não é uniforme:

- **Navegação clareia.** Item de sidebar sobe: `#141414` em repouso → `#1a1a1a` no hover → `#202020` selecionado.
- **Conteúdo mantém hierarquia escura.** Cards partem de `#141414`; menus e controles sobem até `#202020`, sem usar degraus de borda ou texto.

Não unificar os dois. A distinção é o que separa "onde estou navegando" de "o que estou tocando".

Overlays de interação (`--surface-hover`, `--surface-active`, `--surface-strong`, `--surface-subtle`, `--surface-muted`) ficam fora do teto — são tinta translúcida branca sobre a superfície de repouso, não fundo fixo. Acompanham degrau sob elas e não criam novo tier de repouso.

Dois tokens ficam fora da rampa de propósito:

- `--surface-media-letterbox`: `var(--black)`. Não é tier de UI, é o vazio atrás da arte. O piso `#000000` evita halo em capas que já têm barras pretas.
- `--surface-sunken`: igual ao canvas. Nada pode ficar abaixo do piso, então o papel existe como nome, mas a distinção vem de geometria (padding, inset), não de cor.

Paleta estrutural atual:

- `--surface-canvas`: `#0b0b0b`, fundo principal do app.
- `--surface-panel` / `--surface-sidebar` / `--surface-explore-card`: `#141414`, painéis e cards.
- `--surface-raised` / `--surface-option-hover` / `--sidebar-option-hover`: `#151515`, áreas destacadas e hover.
- `--surface-popover` / `--surface-titlebar-control` / `--surface-modal-control-hover`: `#202020`, menus e controles.
- `--surface-option-active` / `--sidebar-option-selected` / `--profile-dropdown-option-hover`: `#202020`, estados selecionados.
- `--surface-modal`: `#0b0b0b`, base de modal dominado por mídia; `--surface-modal-control`: `#141414`.

Esses valores pertencem à rampa neutra e devem continuar sendo consumidos por tokens semânticos. Não usar os hexadecimais diretamente em componentes.

Hierarquia, da mais profunda à mais elevada:

1. `--surface-canvas`: fundo de página e shell principal.
2. `--surface-panel` / `--surface-raised`: painéis estruturais, áreas laterais, cards.
3. `--surface-popover`: menus, dropdowns e popovers.
4. `--surface-option-active` / `--surface-modal-control-hover`: estados ativos e chrome elevado.
   Bases de modal dominadas por mídia continuam em `--surface-canvas` para evitar halo.

Estados interativos seguem a direção da seção "Direção de estado": navegação sobe degraus até seleção, conteúdo usa próximo degrau sem sair da rampa. Onde não houver token de repouso definido, usar os tokens de estado (`--surface-hover`, `--surface-active`, `--surface-strong`). Não usar hover que apague separação entre painel e controle.

Surfaces e cards não usam borda visível por padrão. Separação vem primeiro de espaçamento e agrupamento, depois de contraste entre superfícies — um único degrau da rampa (~1.07:1) não é suficiente sozinho em monitores não-OLED com luz ambiente. Cada elemento deve manter tratamento visual próprio e contrastado em relação ao vizinho, sem transformar toda interface em uma coleção de caixas iguais.

Bordas ficam reservadas para foco, controles que exigem delimitação, indicadores de status e estados de erro. Não adicionar bordas decorativas para compensar falta de contraste — resolver com espaçamento ou salto de degrau, nunca com borda.

Texto:

- `--text-primary`: títulos, conteúdo principal e controles ativos.
- `--text-secondary`: metadados, descrições e navegação secundária.
- `--text-tertiary`: informação auxiliar de baixa prioridade.
- Se uma superfície clara for criada no futuro, adicionar papel semântico específico antes de usá-la; não inserir cor direta no componente.

Bordas devem ser econômicas: `--border-subtle` para separação estrutural, `--border-default` para controles e `--border-interactive` para foco ou interação evidente.

## Tipografia e espaçamento

- Usar escala semântica `--type-size-*` com sua interlinha `--type-line-*` correspondente.
- Texto de interface deve permanecer compacto; títulos de página podem ganhar mais respiro.
- Piso de leitura é caption (13px). Micro (12px) é só rótulo curto — badge, pill, contador — nunca texto de leitura.
- Nitidez de texto é global e uniforme: `text-rendering: optimizeLegibility` herdado do `body`. Nunca usar `text-rendering: geometricPrecision` — desliga hinting e amolece glifos no Windows. Propriedades de smoothing (`-webkit-font-smoothing`, `-moz-osx-font-smoothing`) são macOS/Firefox e não devem ser adicionadas.
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
- Páginas de Settings usam `settings-page__header` com título e descrição por aba; as abas de superfície dedicada (`subscription`, `connections`) prescindem do header.

## Componentes

### Navegação

Navegação ativa deve ser identificável por superfície, texto e ícone. Não depender somente de cor. Itens precisam de foco visível, área de clique confortável e estado desabilitado legível.

### Cards e capas

Cards são contêineres funcionais, não painéis ornamentais. Manter título, estado e ação na mesma lógica de alinhamento. Overlay sobre arte serve para legibilidade e deve permanecer sutil.

### Controles

Botões devem declarar prioridade visual: ação primária, secundária, discreta ou perigosa. Campos, selects, toggles e abas devem compartilhar altura, foco e feedback de estado. A ação primária de um hero (ex. `hero__action--primary`) é a única que compete frontalmente com a arte: preenchimento sólido claro com texto escuro, sem backdrop blur. Toggles acesos sobem ao teto da rampa (`--toggle-track-on: var(--c-5)`) — nunca branco puro, que domina qualquer conteúdo.

### Tags e badges

Tags informativas usam `tag-chip` ou padrão equivalente. Não transformar cada metadado em badge colorido. Premium usa `--premium-gold`; status usa tokens de status. Filtros de catálogo são monocromáticos: o estado de seleção se lê por superfície e contador, nunca por acentos de cor por categoria.

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
