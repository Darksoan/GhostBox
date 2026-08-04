# GhostBox — Sistema visual global baseado no Figma

## Objetivo

Aplicar a linguagem visual do frame Figma `15:3` a todo o aplicativo GhostBox sem copiar suas dimensões de forma rígida. A Home será a referência de composição; as demais páginas usarão os mesmos tokens, superfícies, proporções, componentes e estados interativos, preservando os fluxos e dados existentes.

## Referência visual

Arquivo: `Lk5FI99Y53MYTNi0MUhUdu`, frame `15:3`.

O frame de 1920 × 1080 define:

- canvas principal `#101010`;
- sidebar `#0a0a0a`, com 400 px na largura de referência;
- superfícies secundárias `#151515`;
- superfícies selecionadas `#202020`;
- margem de 42 px entre sidebar e conteúdo;
- banners horizontais de aproximadamente 973 × 149 px;
- cards de aproximadamente 343 × 309 px;
- imagens com cantos arredondados entre 23 e 25 px;
- metadados apresentados como pills discretas.

Essas medidas representam proporções e hierarquia, não tamanhos absolutos obrigatórios.

## Estratégia

### 1. Fundação global

Os tokens SCSS existentes serão a fonte única para cores, raios, espaçamento, tipografia, estados e movimento. Valores já equivalentes ao Figma serão reutilizados. Valores divergentes serão ajustados no nível semântico, evitando cores e medidas duplicadas dentro das páginas.

O shell do aplicativo terá:

- canvas uniforme em `#101010`;
- sidebar visualmente separada em `#0a0a0a`;
- conteúdo com margem proporcional à referência e limites responsivos;
- superfícies sem contornos decorativos quando a separação por contraste for suficiente;
- scrollbar e titlebar integradas ao mesmo fundo.

### 2. Componentes compartilhados

Componentes existentes serão mantidos e adaptados:

- `Sidebar` e perfil lateral;
- cabeçalhos de seção;
- cards de jogos e capas;
- banners e carrosséis;
- pills de gênero, tag, estado e filtros;
- botões, selects, campos e menus;
- modais, painéis e estados vazios;
- skeletons e placeholders.

Cards terão imagem dominante, fundo escuro, raio consistente e metadados compactos. Hover e foco devem reforçar a superfície sem deslocamentos excessivos. O foco por teclado continuará claramente visível.

### 3. Ajustes por página

#### Home

Será a implementação mais próxima do frame: banner horizontal, grade de destaques, cards com imagem e pills, alinhamentos e espaçamentos equivalentes à referência. As seções adicionais existentes continuarão presentes e herdarão o mesmo sistema.

#### Biblioteca e Favoritos

Grades, cards, controles de ordenação e filtros usarão as mesmas superfícies e raios da Home. A densidade atual será preservada, com responsividade baseada na largura disponível.

#### Catálogo

Busca, filtros, previews e navegação serão alinhados à grade global. Resultados reutilizarão o padrão de card; filtros ativos reutilizarão o padrão de pill selecionada.

#### Perfil e Conquistas

Cabeçalhos, resumos estatísticos, progresso e listas serão organizados em superfícies coerentes com os banners e cards da Home. Indicadores funcionais manterão sua semântica e legibilidade.

#### Notificações

Itens, agrupamentos e estados lido/não lido serão diferenciados pelas superfícies semânticas do sistema, sem introduzir novas cores decorativas.

#### Ajustes

Navegação, seções de formulário, planos e estados de conta usarão a mesma hierarquia de painel, seleção e controle. Elementos premium manterão sua identidade quando ela comunicar uma função real.

#### Modais e menus contextuais

Usarão os mesmos tokens de superfície, raio e interação. O conteúdo continuará limitado à viewport, com áreas roláveis e ações sempre alcançáveis.

## Responsividade

A proporção da sidebar do Figma será traduzida para uma largura fluida com limites mínimos e máximos. O conteúdo reduzirá margens e número de colunas progressivamente. Nenhuma página dependerá de 1920 × 1080, posicionamento absoluto ou largura fixa do frame.

Breakpoints existentes serão reutilizados sempre que forem adequados. Novos breakpoints só serão adicionados quando um componente não puder se adaptar por grid, flexbox ou `clamp()`.

## Acessibilidade e interação

- Contraste de texto e controles deve permanecer legível nas superfícies escuras.
- Todos os controles manterão foco visível e nomes acessíveis.
- Hover não será o único meio de revelar informação essencial.
- Preferência por movimento reduzido continuará respeitada.
- Estados de carregamento preservarão a geometria final para evitar saltos de layout.

## Dados e comportamento

Não haverá mudança intencional em APIs, persistência, navegação, carregamento de jogos, coleções, conquistas, conta ou assinatura. Alterações em TSX serão limitadas à estrutura necessária para aplicar padrões visuais compartilhados e acessíveis.

## Limites de escopo

Incluído:

- tokens e shell global;
- páginas principais do aplicativo;
- componentes compartilhados visíveis nessas páginas;
- estados responsivos, loading, hover, focus e seleção;
- atualização dos testes de layout afetados.

Não incluído:

- redesign de fluxos funcionais;
- criação de novos recursos;
- alteração de contratos de backend;
- reprodução literal de conteúdo fictício do Figma;
- mudanças na landing page externa ou nos workers.

## Verificação

A implementação será considerada concluída quando:

1. build TypeScript/Vite e verificação de tokens passarem;
2. testes existentes e testes de layout atualizados passarem;
3. Home reproduzir a hierarquia e proporções do frame em 1920 × 1080;
4. todas as páginas listadas compartilharem o mesmo sistema de superfícies, raios, espaçamento e estados;
5. layouts permanecerem utilizáveis em larguras menores suportadas pelo app;
6. alterações locais preexistentes do usuário forem preservadas.

## Riscos e mitigação

- **Arquivo SCSS global extenso:** alterações serão concentradas em tokens e blocos existentes, sem refatoração ampla fora do escopo.
- **Mudanças locais em andamento:** cada diff será comparado com o estado atual; somente o documento desta especificação será commitado antes da implementação.
- **Regressões entre páginas:** mudanças globais serão verificadas primeiro em componentes compartilhados e depois em cada página.
- **Fidelidade versus responsividade:** o frame será usado como referência na largura de 1920 px, com interpolação fluida nas demais larguras.
