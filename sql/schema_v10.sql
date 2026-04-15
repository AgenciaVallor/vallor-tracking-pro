-- ════════════════════════════════════════════════════════════════════
--  VALLOR TRACKER v10.0 — SQL Schema Multi-Tenant
--  Execute no SQL Editor do Supabase (painel → SQL Editor → New Query)
--  Versão: Production-Ready / Janeiro 2026
-- ════════════════════════════════════════════════════════════════════

-- ── Extensões ──────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Função de updated_at automático ────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════
--  TABELA 1: agencies
--  Uma agência pode ter N clientes (multi-tenant root)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.agencies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  slug       CITEXT NOT NULL UNIQUE,
  plan       TEXT DEFAULT 'starter',   -- starter | pro | enterprise
  status     TEXT DEFAULT 'active',    -- active | suspended
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE TRIGGER agencies_updated_at
  BEFORE UPDATE ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencia: owner pode tudo" ON public.agencies
  FOR ALL USING (owner_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
--  TABELA 2: clients
--  Cada cliente pertence a uma agência (isolamento multi-tenant)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  owner_id        UUID REFERENCES auth.users(id),   -- compatibilidade legada
  name            TEXT NOT NULL,
  domain          TEXT,
  status          TEXT DEFAULT 'active',
  timezone        TEXT DEFAULT 'America/Sao_Paulo',
  -- Meta
  pixel_id        TEXT,
  meta_access_token TEXT,
  meta_account_id TEXT,
  capi_configured BOOLEAN DEFAULT FALSE,
  -- GTM
  gtm_id          TEXT,
  gtm_configured  BOOLEAN DEFAULT FALSE,
  -- Tracking
  script_key      TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  emq_score       NUMERIC,
  -- Plataforma
  platform        TEXT DEFAULT 'wordpress',
  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE TRIGGER clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Política: usuário autenticado acessa clientes da sua agência
CREATE POLICY "Cliente: acesso via agencia" ON public.clients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.agencies a
      WHERE a.id = clients.agency_id AND a.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════
--  TABELA 3: visitors
--  Identidade do visitante (fbc, fbp, fingerprint, IP)
--  Núcleo do motor de atribuição
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.visitors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id    UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Identifiers (múltiplos para match em cascata)
  fbp          TEXT,
  fbc          TEXT,
  email        TEXT,    -- hashed SHA256
  phone        TEXT,    -- hashed SHA256
  fingerprint  TEXT,
  ip_address   INET,
  -- UTMs capturados na primeira visita
  first_utm_source   TEXT,
  first_utm_medium   TEXT,
  first_utm_campaign TEXT,
  -- Metadados
  user_agent   TEXT,
  country      TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visitors_fbc_idx      ON public.visitors(fbc)        WHERE fbc IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_fbp_idx      ON public.visitors(fbp)        WHERE fbp IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_email_idx    ON public.visitors(email)      WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_finger_idx   ON public.visitors(fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_client_idx   ON public.visitors(client_id);

ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Visitor: acesso via agencia" ON public.visitors
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.agencies a
      WHERE a.id = visitors.agency_id AND a.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════
--  TABELA 4: tracking_events
--  Todos os eventos rastreados (PageView, Lead, Purchase, etc.)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tracking_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id        UUID REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  visitor_id       UUID REFERENCES public.visitors(id),
  -- Dados do evento
  event_name       TEXT NOT NULL,
  event_id         TEXT UNIQUE,              -- para deduplicação
  event_time       BIGINT,                  -- unix timestamp
  event_source_url TEXT,
  action_source    TEXT DEFAULT 'website',
  -- UTMs
  utm_source       TEXT,
  utm_medium       TEXT,
  utm_campaign     TEXT,
  utm_content      TEXT,
  utm_term         TEXT,
  -- Status de envio CAPI
  status           TEXT DEFAULT 'pending',  -- pending|sent|error|duplicated
  meta_event_id    TEXT,
  match_quality    NUMERIC,                 -- EMQ 0-10
  error_message    TEXT,
  -- Dados brutos
  raw_data         JSONB,
  properties       JSONB,
  platform         TEXT DEFAULT 'browser',  -- browser|webhook|gtm
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS track_client_idx    ON public.tracking_events(client_id);
CREATE INDEX IF NOT EXISTS track_event_id_idx  ON public.tracking_events(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS track_created_idx   ON public.tracking_events(created_at DESC);
CREATE INDEX IF NOT EXISTS track_visitor_idx   ON public.tracking_events(visitor_id) WHERE visitor_id IS NOT NULL;

ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event: acesso via agencia" ON public.tracking_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.agencies a
      WHERE a.id = tracking_events.agency_id AND a.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════
--  TABELA 5: conversions
--  Compras/vendas com atribuição Multi-touch
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.conversions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id        UUID REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  visitor_id       UUID REFERENCES public.visitors(id),
  -- Dados da venda
  order_id         TEXT,
  total_value      NUMERIC(14, 2),
  currency         TEXT DEFAULT 'BRL',
  product_name     TEXT,
  platform         TEXT,  -- hotmart|kiwify|greenn|eduzz|generic
  status           TEXT,  -- approved|pending|refunded|chargeback
  -- Atribuição
  attributed_by    TEXT,  -- fbc|fbp_email|fingerprint_ip|email|none
  attribution_confidence NUMERIC DEFAULT 0,  -- 0-100
  -- CAPI
  meta_sent        BOOLEAN DEFAULT false,
  meta_event_id    TEXT,
  meta_error       TEXT,
  -- Timestamps
  conversion_time  TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conv_client_idx   ON public.conversions(client_id);
CREATE INDEX IF NOT EXISTS conv_order_idx    ON public.conversions(order_id)   WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conv_visitor_idx  ON public.conversions(visitor_id) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conv_created_idx  ON public.conversions(created_at DESC);

ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Conversion: acesso via agencia" ON public.conversions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.agencies a
      WHERE a.id = conversions.agency_id AND a.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════
--  TABELA 6: integrations
--  Chaves API para webhooks de plataformas (Hotmart, Kiwify, etc.)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.integrations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id  UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL,    -- hotmart|kiwify|greenn|eduzz
  api_key    TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Integration: acesso via agencia" ON public.integrations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.agencies a
      WHERE a.id = integrations.agency_id AND a.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════
--  TABELA 7: configurations  (histórico de configurações GTM/Meta)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.configurations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  gtm_workspace_id      TEXT,
  gtm_version_published BOOLEAN DEFAULT FALSE,
  tags_created          JSONB,
  events_list           JSONB,
  created_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Config: acesso via client" ON public.configurations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      JOIN public.agencies a ON a.id = c.agency_id
      WHERE c.id = configurations.client_id AND a.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════
--  VIEW: dashboard_stats (facilita queries de painel)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_client_stats AS
SELECT
  c.id                                              AS client_id,
  c.agency_id,
  c.name                                            AS client_name,
  COUNT(DISTINCT te.id)                             AS total_events,
  COUNT(DISTINCT te.id) FILTER (
    WHERE te.created_at > now() - interval '24 hours'
  )                                                 AS events_today,
  COUNT(DISTINCT cv.id)                             AS total_conversions,
  COALESCE(SUM(cv.total_value), 0)                  AS total_revenue,
  AVG(te.match_quality) FILTER (
    WHERE te.match_quality IS NOT NULL
  )                                                 AS avg_emq,
  COUNT(DISTINCT v.id)                              AS total_visitors
FROM public.clients c
LEFT JOIN public.tracking_events te ON te.client_id = c.id
LEFT JOIN public.conversions cv     ON cv.client_id = c.id AND cv.status = 'approved'
LEFT JOIN public.visitors v         ON v.client_id = c.id
GROUP BY c.id, c.agency_id, c.name;

-- ════════════════════════════════════════════════════════════════════
--  FIM DO SCHEMA — Inserir seed de agência padrão (opcional)
-- ════════════════════════════════════════════════════════════════════
-- INSERT INTO public.agencies (name, slug, owner_id)
-- VALUES ('Vallor Growth', 'vallor', auth.uid());
