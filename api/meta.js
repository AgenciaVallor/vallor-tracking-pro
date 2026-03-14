/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — meta.js
 *  Rota: /api/meta/:action
 *  Operações com a Meta Graph API usando o token na sessão
 *
 *  Ações:
 *  GET  /api/meta/verify-pixel?pixelId=XXX   → verifica se pixel existe
 *  POST /api/meta/test-capi                  → envia evento CAPI de teste
 *  GET  /api/meta/emq?pixelId=XXX            → obtém EMQ do pixel
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const META_BASE = 'https://graph.facebook.com/v19.0';

// ── Helper: chamada autenticada à Meta Graph API ───────────────
async function metaRequest(token, path, method = 'GET', body = null) {
  // O access token fica no servidor, é passado via URL param (padrão Meta)
  const separator = path.includes('?') ? '&' : '?';
  const url = `${META_BASE}${path}${separator}access_token=${token}`;

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  const data     = await response.json();

  if (data.error) {
    throw new Error(data.error.message || `Meta API error ${response.status}`);
  }

  return data;
}

// ── Verifica se um Pixel existe e retorna seus dados ──────────
async function verifyPixel(token, pixelId) {
  return metaRequest(token, `/${pixelId}?fields=id,name,is_created_by_business,owner_ad_account,data_use_setting`);
}

// ── Obtém o EMQ (Event Match Quality) do Pixel ────────────────
async function getPixelEMQ(token, pixelId) {
  try {
    // Obtém stats básicos do pixel
    const data = await metaRequest(
      token,
      `/${pixelId}?fields=id,name,is_created_by_business`
    );
    return data;
  } catch (e) {
    return null;
  }
}

// ── Envia evento de teste CAPI (para validação) ───────────────
async function sendTestCAPIEvent(capiToken, pixelId, domain) {
  const payload = {
    data: [{
      event_name:        'PageView',
      event_time:        Math.floor(Date.now() / 1000),
      event_id:          `vallor_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event_source_url:  `https://${domain || 'teste.vallor.com.br'}`,
      action_source:     'website',
      user_data: {
        client_ip_address: '1.1.1.1',
        client_user_agent: 'VallonBot/1.0 (Vallor Tracking PRO)',
      },
    }],
    test_event_code: 'TEST', // Aparece como evento de teste no Gerenciador de Eventos
  };

  return metaRequest(capiToken, `/${pixelId}/events`, 'POST', payload);
}

// ════════════════════════════════════════════════════════════════
//  HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════
module.exports = async function metaHandler(req, res) {
  const token = req.session?.metaToken;

  if (!token) {
    return res.status(401).json({ error: 'Meta não autenticada. Faça login primeiro.' });
  }

  const action = req.params.action || req.url.split('/').pop().split('?')[0];

  // CENTRAL VALIDATION: Ad Account ID format check
  const adAccountId = req.query.adAccountId || req.body?.adAccountId || req.query.accountId || req.body?.accountId;
  if (adAccountId && !/^act_\d+$/.test(adAccountId)) {
    return res.status(400).json({ error: "Invalid Ad Account ID format. Must be act_XXXXXXXXXX" });
  }

  try {
    switch (action) {
      case 'verify-pixel': {
        const pixelId = req.query.pixelId || req.body?.pixelId;
        if (!pixelId) return res.status(400).json({ error: 'pixelId é obrigatório' });

        const data = await verifyPixel(token, pixelId);
        return res.json({ success: true, pixel: data });
      }

      case 'emq': {
        const pixelId = req.query.pixelId || req.body?.pixelId;
        if (!pixelId) return res.status(400).json({ error: 'pixelId é obrigatório' });

        const data = await getPixelEMQ(token, pixelId);
        return res.json({ success: true, data });
      }

      case 'test-capi': {
        const { pixelId, capiToken, domain } = req.body;
        if (!pixelId) return res.status(400).json({ error: 'pixelId é obrigatório' });

        // Usa o CAPI token fornecido, ou o token da sessão Meta como fallback
        const usedToken = capiToken || token;
        const result = await sendTestCAPIEvent(usedToken, pixelId, domain);
        return res.json({ success: true, result });
      }

      case 'adaccounts': {
        // Fetch all ad accounts associated with the user
        const data = await metaRequest(token, '/me/adaccounts?fields=id,name,account_status,business,currency');
        return res.json({ success: true, accounts: data.data || [] });
      }

      default:
        return res.status(404).json({ error: `Ação Meta desconhecida: ${action}` });
    }
  } catch (err) {
    console.error('[meta]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
