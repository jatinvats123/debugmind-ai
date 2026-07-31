module.exports = {
  id: '04-missing-null-guard-coupon',
  category: 'missing-null-guard',
  difficulty: 'easy',
  description:
    'The unknown-coupon guard is removed, so an unrecognised code dereferences undefined and throws instead of being ignored.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/checkoutService.js',
    summary: 'applyDiscount dereferences coupon.percentOff without checking that the lookup succeeded.',
  },
  edits: [
    {
      file: 'src/services/checkoutService.js',
      find: '  const coupon = getCoupon(couponCode);\n  if (!coupon) return 0;\n  return percentOf(subtotal, coupon.percentOff);',
      replace: '  const coupon = getCoupon(couponCode);\n  return percentOf(subtotal, coupon.percentOff);',
    },
  ],
  expectedFailing: ['applyDiscount returns 0 for an unknown coupon code'],
};
