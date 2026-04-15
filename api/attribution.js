/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKER v10.0 — attribution.js
 *  Motor de Atribuição em Cascata (DAS Section 5)
 *
 *  Prioridade de match:
 *    1. fbc       → clique rastreado do Facebook (melhor)
 *    2. fbp+email → cruzamento browser ID + email hashed
 *    3. email     → apenas email hashed
 *    4. fingerprint+IP → atribuição probabilística (30 dias)
 *    5. none      → sem atribuição possível
 * ═══════════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/** Hash SHA-256 para PII */
function hashPII(value) {
  if (!value) return null;
  return crypto.createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

/**
 * Janela de atribuição: 30 dias
 */
const ATTRIBUTION_WINDOW_DAYS = 30;
function getWindowStart() {
  const d = new Date();
  d.setDate(d.getDate() - ATTRIBUTION_WINDOW_DAYS);
  return d.toISOString();
}

/**
 * findVisitor
 * Tenta encontrar um visitante existente em cascata.
 * @param {string} clientId
 * @param {object} identifiers - { fbc, fbp, email, phone, fingerprint, ip }
 * @returns {{ visitor: object|null, method: string }}
 */
async function findVisitor(clientId, identifiers) {
  const windowStart = getWindowStart();
  const { fbc, fbp, email, fingerprint, ip } = identifiers;
  const emailHash = hashPII(email);

  // ── Nível 1: fbc (prioridade máxima) ─────────────────────────
  if (fbc) {
    const { data } = await supabase
      .from('visitors')
      .select('*')
      .eq('client_id', clientId)
      .eq('fbc', fbc)
      .gt('last_seen_at', windowStart)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return { visitor: data, method: 'fbc', confidence: 100 };
  }

  // ── Nível 2: fbp + email ──────────────────────────────────────
  if (fbp && emailHash) {
    const { data } = await supabase
      .from('visitors')
      .select('*')
      .eq('client_id', clientId)
      .eq('fbp', fbp)
      .eq('email', emailHash)
      .gt('last_seen_at', windowStart)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return { visitor: data, method: 'fbp_email', confidence: 90 };
  }

  // ── Nível 3: email apenas ─────────────────────────────────────
  if (emailHash) {
    const { data } = await supabase
      .from('visitors')
      .select('*')
      .eq('client_id', clientId)
      .eq('email', emailHash)
      .gt('last_seen_at', windowStart)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return { visitor: data, method: 'email', confidence: 75 };
  }

  // ── Nível 4: fingerprint + IP ─────────────────────────────────
  if (fingerprint && ip) {
    const { data } = await supabase
      .from('visitors')
      .select('*')
      .eq('client_id', clientId)
      .eq('fingerprint', fingerprint)
      .eq('ip_address', ip)
      .gt('last_seen_at', windowStart)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return { visitor: data, method: 'fingerprint_ip', confidence: 60 };
  }

  // ── Nível 5: fingerprint apenas ───────────────────────────────
  if (fingerprint) {
    const { data } = await supabase
      .from('visitors')
      .select('*')
      .eq('client_id', clientId)
      .eq('fingerprint', fingerprint)
      .gt('last_seen_at', windowStart)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return { visitor: data, method: 'fingerprint', confidence: 40 };
  }

  return { visitor: null, method: 'none', confidence: 0 };
}

/**
 * upsertVisitor
 * Cria ou atualiza um visitante no banco.
 * @param {string} clientId
 * @param {string} agencyId
 * @param {object} data - identifiers + metadata
 * @returns {object} visitor record
 */
async function upsertVisitor(clientId, agencyId, data) {
  const {
    fbc, fbp, email, phone, fingerprint, ip,
    userAgent, utmSource, utmMedium, utmCampaign, country
  } = data;

  const emailHash = hashPII(email);
  const phoneHash = hashPII(phone);

  // Tenta encontrar visitor existente
  const { visitor: existing, method } = await findVisitor(clientId, {
    fbc, fbp, email, fingerprint, ip
  });

  if (existing) {
    // Atualiza last_seen + enriquece dados que faltavam
    const updates = { last_seen_at: new Date().toISOString() };
    if (fbc && !existing.fbc)           updates.fbc = fbc;
    if (fbp && !existing.fbp)           updates.fbp = fbp;
    if (emailHash && !existing.email)   updates.email = emailHash;
    if (phoneHash && !existing.phone)   updates.phone = phoneHash;
    if (fingerprint && !existing.fingerprint) updates.fingerprint = fingerprint;

    const { data: updated } = await supabase
      .from('visitors')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();

    return { visitor: updated || existing, isNew: false, method };
  }

  // Cria novo visitante
  const payload = {
    agency_id: agencyId,
    client_id: clientId,
    fbc:       fbc || null,
    fbp:       fbp || null,
    email:     emailHash || null,
    phone:     phoneHash || null,
    fingerprint: fingerprint || null,
    ip_address:  ip || null,
    user_agent:  userAgent || null,
    country:     country || null,
    first_utm_source:   utmSource   || null,
    first_utm_medium:   utmMedium   || null,
    first_utm_campaign: utmCampaign || null,
    last_seen_at: new Date().toISOString()
  };

  const { data: created, error } = await supabase
    .from('visitors')
    .insert([payload])
    .select()
    .single();

  if (error) throw error;
  return { visitor: created, isNew: true, method: 'new' };
}

/**
 * attributeConversion
 * Dado uma conversão (com email, fbp, fbc etc.),
 * tenta encontrar o visitante origem e retornar os dados de atribuição.
 */
async function attributeConversion(clientId, identifiers) {
  const result = await findVisitor(clientId, identifiers);
  return {
    visitor_id:              result.visitor?.id || null,
    attributed_by:           result.method,
    attribution_confidence:  result.confidence,
    fbc:                     result.visitor?.fbc || identifiers.fbc || null,
    fbp:                     result.visitor?.fbp || identifiers.fbp || null,
    utm_source:              result.visitor?.first_utm_source || null,
    utm_campaign:            result.visitor?.first_utm_campaign || null
  };
}

module.exports = { findVisitor, upsertVisitor, attributeConversion, hashPII };
