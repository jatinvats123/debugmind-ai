const { toCents, fromCents, sumMoney, multiplyMoney, percentOf, roundMoney } = require('../src/utils/money');

describe('money arithmetic', () => {
  it('converts to and from cents without drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1999)).toBeCloseTo(19.99, 10);
  });

  it('sums amounts exactly where floating point would drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in raw float arithmetic
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it('sums many line items without accumulating error', () => {
    const amounts = Array(10).fill(0.07);
    expect(sumMoney(amounts)).toBe(0.7);
  });

  it('multiplies a price by a quantity exactly', () => {
    expect(multiplyMoney(19.99, 3)).toBe(59.97);
    expect(multiplyMoney(0.1, 3)).toBe(0.3);
  });

  it('takes a percentage rounded to the nearest cent', () => {
    expect(percentOf(51.98, 8)).toBe(4.16);
    expect(percentOf(89.5, 10)).toBe(8.95);
    expect(percentOf(200, 25)).toBe(50);
  });

  it('rounds to whole cents', () => {
    expect(roundMoney(4.158399999)).toBe(4.16);
  });
});
