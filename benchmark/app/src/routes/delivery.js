const express = require('express');
const { estimateDelivery } = require('../services/deliveryService');

const router = express.Router();

// GET /delivery/estimate?pincode=110001&date=2026-03-06&total=1200
router.get('/estimate', async (req, res, next) => {
  try {
    const estimate = await estimateDelivery({
      pincode: req.query.pincode,
      orderDate: req.query.date,
      orderTotal: Number(req.query.total) || 0,
    });
    res.json(estimate);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
