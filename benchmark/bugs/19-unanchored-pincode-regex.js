module.exports = {
  id: '19-unanchored-pincode-regex',
  category: 'wrong-regex',
  difficulty: 'easy',
  description:
    'The pincode pattern has no ^ and $ anchors, so any input that merely contains six suitable digits passes validation: a 7-digit pincode or one with a letter prefix gets a delivery estimate instead of a 400.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/deliveryService.js',
    summary: 'PINCODE is /[1-9][0-9]{5}/ and must be anchored as /^[1-9][0-9]{5}$/.',
  },
  edits: [
    {
      file: 'src/services/deliveryService.js',
      find: 'const PINCODE = /^[1-9][0-9]{5}$/;',
      replace: 'const PINCODE = /[1-9][0-9]{5}/;',
    },
  ],
  expectedFailing: [
    'GET /delivery/estimate rejects the malformed pincode "1100011"',
    'GET /delivery/estimate rejects the malformed pincode "ABC110001"',
  ],
};
