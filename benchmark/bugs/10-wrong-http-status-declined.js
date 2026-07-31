module.exports = {
  id: '10-wrong-http-status-declined',
  category: 'wrong-http-status',
  difficulty: 'easy',
  description:
    'A declined payment is reported as 400 Bad Request rather than 402 Payment Required, so clients cannot distinguish a malformed request from a refused card.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/routes/checkout.js',
    summary: 'The declined branch of the status selection was collapsed to a constant 400.',
  },
  edits: [
    {
      file: 'src/routes/checkout.js',
      find: '    const status = err.declined ? 402 : 400;',
      replace: '    const status = 400;',
    },
  ],
  expectedFailing: [
    'POST /checkout — payment failures returns 402 when the card is declined',
    'POST /checkout — payment failures rejects checkout when no card is supplied',
  ],
};
