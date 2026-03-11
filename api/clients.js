/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — clients.js
 *  Rota: /api/clients
 *  CRUD de clientes no Supabase (PostgreSQL)
 *
 *  GET    /api/clients         → lista todos os clientes
 *  POST   /api/clients         → cria novo cliente
 *  GET    /api/clients/:id     → busca cliente por ID
 *  PUT    /api/clients/:id     → atualiza cliente
 *  DELETE /api/clients/:id     → remove cliente
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Inicializa o cliente Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ════════════════════════════════════════════════════════════════
//  HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════
module.exports = async function clientsHandler(req, res) {
  const { method } = req;
  const id = req.params?.id;

  try {
    // ── LISTAR todos ─────────────────────────────────────────
    if (method === 'GET' && !id) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.json({ clients: data });
    }

    // ── BUSCAR por ID ────────────────────────────────────────
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('clients')
        .select('*, configurations(*)')
        .eq('id', id)
        .single();

      if (error) throw error;
      return res.json({ client: data });
    }

    // ── CRIAR novo cliente ────────────────────────────────────
    if (method === 'POST') {
      const {
        client_name, domain, pixel_id, gtm_id,
        capi_configured, platform, emq_score,
        tags_created, last_configured_at,
      } = req.body;

      const { data, error } = await supabase
        .from('clients')
        .insert([{
          client_name:       client_name,
          domain:            domain,
          pixel_id:          pixel_id,
          gtm_id:            gtm_id,
          capi_configured:   capi_configured || false,
          platform:          platform || 'wordpress',
          emq_score:         emq_score || null,
          tags_created:      tags_created || 0,
          last_configured_at: last_configured_at || new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ client: data });
    }

    // ── ATUALIZAR cliente ─────────────────────────────────────
    if (method === 'PUT' && id) {
      const { data, error } = await supabase
        .from('clients')
        .update({ ...req.body, last_configured_at: new Date().toISOString() })
        .eq('id', id)
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
        .eq('id', id);

      if (error) throw error;
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Método não permitido' });

  } catch (err) {
    console.error('[clients]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
