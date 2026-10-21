const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

describe('error responses', () => {
  it('answers a malformed JSON body with a JSON 400', async () => {
    const res = await request(app)
      .post('/cart/items')
      .set('Content-Type', 'application/json')
      .send('{"productId": 1,');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('answers an unknown route with a JSON 404', async () => {
    const res = await request(app).get('/no-such-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
