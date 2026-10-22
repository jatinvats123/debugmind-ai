const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

const eligibility = (deliveredOn, requestedOn) =>
  request(app).get('/returns/eligibility').query({ deliveredOn, requestedOn });

describe('GET /returns/eligibility', () => {
  it('accepts a return requested within the window', async () => {
    const res = await eligibility('2026-03-10', '2026-03-14');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ daysSinceDelivery: 4, windowDays: 7, eligible: true });
  });

  it('accepts a return on the last day of the window', async () => {
    const res = await eligibility('2026-03-10', '2026-03-17');

    expect(res.body).toMatchObject({ daysSinceDelivery: 7, eligible: true });
  });

  it('refuses a return once the window has closed', async () => {
    const res = await eligibility('2026-03-10', '2026-03-18');

    expect(res.body).toMatchObject({ daysSinceDelivery: 8, eligible: false });
  });

  it('counts days correctly across the end of a month', async () => {
    // February 2026 has 28 days: 26 Feb to 3 Mar is 5 days.
    const res = await eligibility('2026-02-26', '2026-03-03');

    expect(res.body).toMatchObject({ daysSinceDelivery: 5, eligible: true });
  });

  it('rejects a return requested before delivery', async () => {
    const res = await eligibility('2026-03-10', '2026-03-09');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/before/i);
  });
});
