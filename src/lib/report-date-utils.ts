const APP_TIMEZONE = 'Asia/Kolkata'

export function toReportDateKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE })
}

export function reportDateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00+05:30`)
}

export function isValidReportDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key)
}
