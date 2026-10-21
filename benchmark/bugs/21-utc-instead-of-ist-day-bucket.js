/**
 * Deterministic on any machine: the bug uses the UTC calendar date rather than
 * the server's local zone, so it fails the same way in CI (UTC) and on a
 * developer laptop in India.
 */
module.exports = {
  id: '21-utc-instead-of-ist-day-bucket',
  category: 'timezone',
  difficulty: 'medium',
  description:
    'Daily sales are bucketed by the UTC date instead of the date in India, so orders placed between 00:00 and 05:30 IST are counted towards the previous day.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/utils/dates.js',
    summary: 'istDateKey drops the +05:30 offset and returns the UTC calendar date.',
  },
  edits: [
    {
      file: 'src/utils/dates.js',
      find: '  return new Date(Date.parse(isoTimestamp) + IST_OFFSET_MS).toISOString().slice(0, 10);',
      replace: '  return new Date(isoTimestamp).toISOString().slice(0, 10);',
    },
  ],
  expectedFailing: [
    'istDateKey rolls over to the next day at midnight India time, 18:30 UTC',
    'dailySales buckets orders by the business day in India',
    'GET /reports/daily-sales reports persisted orders by IST business day',
  ],
};
