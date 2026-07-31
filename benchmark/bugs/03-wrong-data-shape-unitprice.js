module.exports = {
  id: '03-wrong-data-shape-unitprice',
  category: 'wrong-data-shape',
  difficulty: 'medium',
  description:
    'The checkout service reads a field name the cart never sets (unitPrice vs price), producing NaN totals. The error surfaces in the checkout route, but originates in the cart model contract.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/checkoutService.js',
    summary: 'calculateSubtotal assumes items expose unitPrice; Cart items carry price.',
  },
  edits: [
    {
      file: 'src/services/checkoutService.js',
      find: 'return sumMoney(items.map((item) => multiplyMoney(item.price, item.quantity)));',
      replace: 'return sumMoney(items.map((item) => multiplyMoney(item.unitPrice, item.quantity)));',
    },
  ],
  expectedFailing: [
    'calculateSubtotal sums price * quantity across cart items',
    'POST /checkout completes checkout and returns the correct order total for a single item',
    'POST /checkout reduces product stock after a successful checkout',
    'POST /checkout applies a 10%-off coupon correctly',
    'POST /checkout empties the cart after a successful checkout',
    'GET /orders returns a persisted order after checkout',
    'GET /orders awaits persistence so the order is queryable immediately after checkout',
    // A NaN total fails the finite-total guard first, so declines surface as
    // 400 rather than 402 — the payment tests break as collateral.
    'POST /checkout — payment failures returns 402 when the card is declined',
    'POST /checkout — payment failures rejects checkout when no card is supplied',
  ],
};
