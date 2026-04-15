import { adminSupabase } from '@/lib/supabase/admin';
import crypto from 'crypto';

interface AttributionData {
  email?: string;
  phone?: string;
  ip?: string;
  fbp?: string;
  fbc?: string;
  fingerprint?: string;
  external_id?: string;
}

interface AttributionResult {
  visitor_id: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  method: string; // fbc, fbp, email, ip, fingerprint, external_id
}

/**
 * Atribui uma conversão a um visitante usando múltiplos métodos
 * @param clientId - ID do cliente
 * @param data - Dados para match
 * @returns Resultado da atribuição ou null se não encontrou
 */
export async function attributeConversion(
  clientId: string,
  data: AttributionData
): Promise<AttributionResult | null> {
  // Janela de atribuição: 30 dias
  const attributionWindow = new Date();
  attributionWindow.setDate(attributionWindow.getDate() - 30);

  // 1. Tentar match por fbc (Facebook Click ID) - PRIORIDADE MÁXIMA
  if (data.fbc) {
    const { data: visitor } = await adminSupabase
      .from('visitors')
      .select('id, campaign_id, utm_campaign')
      .eq('client_id', clientId)
      .eq('fbc', data.fbc)
      .gte('last_seen_at', attributionWindow.toISOString())
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .single();

    if (visitor) {
      const campaignData = await getCampaignData(clientId, visitor.utm_campaign);
      return {
        visitor_id: visitor.id,
        campaign_id: campaignData?.campaign_id,
        adset_id: campaignData?.adset_id,
        ad_id: campaignData?.ad_id,
        method: 'fbc'
      };
    }
  }

  // 2. Tentar match por fbp (Facebook Browser ID)
  if (data.fbp) {
    const { data: visitor } = await adminSupabase
      .from('visitors')
      .select('id, campaign_id, utm_campaign')
      .eq('client_id', clientId)
      .eq('fbp', data.fbp)
      .gte('last_seen_at', attributionWindow.toISOString())
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .single();

    if (visitor) {
      const campaignData = await getCampaignData(clientId, visitor.utm_campaign);
      return {
        visitor_id: visitor.id,
        campaign_id: campaignData?.campaign_id,
        adset_id: campaignData?.adset_id,
        ad_id: campaignData?.ad_id,
        method: 'fbp'
      };
    }
  }

  // 3. Tentar match por email_hash
  if (data.email) {
    const emailHash = crypto.createHash('sha256')
      .update(data.email.toLowerCase().trim())
      .digest('hex');
      
    const { data: visitor } = await adminSupabase
      .from('visitors')
      .select('id, campaign_id, utm_campaign')
      .eq('client_id', clientId)
      .eq('email_hash', emailHash)
      .gte('last_seen_at', attributionWindow.toISOString())
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .single();

    if (visitor) {
      const campaignData = await getCampaignData(clientId, visitor.utm_campaign);
      return {
        visitor_id: visitor.id,
        campaign_id: campaignData?.campaign_id,
        adset_id: campaignData?.adset_id,
        ad_id: campaignData?.ad_id,
        method: 'email'
      };
    }
  }

  // 4. Tentar match por IP + User Agent (menos confiável)
  if (data.ip) {
    const { data: visitor } = await adminSupabase
      .from('visitors')
      .select('id, campaign_id, utm_campaign')
      .eq('client_id', clientId)
      .eq('ip', data.ip)
      .gte('last_seen_at', attributionWindow.toISOString())
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .single();

    if (visitor) {
      const campaignData = await getCampaignData(clientId, visitor.utm_campaign);
      return {
        visitor_id: visitor.id,
        campaign_id: campaignData?.campaign_id,
        adset_id: campaignData?.adset_id,
        ad_id: campaignData?.ad_id,
        method: 'ip'
      };
    }
  }

  // 5. Tentar match por fingerprint
  if (data.fingerprint) {
    const fingerprintHash = crypto.createHash('sha256')
      .update(data.fingerprint)
      .digest('hex');
      
    const { data: visitor } = await adminSupabase
      .from('visitors')
      .select('id, campaign_id, utm_campaign')
      .eq('client_id', clientId)
      .eq('fingerprint_hash', fingerprintHash)
      .gte('last_seen_at', attributionWindow.toISOString())
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .single();

    if (visitor) {
      const campaignData = await getCampaignData(clientId, visitor.utm_campaign);
      return {
        visitor_id: visitor.id,
        campaign_id: campaignData?.campaign_id,
        adset_id: campaignData?.adset_id,
        ad_id: campaignData?.ad_id,
        method: 'fingerprint'
      };
    }
  }

  // 6. Tentar match por external_id (se disponível)
  if (data.external_id) {
    const { data: visitor } = await adminSupabase
      .from('visitors')
      .select('id, campaign_id, utm_campaign')
      .eq('client_id', clientId)
      .eq('external_id', data.external_id)
      .gte('last_seen_at', attributionWindow.toISOString())
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .single();

    if (visitor) {
      const campaignData = await getCampaignData(clientId, visitor.utm_campaign);
      return {
        visitor_id: visitor.id,
        campaign_id: campaignData?.campaign_id,
        adset_id: campaignData?.adset_id,
        ad_id: campaignData?.ad_id,
        method: 'external_id'
      };
    }
  }

  // Não encontrou correspondência
  return null;
}

/**
 * Busca dados da campanha por nome ou ID
 */
async function getCampaignData(clientId: string, utmCampaign?: string) {
  if (!utmCampaign) return null;
  
  const { data: campaign } = await adminSupabase
    .from('campaigns')
    .select(`
      id,
      adsets(id, ads(id))
    `)
    .eq('client_id', clientId)
    .or(`name.ilike.%${utmCampaign}%,source.eq.${utmCampaign}`)
    .limit(1)
    .single();

  if (!campaign) return null;

  return {
    campaign_id: campaign.id,
    adset_id: campaign.adsets?.[0]?.id,
    ad_id: campaign.adsets?.[0]?.ads?.[0]?.id
  };
}
