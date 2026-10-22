module.exports = {
  id: '23-ms-per-day-unit-typo',
  category: 'unit-conversion',
  difficulty: 'easy',
  description:
    'MS_PER_DAY is missing a factor of 60 (it is the number of milliseconds in 24 minutes), so day counts come out 60 times too large and every return is reported as outside the 7-day window.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/utils/dates.js',
    summary: 'MS_PER_DAY = 24 * 60 * 1000; it must be 24 * 60 * 60 * 1000.',
  },
  edits: [
    {
      file: 'src/utils/dates.js',
      find: 'const MS_PER_DAY = 24 * 60 * 60 * 1000;',
      replace: 'const MS_PER_DAY = 24 * 60 * 1000;',
    },
  ],
  expectedFailing: [
    'GET /returns/eligibility accepts a return requested within the window',
    'GET /returns/eligibility accepts a return on the last day of the window',
    'GET /returns/eligibility refuses a return once the window has closed',
    'GET /returns/eligibility counts days correctly across the end of a month',
  ],
};
