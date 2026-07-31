const {
  calculateShipping,
  rateForWeight,
  cartWeight,
  FREE_SHIPPING_THRESHOLD,
  OVERSIZE_PRICE,
} = require('../src/services/shippingService');

describe('rateForWeight', () => {
  it('charges the light rate below the first boundary', () => {
    expect(rateForWeight(0.5)).toBe(4.99);
  });

  it('treats a band boundary as inclusive', () => {
    // A parcel weighing exactly 1kg ships at the 1kg rate, not the next band up.
    expect(rateForWeight(1)).toBe(4.99);
    expect(rateForWeight(5)).toBe(8.99);
    expect(rateForWeight(20)).toBe(15.99);
  });

  it('moves to the next band just past a boundary', () => {
    expect(rateForWeight(1.01)).toBe(8.99);
    expect(rateForWeight(5.01)).toBe(15.99);
  });

  it('charges the oversize rate beyond the last band', () => {
    expect(rateForWeight(21)).toBe(OVERSIZE_PRICE);
  });
});

describe('calculateShipping', () => {
  it('charges by weight below the free-shipping threshold', () => {
    expect(calculateShipping(50, 0.5)).toBe(4.99);
  });

  it('ships free at exactly the threshold', () => {
    expect(calculateShipping(FREE_SHIPPING_THRESHOLD, 3)).toBe(0);
  });

  it('ships free above the threshold', () => {
    expect(calculateShipping(150, 25)).toBe(0);
  });
});

describe('cartWeight', () => {
  it('multiplies item weight by quantity', () => {
    expect(cartWeight([{ weightKg: 0.2, quantity: 3 }])).toBeCloseTo(0.6, 5);
  });

  it('sums across items and tolerates a missing weight', () => {
    expect(cartWeight([{ weightKg: 1, quantity: 2 }, { quantity: 5 }])).toBe(2);
  });

  it('is zero for an empty cart', () => {
    expect(cartWeight([])).toBe(0);
  });
});
