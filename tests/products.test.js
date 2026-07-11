const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');

const app = createApp();

beforeEach(() => {
  resetProducts();
});

describe('GET /products', () => {
  it('returns the list of products', async () => {
    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('GET /products/:id', () => {
  it('returns a single product by id', async () => {
    const res = await request(app).get('/products/1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Wireless Mouse');
  });

  it('returns 404 for a product that does not exist', async () => {
    const res = await request(app).get('/products/999');
    expect(res.status).toBe(404);
  });
});
