/**
 * Note on placement: an equivalent missing `await` inside checkoutService is
 * invisible, because returning a promise from an async function flattens it —
 * the route's own await unwraps both levels. The bug only manifests where the
 * pending promise is handed to something that does not await, which is exactly
 * what res.json() does. That subtlety is the point of this fixture.
 */
module.exports = {
  id: '05-missing-await-order-save',
  category: 'async-await-misuse',
  difficulty: 'medium',
  description:
    'The orders listing hands a pending Promise to res.json() instead of awaiting it, so the endpoint serialises an empty object rather than the order list.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/routes/orders.js',
    summary: 'listOrders() is async but is not awaited before being serialised.',
  },
  edits: [
    {
      file: 'src/routes/orders.js',
      find: '  const orders = await listOrders();',
      replace: '  const orders = listOrders();',
    },
  ],
  expectedFailing: [
    'GET /orders awaits persistence so the order is queryable immediately after checkout',
    'POST /checkout — payment failures does not persist an order when payment is declined',
  ],
};
