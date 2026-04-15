/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — tracking.js
 *  Rota: POST /api/track
 *  Ingestão de eventos do vallor-tracker.js (DAS Section 4)
 *
 *  Fluxo:
 *  1. Recebe evento do script frontend com script_key
 *  2. Identifica client via script_key (multi-tenant)
 *  3. Upsert visitante (identity resolution)
 *  4. Hash de PII (Advanced Matching)
 *  5. Envia para Meta CAPI (Server-Side)
 *  6. Salva evento no banco
 * ═══════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { upsertVisitor, hashPII } = require('./attribution');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async function trackingHandler(req, res) {
  // Aceita CORS para qualquer origem (script instalado em domínios de clientes)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const {
      script_key,
      event_name,
      event_id,
      event_source_url,
      event_time,
      fbc,
      fbp,
      fingerprint,
      utm = {},
      user_data = {},
      custom_data = {},
      // Retrocompatibilidade com versão anterior
      pixel_id
    } = req.body;

    // ── 1. Identificar cliente via script_key (multi-tenant) ──
    let client = null;

    if (script_key) {
      const { data, error } = await supabase
        .from('clients')
        .select('id, agency_id, pixel_id, meta_access_token, name, domain')
        .eq('script_key', script_key)
        .eq('status', 'active')
        .single();

      if (error || !data) {
        console.warn(`[tracking] script_key inválida: ${script_key}`);
        return res.status(400).json({ error: 'script_key inválida ou cliente inativo' });
      }
      client = data;
    } else if (pixel_id) {
      // Fallback: busca por pixel_id (compatibilidade legada)
      const { data } = await supabase
        .from('clients')
        .select('id, agency_id, pixel_id, meta_access_token, name, domain')
        .eq('pixel_id', pixel_id)
        .eq('status', 'active')
        .single();

      if (!data) {
        return res.status(400).json({ error: 'pixel_id não encontrado' });
      }
      client = data;
    } else {
      return res.status(400).json({ error: 'script_key ou pixel_id é obrigatório' });
    }

    // ── 2. Deduplicação por event_id ──────────────────────────
    if (event_id) {
      const { data: existing } = await supabase
        .from('tracking_events')
        .select('id')
        .eq('event_id', event_id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        return res.json({ success: true, status: 'duplicated', message: 'Deduplicado por event_id' });
      }
    }

    // ── 3. Captura de dados do request ────────────────────────
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;

    // ── 4. Upsert Visitante (Identity Resolution) ─────────────
    let visitorResult = { visitor: null, isNew: false, method: 'none' };
    try {
      visitorResult = await upsertVisitor(client.id, client.agency_id, {
        fbc:         fbc || user_data.fbc,
        fbp:         fbp || user_data.fbp,
        email:       user_data.em || user_data.email,
        phone:       user_data.ph || user_data.phone,
        fingerprint: fingerprint,
        ip:          ip,
        userAgent:   ua,
        utmSource:   utm.utm_source   || utm.source,
        utmMedium:   utm.utm_medium   || utm.medium,
        utmCampaign: utm.utm_campaign || utm.campaign,
        country:     user_data.country
      });
    } catch (visitorErr) {
      console.warn('[tracking] Visitor upsert falhou:', visitorErr.message);
    }

    // ── 5. Preparar e enviar para Meta CAPI ───────────────────
    const enrichedUserData = {
      client_ip_address: ip,
      client_user_agent: ua,
      fbp: fbp || user_data.fbp || null,
      fbc: fbc || user_data.fbc || null,
      em:  hashPII(user_data.em || user_data.email),
      ph:  hashPII(user_data.ph || user_data.phone),
      fn:  hashPII(user_data.fn || user_data.first_name),
      ln:  hashPII(user_data.ln || user_data.last_name),
      ct:  hashPII(user_data.ct || user_data.city),
      st:  hashPII(user_data.st || user_data.state),
      zp:  hashPII(user_data.zp || user_data.zip),
      country: hashPII(user_data.country),
    };

    const capiPayload = {
      data: [{
        event_name: event_name,
        event_time: event_time || Math.floor(Date.now() / 1000),
        event_id:   event_id,
        event_source_url: event_source_url,
        action_source: 'website',
        user_data:   enrichedUserData,
        custom_data: custom_data
      }]
    };

    let status = 'pending';
    let errorMessage = null;
    let matchQuality = null;

    if (client.meta_access_token && client.pixel_id) {
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

        if (metaData.error) {
          status = 'error';
          errorMessage = metaData.error.message;
        } else {
          status = 'sent';
          // Tenta extrair EMQ se disponível
          if (metaData.events_received) {
            matchQuality = metaData.events_received;
          }
        }
      } catch (e) {
        status = 'error';
        errorMessage = e.message;
      }
    } else {
      status = 'stored';
      errorMessage = 'CAPI não configurada para este cliente';
    }

    // ── 6. Salvar evento no Supabase ──────────────────────────
    const eventPayload = {
      agency_id:        client.agency_id,
      client_id:        client.id,
      visitor_id:       visitorResult.visitor?.id || null,
      event_name:       event_name,
      event_id:         event_id,
      event_time:       event_time || Math.floor(Date.now() / 1000),
      event_source_url: event_source_url,
      action_source:    'website',
      utm_source:       utm.utm_source   || utm.source   || null,
      utm_medium:       utm.utm_medium   || utm.medium   || null,
      utm_campaign:     utm.utm_campaign || utm.campaign  || null,
      utm_content:      utm.utm_content  || utm.content   || null,
      utm_term:         utm.utm_term     || utm.term      || null,
      status:           status,
      match_quality:    matchQuality,
      error_message:    errorMessage,
      raw_data:         capiPayload,
      properties:       custom_data,
      platform:         'browser'
    };

    await supabase.from('tracking_events').insert([eventPayload]);

    return res.json({
      success: true,
      status,
      visitor_id: visitorResult.visitor?.id || null,
      visitor_new: visitorResult.isNew,
      emq: matchQuality,
      error: errorMessage
    });

  } catch (err) {
    console.error('[tracking error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
