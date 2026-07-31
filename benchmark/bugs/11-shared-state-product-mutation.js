/**
 * The most indirect fixture in the suite, and the one that best exercises
 * cross-file tracing.
 *
 * The failing test is about payment declines. It asserts stock is untouched
 * when a card is refused — and stock IS untouched by that request. It fails
 * because an earlier test in the same file completed a checkout, and
 * resetProducts() no longer restores the seed data: the store aliases the seed
 * objects, so every decrement is permanent. Nothing in the failing test, its
 * assertion, or the payment code is wrong. The defect is in the data layer's
 * copy semantics, two files away.
 */
module.exports = {
  id: '11-shared-state-product-mutation',
  category: 'shared-state-mutation',
  difficulty: 'hard',
  description:
    'The product store aliases its seed objects instead of cloning them, so stock decrements mutate the seed data and survive resetProducts(). The symptom appears in an unrelated payment test, caused by a different test that ran earlier.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/data/products.js',
    summary:
      'Both the initial assignment and resetProducts alias initialProducts rather than cloning it, so mutations leak across resets.',
  },
  edits: [
    {
      file: 'src/data/products.js',
      find: 'let products = initialProducts.map((p) => ({ ...p }));',
      replace: 'let products = initialProducts;',
    },
    {
      file: 'src/data/products.js',
      find: 'function resetProducts() {\n  products = initialProducts.map((p) => ({ ...p }));\n}',
      replace: 'function resetProducts() {\n  products = initialProducts;\n}',
    },
  ],
  expectedFailing: ['POST /checkout — payment failures does not reserve stock when payment is declined'],
};
