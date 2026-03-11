/**
 * ═══════════════════════════════════════════════════════════════
 *  VALLOR TRACKING PRO — gtm.js
 *  Rota: /api/gtm/:action
 *  Todas as operações GTM são feitas no servidor usando
 *  o token OAuth armazenado na sessão (nunca exposto ao browser)
 *
 *  Ações disponíveis:
 *  GET  /api/gtm/accounts          → lista contas GTM
 *  POST /api/gtm/find-container    → encontra container por publicId
 *  POST /api/gtm/create-workspace  → cria workspace
 *  POST /api/gtm/create-trigger    → cria trigger
 *  POST /api/gtm/create-tag        → cria tag
 *  POST /api/gtm/create-variable   → cria variável
 *  POST /api/gtm/publish           → publica versão
 *  POST /api/gtm/run-full-setup    → roda todo o setup de uma vez
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const GTM_BASE = 'https://www.googleapis.com/tagmanager/v2';

// ── Helper: chamada autenticada à GTM API ──────────────────────
async function gtmRequest(token, path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${GTM_BASE}${path}`, options);
  const data     = await response.json();

  if (!response.ok) {
    const msg = data?.error?.message || `GTM API error ${response.status}`;
    throw new Error(msg);
  }

  return data;
}

// ── Lista todas as contas GTM do usuário ───────────────────────
async function listAccounts(token) {
  const data = await gtmRequest(token, '/accounts');
  return data.account || [];
}

// ── Encontra container pelo publicId (ex: GTM-XXXXXXX) ─────────
async function findContainer(token, publicId) {
  const accounts = await listAccounts(token);

  for (const account of accounts) {
    const data = await gtmRequest(token, `/accounts/${account.accountId}/containers`);
    const containers = data.container || [];
    const match = containers.find(c =>
      c.publicId === publicId || c.publicId === publicId.toUpperCase()
    );
    if (match) {
      return { account, container: match };
    }
  }

  throw new Error(`Container ${publicId} não encontrado nas contas GTM do usuário`);
}

// ── Cria workspace ─────────────────────────────────────────────
async function createWorkspace(token, accountId, containerId) {
  const today = new Date().toLocaleDateString('pt-BR');
  return gtmRequest(
    token,
    `/accounts/${accountId}/containers/${containerId}/workspaces`,
    'POST',
    {
      name:        `Vallor Setup ${today}`,
      description: 'Criado automaticamente pelo Vallor Tracking PRO v1.0',
    }
  );
}

// ── Cria variável event_id (para deduplicação CAPI) ────────────
async function createEventIdVariable(token, accountId, containerId, workspaceId) {
  return gtmRequest(
    token,
    `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/variables`,
    'POST',
    {
      name: 'event_id',
      type: 'jsm', // JavaScript Variable
      parameter: [{
        type:  'template',
        key:   'javascript',
        value: 'function() { return "ev_" + Date.now() + "_" + Math.random().toString(36).substr(2,9); }',
      }],
    }
  );
}

// ── Cria trigger All Pages (PAGEVIEW) ─────────────────────────
async function createAllPagesTrigger(token, accountId, containerId, workspaceId) {
  return gtmRequest(
    token,
    `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`,
    'POST',
    { name: 'All Pages — Vallor', type: 'PAGEVIEW' }
  );
}

// ── Cria trigger Página de Obrigado (URL contém /obrigado) ─────
async function createThankYouTrigger(token, accountId, containerId, workspaceId, thankUrl) {
  return gtmRequest(
    token,
    `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`,
    'POST',
    {
      name: 'Página de Obrigado — Vallor',
      type: 'PAGEVIEW',
      filter: [{
        type: 'CONTAINS',
        parameter: [
          { type: 'template', key: 'arg0', value: '{{Page URL}}' },
          { type: 'template', key: 'arg1', value: thankUrl || '/obrigado' },
        ],
      }],
    }
  );
}

// ── Gera o HTML do Meta Pixel para uma tag GTM ────────────────
function generatePixelTagHTML(pixelId, eventName, eventData = {}) {
  if (eventName === 'PageView') {
    return `<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');

// Inicialização com Advanced Matching via GTM
var em = {{dlv - em}} || '';
var ph = {{dlv - ph}} || '';
var fn = {{dlv - fn}} || '';

fbq('init', '${pixelId}', {
  em: em, ph: ph, fn: fn,
  external_id: {{Client ID}} || undefined
});
fbq('track', 'PageView', {}, {eventID: {{event_id}}});
</script>
<noscript>
<img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/>
</noscript>`;
  }

  const extraParams = Object.keys(eventData).length
    ? ', ' + JSON.stringify(eventData)
    : '';

  return `<script>
fbq('track', '${eventName}'${extraParams}, {eventID: {{event_id}}});
</script>`;
}

// ── Cria uma tag HTML customizada no GTM ──────────────────────
async function createTag(token, accountId, containerId, workspaceId, name, html, triggerIds) {
  return gtmRequest(
    token,
    `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags`,
    'POST',
    {
      name,
      type: 'html',
      parameter: [
        { type: 'template', key: 'html',                value: html  },
        { type: 'boolean',  key: 'supportDocumentWrite', value: 'false' },
      ],
      firingTriggerId: triggerIds,
    }
  );
}

// ── Publica a versão no GTM ────────────────────────────────────
async function publishVersion(token, accountId, containerId, workspaceId, clientName) {
  // 1. Cria o container version a partir do workspace
  const version = await gtmRequest(
    token,
    `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/create_version`,
    'POST',
    {
      name:  `Vallor V7 — ${clientName} — ${new Date().toLocaleDateString('pt-BR')}`,
      notes: 'Publicado automaticamente pelo Vallor Tracking PRO. Pixel + CAPI configurados.',
    }
  );

  const versionId = version.containerVersion?.containerVersionId;
  if (!versionId) throw new Error('Não foi possível obter o ID da versão criada');

  // 2. Publica a versão
  await gtmRequest(
    token,
    `/accounts/${accountId}/containers/${containerId}/versions/${versionId}:publish`,
    'POST'
  );

  return version;
}

// ── FULL SETUP: roda tudo de uma vez e retorna logs ───────────
async function runFullSetup(token, { gtmId, pixelId, clientName, thankUrl, domain }) {
  const logs    = [];
  const results = { tags: [], triggerIds: [], workspaceId: null, versionPublished: false };
  const log     = (msg, type = 'ok') => logs.push({ msg, type, time: new Date().toISOString() });

  try {
    // T1: Encontra o container
    log('Buscando container ' + gtmId + '...', 'info');
    const { account, container } = await findContainer(token, gtmId);
    const aId = account.accountId;
    const cId = container.containerId;
    log(`✓ Container "${container.name}" encontrado (conta: ${account.name})`, 'ok');

    // T2: Cria workspace
    log('Criando workspace "Vallor Setup"...', 'info');
    const ws = await createWorkspace(token, aId, cId);
    const wId = ws.workspaceId;
    results.workspaceId = wId;
    log(`✓ Workspace criado: "${ws.name}" (ID: ${wId})`, 'ok');

    // T3: Cria variável event_id
    log('Criando variável event_id...', 'info');
    try {
      await createEventIdVariable(token, aId, cId, wId);
      log('✓ Variável event_id criada (deduplicação CAPI ativa)', 'ok');
    } catch (e) {
      log('⚠ event_id: ' + e.message, 'warn');
    }

    // T4: Cria trigger All Pages
    log('Criando trigger All Pages...', 'info');
    const allPagesTrigger = await createAllPagesTrigger(token, aId, cId, wId);
    const allPagesId = allPagesTrigger.triggerId;
    log(`✓ Trigger All Pages criado (ID: ${allPagesId})`, 'ok');

    // T5: Cria trigger Página de Obrigado
    log(`Criando trigger Obrigado (URL contém "${thankUrl}")...`, 'info');
    const thankTrigger = await createThankYouTrigger(token, aId, cId, wId, thankUrl);
    const thankId = thankTrigger.triggerId;
    log(`✓ Trigger Obrigado criado (ID: ${thankId})`, 'ok');

    // T6: Tag PageView
    log(`Criando tag Meta Pixel — PageView (Pixel: ${pixelId})...`, 'info');
    const tagPV = await createTag(
      token, aId, cId, wId,
      'Meta Pixel — PageView',
      generatePixelTagHTML(pixelId, 'PageView'),
      [allPagesId]
    );
    results.tags.push({ name: tagPV.name, id: tagPV.tagId, event: 'PageView' });
    log(`✓ Tag PageView criada (ID: ${tagPV.tagId})`, 'ok');

    // T7: Tag Lead
    log('Criando tag Meta Pixel — Lead...', 'info');
    const tagLead = await createTag(
      token, aId, cId, wId,
      'Meta Pixel — Lead',
      generatePixelTagHTML(pixelId, 'Lead'),
      [thankId]
    );
    results.tags.push({ name: tagLead.name, id: tagLead.tagId, event: 'Lead' });
    log(`✓ Tag Lead criada (ID: ${tagLead.tagId})`, 'ok');

    // T8: Tag Purchase
    log('Criando tag Meta Pixel — Purchase...', 'info');
    const tagPurchase = await createTag(
      token, aId, cId, wId,
      'Meta Pixel — Purchase',
      generatePixelTagHTML(pixelId, 'Purchase', { currency: 'BRL', value: '{{dlv - value}}' }),
      [thankId]
    );
    results.tags.push({ name: tagPurchase.name, id: tagPurchase.tagId, event: 'Purchase' });
    log(`✓ Tag Purchase criada (ID: ${tagPurchase.tagId})`, 'ok');

    // T9: Publica versão
    log('Publicando versão no GTM...', 'info');
    try {
      const version = await publishVersion(token, aId, cId, wId, clientName);
      results.versionPublished = true;
      results.versionName = version.containerVersion?.name;
      log(`✓ Versão publicada: "${results.versionName}"`, 'ok');
    } catch (e) {
      log('⚠ Publicação falhou: ' + e.message, 'warn');
      log('→ Publique manualmente no painel GTM → "Enviar"', 'warn');
    }

    log('✓ Setup GTM completo!', 'ok');
    return { success: true, logs, results, accountId: aId, containerId: cId };

  } catch (err) {
    log('❌ ERRO: ' + err.message, 'err');
    return { success: false, logs, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  HANDLER PRINCIPAL — Router por action
// ════════════════════════════════════════════════════════════════
module.exports = async function gtmHandler(req, res) {
  // Obtém token da sessão (nunca do frontend)
  const token = req.session?.googleToken;

  if (!token) {
    return res.status(401).json({ error: 'Google não autenticado. Faça login primeiro.' });
  }

  const action = req.params.action || req.url.split('/').pop();

  try {
    switch (action) {
      case 'accounts': {
        const accounts = await listAccounts(token);
        return res.json({ accounts });
      }

      case 'find-container': {
        const { gtmId } = req.body;
        if (!gtmId) return res.status(400).json({ error: 'gtmId é obrigatório' });
        const result = await findContainer(token, gtmId);
        return res.json(result);
      }

      case 'run-full-setup': {
        const { gtmId, pixelId, clientName, thankUrl, domain } = req.body;
        if (!gtmId || !pixelId) {
          return res.status(400).json({ error: 'gtmId e pixelId são obrigatórios' });
        }
        const result = await runFullSetup(token, { gtmId, pixelId, clientName, thankUrl, domain });
        return res.json(result);
      }

      default:
        return res.status(404).json({ error: `Ação GTM desconhecida: ${action}` });
    }
  } catch (err) {
    console.error('[gtm]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
