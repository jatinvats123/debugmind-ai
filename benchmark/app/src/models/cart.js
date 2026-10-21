const { getProductById } = require('../data/products');

class Cart {
  constructor(id) {
    this.id = id;
    this.items = [];
  }

  addItem(productId, quantity = 1) {
    const product = getProductById(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    const existing = this.items.find((i) => i.productId === product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.items.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        weightKg: product.weightKg,
        quantity,
      });
    }
    return this;
  }

  updateItemQuantity(productId, quantity) {
    const item = this.items.find((i) => i.productId === Number(productId));
    if (!item) {
      throw new Error(`Item ${productId} is not in the cart`);
    }
    item.quantity = quantity;
    return this;
  }

  /** Apply several quantity changes at once, then drop lines that reached zero. */
  setQuantities(updates) {
    for (const { productId, quantity } of updates) {
      const item = this.items.find((i) => i.productId === Number(productId));
      if (!item) {
        throw new Error(`Item ${productId} is not in the cart`);
      }
      item.quantity = quantity;
    }
    this.removeEmptyLines();
    return this;
  }

  removeEmptyLines() {
    this.items = this.items.filter((item) => item.quantity > 0);
  }

  removeItem(productId) {
    this.items = this.items.filter((i) => i.productId !== Number(productId));
    return this;
  }

  clear() {
    this.items = [];
    return this;
  }

  getSubtotal() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }
}

const carts = new Map();

function getOrCreateCart(cartId) {
  if (!carts.has(cartId)) {
    carts.set(cartId, new Cart(cartId));
  }
  return carts.get(cartId);
}

function resetCarts() {
  carts.clear();
}

module.exports = {
  Cart,
  getOrCreateCart,
  resetCarts,
};
