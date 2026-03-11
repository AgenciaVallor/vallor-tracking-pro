/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — dashboard.js
 *  Rota: GET /api/dashboard
 *  Agrega estatísticas para o dashboard inicial
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function dashboardHandler(req, res) {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório' });

    // 1. Dados Básicos (Últimas 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Total hoje
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    
    const { count: totalToday } = await supabase
      .from('tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .gt('created_at', todayStart.toISOString());

    // EMQ Médio
    const { data: emqData } = await supabase
      .from('tracking_events')
      .select('match_quality')
      .eq('user_id', user_id)
      .not('match_quality', 'is', null)
      .gt('created_at', yesterday);

    const avgEMQ = emqData && emqData.length > 0 
      ? emqData.reduce((acc, c) => acc + Number(c.match_quality), 0) / emqData.length 
      : 0;

    // Últimos 20 eventos
    const { data: lastEvents } = await supabase
      .from('tracking_events')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(20);

    // Alertas ativos
    const { data: alerts } = await supabase
      .from('alerts')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_read', false)
      .order('created_at', { ascending: false });

    // Integrações
    const { data: integrations } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user_id);

    // Eventos por hora (gráficos)
    const { data: chartData } = await supabase
      .from('tracking_events')
      .select('created_at, event_name')
      .eq('user_id', user_id)
      .gt('created_at', yesterday)
      .order('created_at', { ascending: true });

    return res.json({
      success: true,
      stats: {
        totalToday,
        avgEMQ,
        dedupRate: 0, // Pode ser calculado comparando event_id repetidos etc
        coverage: 100
      },
      lastEvents: lastEvents || [],
      alerts: alerts || [],
      integrations: integrations || [],
      chartData: chartData || []
    });

  } catch (err) {
    console.error('[dashboard error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
