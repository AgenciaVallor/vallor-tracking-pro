/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — alerts.js
 *  Rota: GET /api/alerts/check
 *  Verifica anomalias no rastreamento e gera alertas
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function alertsHandler(req, res) {
  try {
    // 1. Obter todos os usuários com configurações ativas
    const { data: allUsers } = await supabase.from('user_settings').select('*');
    if (!allUsers) return res.json({ success: true, message: 'Nenhum usuário para processar' });

    const alertsCreated = [];

    for (const user of allUsers) {
      // ── ALERTA: Silêncio (Nenhum evento nas últimas 2h, horário comercial) ──
      const now = new Date();
      const currentHour = (now.getUTCHours() - 3 + 24) % 24; // Brasília
      
      if (currentHour >= 8 && currentHour <= 23) {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from('tracking_events')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.user_id)
          .gt('created_at', twoHoursAgo);

        if (count === 0) {
          alertsCreated.push(await createAlert(user.user_id, 'SILENCE', 'Nenhum evento recebido nas últimas 2 horas. Verifique sua instalação do GTM.'));
        }
      }

      // ── ALERTA: EMQ Baixo (Média das últimas 24h) ──
      const { data: events } = await supabase
        .from('tracking_events')
        .select('match_quality')
        .eq('user_id', user.user_id)
        .not('match_quality', 'is', null)
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (events && events.length > 0) {
        const avgEMQ = events.reduce((acc, current) => acc + Number(current.match_quality), 0) / events.length;
        if (avgEMQ < 6) {
          alertsCreated.push(await createAlert(user.user_id, 'LOW_EMQ', `A qualidade de correspondência (EMQ) caiu para ${avgEMQ.toFixed(1)}. Melhore o envio de dados de usuário.`));
        }
      }

      // ── ALERTA: Token Inválido ──
      // Verificado durante o envio no /api/track, aqui podemos checar o status do último evento
      const { data: lastEvent } = await supabase
        .from('tracking_events')
        .select('error_message')
        .eq('user_id', user.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (lastEvent?.error_message?.toLowerCase().includes('token')) {
        alertsCreated.push(await createAlert(user.user_id, 'TOKEN_EXPIRED', 'O Token de Acesso da Meta expirou ou é inválido. Reautentique sua conta.'));
      }
    }

    return res.json({ success: true, alerts_count: alertsCreated.length });

  } catch (err) {
    console.error('[alerts error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function createAlert(userId, type, message) {
  // Evitar duplicar o mesmo alerta (não lido/recente)
  const { data: existing } = await supabase
    .from('alerts')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('is_read', false)
    .gt('created_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
    .maybeSingle();

  if (existing) return null;

  const { data } = await supabase.from('alerts').insert([{
    user_id: userId,
    type,
    message
  }]).select().single();

  return data;
}
