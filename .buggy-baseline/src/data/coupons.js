const coupons = [
  { code: 'SAVE10', percentOff: 10 },
  { code: 'SAVE25', percentOff: 25 },
];

function getCoupon(code) {
  if (!code) return undefined;
  return coupons.find((c) => c.code === code.toUpperCase());
}

module.exports = {
  coupons,
  getCoupon,
};
