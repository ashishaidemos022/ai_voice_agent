(function () {
  var globalConfig = window.MyVoiceAgent || window.myVoiceAgent || {};
  var scriptEl = document.currentScript;
  var baseUrl = globalConfig.baseUrl;
  var apiBase =
    (globalConfig.apiBaseUrl ||
      globalConfig.apiBase ||
      '') || '';
  apiBase = apiBase.replace(/\/$/, '');
  var supabaseUrl = (globalConfig.supabaseUrl || '').replace(/\/$/, '');
  if (!apiBase && supabaseUrl) {
    apiBase = supabaseUrl;
  }
  if (!apiBase) {
    apiBase = baseUrl;
  }
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

  var overrideSettings = globalConfig.override === true || globalConfig.override === '1';
  var rawWidth = overrideSettings ? globalConfig.width : null;
  var rawHeight = overrideSettings ? globalConfig.height : null;
  var rawButtonColor = overrideSettings ? globalConfig.buttonColor : null;
  var rawButtonTextColor = overrideSettings ? globalConfig.buttonTextColor : null;
  var buttonImage = overrideSettings ? globalConfig.buttonImage : null;

  function normalizeSize(value, fallback) {
    if (!value && value !== 0) return fallback;
    if (typeof value === 'number') return value + 'px';
    var trimmed = String(value).trim();
    if (!trimmed) return fallback;
    if (/\d$/.test(trimmed) && !/%|px|rem|em|vh|vw/.test(trimmed)) {
      return trimmed + 'px';
    }
    return trimmed;
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

  var bubbleImg = null;
  function setButtonImage(url) {
    if (url) {
      bubble.textContent = '';
      if (!bubbleImg) {
        bubbleImg = document.createElement('img');
        bubbleImg.alt = 'Open chat';
        bubbleImg.style.width = '24px';
        bubbleImg.style.height = '24px';
        bubbleImg.style.objectFit = 'cover';
        bubbleImg.style.borderRadius = '999px';
        bubble.appendChild(bubbleImg);
      }
      bubbleImg.src = url;
      return;
    }
    if (bubbleImg && bubbleImg.parentNode) {
      bubble.removeChild(bubbleImg);
    }
    bubbleImg = null;
    bubble.textContent = '✦';
  }

  var iframeContainer = document.createElement('div');
  iframeContainer.style.position = 'fixed';
  iframeContainer.style.bottom = '96px';
  iframeContainer.style.right = '24px';
  iframeContainer.style.width = normalizeSize(rawWidth, '360px');
  iframeContainer.style.height = normalizeSize(rawHeight, '520px');
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
  var params = new URLSearchParams({ widget: '1' });
  if (apiBase) {
    params.set('api_base', apiBase);
  }
  iframe.src = baseUrl + '/embed/agent/' + encodeURIComponent(publicId) + '?' + params.toString();
  iframe.setAttribute('allow', 'microphone');
  iframe.style.border = 'none';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframeContainer.appendChild(iframe);

  if (rawButtonColor) {
    bubble.style.background = rawButtonColor;
  }
  if (rawButtonTextColor) {
    bubble.style.color = rawButtonTextColor;
  }
  if (buttonImage) {
    setButtonImage(buttonImage);
  }

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

  function applyRemoteSettings(settings) {
    var appearance = settings && settings.appearance ? settings.appearance : {};
    if (!rawWidth && appearance.widget_width) {
      iframeContainer.style.width = normalizeSize(appearance.widget_width, iframeContainer.style.width);
    }
    if (!rawHeight && appearance.widget_height) {
      iframeContainer.style.height = normalizeSize(appearance.widget_height, iframeContainer.style.height);
    }
    if (!buttonImage && appearance.button_image_url) {
      setButtonImage(appearance.button_image_url);
    }
    if (!rawButtonColor && appearance.button_color) {
      bubble.style.background = appearance.button_color;
    }
    if (!rawButtonTextColor && appearance.button_text_color) {
      bubble.style.color = appearance.button_text_color;
    }
  }

  function buildFunctionUrl(base, name) {
    if (!base) return '';
    if (base.endsWith('/functions/v1')) return base + '/' + name;
    return base + '/functions/v1/' + name;
  }

  function fetchSettings() {
    if (!apiBase) return;
    var url = buildFunctionUrl(apiBase, 'agent-chat') + '?public_id=' + encodeURIComponent(publicId);
    fetch(url, { method: 'GET' })
      .then(function (res) {
        if (!res.ok) throw new Error('chat embed settings unavailable');
        return res.json();
      })
      .then(function (json) {
        if (json && json.settings) {
          applyRemoteSettings(json.settings);
        }
      })
      .catch(function () {});
  }

  fetchSettings();
})();
