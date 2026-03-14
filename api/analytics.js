/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — analytics.js
 *  Rota: GET /api/analytics
 *  Busca estatísticas de eventos do pixel (Graph API)
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const META_BASE = 'https://graph.facebook.com/v19.0';

module.exports = async function analyticsHandler(req, res) {
  const token = req.session?.metaToken;

  if (!token) {
    return res.status(401).json({ error: 'Meta não autenticada. Faça login primeiro.' });
  }

  const { pixelId, startTime, endTime } = req.query;

  if (!pixelId) {
    return res.status(400).json({ error: 'pixelId é obrigatório' });
  }

  try {
    // Meta Graph API: /{pixel_id}/stats
    // aggregation=day retorna quebra diária
    let url = `${META_BASE}/${pixelId}/stats?aggregation=day&access_token=${token}`;
    
    if (startTime) url += `&start_time=${startTime}`;
    if (endTime) url += `&end_time=${endTime}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || `Meta API error ${response.status}`);
    }

    // Retorna os dados formatados para o gráfico
    return res.json({ 
      success: true, 
      data: data.data || [],
      updatedAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    });

  } catch (err) {
    console.error('[analytics]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
