/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — conversions.js
 *  Rota: GET/POST /api/conversions
 *  CRUD de conversões com atribuição automática + envio CAPI
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { attributeConversion, hashPII } = require('./attribution');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function verifyAuth(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('Unauthorized');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

/**
 * Envia evento de Purchase para Meta CAPI
 */
async function sendToCAPI(client, conversion, attribution) {
  if (!client.meta_access_token || !client.pixel_id) {
    return { sent: false, error: 'Token ou Pixel não configurado' };
  }

  const eventId = `conv_${conversion.order_id || Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  const capiPayload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(new Date(conversion.conversion_time || Date.now()).getTime() / 1000),
      event_id:   eventId,
      action_source: conversion.platform === 'browser' ? 'website' : 'system_generated',
      user_data: {
        em:  hashPII(conversion.email),
        ph:  hashPII(conversion.phone),
        fn:  hashPII(conversion.first_name),
        fbc: attribution.fbc || null,
        fbp: attribution.fbp || null,
        client_ip_address: conversion.ip || '127.0.0.1',
        client_user_agent: conversion.user_agent || 'Vallor Server/1.0'
      },
      custom_data: {
        value:    conversion.total_value,
        currency: conversion.currency || 'BRL',
        order_id: conversion.order_id
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

    if (metaData.error) {
      return { sent: false, error: metaData.error.message, event_id: eventId };
    }
    return { sent: true, error: null, event_id: eventId };
  } catch (e) {
    return { sent: false, error: e.message, event_id: eventId };
  }
}

module.exports = async function conversionsHandler(req, res) {
  const { method } = req;

  // Extrai IDs da URL
  const parts = req.url.split('?')[0].split('/').filter(Boolean);
  const conversionId = parts.length > 1 && parts[parts.length - 1] !== 'conversions'
    ? parts[parts.length - 1] : null;

  try {
    const user = await verifyAuth(req);

    // ── LISTAR conversões por client_id ────────────────────────
    if (method === 'GET' && !conversionId) {
      const clientId = req.query?.client_id;
      if (!clientId) return res.status(400).json({ error: 'client_id é obrigatório' });

      const page  = parseInt(req.query.page  || '1');
      const limit = parseInt(req.query.limit || '50');
      const from  = (page - 1) * limit;
      const to    = from + limit - 1;

      let query = supabase
        .from('conversions')
        .select('*, visitors(fbp, fbc, email, fingerprint)', { count: 'exact' })
        .eq('client_id', clientId)
        .order('conversion_time', { ascending: false })
        .range(from, to);

      // Filtro por status
      if (req.query.status) {
        query = query.eq('status', req.query.status);
      }
      // Filtro por período
      if (req.query.start_date) {
        query = query.gte('conversion_time', req.query.start_date);
      }
      if (req.query.end_date) {
        query = query.lte('conversion_time', req.query.end_date);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      // Aggregates
      const totalValue = (data || []).reduce((sum, c) => sum + (Number(c.total_value) || 0), 0);
      const attributed = (data || []).filter(c => c.attributed_by && c.attributed_by !== 'none').length;

      return res.json({
        conversions: data,
        total: count,
        page, limit,
        aggregates: {
          total_value: totalValue,
          attributed_count: attributed,
          attribution_rate: count > 0 ? Math.round((attributed / count) * 100) : 0
        }
      });
    }

    // ── BUSCAR conversão por ID ───────────────────────────────
    if (method === 'GET' && conversionId) {
      const { data, error } = await supabase
        .from('conversions')
        .select('*, visitors(fbp, fbc, email, fingerprint, first_utm_source, first_utm_campaign)')
        .eq('id', conversionId)
        .single();

      if (error) throw error;
      return res.json({ conversion: data });
    }

    // ── REGISTRAR nova conversão (manual/via dashboard) ───────
    if (method === 'POST') {
      const body = req.body;
      const { client_id, agency_id } = body;

      if (!client_id) return res.status(400).json({ error: 'client_id é obrigatório' });

      // 1. Buscar dados do cliente para CAPI
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', client_id)
        .single();

      if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

      // 2. Rodar motor de atribuição
      const attribution = await attributeConversion(client_id, {
        fbc:         body.fbc,
        fbp:         body.fbp,
        email:       body.email,
        fingerprint: body.fingerprint,
        ip:          body.ip || req.headers['x-forwarded-for']
      });

      // 3. Enviar para Meta CAPI
      const capiResult = await sendToCAPI(client, body, attribution);

      // 4. Salvar conversão
      const conversionPayload = {
        agency_id:                client.agency_id || agency_id,
        client_id:                client_id,
        visitor_id:               attribution.visitor_id,
        order_id:                 body.order_id,
        total_value:              body.total_value || body.value,
        currency:                 body.currency || 'BRL',
        product_name:             body.product_name,
        platform:                 body.platform || 'manual',
        status:                   body.status || 'approved',
        attributed_by:            attribution.attributed_by,
        attribution_confidence:   attribution.attribution_confidence,
        meta_sent:                capiResult.sent,
        meta_event_id:            capiResult.event_id,
        meta_error:               capiResult.error,
        conversion_time:          body.conversion_time || new Date().toISOString()
      };

      const { data: created, error } = await supabase
        .from('conversions')
        .insert([conversionPayload])
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({
        success: true,
        conversion: created,
        attribution: {
          method:     attribution.attributed_by,
          confidence: attribution.attribution_confidence,
          visitor_id: attribution.visitor_id
        },
        capi: {
          sent:     capiResult.sent,
          event_id: capiResult.event_id,
          error:    capiResult.error
        }
      });
    }

    return res.status(405).json({ error: 'Método não permitido' });

  } catch (err) {
    console.error('[conversions]', err.message);
    return res.status(err.message === 'Unauthorized' ? 401 : 500).json({ error: err.message });
  }
};
