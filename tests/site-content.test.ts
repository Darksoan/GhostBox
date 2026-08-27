import { describe, expect, it } from "vitest";
import { content, fill } from "../GhostBoxSite/src/content";
import { DISCORD_URL, DOWNLOAD_URL } from "../GhostBoxSite/src/content/links";
import { planMonthlyPriceLabel, planPriceLabel } from "../src/lib/subscriptionPricing";

/** Caminhos de todas as folhas de um objeto, para comparar formato entre idiomas. */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe("conteúdo do site", () => {
  it("tem a mesma forma em pt e en", () => {
    expect(leafPaths(content.en).sort()).toEqual(leafPaths(content.pt).sort());
  });

  it("não deixa nenhuma string vazia fora dos campos opcionais", () => {
    const optional = new Set(["premium.plans[0].perMonth"]);
    for (const language of ["pt", "en"] as const) {
      for (const path of leafPaths(content[language])) {
        if (optional.has(path)) continue;
        const value = path
          .split(/[.[\]]+/)
          .filter(Boolean)
          .reduce<any>((node, key) => node[key], content[language]);
        expect(typeof value === "string" ? value.trim() : value, `${language}.${path}`).not.toBe("");
      }
    }
  });

  it("usa só destinos reais e verificados", () => {
    expect(DOWNLOAD_URL).toBe("https://github.com/Darksoan/GhostBox/releases/latest");
    expect(DISCORD_URL).toBe("https://discord.gg/hubcapsmanifest");

    for (const language of ["pt", "en"] as const) {
      const site = content[language];
      const hrefs = [
        ...site.nav.links.map((link) => link.href),
        ...site.footer.legal.map((link) => link.href),
        ...site.footer.social.map((link) => link.href),
      ];
      for (const href of hrefs) {
        expect(href, `${language}: ${href}`).toMatch(/^(#|\/|https:\/\/)/);
      }
      expect(site.footer.legal.map((link) => link.href)).toEqual([
        "/terms",
        "/privacy",
        "/refund",
      ]);
    }
  });

  it("descreve os planos com a mesma cadência da fonte de preço do app", () => {
    for (const language of ["pt", "en"] as const) {
      const plans = content[language].premium.plans;
      expect(plans.map((plan) => plan.id)).toEqual(["monthly", "quarterly"]);

      const quarterly = plans[1];
      const perMonth = fill(quarterly.perMonth, {
        price: planMonthlyPriceLabel("quarterly", language),
      });
      expect(perMonth).toContain(planMonthlyPriceLabel("quarterly", language));
      expect(perMonth).not.toContain("{price}");
      expect(plans[0].perMonth).toBe("");
    }

    // O preço nunca é escrito no conteúdo: vem de src/lib/subscriptionPricing.ts.
    const serialized = JSON.stringify(content);
    for (const price of [
      planPriceLabel("monthly", "pt"),
      planPriceLabel("quarterly", "pt"),
      planPriceLabel("monthly", "en"),
      planPriceLabel("quarterly", "en"),
    ]) {
      expect(serialized).not.toContain(price);
    }
  });

  it("mantém as três políticas com o mesmo número de parágrafos nos dois idiomas", () => {
    for (const slug of ["terms", "privacy", "refund"] as const) {
      expect(content.pt.policies[slug].paragraphs).toHaveLength(
        content.en.policies[slug].paragraphs.length,
      );
      expect(content.pt.policies[slug].slug).toBe(slug);
    }
  });
});
