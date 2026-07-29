# Plano: estabilizar animações (sem tremor, sem teleporte, sem pulo em troca rápida de abas)

> **OBSOLETO (2026-07-28).** Todo o sistema de View Transitions descrito aqui foi
> removido: `src/utils/viewTransition.ts` foi deletado e as trocas de aba/página
> passaram a ser instantâneas. Documento mantido apenas como registro histórico
> do diagnóstico. Ver
> `docs/superpowers/specs/2026-07-28-remover-transicoes-abas-design.md`.

Status: implementado (etapas 1-10) — ver "Correções pós-implementação" no fim
Escopo: transições de página/aba, restauração de scroll, animações de entrada de cards.

## Objetivo

1. Nenhum elemento "treme" (jitter/sub-pixel/reflow) durante transições.
2. Nenhum "teleporte" de conteúdo (salto de região de scroll ou de tamanho) na troca de página/aba.
3. Troca rápida de abas nunca pula, corta pela metade nem embaralha animações — a última navegação sempre vence e termina limpa.

---

## Diagnóstico (causas identificadas no código atual)

### A. `runViewTransition` não serializa transições concorrentes
[src/utils/viewTransition.ts:114](src/utils/viewTransition.ts:114)

- `skipTransition()` é chamado e logo em seguida `startViewTransition()` na mesma tarefa. `skipTransition` **não** finaliza a transição sincronamente: a árvore de pseudo-elementos é desmontada de forma assíncrona. Iniciar a próxima no mesmo tick faz o Chromium abortar/atropelar uma delas → frame preto ou salto.
- `root.classList.remove(...transitionClasses)` + `add(...)` acontece enquanto as animações antigas ainda estão vinculadas a essas classes. Trocar `motion-tab-forward` → `motion-tab-backward` no meio do voo inverte a `animation-name` de um pseudo-elemento vivo → o conteúdo "pula" para o outro lado.
- `transitionSequence` só protege a *limpeza* de classes, não protege o *início*: dois cliques rápidos com o caminho ocioso (abaixo) enfileiram dois `startTransition` deferidos e ambos executam.

### B. O caminho "app ocioso" atrasa quase todo primeiro clique
[src/utils/viewTransition.ts:98-112](src/utils/viewTransition.ts:98)

`updateIdleState` roda no *capture* de `mousedown`, antes do handler do clique. Ele marca `isAppIdle = true` sempre que passaram >2s desde a última interação — o caso comum. Resultado: a maioria dos cliques passa pelo duplo `requestAnimationFrame`, adicionando ~32ms de latência percebida e criando uma janela em que um segundo clique entra antes do primeiro `startViewTransition`.

### C. `alignScrollOrigins` mexe no scroller ao vivo
[src/utils/viewTransition.ts:38](src/utils/viewTransition.ts:38)

`.container__content` é um scroller **compartilhado** entre páginas. Zerar `scrollTop` antes do snapshot funciona quando a transição roda; quando ela é pulada (rápida troca, `startViewTransition` indisponível, exceção) o usuário vê a página saltar para o topo e voltar. Esse é o "teleporte" mais visível.

### D. Restauração de scroll dupla e dentro do `flushSync`
[src/hooks/useAppNavigation.ts:131](src/hooks/useAppNavigation.ts:131) e [src/App.tsx:323](src/App.tsx:323)

`restorePendingScroll` é chamado por dois `useLayoutEffect` (hook + App). O do hook dispara **dentro** do `flushSync` da callback do view transition, ou seja, entre a captura do snapshot antigo e a do novo — o snapshot novo pega uma posição de scroll, o layout final pega outra.

### E. `view-transition-name` duplicado derruba a transição inteira
[src/app.scss:1008](src/app.scss:1008)

`html.motion-tab-transition .settings-panel, .profile-page__tab-panel { view-transition-name: ghostbox-tab-content }` é um seletor de classe, não de instância única. `.settings-panel` também aparece em [SubscriptionModal.tsx:42](src/components/modals/SubscriptionModal.tsx:42) e no skeleton de [LoadingStates.tsx:557](src/components/ui/LoadingStates.tsx:557). Com modal aberto ou skeleton montado há **dois** elementos com o mesmo nome → o Chromium aborta a transição sem aviso → troca de aba instantânea e seca no meio de uma sequência animada.

