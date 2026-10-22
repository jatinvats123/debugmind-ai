const express = require('express');
const { getAllProducts, getProductById } = require('../data/products');
const { normaliseSearchOptions, searchProducts } = require('../services/catalogService');
const { checkAvailability } = require('../services/availabilityService');
const { ValidationError } = require('../utils/errors');
const reviewsRouter = require('./reviews');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getAllProducts());
});

router.get('/search', (req, res) => {
  res.json(searchProducts(getAllProducts(), normaliseSearchOptions(req.query)));
});

router.post('/availability', async (req, res, next) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      throw new ValidationError('items must be an array of { productId, quantity }');
    }
    res.json({ items: await checkAvailability(items) });
  } catch (err) {
    next(err);
  }
});

router.use('/:id/reviews', reviewsRouter);

router.get('/:id', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

module.exports = router;
