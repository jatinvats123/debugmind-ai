const express = require('express');
const { getOrCreateCart } = require('../models/cart');
const { parseQuantity } = require('../utils/validation');

const router = express.Router();

function resolveCartId(req) {
  return req.header('x-cart-id') || 'default';
}

router.get('/', (req, res) => {
  const cart = getOrCreateCart(resolveCartId(req));
  res.json({ items: cart.items, subtotal: cart.getSubtotal() });
});

router.post('/items', (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const cart = getOrCreateCart(resolveCartId(req));
  try {
    cart.addItem(productId, parseQuantity(quantity));
    res.status(201).json({ items: cart.items, subtotal: cart.getSubtotal() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk update from the cart page: { updates: [{ productId, quantity }] }.
// A quantity of 0 removes that line.
router.patch('/items', (req, res) => {
  const cart = getOrCreateCart(resolveCartId(req));
  try {
    const updates = (req.body.updates || []).map((u) => ({
      productId: u.productId,
      quantity: parseQuantity(u.quantity, { min: 0 }),
    }));
    cart.setQuantities(updates);
    res.json({ items: cart.items, subtotal: cart.getSubtotal() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/items/:productId', (req, res) => {
  const cart = getOrCreateCart(resolveCartId(req));
  try {
    cart.updateItemQuantity(req.params.productId, req.body.quantity);
    res.json({ items: cart.items, subtotal: cart.getSubtotal() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/items/:productId', (req, res) => {
  const cart = getOrCreateCart(resolveCartId(req));
  cart.removeItem(req.params.productId);
  res.json({ items: cart.items, subtotal: cart.getSubtotal() });
});

router.delete('/', (req, res) => {
  const cart = getOrCreateCart(resolveCartId(req));
  cart.clear();
  res.json({ items: cart.items, subtotal: cart.getSubtotal() });
});

module.exports = router;
