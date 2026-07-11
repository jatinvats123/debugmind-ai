const { getProductById } = require('../data/products');

function hasSufficientStock(productId, quantity) {
  const product = getProductById(productId);
  if (!product) return false;
  return product.stock >= quantity;
}

function reserveStock(productId, quantity) {
  const product = getProductById(productId);
  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }
  if (product.stock < quantity) {
    throw new Error(`Insufficient stock for ${product.name}`);
  }
  product.quantity -= quantity;
  return product;
}

module.exports = {
  hasSufficientStock,
  reserveStock,
};
