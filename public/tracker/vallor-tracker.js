/**
* Vallor Tracker - Engine de Rastreamento Avançado 2026
* @version 10.0.0
* @license MIT
*/
(function() {
'use strict';
const VallorTracker = {
// Configuração
config: {
apiUrl: null,
scriptKey: null,
cookieDuration: 30, // dias
debug: false
},
// Utilitários de Cookie
getCookie: function(name) {
const match = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
return match ? decodeURIComponent(match[2]) : null;
},
setCookie: function(name, value, days) {
const expires = new Date();
expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
const cookieValue = encodeURIComponent(value);
document.cookie = `${name}=${cookieValue};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
},
// Gerar Event ID único (para deduplicação)
generateEventID: function(prefix = 'ev') {
return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
},
// Criptografia SHA256
sha256: async function(message) {
const msgBuffer = new TextEncoder().encode(message);
const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
const hashArray = Array.from(new Uint8Array(hashBuffer));
return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
},
// Capturar Fingerprint do Navegador
getFingerprint: function() {
const components = [
navigator.userAgent,
navigator.language,
screen.width + 'x' + screen.height,
screen.colorDepth,
new Date().getTimezoneOffset(),
!!window.sessionStorage,
!!window.localStorage,
navigator.hardwareConcurrency || 'unknown',
navigator.platform
];
return btoa(components.join('|'));
},
// Capturar Parâmetros UTM
getUTMParams: function() {
const params = new URLSearchParams(window.location.search);
return {
utm_source: params.get('utm_source'),
utm_medium: params.get('utm_medium'),
utm_campaign: params.get('utm_campaign'),
utm_content: params.get('utm_content'),
utm_term: params.get('utm_term'),
fbclid: params.get('fbclid'),
gclid: params.get('gclid')
};
},
// Capturar IP (via serviço externo ou servidor)
captureIP: async function() {
try {
const response = await fetch('https://api.ipify.org?format=json', {
timeout: 3000
});
const data = await response.json();
return data.ip;
} catch (e) {
if (this.config.debug) console.warn('Vallor Tracker: Could not capture IP', e);
return '0.0.0.0';
}
},
// Capturar todos os dados do navegador
captureBrowserData: async function() {
const utmParams = this.getUTMParams();
const ip = await this.captureIP();
const fingerprint = this.getFingerprint();
const fingerprintHash = await this.sha256(fingerprint);
// Gerar ou recuperar _fbp (Facebook Browser ID)
let fbp = this.getCookie('_fbp');
if (!fbp) {
fbp = `fb.1.${Date.now()}.${Math.random().toString().substring(2, 11)}`;
this.setCookie('_fbp', fbp, 90);
}
// Capturar _fbc (Facebook Click ID) se existe fbclid
let fbc = this.getCookie('_fbc');
if (utmParams.fbclid && !fbc) {
fbc = `fb.1.${Date.now()}.${utmParams.fbclid}`;
this.setCookie('_fbc', fbc, 90);
}
return {
fbc: fbc,
fbp: fbp,
user_agent: navigator.userAgent,
ip: ip,
url: window.location.href,
referrer: document.referrer,
fingerprint: fingerprint,
fingerprint_hash: fingerprintHash,
screen_resolution: `${screen.width}x${screen.height}`,
language: navigator.language,
timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
...utmParams
};
},
// Persistir dados em LocalStorage (janela de 30 dias)
persistData: function(data) {
const storageKey = 'vallor_tracker_data';
const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');
const merged = { ...existing, ...data, last_updated: Date.now() };
localStorage.setItem(storageKey, JSON.stringify(merged));
return merged;
},
// Recuperar dados persistidos
getPersistedData: function() {
const storageKey = 'vallor_tracker_data';
const data = localStorage.getItem(storageKey);
if (!data) return null;
const parsed = JSON.parse(data);
const age = Date.now() - (parsed.last_updated || 0);
const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 dias
if (age > maxAge) {
localStorage.removeItem(storageKey);
return null;
}
return parsed;
},
// Capturar dados de formulário (Advanced Matching)
captureFormData: async function(form) {
const data = {};
// Buscar campos comuns
const emailField = form.querySelector('input[type="email"], input[name*="email"], input[id*="email"]');
const phoneField = form.querySelector('input[type="tel"], input[name*="phone"], input[name*="telefone"]');
const nameField = form.querySelector('input[name*="name"], input[name*="nome"]');
const firstNameField = form.querySelector('input[name*="first"], input[name*="primeiro"]');
const lastNameField = form.querySelector('input[name*="last"], input[name*="ultimo"], input[name*="sobrenome"]');
const cityField = form.querySelector('input[name*="city"], input[name*="cidade"]');
const stateField = form.querySelector('input[name*="state"], input[name*="estado"], select[name*="uf"]');
const zipField = form.querySelector('input[name*="zip"], input[name*="cep"], input[name*="postal"]');
// Hash dos dados sensíveis
if (emailField && emailField.value) {
data.email_hash = await this.sha256(emailField.value.toLowerCase().trim());
}
if (phoneField && phoneField.value) {
const phone = phoneField.value.replace(/\D/g, ''); // Remove formatação
data.phone_hash = await this.sha256(phone);
}
if (firstNameField && firstNameField.value) {
data.first_name_hash = await this.sha256(firstNameField.value.toLowerCase().trim());
} else if (nameField && nameField.value) {
const nameParts = nameField.value.trim().split(' ');
data.first_name_hash = await this.sha256(nameParts[0].toLowerCase());
if (nameParts.length > 1) {
data.last_name_hash = await this.sha256(nameParts[nameParts.length - 1].toLowerCase());
}
}
if (lastNameField && lastNameField.value) {
data.last_name_hash = await this.sha256(lastNameField.value.toLowerCase().trim());
}
// Localização (não precisa de hash)
if (cityField && cityField.value) {
data.city = cityField.value.toLowerCase().trim();
}
if (stateField && stateField.value) {
data.state = stateField.value.toLowerCase().trim();
}
if (zipField && zipField.value) {
data.zip = zipField.value.replace(/\D/g, '');
}
data.country = 'br';
return data;
},
// Enviar evento para API
sendEvent: async function(eventName, customData = {}) {
if (!this.config.apiUrl || !this.config.scriptKey) {
console.error('Vallor Tracker: Configuration missing');
return null;
}
const browserData = await this.captureBrowserData();
const eventId = this.generateEventID();
// Persistir dados importantes
this.persistData({
fbp: browserData.fbp,
fbc: browserData.fbc,
fingerprint_hash: browserData.fingerprint_hash,
last_event: eventName,
last_event_time: Date.now()
});
const payload = {
script_key: this.config.scriptKey,
event_name: eventName,
event_time: Math.floor(Date.now() / 1000),
event_id: eventId,
...browserData,
...customData
};
// 1. Disparar via Meta Pixel (se existir) - Browser Side
if (typeof fbq !== 'undefined') {
fbq('track', eventName, customData, { eventID: eventId });
}
// 2. Enviar para nosso servidor - Server Side
try {
const response = await fetch(this.config.apiUrl, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload),
mode: 'cors'
});
if (this.config.debug) {
console.log('[Vallor Tracker] Event sent:', eventName, 'ID:', eventId);
}
return eventId;
} catch (e) {
console.error('Vallor Tracker: Failed to send event', e);
return null;
}
},
// Monitorar cliques em WhatsApp (para negócios locais)
monitorWhatsAppClicks: function() {
document.addEventListener('click', async (e) => {
const target = e.target.closest('a');
if (!target) return;
const href = target.getAttribute('href') || '';
if (href.includes('wa.me') || href.includes('whatsapp.com') || href.includes('api.whatsapp.com')) {
await this.sendEvent('Contact', {
content_name: 'WhatsApp Button',
contact_method: 'whatsapp',
button_text: target.textContent.trim(),
button_url: href
});
}
});
},
// Monitorar envio de formulários
monitorFormSubmissions: function() {
document.addEventListener('submit', async (e) => {
const form = e.target;
if (!form.tagName || form.tagName !== 'FORM') return;
// Capturar dados do formulário
const formData = await this.captureFormData(form);
await this.sendEvent('Lead', {
content_name: form.id || form.name || 'Form Submission',
form_id: form.id,
form_name: form.name,
...formData
});
});
},
// Inicializar
init: function(config = {}) {
// Mesclar configuração
this.config = { ...this.config, ...config };
// Capturar script_key do data-attribute se não fornecido
if (!this.config.scriptKey) {
const scriptTag = document.currentScript || document.querySelector('script[data-vallor-key]');
if (scriptTag) {
this.config.scriptKey = scriptTag.getAttribute('data-vallor-key');
}
}
// Definir URL da API se não fornecida
if (!this.config.apiUrl) {
const scriptTag = document.currentScript || document.querySelector('script[data-vallor-key]');
if (scriptTag) {
const scriptSrc = scriptTag.getAttribute('src');
const url = new URL(scriptSrc, window.location.origin);
this.config.apiUrl = `${url.origin}/api/track`;
}
}
if (!this.config.scriptKey) {
console.error('Vallor Tracker: script_key not found');
return;
}
// Rastrear PageView automaticamente
this.sendEvent('PageView');
// Iniciar monitores
this.monitorWhatsAppClicks();
this.monitorFormSubmissions();
if (this.config.debug) {
console.log('[Vallor Tracker] Initialized with key:', this.config.scriptKey);
console.log('[Vallor Tracker] API URL:', this.config.apiUrl);
}
}
};
// Expor globalmente
window.VallorTracker = VallorTracker;
// Auto-inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', function() {
if (window.vallorConfig) {
VallorTracker.init(window.vallorConfig);
} else {
VallorTracker.init();
}
});
} else {
if (window.vallorConfig) {
VallorTracker.init(window.vallorConfig);
} else {
VallorTracker.init();
}
}
})();
