const coupons = [
  { code: 'SAVE10', percentOff: 10 },
  { code: 'SAVE25', percentOff: 25 },
];

// Codes are 4 to 12 letters or digits, case-insensitive.
const COUPON_FORMAT = /^[A-Z0-9]{4,12}$/i;

function isValidCouponFormat(code) {
  return typeof code === 'string' && COUPON_FORMAT.test(code);
}

function getCoupon(code) {
  if (!code) return undefined;
  return coupons.find((c) => c.code === code.toUpperCase());
}

module.exports = {
  coupons,
  getCoupon,
  isValidCouponFormat,
};
