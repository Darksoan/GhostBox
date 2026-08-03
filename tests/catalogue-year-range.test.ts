import { describe, expect, it } from "vitest";
import type { CatalogueFilters } from "../src/types";
import {
  getSelectedFilterCount,
  getYearRangeIndices,
  getYearsInRange,
  sortYearValues,
} from "../src/utils/filters";

describe("Catalogue year range", () => {
  const years = ["2000", "2004", "2010", "2016"];

  it("sorts unique valid years chronologically", () => {
    expect(sortYearValues(["2016", "2000", "2016", "unknown", "2004"])).toEqual([
      "2000",
      "2004",
      "2016",
    ]);
  });

  it("returns selected range bounds from available years", () => {
    expect(getYearRangeIndices(years, ["2016", "2004"])).toEqual({
      start: 1,
      end: 3,
    });
  });

  it("materializes inclusive range values", () => {
    expect(getYearsInRange(years, 1, 3)).toEqual(["2004", "2010", "2016"]);
    expect(getYearsInRange(years, 3, 1)).toEqual(["2004", "2010", "2016"]);
  });

  it("counts selected year range as one filter", () => {
    const filters: CatalogueFilters = {
      genres: [],
      tags: [],
      developers: [],
      publishers: [],
      years: ["2004", "2010", "2016"],
    };

    expect(getSelectedFilterCount(filters)).toBe(1);
  });
});
