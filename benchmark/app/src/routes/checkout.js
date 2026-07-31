const express = require('express');
const { checkout } = require('../services/checkoutService');

const router = express.Router();

router.post('/', async (req, res) => {
  const cartId = req.header('x-cart-id') || 'default';
  const { couponCode, cardNumber } = req.body || {};
  try {
    const order = await checkout(cartId, { couponCode, cardNumber });
    res.status(201).json(order);
  } catch (err) {
    // A declined card is a payment failure (402), not a malformed request.
    const status = err.declined ? 402 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
