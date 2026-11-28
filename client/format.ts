/**
 * Formats a date for a locale. Some mobile JavaScript engines lack the dateStyle and timeStyle options or reject an
 * unknown locale, so this falls back to explicit fields and finally to ISO text instead of breaking the screen.
 */
export function dateFormatter(locale: string, style: "short" | "medium"): { format(value: Date): string } {
  const attempts: Array<() => Intl.DateTimeFormat> = [
    () => new Intl.DateTimeFormat(locale, { dateStyle: style, timeStyle: "short" }),
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: style === "short" ? "numeric" : "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    () => new Intl.DateTimeFormat(undefined, { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  ];
  for (const attempt of attempts) {
    try {
      const formatter = attempt();
      formatter.format(new Date(0));
      return formatter;
    } catch {
      // Try the next, simpler form.
    }
  }
  return { format: (value: Date) => value.toISOString().replace("T", " ").slice(0, 16) };
}
