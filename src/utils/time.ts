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
