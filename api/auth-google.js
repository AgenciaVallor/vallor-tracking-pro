/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — auth-google.js
 *  Rota: GET /auth/google
 *  Redireciona o usuário para o Google OAuth Consent Screen
 *  com os scopes necessários para o Google Tag Manager API
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

/**
 * Handler principal — funciona tanto como Express middleware
 * quanto como Vercel Serverless Function
 */
module.exports = function authGoogle(req, res) {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const baseUrl     = process.env.BASE_URL || `https://${req.headers.host}`;
  const redirectUri = `${baseUrl}/auth/google/callback`;

  // Scopes necessários para operar o GTM via API
  const scopes = [
    'https://www.googleapis.com/auth/tagmanager.edit.containers',
    'https://www.googleapis.com/auth/tagmanager.publish',
    'https://www.googleapis.com/auth/tagmanager.readonly',
    'https://www.googleapis.com/auth/tagmanager.manage.accounts',
  ].join(' ');

  // Monta a URL de autorização do Google
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     clientId);
  authUrl.searchParams.set('redirect_uri',  redirectUri);
  authUrl.searchParams.set('response_type', 'code');        // authorization code flow (seguro)
  authUrl.searchParams.set('scope',         scopes);
  authUrl.searchParams.set('state',         'google_auth'); // CSRF protection
  authUrl.searchParams.set('access_type',   'offline');     // refresh token
  authUrl.searchParams.set('prompt',        'consent');     // força re-consent (pega refresh token)

  console.log('[auth-google] Redirecionando para Google OAuth...');
  res.redirect(authUrl.toString());
};
