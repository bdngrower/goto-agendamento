module.exports = async function handler(req, res) {
  try {
    // ============================
    // 1. Validar chamada do GoTo
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
    // 2. Configurações
    // ============================
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    // Object ID do usuário "agenda"
    const mailboxId = "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

    if (!tenantId || !clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        error: "Variáveis do Azure não configuradas"
      });
    }

    // Por enquanto usamos 08/09/2026 como padrão.
    // Depois essa data virá dinamicamente do GoTo.
    const data =
      req.body?.data ||
      req.query?.data ||
      "2026-09-08";

    // ============================
    // 3. Obter token do Graph
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

    // ============================
    // 4. Consultar calendário
    // ============================
    const startDateTime = `${data}T00:00:00-03:00`;

    const dataFinal = new Date(`${data}T12:00:00-03:00`);
    dataFinal.setDate(dataFinal.getDate() + 1);

    const ano = dataFinal.getFullYear();
    const mes = String(dataFinal.getMonth() + 1).padStart(2, "0");
    const dia = String(dataFinal.getDate()).padStart(2, "0");

    const proximoDia = `${ano}-${mes}-${dia}`;
    const endDateTime = `${proximoDia}T00:00:00-03:00`;

    const graphUrl =
      `https://graph.microsoft.com/v1.0/users/${mailboxId}` +
      `/calendarView?startDateTime=${encodeURIComponent(startDateTime)}` +
      `&endDateTime=${encodeURIComponent(endDateTime)}` +
      `&$select=subject,start,end,isAllDay`;

    const calendarResponse = await fetch(graphUrl, {
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

    // ============================
    // 5. Definir horários possíveis
    // ============================
    // Primeiro teste:
    // expediente de 09:00 até 17:00
    // compromissos de 1 hora.
    const horariosPossiveis = [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00"
    ];

    const eventos = calendarData.value || [];

    function horarioEstaLivre(horario) {
      const [hora, minuto] = horario.split(":").map(Number);

      const inicioSlot = new Date(
        `${data}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00-03:00`
      );

      const fimSlot = new Date(inicioSlot.getTime() + 60 * 60 * 1000);

      return !eventos.some(evento => {
        if (evento.isAllDay) {
          return true;
        }

        // O Graph está retornando horário no timezone solicitado.
        const inicioEvento = new Date(
          `${evento.start.dateTime}-03:00`
        );

        const fimEvento = new Date(
          `${evento.end.dateTime}-03:00`
        );

        // Há conflito quando os intervalos se sobrepõem.
        return inicioSlot < fimEvento && fimSlot > inicioEvento;
      });
    }

    const horariosLivres =
      horariosPossiveis.filter(horarioEstaLivre);

    // ============================
    // 6. Retorno amigável ao GoTo
    // ============================
    const selecionados = horariosLivres.slice(0, 4);

    function falarHorario(horario) {
      const [hora, minuto] = horario.split(":").map(Number);

      if (minuto === 0) {
        return hora === 12
          ? "meio-dia"
          : `${hora} horas`;
      }

      return `${hora} e ${minuto}`;
    }

    let mensagem;

    if (selecionados.length === 0) {
      mensagem =
        "Não encontrei horários disponíveis para essa data.";
    } else if (selecionados.length === 1) {
      mensagem =
        `Tenho disponibilidade às ${falarHorario(selecionados[0])}.`;
    } else {
      const falados = selecionados.map(falarHorario);

      const ultimo = falados.pop();

      mensagem =
        `Tenho disponibilidade às ${falados.join(", ")} ou ${ultimo}.`;
    }

    return res.status(200).json({
      success: true,
      data,
      disponivel: horariosLivres.length > 0,

      horario1: selecionados[0] || "",
      horario2: selecionados[1] || "",
      horario3: selecionados[2] || "",
      horario4: selecionados[3] || "",

      mensagem
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};