const { roundMoney } = require('../utils/money');

/**
 * Weight-banded shipping rates. Bands are inclusive of their upper bound:
 * a 1.0kg parcel ships at the 1kg rate, not the next band up.
 */
const BANDS = [
  { maxKg: 1, price: 4.99 },
  { maxKg: 5, price: 8.99 },
  { maxKg: 20, price: 15.99 },
];
const OVERSIZE_PRICE = 29.99;

const FREE_SHIPPING_THRESHOLD = 100;

function rateForWeight(weightKg) {
  for (const band of BANDS) {
    if (weightKg <= band.maxKg) return band.price;
  }
  return OVERSIZE_PRICE;
}

/**
 * Shipping cost for an order. Orders at or above the free-shipping threshold
 * ship free regardless of weight.
 */
function calculateShipping(subtotal, weightKg) {
  if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return roundMoney(rateForWeight(weightKg));
}

/** Total weight of the cart's items. */
function cartWeight(items) {
  return items.reduce((total, item) => total + (item.weightKg || 0) * item.quantity, 0);
}

module.exports = {
  calculateShipping,
  rateForWeight,
  cartWeight,
  BANDS,
  FREE_SHIPPING_THRESHOLD,
  OVERSIZE_PRICE,
};
