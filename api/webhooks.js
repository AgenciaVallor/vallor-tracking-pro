/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — webhooks.js
 *  Rota: /api/webhooks/:platform
 *  Recebe webhooks de plataformas de infoprodutos e envia para CAPI
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Helper para hash (reutilizado do tracking)
function hashPII(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

module.exports = async function webhooksHandler(req, res) {
  const { platform } = req.params || { platform: req.url.split('/').pop() };
  const apiKey = req.query.key || req.headers['x-api-key'];
  
  if (!apiKey) return res.status(401).json({ error: 'API Key necessária na query (?key=...)' });

  try {
    // 1. Identificar usuário pela API Key na tabela Integrations
    const { data: integration, error: iError } = await supabase
      .from('integrations')
      .select('user_id')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (iError || !integration) {
      return res.status(401).json({ error: 'Integração não encontrada ou inativa' });
    }

    const userId = integration.user_id;

    // 2. Buscar configurações do usuário (Pixel, Token)
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!settings || !settings.meta_pixel_id) {
      return res.status(400).json({ error: 'Configurações de Pixel não encontradas para este usuário' });
    }

    // 3. Normalizar dados por plataforma
    let normalized = null;
    const body = req.body;

    switch (platform.toLowerCase()) {
      case 'hotmart':
        normalized = {
          event: body.event === 'PURCHASE_COMPLETE' ? 'Purchase' : 'Other',
          email: body.data?.buyer?.email,
          name: body.data?.buyer?.name,
          value: body.data?.purchase?.full_price?.value,
          currency: body.data?.purchase?.full_price?.currency_code || 'BRL',
          order_id: body.data?.purchase?.transaction
        };
        break;

      case 'kiwify':
        normalized = {
          event: body.order_status === 'paid' ? 'Purchase' : 'Other',
          email: body.customer?.email,
          name: body.customer?.full_name,
          value: body.order_ref_price / 100, // Kiwify envia em centavos
          currency: 'BRL',
          order_id: body.order_id
        };
        break;

      case 'greenn':
        normalized = {
          event: body.status === 'approved' ? 'Purchase' : 'Other',
          email: body.email,
          name: body.name,
          value: body.amount,
          currency: 'BRL',
          order_id: body.id
        };
        break;

      case 'eduzz':
        normalized = {
          event: body.edz_pags_status_desc === 'Pago' ? 'Purchase' : 'Other',
          email: body.cus_email,
          name: body.cus_name,
          value: body.edz_valor_total,
          currency: 'BRL',
          order_id: body.edz_fatura_cod
        };
        break;

      default:
        // Caso genérico ou outras plataformas simplificadas
        normalized = {
          event: body.event || 'Purchase',
          email: body.email,
          name: body.name,
          value: body.value || body.amount,
          currency: body.currency || 'BRL',
          order_id: body.order_id || body.id
        };
    }

    if (!normalized.email) {
      return res.json({ success: true, status: 'ignored', message: 'Sem email no payload' });
    }

    // 4. Enviar para Meta CAPI (Server-to-Server)
    const eventId = `webhook_${platform}_${normalized.order_id || Date.now()}`;
    const capiPayload = {
      data: [{
        event_name: normalized.event,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'system_generated',
        user_data: {
          em: hashPII(normalized.email),
          fn: hashPII(normalized.name?.split(' ')[0]),
          client_ip_address: req.headers['x-forwarded-for'] || '127.0.0.1',
          client_user_agent: 'Vallor Webhook/1.0'
        },
        custom_data: {
          value: normalized.value,
          currency: normalized.currency
        }
      }]
    };

    let status = 'error';
    let errorMessage = null;

    if (settings.meta_access_token) {
      const metaRes = await fetch(`https://graph.facebook.com/v18.0/${settings.meta_pixel_id}/events?access_token=${settings.meta_access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capiPayload)
      });
      const metaData = await metaRes.json();
      status = metaData.error ? 'error' : 'sent';
      errorMessage = metaData.error?.message || null;
    }

    // 5. Salvar Log
    await supabase.from('tracking_events').insert([{
      user_id: userId,
      event_name: normalized.event,
      event_id: eventId,
      status: status,
      platform: platform,
      raw_data: body,
      error_message: errorMessage
    }]);

    return res.json({ success: true, status, event_id: eventId });

  } catch (err) {
    console.error('[webhook error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
