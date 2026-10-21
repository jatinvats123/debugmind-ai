const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { resetCarts } = require('../src/models/cart');

const app = createApp();
const CART_HEADERS = { 'x-cart-id': 'updates-cart' };

beforeEach(() => {
  resetProducts();
  resetCarts();
});

const addItem = (body) => request(app).post('/cart/items').set(CART_HEADERS).send(body);
const getCart = () => request(app).get('/cart').set(CART_HEADERS);
const updateCart = (updates) => request(app).patch('/cart/items').set(CART_HEADERS).send({ updates });

describe('POST /cart/items — quantity validation', () => {
  it('accepts a numeric string quantity from a form post', async () => {
    const res = await addItem({ productId: 1, quantity: '2' });

    expect(res.status).toBe(201);
    expect(res.body.items[0].quantity).toBe(2);
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
    ['above the per-line maximum', 11],
    ['non-numeric', 'abc'],
  ])('rejects a %s quantity and leaves the cart unchanged', async (_label, quantity) => {
    const res = await addItem({ productId: 1, quantity });

    expect(res.status).toBe(400);
    const cart = await getCart();
    expect(cart.body.items).toHaveLength(0);
    expect(cart.body.subtotal).toBe(0);
  });
});

describe('PATCH /cart/items — bulk update', () => {
  beforeEach(async () => {
    await addItem({ productId: 1, quantity: 1 });
    await addItem({ productId: 2, quantity: 1 });
    await addItem({ productId: 4, quantity: 1 });
  });

  it('updates several quantities at once', async () => {
    const res = await updateCart([
      { productId: 1, quantity: 3 },
      { productId: 4, quantity: 2 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => [i.productId, i.quantity])).toEqual([[1, 3], [2, 1], [4, 2]]);
  });

  it('removes a line whose quantity is set to zero', async () => {
    const res = await updateCart([{ productId: 2, quantity: 0 }]);

    expect(res.body.items.map((i) => i.productId)).toEqual([1, 4]);
  });

  it('removes every line set to zero in the same update', async () => {
    const res = await updateCart([
      { productId: 1, quantity: 0 },
      { productId: 2, quantity: 0 },
    ]);

    expect(res.body.items.map((i) => i.productId)).toEqual([4]);
  });
});
