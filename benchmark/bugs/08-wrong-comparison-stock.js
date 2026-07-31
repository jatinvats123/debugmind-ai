module.exports = {
  id: '08-wrong-comparison-stock',
  category: 'wrong-comparison-operator',
  difficulty: 'easy',
  description:
    'The stock check uses a strict greater-than, so ordering exactly the remaining stock is rejected as insufficient.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/inventory.js',
    summary: 'hasSufficientStock compares stock > quantity instead of >=.',
  },
  edits: [
    {
      file: 'src/services/inventory.js',
      find: '  return product.stock >= quantity;',
      replace: '  return product.stock > quantity;',
    },
  ],
  expectedFailing: ['hasSufficientStock allows buying exactly the remaining stock'],
};
