/**
 * Calendar-date helpers. Dates without a time ("2026-03-06") are represented
 * as UTC midnight so arithmetic never depends on the server's timezone.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// India Standard Time is UTC+05:30 all year (no daylight saving).
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse "YYYY-MM-DD" into a Date at UTC midnight, or null if it is not a real date. */
function parseDateOnly(value) {
  const match = DATE_ONLY.exec(String(value));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/** The calendar date, in India, on which an ISO timestamp falls. */
function istDateKey(isoTimestamp) {
  return new Date(Date.parse(isoTimestamp) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Add working days (Monday to Friday) to a date. */
function addBusinessDays(date, days) {
  const result = new Date(date.getTime());
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return result;
}

/** Whole calendar days from one date to another (negative if `to` is earlier). */
function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

module.exports = {
  parseDateOnly,
  formatDateOnly,
  istDateKey,
  addBusinessDays,
  daysBetween,
  MS_PER_DAY,
};
