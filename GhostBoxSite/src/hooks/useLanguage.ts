import { useCallback, useEffect, useState } from "react";
import { content, type Language, type SiteContent } from "../content";

const STORAGE_KEY = "ghostbox-site-language";

function isLanguage(value: string | null): value is Language {
  return value === "pt" || value === "en";
}

function detectLanguage(): Language {
  if (typeof window === "undefined") return "pt";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLanguage(stored)) return stored;
  return navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
}

/** Idioma da página + o conteúdo já resolvido. Persiste a escolha do usuário. */
export function useLanguage(): {
  language: Language;
  setLanguage: (next: Language) => void;
  t: SiteContent;
} {
  const [language, setLanguageState] = useState<Language>(detectLanguage);
  const t = content[language];

  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
    document.title = t.meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t.meta.description);
  }, [t]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return { language, setLanguage, t };
}
