module.exports = {
  id: '07-missing-early-return-404',
  category: 'incorrect-early-return',
  difficulty: 'easy',
  description:
    'The 404 branch sends a response but does not return, so execution falls through and the handler writes a second response for the same request.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/routes/orders.js',
    summary: 'Missing return after res.status(404).json(...), causing a double send.',
  },
  edits: [
    {
      file: 'src/routes/orders.js',
      find: '  if (!order) {\n    return res.status(404).json({ error: \'Order not found\' });\n  }',
      replace: '  if (!order) {\n    res.status(404).json({ error: \'Order not found\' });\n  }',
    },
  ],
  expectedFailing: ['GET /orders returns 404 for an order that does not exist'],
};
