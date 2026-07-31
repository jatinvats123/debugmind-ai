const express = require('express');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const checkoutRouter = require('./routes/checkout');
const ordersRouter = require('./routes/orders');

function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/products', productsRouter);
  app.use('/cart', cartRouter);
  app.use('/checkout', checkoutRouter);
  app.use('/orders', ordersRouter);

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = createApp;
