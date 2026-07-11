const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { resetCarts } = require('../src/models/cart');

const app = createApp();
const CART_HEADERS = { 'x-cart-id': 'checkout-cart' };

beforeEach(() => {
  resetProducts();
  resetCarts();
});

describe('POST /checkout', () => {
  it('rejects checkout when the cart is empty', async () => {
    const res = await request(app).post('/checkout').set(CART_HEADERS).send({});
    expect(res.status).toBe(400);
  });

  it('rejects checkout when the requested quantity exceeds available stock', async () => {
    // USB-C Hub (id 3) has 0 stock
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 3, quantity: 1 });

    const res = await request(app).post('/checkout').set(CART_HEADERS).send({});

    expect(res.status).toBe(400);
  });

  it('completes checkout and returns the correct order total for a single item', async () => {
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 1, quantity: 2 });

    const res = await request(app).post('/checkout').set(CART_HEADERS).send({});

    // subtotal = 2 * 25.99 = 51.98, tax at 8% = 4.1584
    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBeCloseTo(51.98, 2);
    expect(res.body.total).toBeCloseTo(56.1384, 2);
  });

  it('reduces product stock after a successful checkout', async () => {
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 4, quantity: 3 });

    const res = await request(app).post('/checkout').set(CART_HEADERS).send({});
    expect(res.status).toBe(201);

    const productRes = await request(app).get('/products/4');
    expect(productRes.body.stock).toBe(12); // 15 - 3
  });

  it('applies a 10%-off coupon correctly', async () => {
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 2, quantity: 1 }); // 89.50

    const res = await request(app)
      .post('/checkout')
      .set(CART_HEADERS)
      .send({ couponCode: 'SAVE10' });

    expect(res.status).toBe(201);
    expect(res.body.discount).toBeCloseTo(8.95, 2);
    expect(res.body.total).toBeGreaterThan(0);
  });
});