### F. O `::view-transition-group` anima tamanho enquanto os filhos estão com `object-fit: none`
[src/app.scss:996-1053](src/app.scss:996)

- O grupo interpola width/height do antigo para o novo em 180ms (comportamento padrão, não desativado).
- Os filhos usam `object-fit: none` + `transform-origin: center center` e **sem `object-position`**, então o conteúdo fica ancorado no centro. Painéis de altura diferente (ex.: aba "overview" vs "achievements") deslizam verticalmente durante a interpolação → exatamente o "tremor"/"teleporte" relatado.

### G. `contain` aplicado só durante a transição
[src/app.scss:982](src/app.scss:982) e [src/app.scss:1010](src/app.scss:1010)

`contain: layout paint` / `contain: paint` entram junto com a classe `motion-*`. Ativar containment reflui o subtree no mesmo frame do snapshot — um pulo de 1 frame antes de toda transição.

### H. FLIP roda dentro da callback do view transition
[src/hooks/useFlipLayout.ts:18](src/hooks/useFlipLayout.ts:18)

`useLayoutEffect` do FLIP dispara dentro do `flushSync` da transição. Cada card ganha um `element.animate()` **por cima** da animação de snapshot do view transition → duas animações no mesmo pixel = tremor.

### I. Cursor-lock é curativo, não correção
[Sidebar.tsx:88](src/components/layout/Sidebar.tsx:88), [ProfilePage.tsx:98](src/pages/ProfilePage.tsx:98)

Timeouts fixos de 400ms/700ms forçando `cursor: pointer !important` mascaram o recálculo de hover causado pelos itens acima. Devem sair depois que a causa for corrigida (senão o cursor fica preso quando a transição termina antes/depois do timeout).

---

## Plano de correção

### Etapa 1 — Serializar as transições em `viewTransition.ts`

Reescrever `runViewTransition` com uma fila de no máximo 1 pendente:

1. Manter `currentTransition` e `pendingUpdate`.
2. Se já existe transição em voo: **não** chamar `startViewTransition` de novo. Guardar `{update, classes, sequence}` em `pendingUpdate` (sobrescrevendo qualquer pendente anterior — a última troca vence), chamar `skipTransition()` e deixar o `.finished`/`.finally` disparar o pendente. Assim rajadas de N cliques viram no máximo 2 animações, nunca N sobrepostas.
3. Só remover/adicionar as classes `motion-*` **imediatamente antes** de `startViewTransition` da vez que realmente vai rodar, e só limpá-las quando `sequence === transitionSequence` (já existe, manter).
4. Se `skipTransition` não existir (Safari/versões antigas), enfileirar sem pular: espera `finished` e roda o pendente.
5. Se o update pendente resultar no mesmo estado do atual, descartar.

Critério de aceite: clicar em 6 abas em <1s termina na aba 6, com exatamente uma animação de entrada, sem frame branco.

### Etapa 2 — Remover o caminho "idle" heurístico

Apagar `lastInteractionTime`/`isAppIdle` e os listeners globais ([viewTransition.ts:98-112](src/utils/viewTransition.ts:98)). Manter apenas o guard real: se `document.hidden`, executar `update()` direto **sem** animação (animar aba oculta não faz sentido e é fonte de transição travada ao voltar o foco).

Critério de aceite: primeiro clique após 10s parado responde no mesmo frame.

### Etapa 3 — Trocar `alignScrollOrigins` por captura de scroll não destrutiva

Remover a escrita em `scrollTop` do scroller ao vivo. Em vez disso:

- Aplicar `view-transition-name` no **conteúdo** já com o offset correto, e igualar as origens via CSS no pseudo-elemento: `::view-transition-old(...) { object-position: top left } ` + `object-fit: none`, com o grupo com `overflow: hidden`.
- Se ainda houver descasamento perceptível, a alternativa segura é aplicar `transform: translateY(-scrollTop)` num wrapper apenas durante a captura, revertido no mesmo tick — nunca mexer em `scrollTop`.

Critério de aceite: navegar de uma página rolada para outra não mostra salto ao topo, nem com a transição pulada.

### Etapa 4 — Unificar a restauração de scroll fora do `flushSync`

