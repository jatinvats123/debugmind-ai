/**
 * JavaScript numbers are doubles, but the bitwise | operator converts its
 * operands to signed 32-bit integers. "| 0" is a common idiom for "make it an
 * integer", and it is harmless until a total passes 2^31 - 1 paise
 * (about ₹2.15 crore), where it wraps to a large negative number. Ordinary
 * orders never get near that; a day of B2B sales does.
 */
module.exports = {
  id: '24-int32-overflow-paise-sum',
  category: 'integer-overflow',
  difficulty: 'medium',
  description:
    'sumPaise truncates its running total with "| 0", which wraps at 2^31 paise (about ₹2.15 crore), so a day of large B2B orders reports a negative GMV.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/utils/paise.js',
    summary:
      '(total + paise) | 0 coerces the sum to a signed 32-bit integer; plain addition is exact up to Number.MAX_SAFE_INTEGER.',
  },
  edits: [
    {
      file: 'src/utils/paise.js',
      find: '  return amounts.reduce((total, paise) => total + paise, 0);',
      replace: '  return amounts.reduce((total, paise) => (total + paise) | 0, 0);',
    },
  ],
  expectedFailing: [
    'sumPaise adds amounts beyond ₹2.1 crore exactly',
    'dailySales totals a day of large B2B orders without overflowing',
  ],
};
