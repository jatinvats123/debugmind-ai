const initialProducts = [
  { id: 1, name: 'Wireless Mouse', price: 25.99, stock: 50 },
  { id: 2, name: 'Mechanical Keyboard', price: 89.5, stock: 30 },
  { id: 3, name: 'USB-C Hub', price: 39.99, stock: 0 },
  { id: 4, name: 'Laptop Stand', price: 45.0, stock: 15 },
  { id: 5, name: 'Webcam 1080p', price: 59.99, stock: 20 },
];

let products = initialProducts.map((p) => ({ ...p }));

function getAllProducts() {
  return products;
}

function getProductById(id) {
  return products.find((p) => p.id === Number(id));
}

function resetProducts() {
  products = initialProducts.map((p) => ({ ...p }));
}

module.exports = {
  getAllProducts,
  getProductById,
  resetProducts,
};
