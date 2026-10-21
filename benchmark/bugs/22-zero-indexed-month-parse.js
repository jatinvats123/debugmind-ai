/**
 * The month is treated as 0-indexed in both the constructor and the
 * round-trip check, so the check passes and every date silently moves one
 * month later. Differences between two dates in the same month still come out
 * right, which is why most return-window tests keep passing.
 */
module.exports = {
  id: '22-zero-indexed-month-parse',
  category: 'date-math',
  difficulty: 'medium',
  description:
    'parseDateOnly passes the 1-based month from "YYYY-MM-DD" straight to Date.UTC, which expects 0-11, so every parsed date lands a month late: delivery estimates are a month out, 30 February is accepted, and day counts across a month end are wrong.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/utils/dates.js',
    summary: 'Date.UTC(year, month, day) and the getUTCMonth() check both need month - 1.',
  },
  edits: [
    {
      file: 'src/utils/dates.js',
      find:
        '  const date = new Date(Date.UTC(year, month - 1, day));\n' +
        '  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;',
      replace:
        '  const date = new Date(Date.UTC(year, month, day));\n' +
        '  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;',
    },
  ],
  expectedFailing: [
    'GET /delivery/estimate delivers to a metro pincode in two business days',
    'GET /delivery/estimate skips the weekend for a regional delivery',
    'GET /delivery/estimate serves an unlisted pincode through the national network, prepaid only',
    'GET /delivery/estimate rejects a date that does not exist',
    'GET /returns/eligibility counts days correctly across the end of a month',
  ],
};
