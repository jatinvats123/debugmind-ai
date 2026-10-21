module.exports = {
  id: '30-cod-eligibility-boolean-logic',
  category: 'boolean-logic',
  difficulty: 'easy',
  description:
    'Cash-on-delivery eligibility combines its two conditions with || instead of &&, so COD is offered above the ₹50,000 limit and in the prepaid-only national zone.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/deliveryService.js',
    summary: 'isCodAvailable must require both zone.cod and orderTotal <= COD_LIMIT_RUPEES.',
  },
  edits: [
    {
      file: 'src/services/deliveryService.js',
      find: '  return zone.cod && orderTotal <= COD_LIMIT_RUPEES;',
      replace: '  return zone.cod || orderTotal <= COD_LIMIT_RUPEES;',
    },
  ],
  expectedFailing: [
    'GET /delivery/estimate serves an unlisted pincode through the national network, prepaid only',
    'GET /delivery/estimate offers cash on delivery up to the limit but not above it',
  ],
};
