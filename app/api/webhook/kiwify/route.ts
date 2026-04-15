import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const signature = request.headers.get('x-kiwify-signature');

    // Log do webhook
    await adminSupabase.from('webhook_logs').insert({
      provider: 'kiwify',
      event_type: body.event,
      external_event_id: body.order_id,
      status: 'received',
      request_headers: Object.fromEntries(request.headers.entries()),
      payload: body
    });

    // Mapear payload Kiwify para formato padrão
    const mappedData = {
      order_id: body.order_id,
      amount: body.amount || body.value,
      currency: body.currency || 'BRL',
      status: mapKiwifyStatus(body.status),
      customer_email: body.Customer?.email,
      customer_phone: body.Customer?.phone,
      customer_first_name: body.Customer?.first_name,
      customer_last_name: body.Customer?.last_name,
      customer_ip: body.Customer?.ip,
      customer_fbp: body.Customer?.fbp,
      customer_fbc: body.Customer?.fbc,
      product_name: body.Product?.name,
      product_id: body.Product?.id,
      provider: 'kiwify',
      conversion_time: body.created_at || new Date().toISOString()
    };

    // Encaminhar para webhook genérico
    const token = await getClientTokenByKiwifyConfig(body.Product?.id);
    
    // In a real env, we might directly process it here to avoid a self-fetch, but keeping architecture intact
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhook/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(mappedData)
    });

    const result = await response.json();

    // Atualizar log
    await adminSupabase
      .from('webhook_logs')
      .update({
        status: result.success ? 'processed' : 'error',
        response_body: result
      })
      .eq('external_event_id', body.order_id)
      .eq('provider', 'kiwify');

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Kiwify webhook error:', error);
    await adminSupabase.from('webhook_logs').update({
      status: 'error',
      error_message: error.message
    }).eq('provider', 'kiwify');

    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

function mapKiwifyStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'paid': 'paid',
    'approved': 'approved',
    'refunded': 'refunded',
    'cancelled': 'cancelled',
    'chargeback': 'chargeback'
  };
  return statusMap[status?.toLowerCase()] || 'pending';
}

async function getClientTokenByKiwifyConfig(productId: string): Promise<string> {
  // Implementar lógica para buscar token baseado na configuração do cliente
  // Por exemplo, o cliente pode ter configurado o product_id na tabela de configurações
  const { data } = await adminSupabase
    .from('api_tokens')
    .select('token_hash')
    .limit(1)
    .single();
    
  return data?.token_hash || '';
}
