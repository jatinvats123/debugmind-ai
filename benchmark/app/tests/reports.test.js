const request = require('supertest');
const createApp = require('../src/app');
const { saveOrder, resetOrders } = require('../src/data/orderRepository');
const { dailySales } = require('../src/services/reportService');
const { istDateKey } = require('../src/utils/dates');
const { sumPaise } = require('../src/utils/paise');

const app = createApp();

beforeEach(() => {
  resetOrders();
});

describe('istDateKey', () => {
  it('rolls over to the next day at midnight India time, 18:30 UTC', () => {
    expect(istDateKey('2026-03-01T18:29:59.000Z')).toBe('2026-03-01');
    expect(istDateKey('2026-03-01T18:30:00.000Z')).toBe('2026-03-02');
  });
});

describe('sumPaise', () => {
  it('adds amounts beyond ₹2.1 crore exactly', () => {
    // ₹1.5 crore + ₹1 crore, in paise.
    expect(sumPaise([1500000000, 1000000000])).toBe(2500000000);
  });
});

describe('dailySales', () => {
  it('buckets orders by the business day in India', () => {
    const report = dailySales([
      { createdAt: '2026-03-01T10:00:00.000Z', total: 100 },
      { createdAt: '2026-03-01T20:00:00.000Z', total: 250.5 }, // 01:30 IST on 2 March
    ]);

    expect(report).toEqual([
      { date: '2026-03-01', orders: 1, gmvPaise: 10000, gmv: 100 },
      { date: '2026-03-02', orders: 1, gmvPaise: 25050, gmv: 250.5 },
    ]);
  });

  it('totals a day of large B2B orders without overflowing', () => {
    const report = dailySales([
      { createdAt: '2026-03-02T05:00:00.000Z', total: 15000000 },
      { createdAt: '2026-03-02T06:00:00.000Z', total: 10000000 },
    ]);

    expect(report).toEqual([{ date: '2026-03-02', orders: 2, gmvPaise: 2500000000, gmv: 25000000 }]);
  });
});

describe('GET /reports/daily-sales', () => {
  it('reports persisted orders by IST business day', async () => {
    await saveOrder({ total: 499, createdAt: '2026-03-04T09:15:00.000Z' });
    await saveOrder({ total: 1299, createdAt: '2026-03-04T19:45:00.000Z' }); // 01:15 IST on 5 March

    const res = await request(app).get('/reports/daily-sales');

    expect(res.status).toBe(200);
    expect(res.body.map((d) => [d.date, d.gmv])).toEqual([
      ['2026-03-04', 499],
      ['2026-03-05', 1299],
    ]);
  });
});
