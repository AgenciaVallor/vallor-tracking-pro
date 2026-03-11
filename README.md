# Vallor Tracking PRO

**Ferramenta interna da Vallor Growth Platform** para automação de configuração de rastreamento digital.

> Configure Pixel, GTM e CAPI em minutos — sem abrir nenhum painel manualmente.

---

## Funcionalidades

- **OAuth Google** → acessa o GTM do cliente com permissão oficial
- **OAuth Meta** → acessa o Business Manager e Pixel do cliente
- **GTM API** → cria workspace, triggers, tags e publica versão automaticamente
- **Meta API** → verifica Pixel, valida CAPI, consulta EMQ
- **Gerador de código** → GTM snippet, CAPI em PHP e Node.js, links UTM
- **Banco de dados** → histórico de clientes e configurações no Supabase

---

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML + CSS + JavaScript puro |
| Backend | Node.js + Express |
| Serverless | Vercel Functions |
| Banco de dados | Supabase (PostgreSQL) |
| OAuth | Google Identity + Meta Login |

---

## Instalação Local

### 1. Clonar o repositório

```bash
git clone https://github.com/AgenciaVallor/vallor-tracking-pro.git
cd vallor-tracking-pro
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Abra o `.env` e preencha:

```env
GOOGLE_CLIENT_ID=141400811792-gi6uq8248tacuphku5j0esq567qmhvl7.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=SEU_SECRET_AQUI
META_APP_ID=1599324351336847
META_APP_SECRET=SEU_SECRET_AQUI
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_KEY=sua_anon_key
SESSION_SECRET=string_aleatoria_longa
BASE_URL=http://localhost:3000
PORT=3000
```

### 4. Criar as tabelas no Supabase

Execute o SQL abaixo no **SQL Editor** do painel Supabase:

```sql
-- Tabela de clientes
CREATE TABLE clients (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  client_name        TEXT NOT NULL,
  domain             TEXT NOT NULL,
  pixel_id           TEXT,
  gtm_id             TEXT,
  capi_configured    BOOLEAN DEFAULT FALSE,
  platform           TEXT DEFAULT 'wordpress',
  emq_score          NUMERIC,
  tags_created       INTEGER DEFAULT 0,
  last_configured_at TIMESTAMPTZ
);

-- Tabela de configurações
CREATE TABLE configurations (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id            UUID REFERENCES clients(id) ON DELETE CASCADE,
  gtm_workspace_id     TEXT,
  gtm_version_published BOOLEAN DEFAULT FALSE,
  tags_created         JSONB,
  events_list          JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) — habilitar para segurança
ALTER TABLE clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurations ENABLE ROW LEVEL SECURITY;

-- Política: apenas usuários autenticados acessam
CREATE POLICY "Acesso autenticado" ON clients
  FOR ALL USING (true);
CREATE POLICY "Acesso autenticado" ON configurations
  FOR ALL USING (true);
```

### 5. Configurar URIs de redirecionamento

**Google Cloud Console:**
- Acesse [console.cloud.google.com](https://console.cloud.google.com)
- APIs & Services → Credenciais → OAuth 2.0
- Adicionar URI de redirecionamento: `http://localhost:3000/auth/google/callback`

**Meta for Developers:**
- Acesse [developers.facebook.com](https://developers.facebook.com)
- App → Configurações → Login do Facebook
- Adicionar URI: `http://localhost:3000/auth/meta/callback`

### 6. Rodar localmente

```bash
npm run dev
```

Acesse: **http://localhost:3000**

---

## Deploy no Vercel

### 1. Instalar Vercel CLI

```bash
npm i -g vercel
```

### 2. Fazer deploy

```bash
vercel --prod
```

### 3. Configurar variáveis de ambiente no Vercel

No painel [vercel.com](https://vercel.com):
- Acesse seu projeto → Settings → Environment Variables
- Adicione todas as variáveis do `.env.example`
- Altere `BASE_URL` para a URL do seu deploy (ex: `https://vallor-tracking.vercel.app`)

### 4. Atualizar URIs de redirecionamento

Após o deploy, adicione as URIs de produção no Google e Meta:
- `https://SEU_DOMINIO.vercel.app/auth/google/callback`
- `https://SEU_DOMINIO.vercel.app/auth/meta/callback`

---

## Estrutura do Projeto

```
/
├── api/
│   ├── server.js          # Servidor Express (desenvolvimento local)
│   ├── auth-google.js     # Inicia OAuth Google
│   ├── auth-google-cb.js  # Callback Google — troca code por token
│   ├── auth-meta.js       # Inicia OAuth Meta
│   ├── auth-meta-cb.js    # Callback Meta — gera long-lived token
│   ├── gtm.js             # Todas as operações GTM API
│   ├── meta.js            # Operações Meta Graph API
│   ├── clients.js         # CRUD clientes (Supabase)
│   └── session.js         # Status da sessão (sem expor tokens)
├── public/
│   └── index.html         # Frontend completo (4 etapas)
├── .env.example           # Modelo de variáveis de ambiente
├── vercel.json            # Configuração de deploy Vercel
├── package.json
└── README.md
```

---

## Segurança

- Tokens OAuth armazenados **apenas na sessão server-side** (HTTP-only cookie)
- `client_secret` e `app_secret` **nunca saem do servidor**
- Todas as chamadas às APIs do Google e Meta são feitas no **backend**
- O frontend só recebe flags booleanas (conectado/desconectado), **nunca o token**

---

## Paleta de Cores

| Nome | Hex |
|------|-----|
| Fundo | `#04080F` |
| Dourado | `#C8960C` |
| Dourado claro | `#F0B429` |
| Verde | `#0FBF6A` |
| Texto | `#EEF2FF` |

**Fontes:** Syne (títulos) · DM Sans (corpo) · DM Mono (código)

---

*Vallor Growth Platform — valloragencia@gmail.com · Protocolo V7™*
