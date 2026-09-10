module.exports = async function handler(req, res) {
  try {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    const mailbox = "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

    if (!tenantId || !clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        error: "Variáveis do Azure não configuradas"
      });
    }

    // 1. Obter token no Microsoft Graph
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials"
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json({
        success: false,
        error: "Erro ao obter token",
        details: tokenData
      });
    }

    // 2. Definir o período que queremos consultar
    // Teste: dia 08/09/2026 inteiro no horário de Brasília
    const startDateTime = "2026-09-08T00:00:00-03:00";
    const endDateTime = "2026-09-09T00:00:00-03:00";

    const graphUrl =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
      `/calendarView?startDateTime=${encodeURIComponent(startDateTime)}` +
      `&endDateTime=${encodeURIComponent(endDateTime)}` +
      `&$select=subject,start,end,isAllDay`;

    // 3. Consultar o calendário
    const calendarResponse = await fetch(graphUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Prefer: 'outlook.timezone="E. South America Standard Time"'
      }
    });

    const calendarData = await calendarResponse.json();

    if (!calendarResponse.ok) {
      return res.status(calendarResponse.status).json({
        success: false,
        error: "Erro ao consultar calendário",
        details: calendarData
      });
    }

    // 4. Simplificar a resposta
    const eventos = (calendarData.value || []).map(evento => ({
      assunto: evento.subject,
      inicio: evento.start?.dateTime,
      fim: evento.end?.dateTime,
      fuso: evento.start?.timeZone,
      diaInteiro: evento.isAllDay
    }));

    return res.status(200).json({
      success: true,
      mailbox,
      data: "2026-09-08",
      quantidadeEventos: eventos.length,
      eventos
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};