/**
 * Query-string values are always strings. toPositiveInt validates the parsed
 * number but returns the raw input, so page stays "2". Most arithmetic still
 * works because "-" and "*" coerce to numbers, which hides the bug; only "+"
 * concatenates, turning nextPage into "21".
 */
module.exports = {
  id: '17-query-string-page-coercion',
  category: 'type-coercion',
  difficulty: 'medium',
  description:
    'The page number from the query string is validated but returned as the original string, so the response reports page "2" and nextPage "21" (string concatenation) while the slice itself still looks right.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/services/catalogService.js',
    summary: 'toPositiveInt returns `value` (the raw string) instead of the parsed integer `n`.',
  },
  edits: [
    {
      file: 'src/services/catalogService.js',
      find: '  return Number.isInteger(n) && n > 0 ? n : fallback;',
      replace: '  return Number.isInteger(n) && n > 0 ? value : fallback;',
    },
  ],
  expectedFailing: [
    'GET /products/search returns the requested page, numbering pages from 1',
    'GET /products/search returns a partial last page with no next page',
  ],
};
