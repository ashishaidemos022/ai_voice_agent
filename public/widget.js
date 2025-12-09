(function () {
  var globalConfig = window.MyVoiceAgent || window.myVoiceAgent || {};
  var scriptEl = document.currentScript;
  var baseUrl = globalConfig.baseUrl;
  if (!baseUrl) {
    try {
      var src = scriptEl ? scriptEl.src : window.location.href;
      baseUrl = new URL(src).origin;
    } catch (err) {
      baseUrl = window.location.origin;
    }
  }
  baseUrl = (baseUrl || '').replace(/\/$/, '');

  var publicId = globalConfig.publicId || globalConfig.public_id;
  if (!publicId) {
    console.error('[MyVoiceAgent] Missing publicId. Set window.MyVoiceAgent = { publicId: "slug" } before loading widget.js.');
    return;
  }

  var bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.setAttribute('aria-label', 'Open AI chat widget');
  bubble.style.position = 'fixed';
  bubble.style.bottom = '24px';
  bubble.style.right = '24px';
  bubble.style.width = '56px';
  bubble.style.height = '56px';
  bubble.style.borderRadius = '50%';
  bubble.style.border = 'none';
  bubble.style.cursor = 'pointer';
  bubble.style.boxShadow = '0 12px 30px rgba(15,23,42,0.25)';
  bubble.style.background = 'linear-gradient(135deg,#4f46e5,#9333ea)';
  bubble.style.color = '#fff';
  bubble.style.display = 'flex';
  bubble.style.alignItems = 'center';
  bubble.style.justifyContent = 'center';
  bubble.style.zIndex = '999999';
  bubble.style.fontSize = '24px';
  bubble.textContent = '✦';

  var iframeContainer = document.createElement('div');
  iframeContainer.style.position = 'fixed';
  iframeContainer.style.bottom = '96px';
  iframeContainer.style.right = '24px';
  iframeContainer.style.width = '360px';
  iframeContainer.style.height = '520px';
  iframeContainer.style.borderRadius = '20px';
  iframeContainer.style.boxShadow = '0 20px 60px rgba(15,23,42,0.35)';
  iframeContainer.style.overflow = 'hidden';
  iframeContainer.style.transform = 'translateY(10px)';
  iframeContainer.style.opacity = '0';
  iframeContainer.style.pointerEvents = 'none';
  iframeContainer.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
  iframeContainer.style.background = '#0f172a';
  iframeContainer.style.zIndex = '999998';

  var iframe = document.createElement('iframe');
  iframe.src = baseUrl + '/embed/agent/' + encodeURIComponent(publicId) + '?widget=1';
  iframe.setAttribute('allow', 'microphone');
  iframe.style.border = 'none';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframeContainer.appendChild(iframe);

  var isOpen = false;
  function toggleWidget() {
    isOpen = !isOpen;
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

  bubble.addEventListener('click', toggleWidget);

  if (!document.body) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.appendChild(bubble);
      document.body.appendChild(iframeContainer);
    });
  } else {
    document.body.appendChild(bubble);
    document.body.appendChild(iframeContainer);
  }
})();
