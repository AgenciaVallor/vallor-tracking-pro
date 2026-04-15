import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabase/admin';
import { sendToMetaCAPI } from '@/lib/meta/capi';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Validar dados obrigatórios
    const { script_key, event_name, event_time, event_id } = body;
    if (!script_key || !event_name || !event_time) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Resolver tenant por script_key
    const { data: clientDomain, error: clientError } = await adminSupabase
      .from('client_domains')
      .select(`
        client_id,
        agency_id,
        clients!inner(
          id,
          name,
          meta_pixel_id,
          meta_access_token
        )
      `)
      .eq('script_key', script_key)
      .single();

    if (clientError || !clientDomain) {
      return NextResponse.json(
        { error: 'Invalid script_key' },
        { status: 404 }
      );
    }

    const clientId = clientDomain.client_id;
    const agencyId = clientDomain.agency_id;

    // Capturar IP real (considerar proxies)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
               request.headers.get('x-real-ip') ||
               'unknown';

    // Buscar ou criar visitante
    let visitorId = null;

    // 1. Tentar encontrar por fbp (mais confiável)
    if (body.fbp) {
      const { data: existingVisitor } = await adminSupabase
        .from('visitors')
        .select('id')
        .eq('client_id', clientId)
        .eq('fbp', body.fbp)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .single();
        
      if (existingVisitor) {
        visitorId = existingVisitor.id;
        // Atualizar last_seen_at
        await adminSupabase
          .from('visitors')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', visitorId);
      }
    }

    // 2. Se não encontrou, criar novo visitante
    if (!visitorId) {
      const { data: newVisitor } = await adminSupabase
        .from('visitors')
        .insert({
          agency_id: agencyId,
          client_id: clientId,
          fbp: body.fbp,
          fbc: body.fbc,
          ip: ip,
          user_agent: body.user_agent,
          fingerprint: body.fingerprint,
          fingerprint_hash: body.fingerprint_hash,
          landing_url: body.url,
          referrer: body.referrer,
          utm_source: body.utm_source,
          utm_medium: body.utm_medium,
          utm_campaign: body.utm_campaign,
          utm_content: body.utm_content,
          utm_term: body.utm_term
        })
        .select('id')
        .single();
        
      if (newVisitor) {
        visitorId = newVisitor.id;
      }
    }

    // Buscar campanha se UTM estiver presente
    let campaignId = null;
    if (body.utm_campaign) {
      const { data: campaign } = await adminSupabase
        .from('campaigns')
        .select('id')
        .eq('client_id', clientId)
        .or(`source.eq.${body.utm_source},name.ilike.%${body.utm_campaign}%`)
        .limit(1)
        .single();
      if (campaign) {
        campaignId = campaign.id;
      }
    }

    // Inserir evento
    const { data: event, error: eventError } = await adminSupabase
      .from('tracking_events')
      .insert({
        agency_id: agencyId,
        client_id: clientId,
        visitor_id: visitorId,
        campaign_id: campaignId,
        event_name: event_name,
        event_time: new Date(event_time * 1000).toISOString(),
        event_id: event_id || `ev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source_url: request.headers.get('referer'),
        page_url: body.url,
        referrer: body.referrer,
        ip: ip,
        user_agent: body.user_agent,
        fingerprint_hash: body.fingerprint_hash,
        external_id: body.external_id,
        click_id: body.fbclid || body.gclid,
        fbp: body.fbp,
        fbc: body.fbc,
        utm_source: body.utm_source,
        utm_medium: body.utm_medium,
        utm_campaign: body.utm_campaign,
        utm_content: body.utm_content,
        utm_term: body.utm_term,
        properties: body.properties || {}
      })
      .select()
      .single();

    if (eventError) {
      console.error('Error inserting event:', eventError);
      // Se for erro de duplicação, retornar sucesso
      if (eventError.code === '23505') { // unique_violation
        return NextResponse.json({
          success: true,
          event_id: event_id,
          message: 'Event already recorded (duplicate)'
        });
      }
      throw eventError;
    }

    // Enviar para Meta CAPI (async, não bloquear resposta)
    // Usando uma checagem local sem bloquear
    if (clientDomain.clients[0]?.meta_access_token && clientDomain.clients[0]?.meta_pixel_id) {
      sendToMetaCAPI(
        clientDomain.clients[0].meta_pixel_id,
        clientDomain.clients[0].meta_access_token,
        event
      ).catch(err => {
        console.error('Error sending to Meta CAPI:', err);
      });
    }

    return NextResponse.json({
      success: true,
      event_id: event.event_id,
      message: 'Event tracked successfully'
    });
  } catch (error) {
    console.error('Tracking error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Opções de CORS
export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
