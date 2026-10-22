/**
 * Math.round and Math.floor agree whenever the fractional share is below one
 * half, so ₹100 in 3 instalments still comes out right. When it rounds up
 * (₹200 / 3 = 6666.67 paise) the computed remainder goes negative, no share is
 * adjusted, and the plan charges a paisa more than the order total.
 */
module.exports = {
  id: '25-instalment-rounding-remainder',
  category: 'money-rounding',
  difficulty: 'medium',
  description:
    'The base instalment is rounded instead of floored, so whenever a share rounds up the instalments add up to more than the order total (₹200 over 3 months charges ₹200.01).',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/utils/paise.js',
    summary: 'splitPaise uses Math.round for the base share; it must use Math.floor so the remainder is never negative.',
  },
  edits: [
    {
      file: 'src/utils/paise.js',
      find: '  const base = Math.floor(totalPaise / parts);',
      replace: '  const base = Math.round(totalPaise / parts);',
    },
  ],
  expectedFailing: [
    'splitPaise never loses or invents a paisa',
    'GET /instalments splits an order total into monthly instalments',
  ],
};
