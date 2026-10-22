const express = require('express');
const { getCoupon, isValidCouponFormat } = require('../data/coupons');

const router = express.Router();

// Lets the cart page check a code as the customer types it.
router.get('/:code', (req, res) => {
  const { code } = req.params;
  if (!isValidCouponFormat(code)) {
    return res.status(400).json({ error: 'Coupon codes are 4 to 12 letters or digits' });
  }
  const coupon = getCoupon(code);
  if (!coupon) {
    return res.status(404).json({ error: 'Coupon not found' });
  }
  res.json({ code: coupon.code, percentOff: coupon.percentOff });
});

module.exports = router;
