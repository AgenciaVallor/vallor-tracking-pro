/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — tracking.js
 *  Rota: POST /api/track
 *  Recebe eventos e envia para Meta CAPI com Enriquecimento
 * ═══════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Inicializa o cliente Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Hash SHA-256 para PII (Personally Identifiable Information)
 */
function hashPII(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

/**
 * Handler principal /api/track
 */
module.exports = async function trackingHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const { 
      event_name, 
      event_id, 
      user_data = {}, 
      custom_data = {}, 
      event_source_url, 
      event_time,
      pixel_id // ID do pixel enviado pelo frontend/GTM
    } = req.body;

    if (!pixel_id) return res.status(400).json({ error: 'pixel_id é obrigatório' });

    // 1. Buscar configurações do usuário dono deste Pixel
    const { data: settings, error: sError } = await supabase
      .from('user_settings')
      .select('*')
      .eq('meta_pixel_id', pixel_id)
      .single();

    if (sError || !settings) {
      console.warn(`[tracking] Configurações não encontradas para pixel: ${pixel_id}`);
      // Salva no banco mesmo assim para logar o erro
    }

    // 2. Deduplicação: Verificar se event_id já existe nas últimas 24h
    const { data: existing } = await supabase
      .from('tracking_events')
      .select('id')
      .eq('event_id', event_id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return res.json({ success: true, status: 'duplicated', message: 'Deduplicado por event_id' });
    }

    // 3. Enriquecimento de Dados
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    const fbp = req.cookies?.['_fbp'];
    const fbc = req.cookies?.['_fbc'];

    const enrichedUserData = {
      ...user_data,
      client_ip_address: ip,
      client_user_agent: ua,
      fbp: user_data.fbp || fbp,
      fbc: user_data.fbc || fbc,
      // Hashing de dados sensíveis
      em: hashPII(user_data.em || user_data.email),
      ph: hashPII(user_data.ph || user_data.phone),
      fn: hashPII(user_data.fn || user_data.first_name),
      ln: hashPII(user_data.ln || user_data.last_name),
      ct: hashPII(user_data.ct || user_data.city),
      st: hashPII(user_data.st || user_data.state),
      zp: hashPII(user_data.zp || user_data.zip),
      country: hashPII(user_data.country),
    };

    // Remover campos originais após hash
    delete enrichedUserData.email;
    delete enrichedUserData.phone;
    delete enrichedUserData.first_name;
    delete enrichedUserData.last_name;
    delete enrichedUserData.city;
    delete enrichedUserData.state;
    delete enrichedUserData.zip;

    // 4. Preparar payload CAPI
    const capiPayload = {
      data: [{
        event_name,
        event_time: event_time || Math.floor(Date.now() / 1000),
        event_id,
        event_source_url,
        action_source: 'website',
        user_data: enrichedUserData,
        custom_data
      }]
    };

    let emq = null;
    let status = 'error';
    let errorMessage = null;

    // 5. Enviar para Meta CAPI se tivermos token
    if (settings?.meta_access_token) {
      try {
        const metaRes = await fetch(`https://graph.facebook.com/v18.0/${pixel_id}/events?access_token=${settings.meta_access_token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(capiPayload)
        });
        const metaData = await metaRes.json();
        
        if (metaData.error) {
          errorMessage = metaData.error.message;
        } else {
          status = 'sent';
          // EMQ pode não vir na resposta imediata de inserção, mas em alguns casos vem info de recebimento
          // Aqui salvamos o que for possível
        }
      } catch (e) {
        errorMessage = e.message;
      }
    } else {
      errorMessage = 'Token de acesso Meta ausente';
    }

    // 6. Salvar no Supabase
    await supabase.from('tracking_events').insert([{
      user_id: settings?.user_id || null,
      event_name,
      event_time: event_time || Math.floor(Date.now() / 1000),
      event_id,
      event_source_url,
      status,
      raw_data: capiPayload,
      error_message: errorMessage,
      platform: 'browser/gtm'
    }]);

    return res.json({ success: true, status, emq, error: errorMessage });

  } catch (err) {
    console.error('[tracking error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
