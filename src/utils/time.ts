export function formatCompactPlaytime(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));

  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}min`;

  const hours = totalSeconds / 3600;
  const formattedHours = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(hours);

  return `${formattedHours}h`;
}

/**
 * Parse a lastTimePlayed value into a unix-ms timestamp.
 *
 * Handles both formats:
 *  - ISO 8601 strings ("2024-07-08T21:50:08.000Z") — current format
 *  - Numeric ms-since-epoch strings ("1720475408000") — legacy format
 *
 * Returns NaN when the value is null, undefined, empty, or unparseable.
 */
export function parseLastPlayed(value: string | null | undefined): number {
  if (!value) return NaN;

  // Try ISO 8601 first (Date.parse handles this correctly)
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;

  // Fallback: legacy numeric millisecond string
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : NaN;
}
