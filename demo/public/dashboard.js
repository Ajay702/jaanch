// Dashboard: loads recent orders.
async function refresh() {
  const res = await fetch('/api/orders');
  const orders = await res.json();
  document.getElementById('orders').textContent = orders.length + ' orders';
}

refresh();
// BUG: the "Export CSV" button calls exportCsv(), which was never written.
