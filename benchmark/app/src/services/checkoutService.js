const { getOrCreateCart } = require('../models/cart');
const { reserveStock, hasSufficientStock } = require('./inventory');
const { getCoupon } = require('../data/coupons');
const { calculateShipping, cartWeight } = require('./shippingService');
const { authorize } = require('./paymentService');
const { saveOrder } = require('../data/orderRepository');
const { sumMoney, multiplyMoney, percentOf, roundMoney } = require('../utils/money');

const TAX_RATE_PERCENT = 8;

/** Line totals summed in cents so currency never drifts. */
function calculateSubtotal(items) {
  return sumMoney(items.map((item) => multiplyMoney(item.price, item.quantity)));
}

function applyDiscount(subtotal, couponCode) {
  if (!couponCode) return 0;
  const coupon = getCoupon(couponCode);
  if (!coupon) return 0;
  return percentOf(subtotal, coupon.percentOff);
}

function calculateTotals(cart, couponCode) {
  const subtotal = calculateSubtotal(cart.items);
  const discount = applyDiscount(subtotal, couponCode);
  const taxable = roundMoney(subtotal - discount);
  const tax = percentOf(taxable, TAX_RATE_PERCENT);
  const shipping = calculateShipping(subtotal, cartWeight(cart.items));
  const total = sumMoney([taxable, tax, shipping]);

  return { subtotal, discount, tax, shipping, total };
}

/**
 * Complete a checkout.
 *
 * Order of operations matters: the card is authorised BEFORE stock is
 * reserved, so a declined payment leaves inventory untouched.
 */
async function checkout(cartId, { couponCode, cardNumber } = {}) {
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

  // A decline must reject and abort the checkout — never fall through.
  const authorization = await authorize(cardNumber, totals.total);

  for (const item of cart.items) {
    reserveStock(item.productId, item.quantity);
  }

  const order = await saveOrder({
    cartId,
    items: cart.items.map((item) => ({ ...item })),
    ...totals,
    authorizationRef: authorization.reference,
    createdAt: new Date().toISOString(),
  });

  cart.clear();
  return order;
}

module.exports = {
  checkout,
  calculateTotals,
  calculateSubtotal,
  applyDiscount,
  TAX_RATE_PERCENT,
};
