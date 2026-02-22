export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getCurrentWeek(): { week: number; year: number } {
  const now = new Date();
  return {
    week: getWeekNumber(now),
    year: now.getFullYear(),
  };
}

export function formatWeek(week: number, year: number): string {
  return `Week ${week}, ${year}`;
}
