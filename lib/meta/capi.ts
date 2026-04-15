/**
 * Stub para o cliente da CAPI do Meta
 */
export async function sendToMetaCAPI(pixelId: string, accessToken: string, eventData: any) {
  // Envia eventos comuns para a CAPI
  // Implementação real exigiria formatar para o padrão Meta (data[], test_event_code etc)
  console.log('Sending event to Meta CAPI:', { pixelId, eventData: eventData.event_name });
  return true;
}

export async function sendConversionToMetaCAPI(clientId: string, conversionData: any) {
  // Envia Purchase/Conversões para a CAPI
  console.log('Sending conversion to Meta CAPI for client:', clientId);
  return true;
}
