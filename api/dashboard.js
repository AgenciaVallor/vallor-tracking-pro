/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — dashboard.js
 *  Rota: GET /api/dashboard
 *  Dashboard multi-tenant com métricas de atribuição
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function verifyAuth(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('Unauthorized');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

module.exports = async function dashboardHandler(req, res) {
  try {
    // Suporte dual-auth: JWT header OU query param (legado)
    let userId;
    try {
      const user = await verifyAuth(req);
      userId = user.id;
    } catch {
      userId = req.query.user_id;
    }

    if (!userId) return res.status(400).json({ error: 'Autenticação necessária' });

    const clientId = req.query.client_id; // Opcional: filtrar por cliente específico
    const period   = req.query.period || '24h'; // 24h | 7d | 30d

    // Calcula início do período
    const now = new Date();
    let periodStart;
    switch (period) {
      case '7d':  periodStart = new Date(now - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': periodStart = new Date(now - 30 * 24 * 60 * 60 * 1000); break;
      default:    periodStart = new Date(now - 24 * 60 * 60 * 1000);
    }
    const periodISO = periodStart.toISOString();

    // Hoje (meia-noite)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // ── 1. Buscar agência do usuário ──────────────────────────
    const { data: agency } = await supabase
      .from('agencies')
      .select('id, name, slug, plan')
      .eq('owner_id', userId)
      .single();

    // ── 2. Base query builder ─────────────────────────────────
    function buildQuery(table) {
      let q = supabase.from(table).select('*', { count: 'exact' });
      if (agency) q = q.eq('agency_id', agency.id);
      if (clientId) q = q.eq('client_id', clientId);
      return q;
    }

    // ── 3. Eventos do período ─────────────────────────────────
    const { count: totalEvents } = await buildQuery('tracking_events')
      .gt('created_at', periodISO)
      .select('id', { count: 'exact', head: true });

    const { count: eventsToday } = await buildQuery('tracking_events')
      .gt('created_at', todayStart.toISOString())
      .select('id', { count: 'exact', head: true });

    // ── 4. EMQ Médio ──────────────────────────────────────────
    let emqQuery = buildQuery('tracking_events')
      .not('match_quality', 'is', null)
      .gt('created_at', periodISO)
      .select('match_quality');

    const { data: emqData } = await emqQuery;
    const avgEMQ = emqData && emqData.length > 0
      ? emqData.reduce((acc, c) => acc + Number(c.match_quality), 0) / emqData.length
      : 0;

    // ── 5. Conversões e Receita ───────────────────────────────
    const { data: conversions, count: totalConversions } = await buildQuery('conversions')
      .gt('conversion_time', periodISO)
      .order('conversion_time', { ascending: false })
      .limit(100);

    const totalRevenue = (conversions || [])
      .filter(c => c.status === 'approved')
      .reduce((sum, c) => sum + (Number(c.total_value) || 0), 0);

    const attributedConversions = (conversions || [])
      .filter(c => c.attributed_by && c.attributed_by !== 'none');

    const attributionRate = totalConversions > 0
      ? Math.round((attributedConversions.length / totalConversions) * 100)
      : 0;

    // Breakdown por método de atribuição
    const attributionBreakdown = {};
    attributedConversions.forEach(c => {
      attributionBreakdown[c.attributed_by] = (attributionBreakdown[c.attributed_by] || 0) + 1;
    });

    // ── 6. Visitantes únicos ──────────────────────────────────
    const { count: uniqueVisitors } = await buildQuery('visitors')
      .gt('last_seen_at', periodISO)
      .select('id', { count: 'exact', head: true });

    // ── 7. Últimos 20 eventos (timeline) ──────────────────────
    const { data: lastEvents } = await buildQuery('tracking_events')
      .order('created_at', { ascending: false })
      .limit(20);

    // ── 8. Alertas não lidos ──────────────────────────────────
    let alerts = [];
    try {
      const { data: alertData } = await supabase
        .from('alerts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending: false });
      alerts = alertData || [];
    } catch { /* tabela pode não existir */ }

    // ── 9. Clientes do usuário ────────────────────────────────
    let clients = [];
    if (agency) {
      const { data: clientData } = await supabase
        .from('clients')
        .select('id, name, domain, pixel_id, capi_configured, status, script_key')
        .eq('agency_id', agency.id)
        .eq('status', 'active')
        .order('name');
      clients = clientData || [];
    } else {
      // Fallback legado: busca por owner_id
      const { data: clientData } = await supabase
        .from('clients')
        .select('id, name, domain, pixel_id, capi_configured, status, script_key')
        .eq('owner_id', userId)
        .order('name');
      clients = clientData || [];
    }

    // ── 10. Dados para gráficos (por hora) ─────────────────────
    const { data: chartData } = await buildQuery('tracking_events')
      .gt('created_at', periodISO)
      .select('created_at, event_name')
      .order('created_at', { ascending: true });

    return res.json({
      success: true,
      agency: agency || null,
      stats: {
        totalEvents:     totalEvents || 0,
        eventsToday:     eventsToday || 0,
        avgEMQ:          Math.round(avgEMQ * 10) / 10,
        totalConversions: totalConversions || 0,
        totalRevenue:    totalRevenue,
        attributionRate: attributionRate,
        uniqueVisitors:  uniqueVisitors || 0,
        period:          period
      },
      attribution: {
        breakdown: attributionBreakdown,
        rate:      attributionRate
      },
      lastEvents:   lastEvents || [],
      conversions:  (conversions || []).slice(0, 10), // top 10
      clients:      clients,
      alerts:       alerts,
      chartData:    chartData || []
    });

  } catch (err) {
    console.error('[dashboard error]', err);
    return res.status(err.message === 'Unauthorized' ? 401 : 500)
      .json({ error: err.message || 'Internal server error' });
  }
};
