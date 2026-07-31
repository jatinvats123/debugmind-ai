const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { resetCarts } = require('../src/models/cart');
const { saveOrder, findOrder, countOrders, resetOrders } = require('../src/data/orderRepository');
const { resetPayments } = require('../src/services/paymentService');

const app = createApp();
const CART_HEADERS = { 'x-cart-id': 'orders-cart' };
const GOOD_CARD = '4111111111111111';

beforeEach(() => {
  resetProducts();
  resetCarts();
  resetOrders();
  resetPayments();
});

describe('orderRepository', () => {
  it('persists an order and reads it back', async () => {
    const saved = await saveOrder({ cartId: 'c1', total: 10 });
    const found = await findOrder(saved.id);
    expect(found).not.toBeNull();
    expect(found.total).toBe(10);
  });

  it('assigns distinct ids to concurrently saved orders', async () => {
    const saved = await Promise.all([
      saveOrder({ cartId: 'a', total: 1 }),
      saveOrder({ cartId: 'b', total: 2 }),
      saveOrder({ cartId: 'c', total: 3 }),
    ]);
    const ids = new Set(saved.map((o) => o.id));
    expect(ids.size).toBe(3);
    expect(await countOrders()).toBe(3);
  });

  it('returns null for an unknown order', async () => {
    expect(await findOrder('nope')).toBeNull();
  });
});

describe('GET /orders', () => {
  it('returns 404 for an order that does not exist', async () => {
    const res = await request(app).get('/orders/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns a persisted order after checkout', async () => {
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 1, quantity: 1 });
    const checkoutRes = await request(app)
      .post('/checkout')
      .set(CART_HEADERS)
      .send({ cardNumber: GOOD_CARD });
    expect(checkoutRes.status).toBe(201);

    const res = await request(app).get(`/orders/${checkoutRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(checkoutRes.body.id);
  });

  it('awaits persistence so the order is queryable immediately after checkout', async () => {
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 5, quantity: 1 });
    const checkoutRes = await request(app)
      .post('/checkout')
      .set(CART_HEADERS)
      .send({ cardNumber: GOOD_CARD });

    // If checkout did not await the save, the id would be undefined here.
    expect(checkoutRes.body.id).toBeDefined();
    const listRes = await request(app).get('/orders');
    expect(listRes.body).toHaveLength(1);
  });
});
