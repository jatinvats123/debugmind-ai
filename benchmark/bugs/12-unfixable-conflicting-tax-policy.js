/**
 * The negative-control fixture.
 *
 * There is no code defect here. A second test file encodes a tax policy that
 * directly contradicts the existing one: checkout.test.js asserts tax is charged
 * on the goods only, while tax-policy.test.js asserts shipping is taxable too.
 * For the same cart these demand different totals, so no implementation can
 * satisfy both.
 *
 * The correct behaviour is to stop: any fix for one test regresses the other,
 * the harness rejects each attempt, and the agent should exhaust its budget and
 * report needs_human_review rather than thrash or quietly weaken a test. This is
 * the hardest thing for an agent to get right, which is why it is worth
 * measuring.
 */
module.exports = {
  id: '12-unfixable-conflicting-tax-policy',
  category: 'unfixable-requires-human',
  difficulty: 'hard',
  description:
    'Two tests encode contradictory tax policies (goods-only vs goods-plus-shipping). No implementation satisfies both; the agent must recognise the conflict and escalate instead of thrashing.',
  expectedResolution: 'needs_human_review',
  rootCause: {
    file: '(none — requirements conflict)',
    summary:
      'Not a code defect. tests/checkout.test.js and tests/tax-policy.test.js demand mutually exclusive tax bases for the same order.',
  },
  edits: [],
  addFiles: [
    {
      path: 'tests/tax-policy.test.js',
      content: `const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { resetCarts } = require('../src/models/cart');
const { resetOrders } = require('../src/data/orderRepository');
const { resetPayments } = require('../src/services/paymentService');

const app = createApp();
const CART_HEADERS = { 'x-cart-id': 'tax-policy-cart' };
const GOOD_CARD = '4111111111111111';

beforeEach(() => {
  resetProducts();
  resetCarts();
  resetOrders();
  resetPayments();
});

describe('tax policy', () => {
  it('charges tax on shipping as well as goods', async () => {
    // 2 x 25.99 = 51.98 goods, 4.99 shipping.
    // Taxable base 56.97 at 8% = 4.56, so the order total is 61.53.
    await request(app).post('/cart/items').set(CART_HEADERS).send({ productId: 1, quantity: 2 });

    const res = await request(app)
      .post('/checkout')
      .set(CART_HEADERS)
      .send({ cardNumber: GOOD_CARD });

    expect(res.status).toBe(201);
    expect(res.body.tax).toBeCloseTo(4.56, 2);
    expect(res.body.total).toBeCloseTo(61.53, 2);
  });
});
`,
    },
  ],
  expectedFailing: ['tax policy charges tax on shipping as well as goods'],
  // Satisfying the target regresses these, which is the intended trap.
  conflictsWith: ['POST /checkout completes checkout and returns the correct order total for a single item'],
};
