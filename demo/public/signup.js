// Signup form handler.
const form = document.getElementById('signup-form');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const res = await fetch('/api/signup', { method: 'POST', body: JSON.stringify(data) });
  if (res.ok) {
    // BUG: typo in the element id ("sucess" instead of "success"), so this is null.
    document.getElementById('sucess-msg').textContent = 'Welcome to ChaiCart, ' + data.name + '!';
    form.reset();
  }
});
