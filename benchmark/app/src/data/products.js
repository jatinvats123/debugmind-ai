const initialProducts = [
  { id: 1, name: 'Wireless Mouse', price: 25.99, stock: 50, weightKg: 0.2 },
  { id: 2, name: 'Mechanical Keyboard', price: 89.5, stock: 30, weightKg: 1.2 },
  { id: 3, name: 'USB-C Hub', price: 39.99, stock: 0, weightKg: 0.15 },
  { id: 4, name: 'Laptop Stand', price: 45.0, stock: 15, weightKg: 2.5 },
  { id: 5, name: 'Webcam 1080p', price: 59.99, stock: 20, weightKg: 0.3 },
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
