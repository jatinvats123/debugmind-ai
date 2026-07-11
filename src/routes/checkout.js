const express = require('express');
const { checkout } = require('../services/checkoutService');

const router = express.Router();

router.post('/', (req, res) => {
  const cartId = req.header('x-cart-id') || 'default';
  const { couponCode } = req.body || {};
  try {
    const order = checkout(cartId, couponCode);
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
