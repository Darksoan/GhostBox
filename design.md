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

Rampa neutra de superfície — cinco degraus, `--n-0` até `--n-4`, limitados a `#000000`–`#202020`. Passos calculados por luminância relativa (não por distância hex linear), para que cada degrau tenha contraste semelhante ao anterior:

- `--n-0`: `#000000`
- `--n-1`: `#0b0b0b`
- `--n-2`: `#141414`
- `--n-3`: `#1a1a1a`
- `--n-4`: `#202020`

Cada degrau tem contraste ~1.06–1.07:1 em relação ao vizinho — bem abaixo do mínimo WCAG de 3:1 para elementos não textuais. É baixo contraste por design, não por acidente. Consequência direta: **espaçamento é o separador primário, contraste de rampa é secundário.** Onde duas superfícies encostam sem gap, usar salto de dois degraus (~1.13:1), nunca um.

Rampa de borda (`--b-0`, mais `--n-5` até `--n-7`) é independente da rampa de superfície e fica fora do teto `#202020` — bordas não precisam (nem devem) ficar quase pretas.

Paleta estrutural atual:

- `--surface-canvas`: `#000000`, fundo principal do app.
- `--surface-panel` / `--surface-sidebar`: `#0b0b0b`.
- `--surface-raised`: `#141414`, cards e áreas destacadas.
- `--surface-popover`: `#1a1a1a`, menus e dropdowns.
- `--surface-modal`: `#202020`, diálogos e confirmação — teto da rampa, nunca empata com popover.
- `--sidebar-option-selected`, `--surface-option-active`, `--surface-popover-active`: `#202020`, estados ativos/selecionados no teto.

Esses valores pertencem à rampa neutra e devem continuar sendo consumidos por tokens semânticos. Não usar os hexadecimais diretamente em componentes.

Hierarquia, da mais profunda à mais elevada:

1. `--surface-canvas`: fundo de página e shell principal.
2. `--surface-panel`: painéis estruturais e áreas laterais.
3. `--surface-raised`: cards e áreas destacadas.
4. `--surface-popover`: menus, dropdowns e popovers.
5. `--surface-modal`: diálogos e fluxos de confirmação.

Estados interativos devem subir um degrau (ou dois, se abutting sem gap) ou usar tokens de estado (`--surface-hover`, `--surface-active`, `--surface-strong`). Não usar hover que apague separação entre painel e controle.

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
