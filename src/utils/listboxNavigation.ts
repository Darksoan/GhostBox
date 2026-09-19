import type { KeyboardEvent } from "react";

function getOptions(element: HTMLElement) {
  return Array.from(
    element.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)'),
  );
}

export function handleListboxTriggerKeyDown(
  event: KeyboardEvent<HTMLElement>,
  setOpen: (open: boolean) => void,
) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  event.preventDefault();
  setOpen(true);
  const dropdown = event.currentTarget.closest(".settings-dropdown");
  requestAnimationFrame(() => {
    const options = dropdown ? getOptions(dropdown as HTMLElement) : [];
    options[event.key === "ArrowUp" ? options.length - 1 : 0]?.focus();
  });
}

export function handleListboxKeyDown(
  event: KeyboardEvent<HTMLElement>,
  setOpen: (open: boolean) => void,
) {
  const options = getOptions(event.currentTarget);
  if (!options.length) return;

  const currentIndex = options.indexOf(document.activeElement as HTMLElement);
  let nextIndex: number | null = null;

  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % options.length;
  if (event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + options.length) % options.length;
  }
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = options.length - 1;

  if (event.key === "Escape") {
    event.preventDefault();
    setOpen(false);
    const trigger = event.currentTarget
      .closest(".settings-dropdown")
      ?.querySelector<HTMLElement>(".settings-dropdown__trigger");
    trigger?.focus();
    return;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  options[nextIndex]?.focus();
}
