export const toastDurationOptions = [3, 6, 10, 15] as const;
export type ToastDurationSeconds = (typeof toastDurationOptions)[number];

export function normalizeToastDuration(value: unknown): ToastDurationSeconds {
  return toastDurationOptions.includes(value as ToastDurationSeconds)
    ? (value as ToastDurationSeconds)
    : 6;
}
