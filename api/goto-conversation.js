module.exports = async function handler(req, res) {
  try {
    const cookies = req.headers.cookie || "";
    const match = cookies.match(/goto_access_token=([^;]+)/);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Token GoTo não encontrado. Acesse /api/goto-auth novamente."
      });
    }

    const accessToken = decodeURIComponent(match[1]);

    const conversationSpaceId =
      req.query.id || "0694093a-b82d-3815-8023-595ede98dad1";

    const url =
      "https://api.goto.com/call-events-report/v1/reports/" +
      encodeURIComponent(conversationSpaceId);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    // Procura recursivamente qualquer informação relacionada
    // à IA Recepcionista, agendamento, appointment, scheduling etc.
    const encontrados = [];

    function procurar(valor, caminho = "root") {
      if (valor === null || valor === undefined) return;

      if (typeof valor === "string") {
        const texto = valor.toLowerCase();

        const palavras = [
          "air_",
          "ai_insight",
          "appointment",
          "scheduling",
          "schedule",
          "agendamento",
          "horario",
          "horário",
          "receptionist",
          "virtualreceptionist"
        ];

        if (palavras.some(p => texto.includes(p))) {
          encontrados.push({
            caminho,
            valor
          });
        }

        return;
      }

      if (Array.isArray(valor)) {
        valor.forEach((item, index) => {
          procurar(item, `${caminho}[${index}]`);
        });
        return;
      }

      if (typeof valor === "object") {
        Object.entries(valor).forEach(([chave, conteudo]) => {
          const chaveLower = chave.toLowerCase();

          const palavras = [
            "air",
            "ai",
            "appointment",
            "scheduling",
            "schedule",
            "agendamento",
            "horario",
            "receptionist"
          ];

          if (palavras.some(p => chaveLower.includes(p))) {
            encontrados.push({
              caminho: `${caminho}.${chave}`,
              valor: conteudo
            });
          }

          procurar(conteudo, `${caminho}.${chave}`);
        });
      }
    }

    procurar(data);

    return res.status(200).json({
      success: true,
      conversationSpaceId,

      resumo: {
        callCreated: data?.callCreated,
        callEnded: data?.callEnded,
        direction: data?.direction,
        accountKey: data?.accountKey,
        callReason: data?.callReason,
        quantidadeEstados: data?.callStates?.length || 0
      },

      encontrados
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};