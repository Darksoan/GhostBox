type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

export function runViewTransition(update: () => void, enabled = true) {
  const viewTransitionDocument = document as ViewTransitionDocument;
  if (!enabled || !viewTransitionDocument.startViewTransition) {
    update();
    return;
  }

  viewTransitionDocument.startViewTransition(update);
}