- Remover o `useLayoutEffect` duplicado (manter só um; preferir o de [useAppNavigation.ts:131](src/hooks/useAppNavigation.ts:131) e apagar o de [App.tsx:323](src/App.tsx:323)).
- Fazer a restauração acontecer **depois** da captura do novo snapshot: aplicar `scrollTo` de forma síncrona no mesmo layout effect, mas com `behavior: "instant"` explícito e sem `scrollTo({top})` com smooth herdado do CSS (`scroll-behavior`) — verificar se `.container__content` tem `scroll-behavior: smooth`; se tiver, forçar `instant` durante restauração.

Critério de aceite: voltar para uma página rolada restaura a posição sem animação de scroll visível.

### Etapa 5 — Tornar `view-transition-name` único por instância

- Trocar os seletores de classe por atribuição explícita: aplicar o nome via `style={{ viewTransitionName: ... }}` (ou um atributo `data-vt="tab-content"` usado no CSS) **apenas** no painel ativo de Settings e Profile.
- Garantir que modal aberto e skeleton **nunca** recebam o nome — o skeleton de `LoadingStates` e o `SubscriptionModal` reusam `.settings-panel`.
- Adicionar um guard de dev: antes de `startViewTransition`, `document.querySelectorAll` dos nomes conhecidos e `console.warn` se houver mais de um. Barato e evita regressão silenciosa.

Critério de aceite: abrir o modal de assinatura e trocar de aba de settings continua animando.

### Etapa 6 — Corrigir a geometria dos pseudo-elementos

Em [src/app.scss:996-1070](src/app.scss:996):

- `::view-transition-group(ghostbox-page-content)` e `(ghostbox-tab-content)`: `animation: none;` (não interpolar width/height) e manter `overflow: hidden`.
- `::view-transition-old/new(...)`: `object-fit: none; object-position: top left; width: 100%; height: 100%;` — ancoragem no topo-esquerda elimina o deslize vertical entre painéis de alturas diferentes.
- Remover `transform-origin: center center` dos filhos onde ele contradiz a ancoragem.
- Manter `mix-blend-mode: normal` (correto) e trocar as animações de entrada/saída para **só opacidade + translate em pixel inteiro** (evitar `scale(0.96)`/`scale(1.03)` em [app.scss:1071-1092](src/app.scss:1071), que produz texto sub-pixel borrado/trêmulo em telas 1x).

Critério de aceite: trocar entre abas com alturas muito diferentes não mostra o conteúdo escorregando.

### Etapa 7 — Estabilizar `contain`

Aplicar `contain: layout paint` de forma **permanente** em `.page-stack__base` / `.page-stack__overlay` / painéis de aba (não condicionado à classe `motion-*`), ou remover completamente. O que não pode é entrar e sair. Validar que nada dentro depende de overflow visível para fora do container.

Critério de aceite: nenhum reflow no frame que inicia a transição (checar em Performance → Layout Shift).

### Etapa 8 — Suprimir FLIP durante view transitions

Em [useFlipLayout.ts](src/hooks/useFlipLayout.ts):

- Adicionar um guard: se houver transição em voo (exportar `isViewTransitionActive()` de `viewTransition.ts`), apenas atualizar `previousRectsRef` e **não** animar. O view transition já cobre visualmente a mudança.
- Cancelar animações órfãs em cleanup (hoje só há cancel no caminho de reentrada).

Critério de aceite: trocar de aba dentro da biblioteca não faz os cards vibrarem.

### Etapa 9 — Remover os cursor-locks

Depois das etapas 1-8, remover `lockSidebarCursor` / `lockProfileTabsPointerCursor` e os blocos CSS `html.sidebar-cursor-lock` / `html.profile-tabs-cursor-lock` ([app.scss:360-388](src/app.scss:360)). Reavaliar; se o cursor ainda piscar, a causa restante é `pointer-events` durante a transição — tratar com `::view-transition { pointer-events: none }` em vez de timeout.

### Etapa 10 — Paridade com `reduceAllAnimations` / `prefers-reduced-motion`

