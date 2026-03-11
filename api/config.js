/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — config.js
 *  Rota: GET /api/config
 *  Fornece chaves PÚBLICAS para o frontend
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

module.exports = function configHandler(req, res) {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY, // Anon key é segura para o frontend
  });
};
