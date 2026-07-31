const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { resetCarts } = require('../src/models/cart');
const { resetOrders } = require('../src/data/orderRepository');
const { resetPayments } = require('../src/services/paymentService');

const app = createApp();
const CART_HEADERS = { 'x-cart-id': 'checkout-cart' };
const GOOD_CARD = '4111111111111111';
const DECLINED_CARD = '4000000000000002';

beforeEach(() => {
  resetProducts();
  resetCarts();
  resetOrders();
  resetPayments();
});

const addItem = (productId, quantity) =>
  request(app).post('/cart/items').set(CART_HEADERS).send({ productId, quantity });

const doCheckout = (body = {}) =>
  request(app).post('/checkout').set(CART_HEADERS).send({ cardNumber: GOOD_CARD, ...body });

describe('POST /checkout', () => {
  it('rejects checkout when the cart is empty', async () => {
    const res = await doCheckout();
    expect(res.status).toBe(400);
  });

  it('rejects checkout when the requested quantity exceeds available stock', async () => {
    await addItem(3, 1); // USB-C Hub has 0 stock
    const res = await doCheckout();
    expect(res.status).toBe(400);
  });

  it('completes checkout and returns the correct order total for a single item', async () => {
    await addItem(1, 2); // 2 x 25.99 = 51.98, weight 0.4kg -> 4.99 shipping

    const res = await doCheckout();

    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBeCloseTo(51.98, 2);
    expect(res.body.tax).toBeCloseTo(4.16, 2); // 8% of 51.98, to the cent
    expect(res.body.shipping).toBeCloseTo(4.99, 2);
    expect(res.body.total).toBeCloseTo(61.13, 2);
  });

  it('reduces product stock after a successful checkout', async () => {
    await addItem(4, 3);

    const res = await doCheckout();
    expect(res.status).toBe(201);

    const productRes = await request(app).get('/products/4');
    expect(productRes.body.stock).toBe(12); // 15 - 3
  });

  it('applies a 10%-off coupon correctly', async () => {
    await addItem(2, 1); // 89.50

    const res = await doCheckout({ couponCode: 'SAVE10' });

    expect(res.status).toBe(201);
    expect(res.body.discount).toBeCloseTo(8.95, 2);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('empties the cart after a successful checkout', async () => {
    await addItem(1, 1);
    await doCheckout();

    const cartRes = await request(app).get('/cart').set(CART_HEADERS);
    expect(cartRes.body.items).toHaveLength(0);
  });
});

describe('POST /checkout — payment failures', () => {
  it('returns 402 when the card is declined', async () => {
    await addItem(1, 1);

    const res = await doCheckout({ cardNumber: DECLINED_CARD });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/declined/i);
  });

  it('does not reserve stock when payment is declined', async () => {
    await addItem(1, 5);

    await doCheckout({ cardNumber: DECLINED_CARD });

    const productRes = await request(app).get('/products/1');
    expect(productRes.body.stock).toBe(50); // untouched
  });

  it('does not persist an order when payment is declined', async () => {
    await addItem(1, 1);

    await doCheckout({ cardNumber: DECLINED_CARD });

    const ordersRes = await request(app).get('/orders');
    expect(ordersRes.body).toHaveLength(0);
  });

  it('rejects checkout when no card is supplied', async () => {
    await addItem(1, 1);

    const res = await request(app).post('/checkout').set(CART_HEADERS).send({});

    expect(res.status).toBe(402);
  });
});
