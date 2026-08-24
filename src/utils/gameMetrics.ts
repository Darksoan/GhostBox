import type { AppearanceSettings } from "../context/settings";
import type {
  ControllerSupportStatus,
  GameLanguageSupport,
  GhostBoxGame,
} from "../data";

export interface SteamReviewScore {
  /** Percentual de avaliações positivas, 0-100 já arredondado. */
  percent: number;
  reviewCount: number;
}

/**
 * Nota de reviews da Steam de um jogo, ou `null` quando o catálogo ainda não
 * respondeu (o enrichment chega card a card) ou não tem amostra.
 *
 * A contagem entra na guarda junto com a razão: `steamPositiveRatio` sozinho
 * volta 0 nas linhas sem amostra, e 0 lido como nota vira "0% positivo" num
 * jogo que só não tem review contada ainda.
 */
export function getSteamReviewScore(
  game: Pick<GhostBoxGame, "steamPositiveRatio" | "steamReviewCount">
): SteamReviewScore | null {
  const ratio = game.steamPositiveRatio;
  const reviewCount = game.steamReviewCount;
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return null;
  if (reviewCount == null || reviewCount <= 0) return null;

  return { percent: Math.round(ratio * 100), reviewCount };
}

/** "1,2 mi" / "1.2M" — contagens de review não cabem por extenso num card. */
export function formatCompactCount(
  value: number,
  language: AppearanceSettings["language"]
) {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Faixa de qualidade de uma nota 0-100, no mesmo corte que o Metacritic usa
 * para colorir seus selos. Só a classificação: a cor fica no SCSS.
 */
export function getScoreTone(score: number): "high" | "mid" | "low" {
  if (score >= 75) return "high";
  if (score >= 50) return "mid";
  return "low";
}

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
