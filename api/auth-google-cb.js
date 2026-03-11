/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — auth-google-cb.js
 *  Rota: GET /auth/google/callback
 *  Recebe o "code" do Google, troca por access_token + refresh_token
 *  via requisição server-side (seguro — client_secret nunca vai ao browser)
 *  e armazena o token na sessão HTTP-only
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

/**
 * Troca o authorization code pelo access token via POST server-side
 * O client_secret NUNCA sai do servidor
 */
async function exchangeCodeForToken(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  redirectUri,
    grant_type:    'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Falha ao trocar código Google');
  }

  return data; // { access_token, refresh_token, expires_in, token_type, scope }
}

/**
 * Handler principal
 */
module.exports = async function authGoogleCallback(req, res) {
  const { code, state, error } = req.query;

  // Usuário negou permissão
  if (error) {
    console.error('[auth-google-cb] Erro OAuth:', error);
    return res.redirect('/?error=google_denied#p1');
  }

  // Verificação CSRF básica
  if (state !== 'google_auth') {
    return res.redirect('/?error=invalid_state#p1');
  }

  if (!code) {
    return res.redirect('/?error=no_code#p1');
  }

  try {
    const baseUrl     = process.env.BASE_URL || `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/auth/google/callback`;

    // Troca o code por token (server-side — seguro)
    const tokenData = await exchangeCodeForToken(code, redirectUri);

    // Armazena o token na sessão server-side (HTTP-only cookie)
    // O frontend NUNCA vê o access_token diretamente
    if (req.session) {
      req.session.googleToken        = tokenData.access_token;
      req.session.googleRefreshToken = tokenData.refresh_token;
      req.session.googleConnected    = true;
      req.session.googleTokenExpiry  = Date.now() + (tokenData.expires_in * 1000);
    }

    console.log('[auth-google-cb] ✓ Google autenticado com sucesso');

    // Redireciona de volta ao app com status de sucesso
    res.redirect('/?google=connected#p1');

  } catch (err) {
    console.error('[auth-google-cb] Erro ao trocar token:', err.message);
    res.redirect(`/?error=${encodeURIComponent(err.message)}#p1`);
  }
};
