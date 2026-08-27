import { en } from "./en";
import { pt } from "./pt";
import type { Language, SiteContent } from "./types";

export const content: Record<Language, SiteContent> = { pt, en };

export const LANGUAGES: Language[] = ["pt", "en"];

export const LANGUAGE_LABELS: Record<Language, string> = { pt: "PT", en: "EN" };

/** Substitui {price} e afins sem concatenar fragmentos ao redor da variável. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export type { Language, SiteContent };
