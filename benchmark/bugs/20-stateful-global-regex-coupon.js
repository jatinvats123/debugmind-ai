/**
 * A regex literal with the g flag keeps lastIndex between calls to test().
 * After a successful match, the next call starts searching at the previous
 * match's end, fails, and resets lastIndex to 0, so answers alternate
 * true/false for the same input. Which tests fail depends on the call that
 * happened just before, including calls made by other tests and by the route.
 */
module.exports = {
  id: '20-stateful-global-regex-coupon',
  category: 'wrong-regex',
  difficulty: 'hard',
  description:
    'The coupon-format regex carries the g flag, so test() is stateful: checking a valid code twice in a row returns true then false, and a well-formed unknown code is rejected as malformed (400) instead of not found (404).',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/data/coupons.js',
    summary: 'COUPON_FORMAT is /^[A-Z0-9]{4,12}$/gi; the g flag makes .test() advance lastIndex between calls.',
  },
  edits: [
    {
      file: 'src/data/coupons.js',
      find: 'const COUPON_FORMAT = /^[A-Z0-9]{4,12}$/i;',
      replace: 'const COUPON_FORMAT = /^[A-Z0-9]{4,12}$/gi;',
    },
  ],
  expectedFailing: [
    'isValidCouponFormat accepts codes of 4 to 12 letters or digits',
    'isValidCouponFormat gives the same answer every time the same code is checked',
    'GET /coupons/:code returns 404 for a well-formed code that does not exist',
  ],
};
