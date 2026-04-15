-- ═══════════════════════════════════════════════════════════════
--  VALLOR TRACKER v10.0 — Schema Completo Multi-tenant
--  Cole este arquivo INTEIRO no SQL Editor do Supabase e clique RUN
--  Última atualização: Abril 2026
-- ═══════════════════════════════════════════════════════════════

-- ══ 0. EXTENSÕES ════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ══ 1. LIMPEZA TOTAL (remove versões anteriores) ════════════════
-- Políticas
DROP POLICY IF EXISTS "agencies_select"           ON public.agencies;
DROP POLICY IF EXISTS "clients_select"            ON public.clients;
DROP POLICY IF EXISTS "tracking_events_access"    ON public.tracking_events;
DROP POLICY IF EXISTS "conversions_access"        ON public.conversions;
DROP POLICY IF EXISTS "visitors_access"           ON public.visitors;
DROP POLICY IF EXISTS "integrations_access"       ON public.integrations;

-- Tabelas (ordem inversa de dependência)
DROP TABLE IF EXISTS public.webhook_logs          CASCADE;
DROP TABLE IF EXISTS public.alerts                CASCADE;
DROP TABLE IF EXISTS public.api_tokens            CASCADE;
DROP TABLE IF EXISTS public.integrations          CASCADE;
DROP TABLE IF EXISTS public.conversions           CASCADE;
DROP TABLE IF EXISTS public.tracking_events       CASCADE;
DROP TABLE IF EXISTS public.visitors              CASCADE;
DROP TABLE IF EXISTS public.client_domains        CASCADE;
DROP TABLE IF EXISTS public.clients               CASCADE;
DROP TABLE IF EXISTS public.agencies              CASCADE;

