// A paleta do contorno muda a cada dez níveis. Mantemos o círculo da sidebar
// também nas centenas, repetindo a sequência de cores do Steam.
export function getSteamLevelColorTier(level: number | null): number {
  if (level === null || !Number.isFinite(level) || level < 0) return 0;
  return (Math.floor(level / 10) % 10) * 10;
}
