const { calculateSubtotal, applyDiscount } = require('../src/services/checkoutService');

describe('calculateSubtotal', () => {
  it('sums price * quantity across cart items', () => {
    const items = [
      { productId: 1, name: 'A', price: 10, quantity: 2 },
      { productId: 2, name: 'B', price: 5, quantity: 3 },
    ];

    expect(calculateSubtotal(items)).toBe(35);
  });

  it('returns 0 for an empty cart', () => {
    expect(calculateSubtotal([])).toBe(0);
  });
});

describe('applyDiscount', () => {
  it('returns 0 when no coupon code is provided', () => {
    expect(applyDiscount(100, undefined)).toBe(0);
  });

  it('returns 0 for an unknown coupon code', () => {
    expect(applyDiscount(100, 'NOPE')).toBe(0);
  });

  it('takes 10% off the subtotal for SAVE10', () => {
    expect(applyDiscount(100, 'SAVE10')).toBeCloseTo(10);
  });

  it('takes 25% off the subtotal for SAVE25', () => {
    expect(applyDiscount(200, 'SAVE25')).toBeCloseTo(50);
  });
});
