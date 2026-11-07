// Cart logic for the menu page.
const PRICES = { chai: 30, filter_coffee: 40 };
const cart = [];

function addToCart(id) {
  // BUG: the coffee button passes "coffee", but the price key is "filter_coffee".
  const price = PRICES[id].toFixed(0);
  cart.push({ id, price: Number(price) });
  document.getElementById('cart-count').textContent = cart.length;
  document.getElementById('cart-total').textContent = '₹' + cart.reduce((sum, item) => sum + item.price, 0);
}
