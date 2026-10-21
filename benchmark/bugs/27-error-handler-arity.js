/**
 * Express decides whether middleware is an error handler by its declared
 * arity: exactly four parameters. Dropping the unused `next` (and the
 * eslint-disable comment that protected it) turns the handler into ordinary
 * middleware that errors skip, so Express's built-in handler answers with an
 * HTML page. Status codes stay right; only the JSON body disappears, and the
 * failures show up in tests for four different routes.
 */
module.exports = {
  id: '27-error-handler-arity',
  category: 'express-error-middleware',
  difficulty: 'hard',
  description:
    'The app-level error handler lost its unused fourth parameter, so Express no longer recognises it as error middleware: every next(err) is answered by the default HTML error page instead of a JSON body.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/app.js',
    summary:
      'Error-handling middleware must declare four parameters (err, req, res, next); with three it is never called for errors.',
  },
  edits: [
    {
      file: 'src/app.js',
      find: '  // eslint-disable-next-line no-unused-vars\n  app.use((err, req, res, next) => {',
      replace: '  app.use((err, req, res) => {',
    },
  ],
  expectedFailing: [
    'error responses answers a malformed JSON body with a JSON 400',
    'GET /delivery/estimate rejects the malformed pincode "11000"',
    'GET /delivery/estimate rejects the malformed pincode "1100011"',
    'GET /delivery/estimate rejects the malformed pincode "011000"',
    'GET /delivery/estimate rejects the malformed pincode "ABC110001"',
    'GET /delivery/estimate rejects the malformed pincode ""',
    'GET /delivery/estimate rejects a date that does not exist',
    'GET /returns/eligibility rejects a return requested before delivery',
    'GET /instalments rejects an instalment count of zero',
  ],
};
