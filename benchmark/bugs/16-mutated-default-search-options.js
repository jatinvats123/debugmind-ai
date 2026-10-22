/**
 * The defaults object is shared by every request. Writing into it instead of
 * into a copy means each request's q/sort/page/pageSize become the defaults
 * for the next one. The first few tests pass because they set every option
 * they depend on; the failures appear later in the file, in tests that rely on
 * a default which an earlier test silently changed. Order-dependent, and the
 * failing assertion is never on the line that caused it.
 */
module.exports = {
  id: '16-mutated-default-search-options',
  category: 'mutated-default-params',
  difficulty: 'hard',
  description:
    "normaliseSearchOptions writes request options into its shared default-parameter object, so one request's page, page size and query leak into every later search that relies on the defaults.",
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/catalogService.js',
    summary:
      'options aliases the module-level DEFAULT_SEARCH_OPTIONS (the default parameter) instead of copying it, so assignments mutate the defaults.',
  },
  edits: [
    {
      file: 'src/services/catalogService.js',
      find: '  const options = Object.assign({}, defaults);',
      replace: '  const options = defaults;',
    },
  ],
  expectedFailing: [
    'GET /products/search matches names case-insensitively',
    "GET /products/search does not carry one request's options into the next",
  ],
};