-- Funções auxiliares
DROP FUNCTION IF EXISTS public.set_updated_at()    CASCADE;
DROP FUNCTION IF EXISTS public.is_agency_member(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.has_client_access(UUID) CASCADE;

-- ══ 2. FUNÇÕES AUXILIARES ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══ 3. AGÊNCIAS ══════════════════════════════════════════════════
CREATE TABLE public.agencies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        CITEXT      NOT NULL UNIQUE,
  owner_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  plan        TEXT        NOT NULL DEFAULT 'starter',  -- starter | pro | agency
  logo_url    TEXT,
  status      TEXT        NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 4. CLIENTES ══════════════════════════════════════════════════
-- Todas as colunas usadas pelo código (dashboard.js, clients.js, webhooks.js, tracking.js)
CREATE TABLE public.clients (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           UUID        REFERENCES public.agencies(id) ON DELETE CASCADE,
  owner_id            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  name                TEXT        NOT NULL,
  slug                CITEXT,
  domain              TEXT,
  business_name       TEXT,
  status              TEXT        NOT NULL DEFAULT 'active',
  -- Script de rastreamento
  script_key          TEXT        UNIQUE,
  -- Meta / Facebook
  pixel_id            TEXT,          -- ID do Pixel do Facebook
  meta_access_token   TEXT,          -- Token de acesso para CAPI
  meta_test_event_code TEXT,         -- Código de teste (opcional)
  capi_configured     BOOLEAN     NOT NULL DEFAULT false,
  -- Google / GTM
  gtm_container_id    TEXT,
  google_ads_id       TEXT,
  -- Conta de anúncios
  ad_account_id       TEXT,
  account_status      TEXT,
  -- Configurações adicionais
  timezone            TEXT        NOT NULL DEFAULT 'America/Sao_Paulo',
  currency            TEXT        NOT NULL DEFAULT 'BRL',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 5. DOMÍNIOS DOS CLIENTES ══════════════════════════════════════
CREATE TABLE public.client_domains (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   UUID        NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id   UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  domain      CITEXT      NOT NULL UNIQUE,
  is_primary  BOOLEAN     NOT NULL DEFAULT false,
  script_key  TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 6. VISITANTES ════════════════════════════════════════════════
CREATE TABLE public.visitors (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id             UUID        REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id             UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Identidade
  fbc                   TEXT,        -- Facebook Click ID (_fbc cookie)
  fbp                   TEXT,        -- Facebook Browser ID (_fbp cookie)
  email                 TEXT,        -- SHA256 hash do email
  phone                 TEXT,        -- SHA256 hash do telefone
  fingerprint           TEXT,        -- Hash do fingerprint do navegador; índice
  ip_address            TEXT,        -- IP do visitante
  user_agent            TEXT,
  country               TEXT    DEFAULT 'br',
  -- UTMs de primeira visita
  first_utm_source      TEXT,
  first_utm_medium      TEXT,
  first_utm_campaign    TEXT,
  first_utm_content     TEXT,
  first_utm_term        TEXT,
  -- Datas de controle
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 7. INTEGRAÇÕES (API Keys para Webhooks) ═══════════════════════
CREATE TABLE public.integrations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   UUID        NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id   UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,   -- Ex: "Kiwify Prod", "Hotmart Dev"
  platform    TEXT        NOT NULL,   -- kiwify | hotmart | greenn | eduzz | generic
  api_key     TEXT        NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 8. EVENTOS DE RASTREAMENTO ════════════════════════════════════
CREATE TABLE public.tracking_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         UUID        REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id         UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  visitor_id        UUID        REFERENCES public.visitors(id) ON DELETE SET NULL,
  -- Dados do evento
  event_name        TEXT        NOT NULL,
  event_id          TEXT        NOT NULL,   -- Para deduplicação na Meta CAPI
  event_time        BIGINT,                  -- Unix timestamp
  event_source_url  TEXT,
  action_source     TEXT    DEFAULT 'website',
  -- Rastreamento
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  utm_content       TEXT,
  utm_term          TEXT,
  platform          TEXT    DEFAULT 'browser',
  -- Status de envio para Meta CAPI
  status            TEXT    DEFAULT 'pending',   -- pending | sent | stored | error | duplicated
  match_quality     NUMERIC(5,2),
  error_message     TEXT,
  -- Payload completo para debug
  raw_data          JSONB   DEFAULT '{}'::JSONB,
  properties        JSONB   DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tracking_events_event_unique UNIQUE (client_id, event_id)
);

-- ══ 9. CONVERSÕES (VENDAS) ════════════════════════════════════════
CREATE TABLE public.conversions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id               UUID        REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id               UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  visitor_id              UUID        REFERENCES public.visitors(id) ON DELETE SET NULL,
  -- Dados do pedido
  order_id                TEXT        NOT NULL,
  platform                TEXT        NOT NULL DEFAULT 'generic',  -- kiwify | hotmart | greenn | eduzz
  status                  TEXT        NOT NULL DEFAULT 'approved', -- approved | refunded | pending | chargeback
  total_value             NUMERIC(14,2),
  currency                TEXT        NOT NULL DEFAULT 'BRL',
  product_name            TEXT,
  -- Atribuição
  attributed_by           TEXT,       -- fbc | fbp_email | email | fingerprint_ip | fingerprint | none
  attribution_confidence  INTEGER,    -- 0-100
  -- Meta CAPI
  meta_sent               BOOLEAN     NOT NULL DEFAULT false,
  meta_event_id           TEXT,
  meta_error              TEXT,
  -- Tempo da conversão
  conversion_time         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversions_unique_order UNIQUE (client_id, platform, order_id)
);

-- ══ 10. ALERTAS ══════════════════════════════════════════════════
CREATE TABLE public.alerts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id   UUID        REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id   UUID        REFERENCES public.clients(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,   -- error | warning | info | success
  title       TEXT        NOT NULL,
  message     TEXT,
  is_read     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 11. API TOKENS (para acesso programático) ═════════════════════
CREATE TABLE public.api_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id     UUID        NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id     UUID        REFERENCES public.clients(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  token_hash    TEXT        NOT NULL UNIQUE,
  scopes        TEXT[]      NOT NULL DEFAULT ARRAY['webhook:purchase'],
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 12. LOGS DE WEBHOOK ═══════════════════════════════════════════
CREATE TABLE public.webhook_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT        NOT NULL,
  event_type        TEXT,
  external_event_id TEXT,
  status            TEXT        NOT NULL DEFAULT 'received',  -- received | processed | error
  request_headers   JSONB,
  payload           JSONB,
  response_body     JSONB,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══ 13. ÍNDICES DE PERFORMANCE ════════════════════════════════════
CREATE INDEX idx_visitors_client_fbc         ON public.visitors(client_id, fbc)         WHERE fbc IS NOT NULL;
CREATE INDEX idx_visitors_client_fbp         ON public.visitors(client_id, fbp)         WHERE fbp IS NOT NULL;
CREATE INDEX idx_visitors_client_email       ON public.visitors(client_id, email)        WHERE email IS NOT NULL;
CREATE INDEX idx_visitors_client_fingerprint ON public.visitors(client_id, fingerprint)  WHERE fingerprint IS NOT NULL;
CREATE INDEX idx_visitors_last_seen          ON public.visitors(client_id, last_seen_at DESC);
CREATE INDEX idx_events_client_time          ON public.tracking_events(client_id, created_at DESC);
CREATE INDEX idx_events_agency_time          ON public.tracking_events(agency_id, created_at DESC);
CREATE INDEX idx_conversions_client_time     ON public.conversions(client_id, conversion_time DESC);
CREATE INDEX idx_conversions_agency_time     ON public.conversions(agency_id, conversion_time DESC);
CREATE INDEX idx_clients_script_key          ON public.clients(script_key)               WHERE script_key IS NOT NULL;
CREATE INDEX idx_clients_agency              ON public.clients(agency_id);
CREATE INDEX idx_integrations_api_key        ON public.integrations(api_key);

-- ══ 14. TRIGGERS AUTOMÁTICOS ══════════════════════════════════════
CREATE TRIGGER set_agencies_updated_at    BEFORE UPDATE ON public.agencies    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_clients_updated_at     BEFORE UPDATE ON public.clients     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_conversions_updated_at BEFORE UPDATE ON public.conversions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ══ 15. FUNÇÕES DE SEGURANÇA (RLS) ════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_agency_member(check_agency_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.agencies
    WHERE id = check_agency_id
    AND owner_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.has_client_access(check_client_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clients c
    JOIN public.agencies a ON a.id = c.agency_id
    WHERE c.id = check_client_id
    AND (c.owner_id = auth.uid() OR a.owner_id = auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══ 16. ATIVAR E CONFIGURAR RLS ═══════════════════════════════════
ALTER TABLE public.agencies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations     ENABLE ROW LEVEL SECURITY;

-- Políticas: Apenas o dono da agência vê seus dados
CREATE POLICY "agencies_select"        ON public.agencies         FOR SELECT USING (is_agency_member(id));
CREATE POLICY "clients_select"         ON public.clients          FOR ALL    USING (has_client_access(id));
CREATE POLICY "visitors_access"        ON public.visitors         FOR ALL    USING (has_client_access(client_id));
CREATE POLICY "tracking_events_access" ON public.tracking_events  FOR ALL    USING (has_client_access(client_id));
CREATE POLICY "conversions_access"     ON public.conversions      FOR ALL    USING (has_client_access(client_id));
CREATE POLICY "integrations_access"    ON public.integrations     FOR ALL    USING (has_client_access(client_id));

-- ══ 17. DADOS INICIAIS DE EXEMPLO ═════════════════════════════════
-- ATENÇÃO: Rode esta seção SEPARADAMENTE depois que tiver seu user_id do Supabase Auth
-- Substitua 'SEU-USER-ID-AQUI' pelo seu UUID de usuário

-- INSERT INTO public.agencies (name, slug, owner_id, plan)
-- VALUES ('Agência Vallor', 'agencia-vallor', 'SEU-USER-ID-AQUI', 'agency');

-- INSERT INTO public.clients (agency_id, owner_id, name, slug, domain, script_key, pixel_id, meta_access_token)
-- VALUES (
--   (SELECT id FROM public.agencies WHERE slug = 'agencia-vallor'),
--   'SEU-USER-ID-AQUI',
--   'Cliente Exemplo',
--   'cliente-exemplo',
--   'exemplo.com.br',
--   'sk_live_vallor_' || substring(gen_random_uuid()::text, 1, 16),
--   'SEU-PIXEL-ID',
--   'SEU-META-ACCESS-TOKEN'
-- );
