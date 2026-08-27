// GERADO por GhostBoxSite/scripts/optimize-shots.mjs — não editar à mão.
// Fonte: capturas reais do launcher em GhostBoxSite/screenshots/.

export interface AppShotAsset {
  src: string;
  small: string;
  /** Dimensões do PNG original — a página reserva a caixa antes de carregar. */
  width: number;
  height: number;
}

export type ShotVariant = "home" | "library" | "catalogue" | "achievements";

export const shots: Partial<Record<ShotVariant, AppShotAsset>> = {
  "home": {
    "src": "/shots/home.webp",
    "small": "/shots/home@sm.webp",
    "width": 1317,
    "height": 712
  },
  "catalogue": {
    "src": "/shots/catalogue.webp",
    "small": "/shots/catalogue@sm.webp",
    "width": 1317,
    "height": 712
  },
  "achievements": {
    "src": "/shots/achievements.webp",
    "small": "/shots/achievements@sm.webp",
    "width": 1317,
    "height": 712
  }
};
