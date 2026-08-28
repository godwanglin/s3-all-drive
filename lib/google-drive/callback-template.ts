export function getCallbackPageHtml(token: string) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Drive Callback Berhasil</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 15% 20%,rgba(99,102,241,0.2),transparent 28%), radial-gradient(circle at 85% 80%,rgba(20,184,166,0.16),display: grid; transparent 28%), linear-gradient(135deg, #050816 0%, #0b1020 45%, #06111f 100%); color: #edf4ff; font-family: system-ui; padding: 16px; }
    .card { width: 100%; max-width: 480px; padding: 32px 28px; border-radius: 24px; background: rgba(16,24,39,0.75); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(16px); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 40px -10px rgba(99,102,241,0.25); }
    .icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #4ade80; font-size: 22px; margin-bottom: 18px; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 8px; }
    p { font-size: 13px; line-height: 1.5; color: #94a3b8; margin-bottom: 20px; }
    .token-box { background: rgba(8,13,24,0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 12px 14px; margin-bottom: 18px; }
    input { width: 100%; background: transparent; border: none; outline: none; color: #93c5fd; font-family: monospace; font-size: 13px; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 44px; border-radius: 14px; border: none; background: linear-gradient(135deg, #6366f1 0%, #3b82f6 100%); color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 15px rgba(99,102,241,0.35); }
    .btn.copied { background: linear-gradient(135deg, #10b981 0%, #059669 100%); }
  </style>
</head>
<body>
  <main class="card">
    <div class="icon">✓</div>
    <h1>Drive Callback Berhasil</h1>
    <p>Salin token di bawah ini, lalu paste ke modal <b>Connect Google Drive</b> pada jendela aplikasi utama kamu.</p>
    <div class="token-box">
      <input type="text" id="token" readonly value="${ token }" onclick="this.select()" />
    </div>
    <button id="copy-btn" class="btn" onclick="copyToken()">Salin Token</button>
  </main>
<script>
    function copyToken() {
      const input = document.getElementById('token');
      const btn = document.getElementById('copy-btn');
      navigator.clipboard.writeText(input.value).then(() => {
        btn.classList.add('copied');
        btn.textContent = 'Token Disalin!';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.textContent = 'Salin Token';
        }, 2000);
      });
    }
  </script>
</body>
</html>`; }