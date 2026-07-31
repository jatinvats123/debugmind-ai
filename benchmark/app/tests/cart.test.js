const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { resetCarts } = require('../src/models/cart');

const app = createApp();
const CART_HEADERS = { 'x-cart-id': 'test-cart' };

beforeEach(() => {
  resetProducts();
  resetCarts();
});

describe('cart operations', () => {
  it('adds an item to the cart and reports the correct subtotal', async () => {
    await request(app)
      .post('/cart/items')
      .set(CART_HEADERS)
      .send({ productId: 1, quantity: 2 });

    const res = await request(app).get('/cart').set(CART_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.subtotal).toBeCloseTo(51.98, 2); // 2 * 25.99
  });

  it('merges quantities when the same product is added twice', async () => {
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 2, quantity: 1 });
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 2, quantity: 3 });

    const res = await request(app).get('/cart').set(CART_HEADERS);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(4);
  });

  it('removes an item from the cart', async () => {
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 1, quantity: 1 });
    await request(app).delete('/cart/items/1').set(CART_HEADERS);

    const res = await request(app).get('/cart').set(CART_HEADERS);

    expect(res.body.items).toHaveLength(0);
    expect(res.body.subtotal).toBe(0);
  });
});
