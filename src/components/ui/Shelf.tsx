import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { SectionHeader } from "./SectionHeader";
import { useRafThrottle } from "../../hooks/useRafThrottle";

interface ShelfProps<T> {
  title: string;
  /** Heading rico; `title` segue sendo o texto do `aria-label` da seção. */
  titleContent?: ReactNode;
  subtitle?: string;
  action?: ReactNode;
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, rootRef: RefObject<HTMLDivElement | null>) => ReactNode;
  /** Prev/next arrows only appear once there is more than one screen's worth of content. */
  minItemsForControls?: number;
  prevLabel: string;
  nextLabel: string;
  /**
   * BEM block name for the generated markup (`${blockName}__rail`, `__arrow`,
   * `__carousel`, `__track`). Defaults to "shelf". Callers with existing CSS
   * for their own block name (e.g. "home-explore") pass it here so this
   * extraction doesn't require touching that CSS at all.
   */
  blockName?: string;
}

/**
 * Generic scroll-snap rail: prev/next arrows, page-by-viewport scrolling with
 * a fixed duration/easing owned by JS, and arrow visibility tracked via a
 * rAF-throttled scroll handler. Extracted from the Home page's category rail
 * — see HomeExploreCategories.
 *
 * Motion (skill `motion-design`, arquétipo Corporate/Premium do projeto):
 * a navegação é um movimento on-screen de peso médio (cards), então usa
 * duração fixa (~450ms = base Corporate 300ms × escala de distância 1.5x
 * para ~1 viewport) com desaceleração (`ease-out`, mesma família do
 * `--ease-out` do projeto). Duração fixa = velocidade percebida constante:
 * o `scroll-behavior: smooth` nativo varia a duração conforme a distância e
 * cada clique partia de um ponto distinto da animação anterior — daí a
 * alternância de velocidade. O snap `mandatory` brigava com o voo suave e o
 * passo ignorava o `gap`, então o snap corrigia depois com outra velocidade
 * (o "rasgo"); por isso o passo alinha na grade card+gap e o snap desliga
 * durante o voo (classe `--animating`).
 */
const SHELF_SCROLL_DURATION_MS = 450;

/** Desaceleração cúbica: entrada rápida, pouso suave (família ease-out). */
function shelfEaseOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/** Movimento só sai de cena pelo toggle interno (`html.no-animations`):
 * efeitos do SO desligados não congelam o carrossel. */
function shelfMotionDisabled(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("no-animations")
  );
}

/**
 * Passo de uma página alinhado à grade card+gap. `scrollBy(clientWidth)`
 * ignorava o `gap`, então o pouso caía entre cards e o snap `mandatory`
 * puxava o resto depois — dois movimentos com duas velocidades (o "rasgo"
 * + a alternância). Aqui a página é N×(card+gap) e o alvo arredonda para a
 * fronteira de card mais próxima, então o pouso já é o ponto de snap.
 */
function getShelfPageMetrics(carousel: HTMLDivElement): {
  cardStep: number;
  page: number;
} {
  const viewport = carousel.clientWidth;
  const track = carousel.firstElementChild as HTMLElement | null;
  const firstCard = track?.children[0] as HTMLElement | undefined;

  if (!track || !firstCard) return { cardStep: viewport, page: viewport };

  const trackStyle = getComputedStyle(track);
  const gap =
    Number.parseFloat(trackStyle.columnGap || trackStyle.gap || "0") || 0;
  const cardWidth = firstCard.getBoundingClientRect().width;

  if (!Number.isFinite(cardWidth) || cardWidth <= 0) {
    return { cardStep: viewport, page: viewport };
  }

  const cardStep = cardWidth + gap;
  const perPage = Math.max(1, Math.round(viewport / cardStep));
  return { cardStep, page: perPage * cardStep };
}

