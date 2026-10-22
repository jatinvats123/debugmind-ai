let reviews = new Map();
let sequence = 0;

function listReviews(productId) {
  return reviews.get(productId) || [];
}

function addReview(productId, { rating, comment }) {
  sequence += 1;
  const review = { id: sequence, productId, rating, comment };
  reviews.set(productId, [...listReviews(productId), review]);
  return review;
}

/** Mean rating to one decimal place, or null when there are no reviews. */
function averageRating(list) {
  if (list.length === 0) return null;
  const sum = list.reduce((total, r) => total + r.rating, 0);
  return Math.round((sum / list.length) * 10) / 10;
}

function resetReviews() {
  reviews = new Map();
  sequence = 0;
}

module.exports = { listReviews, addReview, averageRating, resetReviews };
