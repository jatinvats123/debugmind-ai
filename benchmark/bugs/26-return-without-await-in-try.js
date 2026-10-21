/**
 * `return promise` inside try/catch hands the promise back before it settles,
 * so a rejection is not caught by this function's catch block; it propagates
 * to the caller instead. `return await promise` keeps the rejection inside the
 * try. The symptom is a 500 from the route, two calls away from the cause.
 */
module.exports = {
  id: '26-return-without-await-in-try',
  category: 'async-error-propagation',
  difficulty: 'hard',
  description:
    'resolveZone returns the lookup promise without awaiting it inside try/catch, so the ZoneNotFoundError escapes the fallback and an unlisted pincode gets a 500 instead of the national delivery zone.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/deliveryService.js',
    summary:
      '`return lookupZone(pincode)` inside try must be `return await lookupZone(pincode)` for the catch to see the rejection.',
  },
  edits: [
    {
      file: 'src/services/deliveryService.js',
      find: '    return await lookupZone(pincode);',
      replace: '    return lookupZone(pincode);',
    },
  ],
  expectedFailing: [
    'resolveZone falls back to the national zone for a pincode the courier does not list',
    'GET /delivery/estimate serves an unlisted pincode through the national network, prepaid only',
  ],
};
