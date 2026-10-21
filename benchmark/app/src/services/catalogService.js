/**
 * Product search: filtering, sorting and pagination for GET /products/search.
 */

const DEFAULT_SEARCH_OPTIONS = { q: '', sort: 'relevance', page: 1, pageSize: 10 };
const MAX_PAGE_SIZE = 50;

const SORTERS = {
  relevance: null,
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
  name: (a, b) => a.name.localeCompare(b.name),
};

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Turn raw query-string values into search options, filling in defaults. */
function normaliseSearchOptions(query = {}, defaults = DEFAULT_SEARCH_OPTIONS) {
  const options = Object.assign({}, defaults);
  if (query.q) options.q = String(query.q).trim().toLowerCase();
  if (query.sort && query.sort in SORTERS) options.sort = query.sort;
  if (query.page) options.page = toPositiveInt(query.page, defaults.page);
  if (query.pageSize) options.pageSize = Math.min(MAX_PAGE_SIZE, toPositiveInt(query.pageSize, defaults.pageSize));
  return options;
}

/** One page of results. Pages are numbered from 1. */
function paginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages,
    nextPage: page < totalPages ? page + 1 : null,
  };
}

function searchProducts(products, { q, sort, page, pageSize }) {
  const matches = products.filter((p) => !q || p.name.toLowerCase().includes(q));
  const comparator = SORTERS[sort];
  if (comparator) matches.sort(comparator);
  return paginate(matches, page, pageSize);
}

module.exports = {
  normaliseSearchOptions,
  searchProducts,
  paginate,
  DEFAULT_SEARCH_OPTIONS,
  MAX_PAGE_SIZE,
};
