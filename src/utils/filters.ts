import type { GhostBoxGame } from "../data";
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

export function sortYearValues(values: string[]) {
  return [...new Set(values.filter((value) => /^\d{4}$/.test(value)))].sort(
    (left, right) => Number(left) - Number(right)
  );
}

export function getYearRangeIndices(years: string[], selectedYears: string[]) {
  const selectedIndices = selectedYears.flatMap((year) => {
    const index = years.indexOf(year);
    return index >= 0 ? [index] : [];
  });

  if (!selectedIndices.length) {
    return { start: 0, end: Math.max(0, years.length - 1) };
  }

  return {
    start: Math.min(...selectedIndices),
    end: Math.max(...selectedIndices),
  };
}

export function getYearsInRange(years: string[], start: number, end: number) {
  const first = Math.max(0, Math.min(start, end));
  const last = Math.min(years.length - 1, Math.max(start, end));
  return years.slice(first, last + 1);
}

export function getSelectedFilterCount(filters: CatalogueFilters) {
  return Object.entries(filters).reduce(
    (total, [key, values]) => total + (key === "years" ? Number(values.length > 0) : values.length),
    0
  );
}

export function hasSelectedCatalogueFilters(filters: CatalogueFilters) {
  return getSelectedFilterCount(filters) > 0;
}

export function getReleaseYear(game: GhostBoxGame) {
  const match = game.release.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? "Data indisponivel";
}

export function isHiddenLibraryGame(game: GhostBoxGame) {
  const hiddenIds = new Set(["228980"]);
  return (
    hiddenIds.has(game.appId) ||
    game.title.toLowerCase().includes("steamworks common redistributables")
  );
}
