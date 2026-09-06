module.exports = async function handler(req, res) {
  try {
    // ============================
    // 1. Validar API Key
    // ============================
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.GOTO_API_KEY;

    if (!expectedKey) {
      return res.status(500).json({
        success: false,
        error: "GOTO_API_KEY não configurada no servidor"
      });
    }

    if (!apiKey || apiKey !== expectedKey) {
      return res.status(401).json({
        success: false,
        error: "API Key inválida"
      });
    }

    // ============================
    // 2. Aceitar somente POST
    // ============================
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido. Use POST."
      });
    }

    // ============================
    // 3. Dados recebidos do GoTo
    // ============================
    const data = req.body?.data || "2026-09-08";
    const horario = req.body?.horario;
    const nome = req.body?.nome || "Cliente GoTo";

    if (!horario) {
      return res.status(400).json({
        success: false,
        error: "Horário não informado"
      });
    }

    // ============================
    // 4. Configurações Azure / Graph
    // ============================
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    // Object ID do usuário agenda
    const mailboxId = "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

    if (!tenantId || !clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        error: "Variáveis do Azure não configuradas"
      });
    }

    // ============================
    // 5. Obter token do Graph
    // ============================
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
        error: "Erro ao obter token do Microsoft Graph",
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // ============================
    // 6. Montar início/fim
    // ============================
    const [hora, minuto] = horario.split(":").map(Number);

    const inicio = `${data}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00`;

    const fimDate = new Date(
      `${data}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00-03:00`
    );

    fimDate.setHours(fimDate.getHours() + 1);

    const fim =
      `${fimDate.getFullYear()}-` +
      `${String(fimDate.getMonth() + 1).padStart(2, "0")}-` +
      `${String(fimDate.getDate()).padStart(2, "0")}T` +
      `${String(fimDate.getHours()).padStart(2, "0")}:` +
      `${String(fimDate.getMinutes()).padStart(2, "0")}:00`;

    // ============================
    // 7. Conferir se ainda está livre
    // ============================
    const inicioConsulta = `${data}T${horario}:00-03:00`;

    const fimConsultaDate = new Date(inicioConsulta);
    fimConsultaDate.setHours(fimConsultaDate.getHours() + 1);

    const fimConsulta = fimConsultaDate.toISOString();

    const calendarUrl =
      `https://graph.microsoft.com/v1.0/users/${mailboxId}` +
      `/calendarView?startDateTime=${encodeURIComponent(inicioConsulta)}` +
      `&endDateTime=${encodeURIComponent(fimConsulta)}`;

    const calendarResponse = await fetch(calendarUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="E. South America Standard Time"'
      }
    });

    const calendarData = await calendarResponse.json();

    if (!calendarResponse.ok) {
      return res.status(calendarResponse.status).json({
        success: false,
        error: "Erro ao verificar disponibilidade",
        details: calendarData
      });
    }

    if ((calendarData.value || []).length > 0) {
      return res.status(409).json({
        success: false,
        disponivel: false,
        error: "Esse horário não está mais disponível",
        mensagem:
          "Desculpe, esse horário acabou de ficar indisponível. Vamos consultar outros horários."
      });
    }

    // ============================
    // 8. Criar evento
    // ============================
    const evento = {
      subject: `Agendamento GoTo - ${nome}`,
      body: {
        contentType: "Text",
        content: "Agendamento criado automaticamente pela integração GoTo."
      },
      start: {
        dateTime: inicio,
        timeZone: "E. South America Standard Time"
      },
      end: {
        dateTime: fim,
        timeZone: "E. South America Standard Time"
      },
      showAs: "busy"
    };

    const createResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${mailboxId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(evento)
      }
    );

    const createdEvent = await createResponse.json();

    if (!createResponse.ok) {
      return res.status(createResponse.status).json({
        success: false,
        error: "Erro ao criar evento",
        details: createdEvent
      });
    }

    // ============================
    // 9. Resposta para o GoTo
    // ============================
    return res.status(200).json({
      success: true,
      data,
      horario,
      mensagem:
        `Pronto. Seu agendamento foi realizado para ${horario}.`,
      eventoId: createdEvent.id
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};