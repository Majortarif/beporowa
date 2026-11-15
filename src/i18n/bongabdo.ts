/**
 * Bengali calendar (Bangladesh revised calendar, 2019 onward).
 * Intl has no Bengali calendar, so it is computed here:
 * 1 Boishakh is always 14 April. Boishakh to Ashwin have 31 days,
 * Kartik to Magh and Choitro have 30, Falgun has 29 (30 in a leap year).
 */

export interface BongabdoDate {
  year: number;
  /** 0 is Boishakh, 11 is Choitro. */
  monthIndex: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function monthLengths(gregorianYearOfFalgun: number): number[] {
  const falgun = isLeapYear(gregorianYearOfFalgun) ? 30 : 29;
  return [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, falgun, 30];
}

export function toBongabdo(date: Date): BongabdoDate {
  const year = date.getFullYear();
  const beforeBoishakh = date.getMonth() < 3 || (date.getMonth() === 3 && date.getDate() < 14);
  const startYear = beforeBoishakh ? year - 1 : year;

  // Date arithmetic in UTC so daylight-saving changes cannot shift the count.
  const today = Date.UTC(year, date.getMonth(), date.getDate());
  const start = Date.UTC(startYear, 3, 14);
  let remaining = Math.round((today - start) / 86400000);

  const lengths = monthLengths(startYear + 1);
  let monthIndex = 0;
  while (remaining >= lengths[monthIndex]) {
    remaining -= lengths[monthIndex];
    monthIndex++;
  }
  return { year: startYear - 593, monthIndex, day: remaining + 1 };
}
