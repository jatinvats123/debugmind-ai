/**
 * Async in-memory order store.
 *
 * Persistence is asynchronous so callers must await it; the artificial tick
 * models the round trip a real datastore would have.
 */

let orders = new Map();
let sequence = 0;

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function saveOrder(order) {
  await tick();
  sequence += 1;
  const stored = { ...order, id: order.id || `order_${sequence}`, savedAt: sequence };
  orders.set(stored.id, stored);
  return stored;
}

async function findOrder(id) {
  await tick();
  return orders.get(id) || null;
}

async function listOrders() {
  await tick();
  return [...orders.values()];
}

async function countOrders() {
  await tick();
  return orders.size;
}

function resetOrders() {
  orders = new Map();
  sequence = 0;
}

module.exports = { saveOrder, findOrder, listOrders, countOrders, resetOrders };
