module.exports = {
  id: '09-silent-catch-payment',
  category: 'silent-catch',
  difficulty: 'medium',
  description:
    'A declined card is swallowed by a catch block that fabricates an authorisation, so checkout proceeds to reserve stock and ship goods that were never paid for.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/checkoutService.js',
    summary:
      'try/catch around authorize() converts a PaymentDeclinedError into a fake success instead of propagating it.',
  },
  edits: [
    {
      file: 'src/services/checkoutService.js',
      find: '  const authorization = await authorize(cardNumber, totals.total);',
      replace:
        '  let authorization;\n' +
        '  try {\n' +
        '    authorization = await authorize(cardNumber, totals.total);\n' +
        '  } catch (err) {\n' +
        "    authorization = { authorized: false, reference: 'unavailable' };\n" +
        '  }',
    },
  ],
  expectedFailing: [
    'POST /checkout — payment failures returns 402 when the card is declined',
    'POST /checkout — payment failures does not reserve stock when payment is declined',
    'POST /checkout — payment failures does not persist an order when payment is declined',
    'POST /checkout — payment failures rejects checkout when no card is supplied',
  ],
};
