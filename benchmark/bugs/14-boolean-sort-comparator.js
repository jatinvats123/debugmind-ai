/**
 * A comparator that returns a boolean looks right and reads right, but
 * Array.prototype.sort needs a negative, zero or positive number. `a > b`
 * yields true/false, i.e. 1/0 and never negative, so V8's TimSort treats the
 * input as one already-ascending run and returns it unchanged. Some inputs and
 * older engines appear to sort correctly, which is why this survives review.
 */
module.exports = {
  id: '14-boolean-sort-comparator',
  category: 'wrong-sort-comparator',
  difficulty: 'medium',
  description:
    'The price-ascending comparator returns a boolean instead of a signed number, so sort() never reorders anything and "lowest price first" returns products in catalogue order.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/catalogService.js',
    summary: 'SORTERS.price_asc is (a, b) => a.price > b.price; it must return a.price - b.price.',
  },
  edits: [
    {
      file: 'src/services/catalogService.js',
      find: '  price_asc: (a, b) => a.price - b.price,',
      replace: '  price_asc: (a, b) => a.price > b.price,',
    },
  ],
  expectedFailing: [
    'GET /products/search sorts by price, lowest first',
    'GET /products/search returns the requested page, numbering pages from 1',
    'GET /products/search returns a partial last page with no next page',
  ],
};
