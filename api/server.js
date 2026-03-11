/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — Server Local (Express)
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
app.use(express.json());
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

// ── Auth Routes ───────────────────────────────────────────────
const authGoogle   = require('./auth-google');
const authGoogleCb = require('./auth-google-cb');
const authMeta     = require('./auth-meta');
const authMetaCb   = require('./auth-meta-cb');
const gtmHandler   = require('./gtm');
const metaHandler  = require('./meta');
const clientsHandler = require('./clients');
const sessionHandler = require('./session');
const configHandler  = require('./config');

// Google OAuth
app.get('/auth/google', authGoogle);
app.get('/auth/google/callback', authGoogleCb);

// Meta OAuth
app.get('/auth/meta', authMeta);
app.get('/auth/meta/callback', authMetaCb);

// GTM API (todas as operações)
app.all('/api/gtm/:action', gtmHandler);

// Meta API (verificar pixel, CAPI)
app.all('/api/meta/:action', metaHandler);

// Clientes (Supabase)
app.all('/api/clients', clientsHandler);
app.all('/api/clients/:id', clientsHandler);

// Info de sessão (tokens ativos)
app.get('/api/session', sessionHandler);

// Config publicas
app.get('/api/config', configHandler);

// ── Catch-all → index.html ────────────────────────────────────
app.get('*', (req, res) => {
  // Se não estiver logado (logica simplificada para SPA), o frontend redireciona
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║  VALLOR TRACKING PRO — Rodando na porta ${PORT}  ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`  → App: http://localhost:${PORT}`);
  console.log(`  → Google Auth: http://localhost:${PORT}/auth/google`);
  console.log(`  → Meta Auth:   http://localhost:${PORT}/auth/meta\n`);
});

module.exports = app;
