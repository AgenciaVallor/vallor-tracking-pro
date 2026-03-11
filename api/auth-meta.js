/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — auth-meta.js
 *  Rota: GET /auth/meta
 *  Redireciona para o Meta (Facebook) OAuth Dialog
 *  Scopes: ads_management, business_management, pages_read_engagement
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

/**
 * Handler principal
 */
module.exports = function authMeta(req, res) {
  const appId   = process.env.META_APP_ID;
  const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
  const redirectUri = `${baseUrl}/auth/meta/callback`;

  // Scopes necessários para acessar Pixels e Business Manager
  const scopes = [
    'ads_management',
    'business_management',
    'pages_read_engagement',
    'ads_read',
  ].join(',');

  // Monta a URL do Facebook Login Dialog
  const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  authUrl.searchParams.set('client_id',    appId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type','code');         // authorization code (seguro)
  authUrl.searchParams.set('scope',        scopes);
  authUrl.searchParams.set('state',        'meta_auth');    // CSRF protection

  console.log('[auth-meta] Redirecionando para Meta OAuth...');
  res.redirect(authUrl.toString());
};
