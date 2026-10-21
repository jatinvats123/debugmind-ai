const express = require('express');
const { getProductById } = require('../data/products');
const { listReviews, addReview, averageRating } = require('../data/reviews');

// Mounted at /products/:id/reviews.
const router = express.Router({ mergeParams: true });

router.get('/', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const list = listReviews(product.id);
  res.json({ productId: product.id, count: list.length, averageRating: averageRating(list), reviews: list });
});

router.post('/', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
  }
  const review = addReview(product.id, { rating, comment: String(req.body.comment || '').trim() });
  res.status(201).json(review);
});

module.exports = router;
