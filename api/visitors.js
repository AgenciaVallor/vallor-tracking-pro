/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — visitors.js
 *  Rota: GET/POST /api/visitors
 *  Gestão de identidade de visitantes (multi-tenant)
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const { upsertVisitor, hashPII } = require('./attribution');

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

module.exports = async function visitorsHandler(req, res) {
  const { method } = req;

  // Extrai client_id e visitor_id da URL
  const parts = req.url.split('?')[0].split('/').filter(Boolean);
  const clientId = req.query?.client_id || req.body?.client_id;
  const visitorId = parts[parts.length - 1] !== 'visitors' ? parts[parts.length - 1] : null;

  try {
    const user = await verifyAuth(req);

    // ── LISTAR visitantes de um cliente ───────────────────────
    if (method === 'GET' && !visitorId) {
      if (!clientId) return res.status(400).json({ error: 'client_id é obrigatório' });

      const page  = parseInt(req.query.page  || '1');
      const limit = parseInt(req.query.limit || '50');
      const from  = (page - 1) * limit;
      const to    = from + limit - 1;

      const { data, error, count } = await supabase
        .from('visitors')
        .select('*', { count: 'exact' })
        .eq('client_id', clientId)
        .order('last_seen_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return res.json({ visitors: data, total: count, page, limit });
    }

    // ── BUSCAR visitante por ID ───────────────────────────────
    if (method === 'GET' && visitorId) {
      const { data, error } = await supabase
        .from('visitors')
        .select('*, tracking_events(event_name, created_at, status), conversions(order_id, total_value, attributed_by)')
        .eq('id', visitorId)
        .single();

      if (error) throw error;
      return res.json({ visitor: data });
    }

    // ── UPSERT (criar ou atualizar) visitante ─────────────────
    if (method === 'POST') {
      const {
        client_id, agency_id,
        fbc, fbp, email, phone, fingerprint, ip,
        user_agent, utm_source, utm_medium, utm_campaign, country
      } = req.body;

      if (!client_id || !agency_id) {
        return res.status(400).json({ error: 'client_id e agency_id são obrigatórios' });
      }

      const result = await upsertVisitor(client_id, agency_id, {
        fbc, fbp, email, phone, fingerprint,
        ip: ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
        userAgent:   user_agent || req.headers['user-agent'],
        utmSource:   utm_source,
        utmMedium:   utm_medium,
        utmCampaign: utm_campaign,
        country
      });

      return res.status(result.isNew ? 201 : 200).json({
        visitor: result.visitor,
        is_new:  result.isNew,
        method:  result.method
      });
    }

    return res.status(405).json({ error: 'Método não permitido' });

  } catch (err) {
    console.error('[visitors]', err.message);
    return res.status(err.message === 'Unauthorized' ? 401 : 500).json({ error: err.message });
  }
};
