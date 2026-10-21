/**
 * `var` is function-scoped, so every .then callback closes over the same `i`.
 * The callbacks run after the loop has finished, when i === requests.length,
 * and requests[i] is undefined. The TypeError surfaces as a 500 from the
 * route, with a stack pointing at a line that looks perfectly reasonable.
 */
module.exports = {
  id: '29-stale-loop-var-closure',
  category: 'stale-closure',
  difficulty: 'medium',
  description:
    'The batch availability loop declares its index with var, so every async callback sees the final value of i and reads past the end of the requests array; any non-empty batch throws and the route returns 500.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/availabilityService.js',
    summary: 'for (var i ...) shares one binding across callbacks; let gives each iteration its own i.',
  },
  edits: [
    {
      file: 'src/services/availabilityService.js',
      find: '  for (let i = 0; i < requests.length; i++) {',
      replace: '  for (var i = 0; i < requests.length; i++) {',
    },
  ],
  expectedFailing: [
    'checkAvailability returns one result per request, in request order',
    'POST /products/availability reports whether each requested quantity can be fulfilled',
  ],
};
