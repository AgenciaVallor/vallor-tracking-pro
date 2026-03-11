/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — session.js
 *  Rota: GET /api/session
 *  Retorna o STATUS da sessão (conectado? qual plataforma?)
 *  SEM expor os tokens para o frontend
 * ═══════════════════════════════════════════════════════════════
 */

module.exports = function sessionHandler(req, res) {
  const session = req.session || {};

  // Retorna apenas flags booleanas (nunca o token em si)
  res.json({
    googleConnected: !!session.googleConnected,
    metaConnected:   !!session.metaConnected,
    // Expira em X minutos (para o frontend mostrar aviso)
    googleExpiresIn: session.googleTokenExpiry
      ? Math.max(0, Math.round((session.googleTokenExpiry - Date.now()) / 60000))
      : 0,
    metaExpiresIn: session.metaTokenExpiry
      ? Math.max(0, Math.round((session.metaTokenExpiry - Date.now()) / 60000))
      : 0,
  });
};
