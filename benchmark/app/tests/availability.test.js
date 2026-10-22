const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { checkAvailability } = require('../src/services/availabilityService');

const app = createApp();

beforeEach(() => {
  resetProducts();
});

describe('checkAvailability', () => {
  it('returns one result per request, in request order', async () => {
    const results = await checkAvailability([
      { productId: 1, quantity: 2 },
      { productId: 3, quantity: 1 },
      { productId: 4, quantity: 15 },
    ]);

    expect(results).toEqual([
      { productId: 1, requested: 2, inStock: 50, available: true },
      { productId: 3, requested: 1, inStock: 0, available: false },
      { productId: 4, requested: 15, inStock: 15, available: true },
    ]);
  });

  it('returns an empty list for an empty batch', async () => {
    expect(await checkAvailability([])).toEqual([]);
  });
});

describe('POST /products/availability', () => {
  it('reports whether each requested quantity can be fulfilled', async () => {
    const res = await request(app)
      .post('/products/availability')
      .send({ items: [{ productId: 2, quantity: 31 }] });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ productId: 2, requested: 31, inStock: 30, available: false }]);
  });

  it('rejects a body without an items array', async () => {
    const res = await request(app).post('/products/availability').send({ productId: 1 });

    expect(res.status).toBe(400);
  });
});
