/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — audiences.js
 *  Rota: POST /api/audiences/sync
 *  Cria e sincroniza públicos customizados na Meta Marketing API
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function audiencesHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório' });

    // 1. Buscar configurações da Meta
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (!settings?.meta_account_id || !settings?.meta_access_token) {
      return res.status(400).json({ error: 'Conta de anúncios ou Token Meta não configurados' });
    }

    const { meta_account_id, meta_access_token, meta_pixel_id } = settings;
    const accountUrl = `https://graph.facebook.com/v18.0/${meta_account_id}/customaudiences?access_token=${meta_access_token}`;

    // 2. Definir públicos padrão
    const standardAudiences = [
      {
        name: "Vallor - Visitantes 7 dias",
        rule: { inclusions: { operator: "or", rules: [{ event_name: "PageView", retention_seconds: 604800 }] } }
      },
      {
        name: "Vallor - Visitantes 30 dias",
        rule: { inclusions: { operator: "or", rules: [{ event_name: "PageView", retention_seconds: 2592000 }] } }
      },
      {
        name: "Vallor - Iniciaram Checkout (30d)",
        rule: { inclusions: { operator: "or", rules: [{ event_name: "InitiateCheckout", retention_seconds: 2592000 }] } }
      },
      {
        name: "Vallor - Compradores (180d)",
        rule: { inclusions: { operator: "or", rules: [{ event_name: "Purchase", retention_seconds: 15552000 }] } }
      }
    ];

    const results = [];

    // 3. Criar cada público (evita duplicatas pelo nome ou lógica de verificação se necessário)
    for (const aud of standardAudiences) {
      const payload = {
        name: aud.name,
        subtype: "CUSTOM",
        pixel_id: meta_pixel_id,
        rule: JSON.stringify(aud.rule),
        prefill: true,
        description: "Criado automaticamente pelo Vallor Tracking PRO"
      };

      const metaRes = await fetch(accountUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const metaData = await metaRes.json();
      results.push({ name: aud.name, result: metaData });
    }

    return res.json({ success: true, results });

  } catch (err) {
    console.error('[audiences error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
