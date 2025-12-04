(function () {
  const currentScript = document.currentScript;
  if (!currentScript) return;

  const agentId = currentScript.getAttribute('data-agent-id') || '';
  const userJwt = currentScript.getAttribute('data-user-jwt') || '';
  const theme = currentScript.getAttribute('data-theme') || 'dark';
  const origin = new URL(currentScript.src, window.location.href).origin;
  const widgetUrl = `${origin}/widget?agent=${encodeURIComponent(agentId)}&theme=${encodeURIComponent(theme)}${userJwt ? `&token=${encodeURIComponent(userJwt)}` : ''}`;

  const style = document.createElement('style');
  style.textContent = `
    .agentic-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 999px;
      background: linear-gradient(135deg, #6366f1, #0ea5e9);
      color: #fff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.3);
      z-index: 2147483000;
    }
    .agentic-widget-frame {
      position: fixed;
      width: 360px;
      height: 520px;
      bottom: 96px;
      right: 24px;
      border: none;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 25px 40px rgba(15, 23, 42, 0.35);
      transform-origin: bottom right;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 2147483000;
    }
    .agentic-widget-frame[data-hidden='true'] {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.95);
    }
  `;
  document.head.appendChild(style);

  const launcher = document.createElement('button');
  launcher.className = 'agentic-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open Agentic Chat');
  launcher.innerHTML = '<svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 19c7 0 9-5 9-8V5l-9-3-9 3v6c0 3 2 8 9 8z\"/><path d=\"M12 22v-3\"/></svg>';

  const frame = document.createElement('iframe');
  frame.className = 'agentic-widget-frame';
  frame.src = widgetUrl;
  frame.dataset.hidden = 'true';

  launcher.addEventListener('click', () => {
    const hidden = frame.dataset.hidden === 'true';
    frame.dataset.hidden = hidden ? 'false' : 'true';
  });

  document.body.appendChild(frame);
  document.body.appendChild(launcher);
})();
