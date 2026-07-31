module.exports = {
  id: '01-off-by-one-shipping-band',
  category: 'off-by-one',
  difficulty: 'easy',
  description:
    'Shipping band boundaries become exclusive instead of inclusive, so a parcel weighing exactly the band limit is charged at the next band up.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/shippingService.js',
    summary: 'Boundary comparison changed from <= to <, shifting every band by one increment.',
  },
  edits: [
    {
      file: 'src/services/shippingService.js',
      find: 'if (weightKg <= band.maxKg) return band.price;',
      replace: 'if (weightKg < band.maxKg) return band.price;',
    },
  ],
  expectedFailing: ['rateForWeight treats a band boundary as inclusive'],
};
