const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');
const { resetReviews } = require('../src/data/reviews');

const app = createApp();

beforeEach(() => {
  resetProducts();
  resetReviews();
});

describe('product reviews', () => {
  it('lists no reviews for a product nobody has reviewed', async () => {
    const res = await request(app).get('/products/1/reviews');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ productId: 1, count: 0, averageRating: null, reviews: [] });
  });

  it('adds reviews and reports the average rating', async () => {
    const first = await request(app).post('/products/2/reviews').send({ rating: 5, comment: 'Great keys' });
    await request(app).post('/products/2/reviews').send({ rating: 4 });
    expect(first.status).toBe(201);

    const res = await request(app).get('/products/2/reviews');

    expect(res.body.count).toBe(2);
    expect(res.body.averageRating).toBe(4.5);
    expect(res.body.reviews[0].comment).toBe('Great keys');
  });

  it('rejects a rating outside 1 to 5', async () => {
    const res = await request(app).post('/products/1/reviews').send({ rating: 6 });

    expect(res.status).toBe(400);
  });

  it('returns 404 for reviews of a product that does not exist', async () => {
    const res = await request(app).get('/products/999/reviews');

    expect(res.status).toBe(404);
  });
});
