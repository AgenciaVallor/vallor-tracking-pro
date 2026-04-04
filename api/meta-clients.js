require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const META_BASE = 'https://graph.facebook.com/v19.0';

async function verifyAuth(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('Unauthorized');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

module.exports = async function metaClientsHandler(req, res) {
  try {
    const user = await verifyAuth(req);

    // Identificar a rota
    let path = req.url.split('?')[0];
    if (path.startsWith('/api/meta/')) {
      path = path.replace('/api/meta/', '');
    }

    const metaToken = req.session?.metaToken;
    if (!metaToken) {
      return res.status(401).json({ error: 'Meta não autenticada no servidor. Faça login com a Meta.' });
    }

    if (path.startsWith('bm/overview')) {
      const bmsResp = await axios.get(`${META_BASE}/me/businesses`, {
        params: { fields: 'id,name,profile_picture_uri', access_token: metaToken }
      });
      const businesses = bmsResp.data.data || [];
      const resultBusinesses = [];

      for (const biz of businesses) {
        const adAccountsMap = new Map();

        const fetchAccounts = async (edge) => {
          try {
            const accResp = await axios.get(`${META_BASE}/${biz.id}/${edge}`, {
              params: {
                fields: 'id,name,account_status,currency',
                access_token: metaToken
              }
            });
            const accs = accResp.data.data || [];
            for (const a of accs) {
              if (!adAccountsMap.has(a.id)) {
                adAccountsMap.set(a.id, {
                  id: a.id,
                  name: a.name || 'Conta sem nome',
                  status: a.account_status,
                  currency: a.currency,
                  insights: { spend: "0.00", impressions: 0, clicks: 0, cpc: "0.00", cpm: "0.00", leads: 0, purchases: 0, roas: 0 }
                });
              }
            }
          } catch (e) {
            console.error(`Erro BM ${biz.id} ${edge}:`, e.response?.data || e.message);
          }
        };

        await fetchAccounts('owned_ad_accounts');
        await fetchAccounts('client_ad_accounts');

        const adAccounts = Array.from(adAccountsMap.values());

        if (adAccounts.length > 0) {
          await Promise.allSettled(adAccounts.map(async (acc) => {
            try {
              const insResp = await axios.get(`${META_BASE}/${acc.id}/insights`, {
                params: {
                  fields: 'spend,impressions,clicks,cpc,cpm,actions,action_values',
                  date_preset: 'last_30d',
                  access_token: metaToken
                }
              });
              const data = insResp.data;
              if (data.data && data.data.length > 0) {
                const d = data.data[0];
                const spend = parseFloat(d.spend || 0);
                let conversions = 0, purchases = 0, purchaseValue = 0;
                
                const actions = d.actions || [];
                const actionValues = d.action_values || [];
                
                const leadsEvent = actions.find(a => a.action_type === 'lead');
                if (leadsEvent) conversions = parseInt(leadsEvent.value);
                
                const purchaseEvent = actions.find(a => a.action_type === 'purchase');
                if (purchaseEvent) purchases = parseInt(purchaseEvent.value);
                
                const purchaseValueObj = actionValues.find(a => a.action_type === 'purchase');
                if (purchaseValueObj) purchaseValue = parseFloat(purchaseValueObj.value);
                
                acc.insights = {
                  spend: spend.toFixed(2),
                  impressions: parseInt(d.impressions || 0),
                  clicks: parseInt(d.clicks || 0),
                  cpc: parseFloat(d.cpc || 0).toFixed(2),
                  cpm: parseFloat(d.cpm || 0).toFixed(2),
                  leads: conversions,
                  purchases: purchases,
                  roas: spend > 0 ? parseFloat((purchaseValue / spend).toFixed(2)) : 0
                };
              }
            } catch (e) {
               console.error(`Erro Insights ${acc.id}:`, e.response?.data || e.message);
            }
          }));
        }

        resultBusinesses.push({
          id: biz.id,
          name: biz.name,
          profile_picture_uri: biz.profile_picture_uri,
          adAccounts
        });
      }

      return res.json({ success: true, businesses: resultBusinesses });
    }

    if (path.startsWith('bm/accounts')) {
      const resp = await axios.get(`${META_BASE}/me/businesses`, {
        params: {
          fields: 'id,name,ad_accounts{id,name,account_status,currency}',
          access_token: metaToken
        }
      });
      const data = resp.data;
      
      const accounts = [];
      if (data.data) {
        for (const biz of data.data) {
          if (biz.ad_accounts && biz.ad_accounts.data) {
            accounts.push(...biz.ad_accounts.data.map(a => ({
              id: a.id,
              name: a.name,
              status: a.account_status,
              currency: a.currency,
              bm_id: biz.id,
              bm_name: biz.name
            })));
          }
        }
      }
      return res.json({ accounts });
    }

    if (path.startsWith('pixels/')) {
      const accountId = path.split('/')[1];
      const resp = await axios.get(`${META_BASE}/${accountId}/adspixels`, {
        params: {
          fields: 'id,name,last_fired_time',
          access_token: metaToken
        }
      });
      return res.json({ pixels: resp.data.data || [] });
    }

    if (path.startsWith('insights/')) {
      const accountId = path.split('/')[1];
      const datePreset = req.query.date_preset || 'last_7d';
      const fields = 'spend,impressions,clicks,cpc,cpm,actions,action_values,reach,frequency';
      
      const resp = await axios.get(`${META_BASE}/${accountId}/insights`, {
        params: {
          fields,
          date_preset: datePreset,
          access_token: metaToken
        }
      });
      const data = resp.data;
      
      let summary = {
        spend: 0, impressions: 0, clicks: 0, 
        cpc: 0, cpm: 0, cpl: 0, roas: 0, conversions: 0, reach: 0, frequency: 0
      };

      if (data.data && data.data.length > 0) {
        const d = data.data[0];
        summary.spend = parseFloat(d.spend || 0);
        summary.impressions = parseInt(d.impressions || 0);
        summary.clicks = parseInt(d.clicks || 0);
        summary.cpc = parseFloat(d.cpc || 0);
        summary.cpm = parseFloat(d.cpm || 0);
        summary.reach = parseInt(d.reach || 0);
        summary.frequency = parseFloat(d.frequency || 0);

        const actions = d.actions || [];
        const leadsEvent = actions.find(a => a.action_type === 'lead');
        summary.conversions = leadsEvent ? parseInt(leadsEvent.value) : 0;
        
        const actionValues = d.action_values || [];
        const purchaseValueObj = actionValues.find(a => a.action_type === 'purchase');
        const purchaseValue = purchaseValueObj ? parseFloat(purchaseValueObj.value) : 0;

        summary.cpl = summary.conversions > 0 ? summary.spend / summary.conversions : 0;
        summary.roas = summary.spend > 0 ? purchaseValue / summary.spend : 0;
      }
      return res.json({ insights: summary });
    }

    if (path.startsWith('pixel-quality/')) {
      const pixelId = path.split('/')[1];
      const resp = await axios.get(`${META_BASE}/${pixelId}/stats`, {
        params: { access_token: metaToken }
      });
      return res.json({ emq_score: resp.data.data || {} });
    }

    return res.status(404).json({ error: 'Endpoint não encontrado em meta-clients.' });
  } catch (err) {
    const status = err.message === 'Unauthorized' ? 401 : 500;
    const errorMsg = err.response?.data?.error?.message || err.message;
    return res.status(status).json({ error: errorMsg });
  }
};

