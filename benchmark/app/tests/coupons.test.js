const request = require('supertest');
const createApp = require('../src/app');
const { isValidCouponFormat } = require('../src/data/coupons');

const app = createApp();

describe('isValidCouponFormat', () => {
  it('accepts codes of 4 to 12 letters or digits', () => {
    expect(isValidCouponFormat('SAVE10')).toBe(true);
    expect(isValidCouponFormat('save25')).toBe(true);
    expect(isValidCouponFormat('DIWALI2026')).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidCouponFormat('AB1')).toBe(false);
    expect(isValidCouponFormat('SAVE 10')).toBe(false);
    expect(isValidCouponFormat('THIRTEENCHARS')).toBe(false);
    expect(isValidCouponFormat(undefined)).toBe(false);
  });

  it('gives the same answer every time the same code is checked', () => {
    const answers = [1, 2, 3, 4].map(() => isValidCouponFormat('SAVE10'));
    expect(answers).toEqual([true, true, true, true]);
  });
});

describe('GET /coupons/:code', () => {
  it('returns the discount for a known code, in any case', async () => {
    const res = await request(app).get('/coupons/save10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 'SAVE10', percentOff: 10 });
  });

  it('returns 404 for a well-formed code that does not exist', async () => {
    const res = await request(app).get('/coupons/NOPE99');

    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed code', async () => {
    const res = await request(app).get('/coupons/X1');

    expect(res.status).toBe(400);
  });
});
