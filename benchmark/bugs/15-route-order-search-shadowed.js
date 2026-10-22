/**
 * Express matches routes in registration order. With /search registered after
 * /:id, a request for /products/search is captured by /:id with id = "search",
 * which finds no product and answers 404. The search handler itself is
 * correct and is never reached.
 */
module.exports = {
  id: '15-route-order-search-shadowed',
  category: 'express-routing',
  difficulty: 'medium',
  description:
    'The search route is registered after the /:id route, so /products/search is treated as a product id lookup and every search returns 404 Product not found.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/routes/products.js',
    summary: "router.get('/search') is declared after router.get('/:id'), which shadows it.",
  },
  edits: [
    {
      file: 'src/routes/products.js',
      find:
        "router.get('/search', (req, res) => {\n" +
        '  res.json(searchProducts(getAllProducts(), normaliseSearchOptions(req.query)));\n' +
        '});\n\n',
      replace: '',
    },
    {
      file: 'src/routes/products.js',
      find: '  res.json(product);\n});\n',
      replace:
        '  res.json(product);\n});\n\n' +
        "router.get('/search', (req, res) => {\n" +
        '  res.json(searchProducts(getAllProducts(), normaliseSearchOptions(req.query)));\n' +
        '});\n',
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
