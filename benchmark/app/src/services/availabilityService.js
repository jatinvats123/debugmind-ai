/**
 * Batch stock checks for the product page ("is this in stock?") and the cart.
 *
 * Stock levels come from the warehouse system, which is asynchronous, so a
 * batch issues every lookup at once and waits for all of them.
 */
const { getProductById } = require('../data/products');

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function fetchStockLevel(productId) {
  await tick();
  const product = getProductById(productId);
  return product ? product.stock : 0;
}

/**
 * @param {{productId: number, quantity: number}[]} requests
 * @returns one result per request, in request order
 */
async function checkAvailability(requests) {
  const results = new Array(requests.length);
  const lookups = [];
  for (let i = 0; i < requests.length; i++) {
    lookups.push(
      fetchStockLevel(requests[i].productId).then((stock) => {
        results[i] = {
          productId: requests[i].productId,
          requested: requests[i].quantity,
          inStock: stock,
          available: stock >= requests[i].quantity,
        };
      })
    );
  }
  await Promise.all(lookups);
  return results;
}

module.exports = { checkAvailability, fetchStockLevel };
