import { flushSync } from "react-dom";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

const transitionClasses = [
  "motion-page-transition",
  "motion-tab-transition",
  "motion-tab-forward",
  "motion-tab-backward",
];

let activeTransition: Promise<void> | null = null;
let pendingTransition: (() => void) | null = null;
let transitionSequence = 0;

function appMotionIsDisabled() {
  return document.documentElement.classList.contains("no-animations");
}

/**
 * Page transitions capture a raster snapshot of the OLD page, then a
 * snapshot of the NEW page after DOM update. If the OLD page is scrolled
 * (e.g. scrollTop=500 on profile) and the NEW page is at scrollTop=0
 * (home), the two snapshots show unrelated content regions. Cross-fading
 * them looks like a teleport.
 *
 * The fix: snap the OLD container to scrollTop=0 BEFORE the snapshot so
 * BOTH snapshots are taken from the same scroll origin. The user sees the
 * OLD content at the top of the page (brief, ~1 frame) cross-fading into
 * the NEW content at the top — no content-region jump.
 *
 * This does NOT freeze overflow, so `restorePendingScroll` in the new
 * page's useLayoutEffect still fires correctly and the NEW page will
 * restore its saved scroll position immediately after commit (before
 * the animation finishes — the raster is already captured by then).
 */
function alignScrollOrigins() {
  const el = document.querySelector<HTMLElement>(".container__content");
  if (el && el.scrollTop > 0) {
    el.scrollTop = 0;
  }
}

function clearTransitionClasses() {
  document.documentElement.classList.remove(...transitionClasses);
}

function startTransition(
  update: () => void,
  classes: string[],
  sequence: number,
): Promise<void> {
  const root = document.documentElement;
  root.classList.remove(...transitionClasses);
  root.classList.add(...classes);

  alignScrollOrigins();

  const viewTransitionDocument = document as ViewTransitionDocument;

  let transition: ReturnType<NonNullable<ViewTransitionDocument["startViewTransition"]>>;
  try {
    transition = viewTransitionDocument.startViewTransition!(() => {
      flushSync(() => {
        update();
      });
    });
  } catch {
    if (sequence === transitionSequence) {
      clearTransitionClasses();
    }
    update();
    return Promise.resolve();
  }

  return transition.finished.then(
    () => {
      if (sequence === transitionSequence) {
        clearTransitionClasses();
      }
    },
    () => {
      if (sequence === transitionSequence) {
        clearTransitionClasses();
      }
    },
  );
}

export function runViewTransition(
  update: () => void,
  enabled = true,
  classes: string[] = [],
) {
  const viewTransitionDocument = document as ViewTransitionDocument;
  if (!enabled || appMotionIsDisabled() || !viewTransitionDocument.startViewTransition) {
    update();
    return;
  }

  const sequence = ++transitionSequence;
  const next = () => startTransition(update, classes, sequence);

  // Coalesce: if a transition is already running, store only the latest
  // pending request. When the current one resolves, the most recent
  // pending runs. Earlier pending requests are dropped — the user only
  // ever sees their last clicked destination animate. This fixes the
  // "second click gets eaten" bug because we never lose the latest
  // intent, and we never queue more than one pending transition.
  if (activeTransition) {
    pendingTransition = next;
    return;
  }

  const run = (): Promise<void> => {
    activeTransition = next();
    return activeTransition.finally(() => {
      const pending = pendingTransition;
      pendingTransition = null;
      if (pending) {
        run();
      } else {
        activeTransition = null;
      }
    });
  };

  run();
}
