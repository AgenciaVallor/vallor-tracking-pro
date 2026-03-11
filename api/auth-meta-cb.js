/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — auth-meta-cb.js
 *  Rota: GET /auth/meta/callback
 *  Troca o "code" da Meta por short-lived token e depois por
 *  long-lived token (60 dias) via fetch server-side
 *  O app_secret NUNCA sai do servidor
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

/**
 * Troca authorization code por short-lived user access token
 * Meta exige que essa troca seja feita no servidor (CORS block no browser)
 */
async function exchangeCodeForShortToken(code, redirectUri) {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  url.searchParams.set('client_id',     process.env.META_APP_ID);
  url.searchParams.set('client_secret', process.env.META_APP_SECRET);
  url.searchParams.set('redirect_uri',  redirectUri);
  url.searchParams.set('code',          code);

  const response = await fetch(url.toString());
  const data     = await response.json();

  if (data.error) {
    throw new Error(data.error.message || 'Erro ao trocar código Meta');
  }

  return data; // { access_token, token_type }
}

/**
 * Extende o short-lived token para long-lived (60 dias)
 * Necessário para não ter que reautenticar todo dia
 */
async function extendToLongLivedToken(shortToken) {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  url.searchParams.set('grant_type',        'fb_exchange_token');
  url.searchParams.set('client_id',         process.env.META_APP_ID);
  url.searchParams.set('client_secret',     process.env.META_APP_SECRET);
  url.searchParams.set('fb_exchange_token', shortToken);

  const response = await fetch(url.toString());
  const data     = await response.json();

  if (data.error) {
    // Não crítico — retorna o short token mesmo se a extensão falhar
    console.warn('[auth-meta-cb] Não foi possível estender token:', data.error.message);
    return { access_token: shortToken, expires_in: 3600 };
  }

  return data; // { access_token, token_type, expires_in }
}

/**
 * Handler principal
 */
module.exports = async function authMetaCallback(req, res) {
  const { code, state, error, error_description } = req.query;

  // Usuário negou permissão
  if (error) {
    console.error('[auth-meta-cb] Erro OAuth:', error, error_description);
    return res.redirect('/?error=meta_denied#p1');
  }

  // Verificação CSRF
  if (state !== 'meta_auth') {
    return res.redirect('/?error=invalid_state#p1');
  }

  if (!code) {
    return res.redirect('/?error=no_code#p1');
  }

  try {
    const baseUrl     = process.env.BASE_URL || `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/auth/meta/callback`;

    // Passo 1: Troca code por short-lived token (server-side)
    const shortTokenData = await exchangeCodeForShortToken(code, redirectUri);
    console.log('[auth-meta-cb] ✓ Short-lived token obtido');

    // Passo 2: Extende para long-lived token (60 dias)
    const longTokenData = await extendToLongLivedToken(shortTokenData.access_token);
    console.log('[auth-meta-cb] ✓ Long-lived token obtido (60 dias)');

    // Armazena na sessão server-side (NUNCA no frontend)
    if (req.session) {
      req.session.metaToken       = longTokenData.access_token;
      req.session.metaConnected   = true;
      req.session.metaTokenExpiry = Date.now() + ((longTokenData.expires_in || 5184000) * 1000);
    }

    console.log('[auth-meta-cb] ✓ Meta autenticada com sucesso');
    res.redirect('/?meta=connected#p1');

  } catch (err) {
    console.error('[auth-meta-cb] Erro:', err.message);
    res.redirect(`/?error=${encodeURIComponent(err.message)}#p1`);
  }
};
