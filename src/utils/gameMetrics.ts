import type {
  ControllerSupportStatus,
  GameLanguageSupport,
} from "../data";

/**
 * Faz o parse da string HTML `supported_languages` da Steam appdetails.
 *
 * Formato típico: "Inglês<strong>*</strong>, Francês, Português (Brasil)
 * <strong>*</strong><br>legendas em ..." — cada idioma seguido de
 * `<strong>*</strong>` quando tem dublagem/áudio; após o primeiro `<br>` vem
 * apenas a nota de legendas, que não entra na tabela.
 */
export function parseSupportedLanguages(
  raw?: string | null
): GameLanguageSupport[] {
  if (!raw) return [];

  const firstBlock = raw.split(/<br\s*\/?>/i)[0] ?? "";
  return firstBlock
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ({
      language: entry
        .replace(/<strong>\s*\*\s*<\/strong>/gi, "")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .trim(),
      hasAudio: entry.includes("*"),
    }))
    .filter((lang) => lang.language.length > 0);
}

/**
 * Normaliza o valor cru de `controllerSupport`/`controller_support` vindo dos
 * payloads de detalhes para um `ControllerSupportStatus`. Valores vazios ou
 * desconhecidos viram "none".
 */
export function resolveControllerSupportStatus(
  raw?: string | null
): ControllerSupportStatus {
  const value = raw?.trim().toLowerCase();
  if (value === "full" || value === "partial") return value;
  return "none";
}

export interface ControllerSupportCopy {
  label: string;
  description?: string;
}

/** Rótulos pt/en por status, no mesmo formato do badge do Hydra. */
export function getControllerSupportCopy(
  status: ControllerSupportStatus,
  isEnglish: boolean
): ControllerSupportCopy {
  switch (status) {
    case "full":
      // Sem subtexto: o badge "SUPORTE TOTAL" ja basta — a descricao era
      // redundante embaixo das logos de PlayStation/Xbox.
      return {
        label: isEnglish ? "FULL SUPPORT" : "SUPORTE TOTAL",
      };
    case "partial":
      return {
        label: isEnglish ? "PARTIAL SUPPORT" : "SUPORTE PARCIAL",
        description: isEnglish
          ? "Some menus may require keyboard and mouse."
          : "Alguns menus podem exigir teclado e mouse.",
      };
    default:
      return {
        label: isEnglish ? "NO SUPPORT" : "SEM SUPORTE",
      };
  }
}
