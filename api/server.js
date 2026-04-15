/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — Server Local (Express)
 *  Multi-Tenant / Server-Side / Production-Ready
 *
 *  Para rodar localmente: node api/server.js
 *  Em produção: use as serverless functions Vercel (api/*.js)
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sessão server-side (tokens OAuth nunca vão pro frontend)
app.use(session({
  secret: process.env.SESSION_SECRET || 'vallor_secret_dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,         // true em HTTPS (produção)
    httpOnly: true,        // nunca expõe o cookie ao JS do browser
    maxAge: 1000 * 60 * 60 * 8  // 8 horas
  }
}));

// ── Static files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── Auth / Login Page ────────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// ── Reset Password Page ───────────────────────────────────────
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/reset-password.html'));
});

// ═══════════════════════════════════════════════════════════════
//  IMPORTAÇÃO DE HANDLERS
// ═══════════════════════════════════════════════════════════════
const authGoogle       = require('./auth-google');
const authGoogleCb     = require('./auth-google-cb');
const authMeta         = require('./auth-meta');
const authMetaCb       = require('./auth-meta-cb');
const gtmHandler       = require('./gtm');
const metaHandler      = require('./meta');
const metaClientsHandler = require('./meta-clients');
const clientsHandler   = require('./clients');
const sessionHandler   = require('./session');
const configHandler    = require('./config');
const trackingHandler  = require('./tracking');
const webhooksHandler  = require('./webhooks');
const audiencesHandler = require('./audiences');
const alertsHandler    = require('./alerts');
const dashboardHandler = require('./dashboard');
const syncHandler      = require('./sync');
const analyticsHandler = require('./analytics');
// ── v10.0 Novos Handlers ─────────────────────────────────────
const visitorsHandler    = require('./visitors');
const conversionsHandler = require('./conversions');

// ═══════════════════════════════════════════════════════════════
//  ROTAS DE AUTENTICAÇÃO
// ═══════════════════════════════════════════════════════════════
app.get('/auth/google', authGoogle);
app.get('/auth/google/callback', authGoogleCb);
app.get('/auth/meta', authMeta);
app.get('/auth/meta/callback', authMetaCb);

// ═══════════════════════════════════════════════════════════════
//  ROTAS v1 — TRACKING & ATRIBUIÇÃO (DAS Section 4 & 5)
// ═══════════════════════════════════════════════════════════════

// Endpoint principal de ingestão (script vallor-tracker.js envia para cá)
app.post('/v1/track',  trackingHandler);
app.post('/api/track', trackingHandler); // compatibilidade legada

// Webhooks de plataformas (Hotmart, Kiwify, Greenn, Eduzz)
app.all('/v1/webhooks/:platform', webhooksHandler);
app.all('/api/webhooks/:platform', webhooksHandler);

// Visitantes (Identity Resolution)
app.get('/api/visitors',     visitorsHandler);
app.get('/api/visitors/:id', visitorsHandler);
app.post('/api/visitors',    visitorsHandler);

// Conversões (Atribuição + CAPI)
app.get('/api/conversions',     conversionsHandler);
app.get('/api/conversions/:id', conversionsHandler);
app.post('/api/conversions',    conversionsHandler);

// ═══════════════════════════════════════════════════════════════
//  ROTAS API — GTM, META, CLIENTES, DASHBOARD
// ═══════════════════════════════════════════════════════════════

// GTM API (todas as operações)
app.all('/api/gtm/:action', gtmHandler);

// Meta API (verificar pixel, CAPI)
app.all('/api/meta/bm/*', metaClientsHandler);
app.all('/api/meta/pixels/*', metaClientsHandler);
app.all('/api/meta/insights/*', metaClientsHandler);
app.all('/api/meta/pixel-quality/*', metaClientsHandler);
app.all('/api/meta/:action', metaHandler);

// Clientes (Supabase — multi-tenant)
app.all('/api/clients', clientsHandler);
app.all('/api/clients/:id', clientsHandler);
app.all('/api/clients/:id/summary', clientsHandler);

// Dashboard & Analytics
app.get('/api/dashboard',  dashboardHandler);
app.get('/api/analytics',  analyticsHandler);

// Audiences & Sync
app.post('/api/audiences/sync', audiencesHandler);
app.all('/api/sync/*', syncHandler);

// Alerts
app.get('/api/alerts/check', alertsHandler);

// Info de sessão
app.get('/api/session', sessionHandler);

// Config públicas
app.get('/api/config', configHandler);

// ═══════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    version: '10.0',
    uptime:  process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ── Catch-all → index.html ────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log(`║  VALLOR TRACKER v10.0 — Porta ${PORT}              ║`);
  console.log('║  Multi-Tenant • Server-Side • Attribution      ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  console.log(`  → Dashboard:    http://localhost:${PORT}`);
  console.log(`  → Track API:    http://localhost:${PORT}/v1/track`);
  console.log(`  → Webhooks:     http://localhost:${PORT}/v1/webhooks/:platform`);
  console.log(`  → Health:       http://localhost:${PORT}/api/health`);
  console.log(`  → Google Auth:  http://localhost:${PORT}/auth/google`);
  console.log(`  → Meta Auth:    http://localhost:${PORT}/auth/meta\n`);
});

module.exports = app;
