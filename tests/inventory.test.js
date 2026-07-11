const { resetProducts, getProductById } = require('../src/data/products');
const { hasSufficientStock, reserveStock } = require('../src/services/inventory');

beforeEach(() => {
  resetProducts();
});

describe('hasSufficientStock', () => {
  it('returns true when enough stock is available', () => {
    expect(hasSufficientStock(1, 5)).toBe(true);
  });

  it('returns false when the requested quantity exceeds stock', () => {
    expect(hasSufficientStock(3, 1)).toBe(false); // USB-C Hub has 0 stock
  });
});

describe('reserveStock', () => {
  it('decreases the available stock by the reserved quantity', () => {
    const before = getProductById(1).stock;

    reserveStock(1, 4);

    const after = getProductById(1).stock;
    expect(after).toBe(before - 4);
  });

  it('throws when trying to reserve more than is available', () => {
    expect(() => reserveStock(3, 1)).toThrow();
  });
});