export function Shelf<T>({
  title,
  titleContent,
  subtitle,
  action,
  items,
  getKey,
  renderItem,
  minItemsForControls = 5,
  prevLabel,
  nextLabel,
  blockName = "shelf",
}: ShelfProps<T>) {
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const hasControls = items.length > minItemsForControls;
  const itemOrderKey = items.map(getKey).join("|");
  const scrollAnimationRef = useRef<number | null>(null);

  const cancelScrollAnimation = useCallback(() => {
    if (scrollAnimationRef.current !== null) {
      cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = null;
    }
  }, []);

  useEffect(() => cancelScrollAnimation, [cancelScrollAnimation]);

  const syncEdgeStates = useCallback(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsAtStart(carousel.scrollLeft <= 1);
    setIsAtEnd(
      carousel.scrollLeft + carousel.clientWidth >=
        carousel.scrollWidth - 2
    );
  }, []);

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    cancelScrollAnimation();
    carousel.classList.remove(`${blockName}__carousel--animating`);
    // O reset precisa ser instantâneo: `scroll-behavior: smooth` do CSS do
    // carrossel também se aplica a atribuições via JS, então sem desligá-lo
    // aqui o reset vira uma animação visível de volta ao início sempre que o
    // browser tiver reposicionado o offset antes (o re-snap obrigatório dispara
    // quando os cards trocam — os dados da home chegam em etapas no arranque).
    const { style } = carousel;
    const previousBehavior = style.scrollBehavior;
    style.scrollBehavior = "auto";
    carousel.scrollLeft = 0;
    // A leitura abaixo força o layout (e o re-snap do snap `mandatory` que vem
    // junto); o segundo assert garante o início mesmo depois dele. Como isso
    // roda em layout effect, nada disso aparece pintado na tela.
    setIsAtEnd(carousel.clientWidth >= carousel.scrollWidth - 2);
    carousel.scrollLeft = 0;
    style.scrollBehavior = previousBehavior;
    setIsAtStart(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemOrderKey, blockName, cancelScrollAnimation]);

  const handleScroll = useRafThrottle(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsAtStart(carousel.scrollLeft <= 1);
    setIsAtEnd(
      carousel.scrollLeft + carousel.clientWidth >=
      carousel.scrollWidth - 2
    );
  });

  if (!items.length) return null;

  const scroll = (direction: -1 | 1) => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    // Novo clique interrompe o voo anterior partindo da posição atual, com a
    // mesma duração/easing — cliques rápidos mantêm a mesma velocidade em vez
    // de enfileirar rolamentos nativos de durações distintas.
    cancelScrollAnimation();

    const maxScroll = carousel.scrollWidth - carousel.clientWidth;
    if (maxScroll <= 0) return;

    const { cardStep, page } = getShelfPageMetrics(carousel);
    const start = carousel.scrollLeft;
    const rawTarget = start + direction * page;
    const snappedTarget =
      cardStep > 0 ? Math.round(rawTarget / cardStep) * cardStep : rawTarget;
    const target = Math.min(Math.max(snappedTarget, 0), maxScroll);
    if (Math.abs(target - start) < 1) {
      carousel.scrollLeft = target;
      syncEdgeStates();
      return;
    }

    if (shelfMotionDisabled()) {
      carousel.scrollLeft = target;
      syncEdgeStates();
      return;
    }

    // Sem snap durante o voo: `proximity`/`mandatory` corrigiriam o offset no
    // meio da animação com outra curva/velocidade (o "rasgo"). O alvo já é
    // fronteira de card, então o pouso coincide com o ponto de snap.
    const animatingClass = `${blockName}__carousel--animating`;
    const { style } = carousel;
    const previousBehavior = style.scrollBehavior;
    style.scrollBehavior = "auto";
    carousel.classList.add(animatingClass);

    const from = start;
    const delta = target - from;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const finish = () => {
      scrollAnimationRef.current = null;
      carousel.classList.remove(animatingClass);
      style.scrollBehavior = previousBehavior;
      carousel.scrollLeft = target;
      syncEdgeStates();
    };

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(elapsed / SHELF_SCROLL_DURATION_MS, 1);
      carousel.scrollLeft = from + delta * shelfEaseOutCubic(progress);
      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };

    scrollAnimationRef.current = requestAnimationFrame(tick);
  };

  return (
    <section className={blockName} aria-label={title}>
      <SectionHeader
        title={title}
        titleContent={titleContent}
        subtitle={subtitle}
        action={action}
      />
      <div className={`${blockName}__rail`}>
        {hasControls && (
          <button
            type="button"
            className={`${blockName}__arrow ${blockName}__arrow--prev`}
            aria-label={prevLabel}
            onClick={() => scroll(-1)}
            style={{ visibility: isAtStart ? "hidden" : "visible" }}
          >
            <ChevronLeft size={30} strokeWidth={2.0} aria-hidden="true" />
          </button>
        )}
        <div className={`${blockName}__carousel`} ref={carouselRef} onScroll={handleScroll}>
          <div className={`${blockName}__track`}>
            {items.map((item) => (
              <Fragment key={getKey(item)}>{renderItem(item, carouselRef)}</Fragment>
            ))}
          </div>
        </div>
        {hasControls && (
          <button
            type="button"
            className={`${blockName}__arrow ${blockName}__arrow--next`}
            aria-label={nextLabel}
            onClick={() => scroll(1)}
            style={{ visibility: isAtEnd ? "hidden" : "visible" }}
          >
            <ChevronRight size={30} strokeWidth={2.0} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
