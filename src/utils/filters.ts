import type { PirateGame } from "../data";
import type { CatalogueFilters } from "../types";

export function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export function limitFilterValues(values: string[], selectedValues: string[]) {
  const selectedSet = new Set(selectedValues.filter(Boolean));
  const selected = [...selectedSet];
  const available = values.filter((value) => value && !selectedSet.has(value));

  return [...selected, ...available];
}

export function getSelectedFilterCount(filters: CatalogueFilters) {
  return Object.values(filters).reduce(
    (total, values) => total + values.length,
    0
  );
}

export function hasSelectedCatalogueFilters(filters: CatalogueFilters) {
  return getSelectedFilterCount(filters) > 0;
}

export function getReleaseYear(game: PirateGame) {
  const match = game.release.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? "Data indisponivel";
}

export function isHiddenLibraryGame(game: PirateGame) {
  const hiddenIds = new Set(["228980"]);
  return (
    hiddenIds.has(game.appId) ||
    game.title.toLowerCase().includes("steamworks common redistributables")
  );
}
