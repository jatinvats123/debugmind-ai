module.exports = {
  id: '13-off-by-one-pagination-offset',
  category: 'off-by-one',
  difficulty: 'easy',
  description:
    'Pages are numbered from 1 but the slice offset is computed as if they started at 0, so every page is shifted forward by one: page 1 shows page 2 and the first page of results is never returned.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/catalogService.js',
    summary: 'paginate() computes start = page * pageSize instead of (page - 1) * pageSize.',
  },
  edits: [
    {
      file: 'src/services/catalogService.js',
      find: '  const start = (page - 1) * pageSize;',
      replace: '  const start = page * pageSize;',
    },
  ],
  expectedFailing: [
    'GET /products/search returns every product on the first page by default',
    'GET /products/search sorts by price, lowest first',
    'GET /products/search sorts by price, highest first',
    'GET /products/search returns the requested page, numbering pages from 1',
    'GET /products/search returns a partial last page with no next page',
    'GET /products/search matches names case-insensitively',
    "GET /products/search does not carry one request's options into the next",
  ],
};
