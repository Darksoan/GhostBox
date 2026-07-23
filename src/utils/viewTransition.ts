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

  const root = document.documentElement;
  const sequence = ++transitionSequence;
  root.classList.remove(...transitionClasses);
  root.classList.add(...classes);

  const transition = viewTransitionDocument.startViewTransition(() => {
    flushSync(update);
  });

  const cleanup = () => {
    if (sequence !== transitionSequence) return;
    root.classList.remove(...transitionClasses);
  };
  void transition.finished.then(cleanup, cleanup);
}
