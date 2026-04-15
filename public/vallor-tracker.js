/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — vallor-tracker.js
 *  Script de Captura Frontend (DAS Section 4)
 *
 *  Instalação na LP do cliente:
 *  <script src="https://SEU_DOMINIO/vallor-tracker.js"
 *          data-key="SCRIPT_KEY_DO_CLIENTE"
 *          async></script>
 *
 *  O que faz:
 *  - Captura fbclid da URL e salva cookie _fbc
 *  - Lê cookie _fbp do Meta Pixel
 *  - Captura UTMs da URL
 *  - Gera fingerprint determinístico (não usa dados biométricos)
 *  - Envia PageView automaticamente ao carregar
 *  - Expõe window.VallorTracker.track() para eventos manuais
 * ═══════════════════════════════════════════════════════════════
 */
(function (window, document) {
  'use strict';

  var SCRIPT_KEY = (document.currentScript || {}).getAttribute('data-key');
  var API_ENDPOINT = (document.currentScript || {}).getAttribute('data-endpoint')
    || (window.location.origin + '/api/track');

  // ── Utilitários de Cookie ───────────────────────────────────
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    var expires = '';
    if (days) {
      var d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      expires = '; expires=' + d.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
  }

  // ── Captura do fbclid e geração do _fbc ────────────────────
  function getFbc() {
    var existing = getCookie('_fbc');
    if (existing) return existing;

    var params = new URLSearchParams(window.location.search);
    var fbclid = params.get('fbclid');
    if (fbclid) {
      // Formato oficial Meta: fb.1.{timestamp}.{fbclid}
      var fbc = 'fb.1.' + Math.floor(Date.now() / 1000) + '.' + fbclid;
      setCookie('_fbc', fbc, 90); // 90 dias
      return fbc;
    }
    return null;
  }

  // ── Leitura do _fbp (gerado pelo Meta Pixel) ───────────────
  function getFbp() {
    return getCookie('_fbp') || null;
  }

  // ── Captura de UTMs ────────────────────────────────────────
  function getUtms() {
    var params = new URLSearchParams(window.location.search);
    return {
      utm_source:   params.get('utm_source')   || null,
      utm_medium:   params.get('utm_medium')   || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_content:  params.get('utm_content')  || null,
      utm_term:     params.get('utm_term')     || null
    };
  }

  // ── Fingerprint Determinístico ──────────────────────────────
  // Baseado em características do browser — sem dados pessoais
  function generateFingerprint() {
    var components = [
      navigator.userAgent        || '',
      navigator.language         || '',
      screen.colorDepth          || '',
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || '',
      navigator.platform         || '',
      !!window.sessionStorage,
      !!window.localStorage,
      !!window.indexedDB
    ];
    var str = components.join('|||');
    // Simple hash (djb2)
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'fp_' + Math.abs(hash).toString(16);
  }

  // ── Geração de Event ID único ──────────────────────────────
  function generateEventId(eventName) {
    return eventName.toLowerCase().replace(/\s/g, '_')
      + '_' + Date.now()
      + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ── Função principal de rastreamento ──────────────────────
  function track(eventName, userData, customData) {
    if (!SCRIPT_KEY) {
      console.warn('[VallorTracker] data-key não configurado no script tag.');
      return;
    }

    var fbc = getFbc();
    var fbp = getFbp();
    var utms = getUtms();
    var fingerprint = generateFingerprint();

    var payload = {
      script_key:       SCRIPT_KEY,
      event_name:       eventName,
      event_id:         generateEventId(eventName),
      event_source_url: window.location.href,
      event_time:       Math.floor(Date.now() / 1000),
      fbc:              fbc,
      fbp:              fbp,
      fingerprint:      fingerprint,
      utm:              utms,
      user_data:        userData  || {},
      custom_data:      customData || {}
    };

    // Envio via Beacon API (não bloqueia unload) ou fetch
    var jsonPayload = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      var blob = new Blob([jsonPayload], { type: 'application/json' });
      navigator.sendBeacon(API_ENDPOINT, blob);
    } else {
      fetch(API_ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: jsonPayload
      }).catch(function (e) {
        console.warn('[VallorTracker] Erro ao enviar evento:', e.message);
      });
    }
  }

  // ── Exposição da API Pública ───────────────────────────────
  window.VallorTracker = {
    track: track,
    /**
     * Identifica o usuário com dados de PII (serão hasheados no server)
     * Exemplo: VallorTracker.identify({ email: 'user@mail.com', phone: '11999999999' })
     */
    identify: function (userData) {
      track('Identify', userData, {});
    },
    /**
     * Rastreia evento de Lead (formulário preenchido)
     * Exemplo: VallorTracker.lead({ email: 'user@mail.com' })
     */
    lead: function (userData) {
      track('Lead', userData, {});
    },
    /**
     * Rastreia início de checkout
     */
    initiateCheckout: function (customData) {
      track('InitiateCheckout', {}, customData || {});
    },
    /**
     * Rastreia compra (para uso via GTM / tag customizada)
     */
    purchase: function (userData, customData) {
      track('Purchase', userData || {}, customData || {});
    }
  };

  // ── Auto PageView ─────────────────────────────────────────
  // Dispara automaticamente ao carregar o script
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      track('PageView', {}, {});
    });
  } else {
    track('PageView', {}, {});
  }

})(window, document);
