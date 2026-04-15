/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — webhooks.js
 *  Rota: POST /api/webhooks/:platform
 *  Recebe webhooks de Hotmart, Kiwify, Greenn, Eduzz
 *  Roda atribuição e salva em conversions + envia CAPI
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { attributeConversion, hashPII } = require('./attribution');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function webhooksHandler(req, res) {
  // CORS para webhooks
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const urlParts = req.url.split('/').filter(Boolean);
  const platform = req.params?.platform || urlParts[urlParts.length - 1]?.split('?')[0];
  const apiKey = req.query?.key || req.headers['x-api-key'];

  if (!apiKey) return res.status(401).json({ error: 'API Key necessária (?key=... ou header x-api-key)' });

  try {
    // ── 1. Identificar integração pela API Key (multi-tenant) ─
    const { data: integration, error: iError } = await supabase
      .from('integrations')
      .select('client_id, agency_id')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (iError || !integration) {
      return res.status(401).json({ error: 'Integração não encontrada ou inativa' });
    }

    const { client_id, agency_id } = integration;

    // ── 2. Buscar dados do cliente (Pixel, Token CAPI) ────────
    const { data: client } = await supabase
      .from('clients')
      .select('id, agency_id, pixel_id, meta_access_token, name')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    // ── 3. Normalizar dados por plataforma ────────────────────
    const body = req.body;
    let normalized = null;

    switch (platform.toLowerCase()) {
      case 'hotmart':
        normalized = {
          event:      body.event === 'PURCHASE_COMPLETE' ? 'Purchase'
                    : body.event === 'PURCHASE_REFUNDED' ? 'Refund' : 'Other',
          email:      body.data?.buyer?.email,
          phone:      body.data?.buyer?.checkout_phone,
          name:       body.data?.buyer?.name,
          value:      body.data?.purchase?.full_price?.value,
          currency:   body.data?.purchase?.full_price?.currency_code || 'BRL',
          order_id:   body.data?.purchase?.transaction,
          product:    body.data?.product?.name,
          status:     body.event === 'PURCHASE_COMPLETE' ? 'approved'
                    : body.event === 'PURCHASE_REFUNDED' ? 'refunded' : 'pending'
        };
        break;

      case 'kiwify':
        normalized = {
          event:      body.order_status === 'paid' ? 'Purchase'
                    : body.order_status === 'refunded' ? 'Refund' : 'Other',
          email:      body.Customer?.email,
          phone:      body.Customer?.mobile,
          name:       body.Customer?.full_name,
          value:      (body.Commissions?.charge_amount || body.order_ref_price || 0) / 100,
          currency:   'BRL',
          order_id:   body.order_id,
          product:    body.Product?.product_name,
          status:     body.order_status === 'paid' ? 'approved'
                    : body.order_status === 'refunded' ? 'refunded' : 'pending'
        };
        break;

      case 'greenn':
        normalized = {
          event:      body.status === 'approved' ? 'Purchase'
                    : body.status === 'refunded' ? 'Refund' : 'Other',
          email:      body.email || body.customer?.email,
          phone:      body.phone || body.customer?.phone,
          name:       body.name  || body.customer?.name,
          value:      body.amount || body.total,
          currency:   'BRL',
          order_id:   body.id || body.order_id,
          product:    body.product_name,
          status:     body.status || 'pending'
        };
        break;

      case 'eduzz':
        normalized = {
          event:      body.edz_pags_status_desc === 'Pago' ? 'Purchase'
                    : body.edz_pags_status_desc === 'Reembolsado' ? 'Refund' : 'Other',
          email:      body.cus_email,
          phone:      body.cus_cel,
          name:       body.cus_name,
          value:      body.edz_valor_total,
          currency:   'BRL',
          order_id:   body.edz_fatura_cod?.toString(),
          product:    body.edz_cnt_titulo,
          status:     body.edz_pags_status_desc === 'Pago' ? 'approved'
                    : body.edz_pags_status_desc === 'Reembolsado' ? 'refunded' : 'pending'
        };
        break;

      default:
        normalized = {
          event:    body.event || 'Purchase',
          email:    body.email,
          phone:    body.phone,
          name:     body.name,
          value:    body.value || body.amount,
          currency: body.currency || 'BRL',
          order_id: body.order_id || body.id,
          product:  body.product_name || body.product,
          status:   body.status || 'approved'
        };
    }

    if (!normalized.email) {
      return res.json({ success: true, status: 'ignored', message: 'Sem email no payload' });
    }

    // ── 4. Motor de Atribuição em Cascata ─────────────────────
    const attribution = await attributeConversion(client_id, {
      email:       normalized.email,
      phone:       normalized.phone,
      fbc:         null, // webhooks não têm fbc
      fbp:         null,
      fingerprint: null,
      ip:          req.headers['x-forwarded-for'] || '127.0.0.1'
    });

    // ── 5. Enviar para Meta CAPI (Server-to-Server) ───────────
    const eventId = `wh_${platform}_${normalized.order_id || Date.now()}`;
    let metaSent = false;
    let metaError = null;

    if (client.meta_access_token && client.pixel_id && normalized.event === 'Purchase') {
      const capiPayload = {
        data: [{
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_id:   eventId,
          action_source: 'system_generated',
          user_data: {
            em:  hashPII(normalized.email),
            ph:  hashPII(normalized.phone),
            fn:  hashPII(normalized.name?.split(' ')[0]),
            fbc: attribution.fbc || null,
            fbp: attribution.fbp || null,
            client_ip_address: req.headers['x-forwarded-for'] || '127.0.0.1',
            client_user_agent: 'Vallor Webhook/2.0'
          },
          custom_data: {
            value:    normalized.value,
            currency: normalized.currency,
            order_id: normalized.order_id
          }
        }]
      };

      try {
        const metaRes = await fetch(
          `https://graph.facebook.com/v18.0/${client.pixel_id}/events?access_token=${client.meta_access_token}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(capiPayload)
          }
        );
        const metaData = await metaRes.json();
        metaSent = !metaData.error;
        metaError = metaData.error?.message || null;
      } catch (e) {
        metaError = e.message;
      }
    }

    // ── 6. Salvar em conversions (NÃO só tracking_events) ─────
    const conversionPayload = {
      agency_id:              agency_id,
      client_id:              client_id,
      visitor_id:             attribution.visitor_id,
      order_id:               normalized.order_id,
      total_value:            normalized.value,
      currency:               normalized.currency,
      product_name:           normalized.product,
      platform:               platform,
      status:                 normalized.status,
      attributed_by:          attribution.attributed_by,
      attribution_confidence: attribution.attribution_confidence,
      meta_sent:              metaSent,
      meta_event_id:          eventId,
      meta_error:             metaError,
      conversion_time:        new Date().toISOString()
    };

    const { data: savedConversion, error: convError } = await supabase
      .from('conversions')
      .insert([conversionPayload])
      .select()
      .single();

    if (convError) {
      console.error('[webhook] Erro ao salvar conversão:', convError.message);
    }

    // ── 7. Log em tracking_events (para timeline) ─────────────
    await supabase.from('tracking_events').insert([{
      agency_id:        agency_id,
      client_id:        client_id,
      visitor_id:       attribution.visitor_id,
      event_name:       normalized.event,
      event_id:         eventId,
      event_time:       Math.floor(Date.now() / 1000),
      status:           metaSent ? 'sent' : 'error',
      platform:         platform,
      raw_data:         body,
      error_message:    metaError
    }]);

    return res.json({
      success: true,
      event_id: eventId,
      conversion_id: savedConversion?.id,
      attribution: {
        method:     attribution.attributed_by,
        confidence: attribution.attribution_confidence,
        visitor_id: attribution.visitor_id
      },
      capi: {
        sent:  metaSent,
        error: metaError
      }
    });

  } catch (err) {
    console.error('[webhook error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
