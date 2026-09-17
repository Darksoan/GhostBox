import { describe, expect, it } from "vitest";

import {
  isLandscapeImageSource,
  isPortraitLibraryImageSource,
} from "../src/utils/image";

describe("Steam library image sources", () => {
  it("recognizes legacy and hashed vertical library capsule assets", () => {
    expect(
      isPortraitLibraryImageSource(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/library_capsule.jpg",
      ),
    ).toBe(true);
    expect(
      isPortraitLibraryImageSource(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/9f1d/library_600x900.jpg?t=1",
      ),
    ).toBe(true);
  });

  it("keeps header and horizontal capsule assets eligible", () => {
    expect(
      isPortraitLibraryImageSource(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg",
      ),
    ).toBe(false);
    expect(
      isLandscapeImageSource(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/header_2x.jpg",
      ),
    ).toBe(true);
    expect(
      isPortraitLibraryImageSource(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/capsule_616x353.jpg",
      ),
    ).toBe(false);
  });
});
