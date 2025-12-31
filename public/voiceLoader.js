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
  var supabaseUrl = (globalConfig.supabaseUrl || dataset.supabaseUrl || baseUrl || '').replace(/\/$/, '');
  var supabaseKey = globalConfig.supabaseKey || dataset.supabaseKey || dataset.apikey;
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
  var overrideSettings =
    (globalConfig.override || dataset.override || dataset.overrideSettings) === '1' ||
    globalConfig.override === true;
  var rawWidth = overrideSettings ? (globalConfig.width || dataset.width) : null;
  var rawHeight = overrideSettings ? (globalConfig.height || dataset.height) : null;
  var rawButtonColor = overrideSettings ? (globalConfig.buttonColor || dataset.buttonColor) : null;
  var rawButtonTextColor = overrideSettings ? (globalConfig.buttonTextColor || dataset.buttonTextColor) : null;
  var buttonImage = overrideSettings
    ? (globalConfig.buttonImage || dataset.buttonImage || dataset.buttonImageUrl)
    : null;

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
  var bubbleImg = null;
  function setButtonImage(url) {
    if (url) {
      bubble.textContent = '';
      if (!bubbleImg) {
        bubbleImg = document.createElement('img');
        bubbleImg.alt = 'Open voice chat';
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
    bubble.textContent = '🔊';
  }

  var iframeContainer = document.createElement('div');
  iframeContainer.style.position = 'fixed';
  iframeContainer.style.width = normalizeSize(rawWidth, '500px');
  iframeContainer.style.height = normalizeSize(rawHeight, '760px');
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

  function applyRemoteSettings(settings) {
    var appearance = settings && settings.appearance ? settings.appearance : {};
    if ((!rawWidth || rawWidth === '') && appearance.widget_width) {
      iframeContainer.style.width = normalizeSize(appearance.widget_width, iframeContainer.style.width);
    }
    if ((!rawHeight || rawHeight === '') && appearance.widget_height) {
      iframeContainer.style.height = normalizeSize(appearance.widget_height, iframeContainer.style.height);
    }
    if ((!buttonImage || buttonImage === '') && appearance.button_image_url) {
      setButtonImage(appearance.button_image_url);
    }
    if ((!rawButtonColor || rawButtonColor === '') && appearance.button_color) {
      bubble.style.background = appearance.button_color;
    }
    if ((!rawButtonTextColor || rawButtonTextColor === '') && appearance.button_text_color) {
      bubble.style.color = appearance.button_text_color;
    }
  }

  function fetchSettings() {
    if (!supabaseUrl) return;
    var url = supabaseUrl + '/functions/v1/voice-ephemeral-key?public_id=' + encodeURIComponent(publicId);
    var headers = {};
    if (supabaseKey) {
      headers.apikey = supabaseKey;
      headers.Authorization = 'Bearer ' + supabaseKey;
    }
    fetch(url, { method: 'GET', headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('voice embed settings unavailable');
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
