module.exports = async function handler(req, res) {
  try {
    // ============================================================
    // 1. TOKEN OAUTH GOTO
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
      req.query.id || "241899fc-3b66-3439-a720-70e7865930cb";

    // ============================================================
    // 3. CALL EVENTS REPORT
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

    if (!response.ok) {
      return res.status(200).json({
        success: false,
        gotoStatus: response.status,
        conversationSpaceId,
        resposta: data
      });
    }

    // ============================================================
    // 4. PROCURA RECURSIVA POR CAMPOS IMPORTANTES
    // ============================================================

    const encontrados = [];

    const palavrasImportantes = [
      "recording",
      "recordings",
      "recordingid",
      "transcript",
      "transcripts",
      "transcriptid",
      "livetranscript",
      "livetranscripts",
      "caption",
      "captions",
      "info_capture",
      "appointment",
      "scheduling",
      "agendamento",
      "horario",
      "horário",
      "air_",
      "ai_insight"
    ];

    function procurar(valor, caminho = "root") {
      if (valor === null || valor === undefined) {
        return;
      }

      if (typeof valor === "string") {
        const texto = valor.toLowerCase();

        if (
          palavrasImportantes.some((palavra) =>
            texto.includes(palavra)
          )
        ) {
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

          if (
            palavrasImportantes.some((palavra) =>
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
    // 5. PARTICIPANTES COMPLETOS COM DADOS DE GRAVAÇÃO
    // ============================================================

    const participants =
      Array.isArray(data?.participants)
        ? data.participants.map((participant) => ({
            id: participant?.id || null,
            type: participant?.type || null,
            status: participant?.status || null,

            recordings: participant?.recordings || [],

            transcripts: participant?.transcripts || [],

            liveTranscripts: participant?.liveTranscripts || [],

            raw: participant
          }))
        : [];

    // ============================================================
    // 6. RESPOSTA
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
        quantidadeActions:
          Array.isArray(data?.actions)
            ? data.actions.length
            : 0,
        quantidadeParticipantes:
          Array.isArray(data?.participants)
            ? data.participants.length
            : 0
      },

      actions: data?.actions || [],

      recordings: data?.recordings || [],

      transcripts: data?.transcripts || [],

      liveTranscripts: data?.liveTranscripts || [],

      participants,

      encontrados
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};