const express = require('express');
const { listOrders } = require('../data/orderRepository');
const { dailySales } = require('../services/reportService');

const router = express.Router();

router.get('/daily-sales', async (req, res, next) => {
  try {
    res.json(dailySales(await listOrders()));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
