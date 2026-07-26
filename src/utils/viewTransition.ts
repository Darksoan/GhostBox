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

let transitionSequence = 0;
let transitionQueue: Promise<void> | null = null;

function appMotionIsDisabled() {
  return document.documentElement.classList.contains("no-animations");
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

  const run = (): Promise<void> => {
    if (appMotionIsDisabled()) {
      update();
      return Promise.resolve();
    }

    const root = document.documentElement;
    const sequence = ++transitionSequence;
    root.classList.remove(...transitionClasses);
    root.classList.add(...classes);

    let transition: ReturnType<NonNullable<ViewTransitionDocument["startViewTransition"]>>;
    try {
      transition = viewTransitionDocument.startViewTransition(() => {
        flushSync(update);
      });
    } catch {
      root.classList.remove(...transitionClasses);
      update();
      return Promise.resolve();
    }

    const cleanup = () => {
      if (sequence !== transitionSequence) return;
      root.classList.remove(...transitionClasses);
    };

    return transition.finished.then(cleanup, cleanup);
  };

  if (!transitionQueue) {
    const current = run().finally(() => {
      if (transitionQueue === current) {
        transitionQueue = null;
      }
    });
    transitionQueue = current;
    return;
  }

  const queued = transitionQueue
    .then(
      () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => {
            void run().then(resolve, resolve);
          });
        }),
    )
    .finally(() => {
      if (transitionQueue === queued) {
        transitionQueue = null;
      }
    });
  transitionQueue = queued;
}
