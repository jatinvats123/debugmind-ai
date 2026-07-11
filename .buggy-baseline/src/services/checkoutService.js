const { getOrCreateCart } = require('../models/cart');
const { reserveStock, hasSufficientStock } = require('./inventory');
const { getCoupon } = require('../data/coupons');

const TAX_RATE = 0.08;

function calculateSubtotal(items) {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function applyDiscount(subtotal, couponCode) {
  if (!couponCode) return 0;
  const coupon = getCoupon(couponCode);
  if (!coupon) return 0;
  return subtotal * coupon.percentOff;
}

function calculateTotals(cart, couponCode) {
  const subtotal = calculateSubtotal(cart.items);
  const discount = applyDiscount(subtotal, couponCode);
  const taxableAmount = subtotal - discount;
  const tax = taxableAmount * TAX_RATE;
  const total = taxableAmount + tax;

  return { subtotal, discount, tax, total };
}

function checkout(cartId, couponCode) {
  const cart = getOrCreateCart(cartId);
  if (cart.items.length === 0) {
    throw new Error('Cart is empty');
  }

  for (const item of cart.items) {
    if (!hasSufficientStock(item.productId, item.quantity)) {
      throw new Error(`Insufficient stock for product ${item.productId}`);
    }
  }

  const totals = calculateTotals(cart, couponCode);

  if (!Number.isFinite(totals.total)) {
    throw new Error('Unable to calculate a valid order total');
  }

  for (const item of cart.items) {
    reserveStock(item.productId, item.quantity);
  }

  const order = {
    id: `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    cartId,
    items: cart.items,
    ...totals,
    createdAt: new Date().toISOString(),
  };

  cart.clear();
  return order;
}

module.exports = {
  checkout,
  calculateTotals,
  calculateSubtotal,
  applyDiscount,
};
