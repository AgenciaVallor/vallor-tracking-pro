require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Helper para verificar token via Headers
async function verifyAuth(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('Unauthorized');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

module.exports = async function clientsHandler(req, res) {
  const { method } = req;
  // O id pode vir de req.params.id (no Express) ou de req.url em serverless
  let id = req.params?.id;
  if (!id) {
    const parts = req.url.split('?')[0].split('/');
    if (parts.length > 2 && parts[2] !== 'summary') {
      id = parts[2];
      if(parts[3] === 'summary') {
        req.isSummary = true;
      }
    } else if (parts.length > 3 && parts[3] === 'summary') {
      id = parts[2];
      req.isSummary = true;
    }
  }

  try {
    const user = await verifyAuth(req);
    const userId = user.id;

    // ── LISTAR todos ─────────────────────────────────────────
    if (method === 'GET' && !id && !req.isSummary) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.json({ clients: data });
    }

    // ── RESUMO (summary) ─────────────────────────────────────
    if (method === 'GET' && id && req.isSummary) {
      // busca o cliente primeiro para garantir que pertence ao user
      const { data: client, error: cErr } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('owner_id', userId)
        .single();
      if (cErr) throw cErr;

      // buscar metrics filtradas por data
      const { startTime, endTime } = req.query;
      
      let trackQuery = supabase.from('tracking_metrics').select('*').eq('client_id', id);
      let adsQuery   = supabase.from('ads_metrics').select('*').eq('client_id', id);
      let configQuery = supabase.from('configurations').select('*').eq('client_id', id);

      if (startTime) {
        trackQuery = trackQuery.gte('date', startTime);
        adsQuery   = adsQuery.gte('date', startTime);
        configQuery = configQuery.gte('created_at', startTime);
      }
      if (endTime) {
        trackQuery = trackQuery.lte('date', endTime);
        adsQuery   = adsQuery.lte('date', endTime);
        configQuery = configQuery.lte('created_at', endTime);
      }

      const { data: tracking } = await trackQuery.order('date', { ascending: false });
      const { data: ads }      = await adsQuery.order('date', { ascending: false });
      const { data: history }  = await configQuery.order('created_at', { ascending: false });

      return res.json({ client, tracking, ads, history });
    }

    // ── BUSCAR por ID ────────────────────────────────────────
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('owner_id', userId)
        .single();

      if (error) throw error;
      return res.json({ client: data });
    }

    // ── CRIAR novo cliente ────────────────────────────────────
    if (method === 'POST') {
      const payload = req.body;
      payload.owner_id = userId; // força o dono
      
      // SQL Migration reminder:
      // ALTER TABLE clients ADD COLUMN IF NOT EXISTS ad_account_id TEXT;
      // ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_name TEXT;
      // ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_status TEXT;

      const { data, error } = await supabase
        .from('clients')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ client: data });
    }

    // ── ATUALIZAR cliente ─────────────────────────────────────
    if (method === 'PUT' && id) {
      const payload = req.body;
      delete payload.owner_id; // nao permitir alterar dono
      const { data, error } = await supabase
        .from('clients')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('owner_id', userId)
        .select()
        .single();

      if (error) throw error;
      return res.json({ client: data });
    }

    // ── DELETAR cliente ───────────────────────────────────────
    if (method === 'DELETE' && id) {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', id)
        .eq('owner_id', userId);

      if (error) throw error;
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Método não permitido' });

  } catch (err) {
    console.error('[clients]', err.message);
    return res.status(err.message === 'Unauthorized' ? 401 : 500).json({ error: err.message });
  }
};
