import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
 * Generic scroll-snap rail: prev/next arrows, smooth page-by-viewport
 * scrolling, and arrow visibility tracked via a rAF-throttled scroll handler.
 * Extracted from the Home page's category rail — see HomeExploreCategories.
 */
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

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

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
  }, [itemOrderKey]);

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

    carousel.scrollBy({
      left: direction * carousel.clientWidth,
      behavior: "smooth",
    });
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
