const express = require('express');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const checkoutRouter = require('./routes/checkout');
const ordersRouter = require('./routes/orders');
const couponsRouter = require('./routes/coupons');
const deliveryRouter = require('./routes/delivery');
const returnsRouter = require('./routes/returns');
const instalmentsRouter = require('./routes/instalments');
const reportsRouter = require('./routes/reports');

function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/products', productsRouter);
  app.use('/cart', cartRouter);
  app.use('/checkout', checkoutRouter);
  app.use('/orders', ordersRouter);
  app.use('/coupons', couponsRouter);
  app.use('/delivery', deliveryRouter);
  app.use('/returns', returnsRouter);
  app.use('/instalments', instalmentsRouter);
  app.use('/reports', reportsRouter);

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Errors passed to next(err) carry their own status (see utils/errors.js);
  // anything else is an unexpected 500 whose details stay server-side.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  });

  return app;
}

module.exports = createApp;
