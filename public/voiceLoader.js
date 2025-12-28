(function () {
  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var globalConfig = window.VoiceAgentEmbed || {};
  var dataset = scriptEl.dataset || {};

  function resolveBaseUrl() {
    var base = globalConfig.baseUrl || dataset.baseUrl;
    if (base) return base.replace(/\/$/, '');
    try {
      return new URL(scriptEl.src || window.location.href).origin;
    } catch (err) {
      console.warn('[VoiceAgentEmbed] Failed to parse script origin', err);
      return window.location.origin;
    }
  }

  var baseUrl = resolveBaseUrl();
  var publicId =
    globalConfig.publicId ||
    globalConfig.agent ||
    dataset.agent ||
    dataset.publicId ||
    dataset.slug;

  if (!publicId) {
    console.error('[VoiceAgentEmbed] Missing data-agent/publicId attribute');
    return;
  }

  var theme = (globalConfig.theme || dataset.theme || 'dark').toLowerCase() === 'light' ? 'light' : 'dark';
  var autostart = (globalConfig.autostart || dataset.autostart) === '1' || globalConfig.autostart === true;
  var position = (globalConfig.position || dataset.position || 'br').toLowerCase();

  var bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.setAttribute('aria-label', 'Open AI voice agent');
  bubble.style.position = 'fixed';
  bubble.style.width = '56px';
  bubble.style.height = '56px';
  bubble.style.borderRadius = '50%';
  bubble.style.border = 'none';
  bubble.style.cursor = 'pointer';
  bubble.style.boxShadow = '0 12px 30px rgba(15,23,42,0.25)';
  bubble.style.background = 'linear-gradient(135deg,#22d3ee,#6366f1)';
  bubble.style.color = '#fff';
  bubble.style.display = 'flex';
  bubble.style.alignItems = 'center';
  bubble.style.justifyContent = 'center';
  bubble.style.zIndex = '2147483001';
  bubble.style.fontSize = '24px';
  bubble.textContent = '🔊';

  var iframeContainer = document.createElement('div');
  iframeContainer.style.position = 'fixed';
  iframeContainer.style.width = '500px';
  iframeContainer.style.height = '760px';
  iframeContainer.style.borderRadius = '24px';
  iframeContainer.style.boxShadow = '0 25px 40px rgba(15,23,42,0.35)';
  iframeContainer.style.overflow = 'hidden';
  iframeContainer.style.opacity = '0';
  iframeContainer.style.pointerEvents = 'none';
  iframeContainer.style.transform = 'translateY(10px)';
  iframeContainer.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
  iframeContainer.style.zIndex = '2147483000';

  function applyPosition(target) {
    var vertical = position.includes('t') ? 'top' : 'bottom';
    var horizontal = position.includes('l') ? 'left' : 'right';
    var verticalOffset = position.includes('t') ? '24px' : '24px';
    target.style[vertical] = verticalOffset;
    target.style[horizontal] = '24px';
  }

  applyPosition(bubble);
  applyPosition(iframeContainer);
  if (position.includes('t')) {
    iframeContainer.style.marginTop = '64px';
  } else {
    iframeContainer.style.marginBottom = '64px';
  }

  var iframe = document.createElement('iframe');
  var params = new URLSearchParams();
  params.set('widget', '1');
  params.set('theme', theme);
  iframe.src = baseUrl + '/embed/voice/' + encodeURIComponent(publicId) + '?' + params.toString();
  iframe.setAttribute('allow', 'microphone');
  iframe.style.border = 'none';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframeContainer.appendChild(iframe);

  var isOpen = false;
  function toggleWidget(forceOpen) {
    if (typeof forceOpen === 'boolean') {
      isOpen = forceOpen;
    } else {
      isOpen = !isOpen;
    }
    if (isOpen) {
      iframeContainer.style.opacity = '1';
      iframeContainer.style.transform = 'translateY(0)';
      iframeContainer.style.pointerEvents = 'auto';
      bubble.style.transform = 'scale(0.9)';
    } else {
      iframeContainer.style.opacity = '0';
      iframeContainer.style.transform = 'translateY(10px)';
      iframeContainer.style.pointerEvents = 'none';
      bubble.style.transform = 'scale(1)';
    }
  }

  bubble.addEventListener('click', function () {
    toggleWidget();
  });

  if (!document.body) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.appendChild(bubble);
      document.body.appendChild(iframeContainer);
      if (autostart) toggleWidget(true);
    });
  } else {
    document.body.appendChild(bubble);
    document.body.appendChild(iframeContainer);
    if (autostart) toggleWidget(true);
  }
})();
