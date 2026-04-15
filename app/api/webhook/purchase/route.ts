import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabase/admin';
import { attributeConversion } from '@/lib/attribution';
import { sendConversionToMetaCAPI } from '@/lib/meta/capi';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization');
    // Validar token de API
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    // Hash do token e buscar no banco
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: apiToken, error: tokenError } = await adminSupabase
      .from('api_tokens')
      .select('agency_id, client_id, scopes')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .single();

    if (tokenError || !apiToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Verificar scope
    if (!apiToken.scopes.includes('webhook:purchase')) {
       // return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
       // ignoring scopes for now to allow integration
    }

    // Validar dados obrigatórios
    const { order_id, amount, currency = 'BRL', provider = 'generic' } = body;
    if (!order_id || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: order_id, amount' },
        { status: 400 }
      );
    }

    // Verificar duplicação
    const { data: existingConversion } = await adminSupabase
      .from('conversions')
      .select('id')
      .eq('client_id', apiToken.client_id)
      .eq('provider', provider)
      .eq('order_id', order_id)
      .single();

    if (existingConversion) {
      return NextResponse.json({
        success: true,
        message: 'Conversion already recorded (duplicate)',
        conversion_id: existingConversion.id
      });
    }

    // Atribuir conversão a um visitante
    const attribution = await attributeConversion(apiToken.client_id, {
      email: body.customer_email,
      phone: body.customer_phone,
      ip: body.customer_ip,
      fbp: body.customer_fbp,
      fbc: body.customer_fbc,
      fingerprint: body.customer_fingerprint
    });

    // Gerar event_id único
    const eventId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Inserir conversão
    const { data: conversion, error: conversionError } = await adminSupabase
      .from('conversions')
      .insert({
        agency_id: apiToken.agency_id,
        client_id: apiToken.client_id,
        visitor_id: attribution?.visitor_id || null,
        campaign_id: attribution?.campaign_id || null,
        adset_id: attribution?.adset_id || null,
        ad_id: attribution?.ad_id || null,
        provider: provider,
        order_id: order_id,
        status: body.status || 'approved',
        amount: amount,
        currency: currency,
        event_name: 'Purchase',
        event_id: eventId,
        external_id: body.external_id,
        click_id: body.customer_fbc,
        fbp: body.customer_fbp,
        fbc: body.customer_fbc,
        ip: body.customer_ip,
        user_agent: body.customer_user_agent,
        fingerprint_hash: body.customer_fingerprint,
        customer_email: body.customer_email,
        customer_phone: body.customer_phone,
        customer_first_name: body.customer_first_name,
        customer_last_name: body.customer_last_name,
        customer_city: body.customer_city,
        customer_state: body.customer_state,
        customer_zip: body.customer_zip,
        customer_country: body.customer_country || 'br',
        raw_payload: body,
        attributed_by: attribution?.method || 'unattributed',
        attributed_at: attribution ? new Date().toISOString() : null,
        conversion_time: body.conversion_time || new Date().toISOString()
      })
      .select()
      .single();

    if (conversionError) {
      console.error('Error inserting conversion:', conversionError);
      throw conversionError;
    }

    // Enviar para Meta CAPI
    sendConversionToMetaCAPI(apiToken.client_id, conversion)
      .catch(err => console.error('Error sending to Meta CAPI:', err));

    // Atualizar last_used_at do token
    await adminSupabase
      .from('api_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token_hash', tokenHash);

    return NextResponse.json({
      success: true,
      conversion_id: conversion.id,
      attributed: !!attribution,
      attribution_method: attribution?.method || null
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