- Hoje só `html.no-animations` desliga as coisas ([app.scss:10611](src/app.scss:10611)) e `@media (prefers-reduced-motion: reduce)` cobre pouquíssimo ([app.scss:13730](src/app.scss:13730)).
- Fazer `prefers-reduced-motion: reduce` aplicar o mesmo conjunto do `no-animations` (extrair para um mixin/`@extend` compartilhado) e garantir que ele também desative `::view-transition-*`.

---

## Ordem de execução recomendada

1, 2, 5 (as três que resolvem os pulos de troca rápida) → 3, 4 (teleporte de scroll) → 6, 7, 8 (tremor) → 9, 10 (limpeza).

Cada etapa é independentemente commitável e verificável.

## Verificação

- Rodar o app e exercitar: cliques rápidos alternando abas do Profile; alternando abas de Settings com modal de assinatura aberto; navegar página rolada → outra página → voltar; trocar formato de capa na biblioteca durante uma troca de aba.
- DevTools → Rendering → *Paint flashing* e *Layout Shift Regions* ligados: nenhuma região de shift deve piscar durante a transição.
- Conferir no console que o guard de `view-transition-name` duplicado (Etapa 5) nunca avisa.

---

## Correções pós-implementação

Defeitos encontrados na revisão da implementação e já corrigidos:

1. **Scrollbar sumia no perfil (Etapa 7 mal aplicada).** `contain: layout paint` foi
   fixado em `.page-stack__base` / `.page-stack__overlay` e `contain: paint` em
   `[data-vt="ghostbox-tab-content"]`. Containment de *paint* recorta o conteúdo na
   padding box, então o overflow deixa de propagar para o scroller
   `.container__content` — `scrollHeight === clientHeight` e a barra desaparece.
   Corrigido: containment removido dos dois `page-stack` e reduzido a
   `contain: layout style` no painel de aba (isola layout sem recortar).
   **Regra:** nunca usar `paint`/`content`/`strict` em um ancestral cujo conteúdo
   precisa rolar no scroller da página.

2. **Bloco `prefers-reduced-motion` morto (Etapa 10).** `::view-transition-group`,
   `-image-pair`, `-old` e `-new` são pseudo-elementos *funcionais*; sem argumento
   são inválidos e invalidam a lista de seletores inteira. Trocado por `(*)`.

3. **`transitionSequence` incrementado antes do guard `document.hidden`.** Navegar
   com a janela oculta durante uma transição em voo invalidava o `sequence` dela,
   e as classes `motion-*` nunca eram removidas do `<html>`. O bump passou para
   depois do guard.

4. **Fila órfã no `catch` de `startViewTransition`.** O caminho de erro não limpava
   `currentViewTransition` nem drenava `pendingUpdate` — o update pendente ficava
   preso até a próxima transição. Agora ambos são resolvidos no `catch`.

5. **`restorePendingScroll` não usado em `App.tsx`** após a Etapa 4 (erro TS6133).
   Removido do destructuring.

### Pendências conhecidas — resolvidas

6. **`ghostbox-page-content` movido para o scroller (as duas pendências acima).**
   O nome saiu de `.page-stack__base`/`.page-stack__overlay` (aplicado por classe)
   e passou para `.container__content` via `data-vt="ghostbox-page-content"`
   ([App.tsx](src/App.tsx), [app.scss](src/app.scss)).

   Sintoma que fechou o caso: **a titlebar sumia por um instante ao voltar para o
   perfil.** `.page-stack__base` tem a altura TOTAL do conteúdo — numa página
   rolada a caixa dela começa *acima* do viewport. Como o
   `::view-transition-group(ghostbox-page-content)` é pintado **depois** do
   snapshot `root` (que é quem carrega o header), o grupo cobria a faixa do
   header, e com `ghostbox-page-in` partindo de `opacity: 0` o resultado era a
   titlebar piscando. O perfil é a página mais alta do app, então era onde mais
   aparecia.

   O scroller tem exatamente o tamanho do scrollport e começa abaixo do header:
   snapshots antigo e novo sempre coincidem em geometria, `object-position: top
   left` deixa de descasar com o scroll, e nada mais invade a titlebar. De
   quebra, some o risco de nome duplicado base/overlay (a regra
   `view-transition-name: none` da base virou desnecessária) e o guard
   `warnDuplicateViewTransitionNames` passa a enxergar o elemento, porque agora
   ele é marcado com `data-vt`.
