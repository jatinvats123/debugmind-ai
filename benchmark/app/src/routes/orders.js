const express = require('express');
const { findOrder, listOrders } = require('../data/orderRepository');

const router = express.Router();

router.get('/', async (req, res) => {
  const orders = await listOrders();
  res.json(orders);
});

router.get('/:id', async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(order);
});

module.exports = router;
