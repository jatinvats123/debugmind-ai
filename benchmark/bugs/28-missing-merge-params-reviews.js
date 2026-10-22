module.exports = {
  id: '28-missing-merge-params-reviews',
  category: 'express-routing',
  difficulty: 'medium',
  description:
    "The nested reviews router is created without mergeParams, so it cannot see the parent route's :id; every product looks missing and all review requests return 404.",
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/routes/reviews.js',
    summary: 'express.Router() needs { mergeParams: true } to read req.params.id from /products/:id/reviews.',
  },
  edits: [
    {
      file: 'src/routes/reviews.js',
      find: 'const router = express.Router({ mergeParams: true });',
      replace: 'const router = express.Router();',
    },
  ],
  expectedFailing: [
    'product reviews lists no reviews for a product nobody has reviewed',
    'product reviews adds reviews and reports the average rating',
    'product reviews rejects a rating outside 1 to 5',
  ],
};
