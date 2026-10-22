module.exports = {
  id: '18-missing-quantity-validation',
  category: 'missing-input-validation',
  difficulty: 'easy',
  description:
    'Quantity validation only rejects non-numbers, so zero, negative, fractional and over-limit quantities are added to the cart (a negative line makes the subtotal negative).',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/utils/validation.js',
    summary:
      'parseQuantity checks Number.isNaN only; it must require a whole number between min and MAX_LINE_QUANTITY.',
  },
  edits: [
    {
      file: 'src/utils/validation.js',
      find: '  if (!Number.isInteger(qty) || qty < min || qty > MAX_LINE_QUANTITY) {',
      replace: '  if (Number.isNaN(qty)) {',
    },
  ],
  expectedFailing: [
    'POST /cart/items — quantity validation rejects a zero quantity and leaves the cart unchanged',
    'POST /cart/items — quantity validation rejects a negative quantity and leaves the cart unchanged',
    'POST /cart/items — quantity validation rejects a fractional quantity and leaves the cart unchanged',
    'POST /cart/items — quantity validation rejects a above the per-line maximum quantity and leaves the cart unchanged',
  ],
};
