module.exports = async function handler(req, res) {
  try {
    // ============================================================
    // 1. RECUPERA TOKEN OAUTH DO GOTO
    // ============================================================

    const cookies = req.headers.cookie || "";
    const match = cookies.match(/goto_access_token=([^;]+)/);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Token GoTo não encontrado. Acesse /api/goto-auth novamente."
      });
    }

    const accessToken = decodeURIComponent(match[1]);

    // ============================================================
    // 2. CONVERSATION SPACE ID
    // ============================================================

    const conversationSpaceId =
      req.query.id || "0694093a-b82d-3815-8023-595ede98dad1";

    // ============================================================
    // 3. CONSULTA O CALL EVENTS REPORT
    // ============================================================

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

    // ============================================================
    // 4. TRATAMENTO DE ERRO DA API GOTO
    // ============================================================

    if (!response.ok) {
      return res.status(200).json({
        success: false,
        gotoStatus: response.status,
        conversationSpaceId,
        resposta: data
      });
    }

    // ============================================================
    // 5. BUSCA RECURSIVA POR DADOS RELACIONADOS À IA/AGENDAMENTO
    // ============================================================

    const encontrados = [];

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
      "virtualreceptionist",
      "form",
      "capture",
      "captured"
    ];

    function procurar(valor, caminho = "root") {
      if (valor === null || valor === undefined) {
        return;
      }

      // ----------------------------------------------------------
      // STRING
      // ----------------------------------------------------------

      if (typeof valor === "string") {
        const texto = valor.toLowerCase();

        if (palavras.some((palavra) => texto.includes(palavra))) {
          encontrados.push({
            caminho,
            valor
          });
        }

        return;
      }

      // ----------------------------------------------------------
      // ARRAY
      // ----------------------------------------------------------

      if (Array.isArray(valor)) {
        valor.forEach((item, index) => {
          procurar(item, `${caminho}[${index}]`);
        });

        return;
      }

      // ----------------------------------------------------------
      // OBJETO
      // ----------------------------------------------------------

      if (typeof valor === "object") {
        Object.entries(valor).forEach(([chave, conteudo]) => {
          const chaveLower = chave.toLowerCase();

          if (
            palavras.some((palavra) =>
              chaveLower.includes(palavra)
            )
          ) {
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

    // ============================================================
    // 6. PARTICIPANTES
    // ============================================================

    const participantes =
      Array.isArray(data?.participants)
        ? data.participants.map((participant) => ({
            id: participant?.id || null,
            type: participant?.type || null,
            transcripts: participant?.transcripts || [],
            liveTranscripts: participant?.liveTranscripts || []
          }))
        : [];

    // ============================================================
    // 7. RESPOSTA DE DIAGNÓSTICO
    // ============================================================

    return res.status(200).json({
      success: true,

      conversationSpaceId,

      resumo: {
        callCreated: data?.callCreated || null,
        callEnded: data?.callEnded || null,
        direction: data?.direction || null,
        accountKey: data?.accountKey || null,
        callReason: data?.callReason || null,
        quantidadeEstados:
          Array.isArray(data?.callStates)
            ? data.callStates.length
            : 0,
        quantidadeActions:
          Array.isArray(data?.actions)
            ? data.actions.length
            : 0
      },

      // A parte mais importante agora:
      actions: data?.actions || [],

      // Caso o relatório tenha transcrição global:
      transcripts: data?.transcripts || [],

      // Caso a transcrição esteja associada aos participantes:
      participants: participantes,

      // Mantemos nossa busca anterior para não perder informação:
      encontrados
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};