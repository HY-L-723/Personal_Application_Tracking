const form = document.querySelector('#login-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  const error = document.querySelector('#login-error');
  error.textContent = '';
  button.disabled = true;
  button.textContent = '正在验证…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: form.elements.password.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '登录失败');
    location.replace('/');
  } catch (cause) {
    error.textContent = cause instanceof TypeError ? '暂时无法连接服务器，请检查网络后重试。' : cause.message;
    button.disabled = false;
    button.textContent = '进入我的手记 ↗';
  }
});
