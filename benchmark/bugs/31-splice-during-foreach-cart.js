/**
 * Removing elements from an array while forEach walks it shifts the
 * remaining elements left, so the element right after each removed one is
 * skipped. A single zero-quantity line is removed correctly; two adjacent
 * ones leave the second behind.
 */
module.exports = {
  id: '31-splice-during-foreach-cart',
  category: 'mutation-during-iteration',
  difficulty: 'medium',
  description:
    'Cart lines with quantity 0 are removed with splice() inside forEach, which skips the element after each removal, so when two adjacent lines are zeroed in one update the second one stays in the cart.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/models/cart.js',
    summary:
      'removeEmptyLines mutates this.items while iterating it; filtering into a new array avoids the skipped index.',
  },
  edits: [
    {
      file: 'src/models/cart.js',
      find: '    this.items = this.items.filter((item) => item.quantity > 0);',
      replace:
        '    this.items.forEach((item, index) => {\n' +
        '      if (item.quantity <= 0) this.items.splice(index, 1);\n' +
        '    });',
    },
  ],
  expectedFailing: ['PATCH /cart/items — bulk update removes every line set to zero in the same update'],
};
