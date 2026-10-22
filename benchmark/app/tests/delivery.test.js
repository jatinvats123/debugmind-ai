const request = require('supertest');
const createApp = require('../src/app');
const { resolveZone, ZONES } = require('../src/services/deliveryService');

const app = createApp();

// 2026-03-06 is a Friday, so every estimate below crosses a weekend.
const FRIDAY = '2026-03-06';

const estimate = (query) => request(app).get('/delivery/estimate').query({ date: FRIDAY, ...query });

describe('resolveZone', () => {
  it('falls back to the national zone for a pincode the courier does not list', async () => {
    await expect(resolveZone('799001')).resolves.toBe(ZONES.national);
  });
});

describe('GET /delivery/estimate', () => {
  it('delivers to a metro pincode in two business days', async () => {
    const res = await estimate({ pincode: '110001' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pincode: '110001',
      zone: 'metro',
      estimatedDelivery: '2026-03-10',
      codAvailable: true,
    });
  });

  it('skips the weekend for a regional delivery', async () => {
    const res = await estimate({ pincode: '411001' });

    expect(res.body.zone).toBe('regional');
    expect(res.body.estimatedDelivery).toBe('2026-03-12');
  });

  it('serves an unlisted pincode through the national network, prepaid only', async () => {
    const res = await estimate({ pincode: '799001' });

    expect(res.status).toBe(200);
    expect(res.body.zone).toBe('national');
    expect(res.body.estimatedDelivery).toBe('2026-03-17');
    expect(res.body.codAvailable).toBe(false);
  });

  it('offers cash on delivery up to the limit but not above it', async () => {
    const atLimit = await estimate({ pincode: '560001', total: 50000 });
    const overLimit = await estimate({ pincode: '560001', total: 75000 });

    expect(atLimit.body.codAvailable).toBe(true);
    expect(overLimit.body.codAvailable).toBe(false);
  });

  it.each(['11000', '1100011', '011000', 'ABC110001', ''])('rejects the malformed pincode "%s"', async (pincode) => {
    const res = await estimate({ pincode });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pincode/i);
  });

  it('rejects a date that does not exist', async () => {
    const res = await estimate({ pincode: '110001', date: '2026-02-30' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });
});
