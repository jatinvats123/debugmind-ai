const request = require('supertest');
const createApp = require('../src/app');
const { splitPaise } = require('../src/utils/paise');
const { planInstalments } = require('../src/services/instalmentService');

const app = createApp();
const sum = (values) => values.reduce((a, b) => a + b, 0);

describe('splitPaise', () => {
  it('gives the extra paise to the earliest shares', () => {
    expect(splitPaise(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it('never loses or invents a paisa', () => {
    for (const total of [100, 20000, 99999, 123456, 500001]) {
      for (const parts of [2, 3, 6, 7, 12]) {
        const shares = splitPaise(total, parts);
        expect(shares).toHaveLength(parts);
        expect(sum(shares)).toBe(total);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('planInstalments', () => {
  it('numbers instalments from 1 and reports rupees alongside paise', () => {
    expect(planInstalments(100, 2)).toEqual([
      { number: 1, amountPaise: 5000, amount: 50 },
      { number: 2, amountPaise: 5000, amount: 50 },
    ]);
  });
});

describe('GET /instalments', () => {
  it('splits an order total into monthly instalments', async () => {
    const res = await request(app).get('/instalments').query({ total: 200, count: 3 });

    expect(res.status).toBe(200);
    expect(res.body.instalments.map((i) => i.amount)).toEqual([66.67, 66.67, 66.66]);
  });

  it('rejects an instalment count of zero', async () => {
    const res = await request(app).get('/instalments').query({ total: 200, count: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/count/i);
  });
});
