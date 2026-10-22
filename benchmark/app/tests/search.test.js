const request = require('supertest');
const createApp = require('../src/app');
const { resetProducts } = require('../src/data/products');

const app = createApp();

beforeEach(() => {
  resetProducts();
});

const search = (query = {}) => request(app).get('/products/search').query(query);
const prices = (res) => res.body.items.map((p) => p.price);

describe('GET /products/search', () => {
  it('returns every product on the first page by default', async () => {
    const res = await search();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body).toMatchObject({ page: 1, pageSize: 10, total: 5, totalPages: 1, nextPage: null });
  });

  it('sorts by price, lowest first', async () => {
    const res = await search({ sort: 'price_asc' });

    expect(prices(res)).toEqual([25.99, 39.99, 45, 59.99, 89.5]);
  });

  it('sorts by price, highest first', async () => {
    const res = await search({ sort: 'price_desc' });

    expect(prices(res)).toEqual([89.5, 59.99, 45, 39.99, 25.99]);
  });

  it('returns the requested page, numbering pages from 1', async () => {
    const res = await search({ sort: 'price_asc', page: 2, pageSize: 2 });

    expect(prices(res)).toEqual([45, 59.99]);
    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3, nextPage: 3 });
  });

  it('returns a partial last page with no next page', async () => {
    const res = await search({ sort: 'price_asc', page: 3, pageSize: 2 });

    expect(prices(res)).toEqual([89.5]);
    expect(res.body).toMatchObject({ page: 3, totalPages: 3, nextPage: null });
  });

  it('matches names case-insensitively', async () => {
    const res = await search({ q: 'MOUSE' });

    expect(res.body.items.map((p) => p.name)).toEqual(['Wireless Mouse']);
    expect(res.body.total).toBe(1);
  });

  it('does not carry one request\'s options into the next', async () => {
    await search({ q: 'stand', sort: 'price_desc', pageSize: 2 });

    const res = await search();

    expect(res.body.items).toHaveLength(5);
    expect(res.body.pageSize).toBe(10);
    expect(res.body.items[0].name).toBe('Wireless Mouse');
  });
});
