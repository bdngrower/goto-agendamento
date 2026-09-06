const { waitUntil } = require("@vercel/functions");

const GOTO_ACCOUNT_KEY = "5316599808366110732";

const FORMULARIO_AGENDAMENTO =
  "Agendamento Microsoft 365";


// ============================================================
// PROTEÇÃO LOCAL CONTRA PROCESSAMENTO DUPLICADO
// ============================================================

const processando = new Set();


// ============================================================
// ESPERA
// ============================================================

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// ============================================================
// OBTÉM ACCESS TOKEN DO GOTO
// ============================================================

async function obterAccessTokenGoTo() {
  const clientId =
    process.env.GOTO_CLIENT_ID;

  const clientSecret =
    process.env.GOTO_CLIENT_SECRET;

  const refreshToken =
    process.env.GOTO_REFRESH_TOKEN;

  if (
    !clientId ||
    !clientSecret ||
    !refreshToken
  ) {
    throw new Error(
      "GOTO_CLIENT_ID, GOTO_CLIENT_SECRET ou GOTO_REFRESH_TOKEN não configurados"
    );
  }

  const basicAuth = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const response = await fetch(
    "https://authentication.logmeininc.com/oauth/token",
    {
      method: "POST",

      headers: {
        Authorization:
          `Basic ${basicAuth}`,

        "Content-Type":
          "application/x-www-form-urlencoded",

        Accept:
          "application/json"
      },

      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    }
  );

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Erro ao renovar token GoTo ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (!data?.access_token) {
    throw new Error(
      "GoTo não retornou access_token"
    );
  }

  return data.access_token;
}


// ============================================================
// CONSULTA CALL EVENTS REPORT
// ============================================================

async function consultarRelatorio(
  conversationSpaceId,
  accessToken
) {
  const url =
    "https://api.goto.com/call-events-report/v1/reports/" +
    encodeURIComponent(
      conversationSpaceId
    );

  const response =
    await fetch(url, {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        Accept:
          "application/json"
      }
    });

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status:
      response.status,

    ok:
      response.ok,

    data
  };
}


// ============================================================
// VERIFICA INFO_CAPTURE DO NOSSO FORMULÁRIO
// ============================================================

function possuiCapturaAgendamento(
  relatorio
) {
  const actions =
    Array.isArray(relatorio?.actions)
      ? relatorio.actions
      : [];

  return actions.some(
    (action) =>
      action?.type?.value ===
        "INFO_CAPTURE" &&

      action?.type?.form?.name ===
        FORMULARIO_AGENDAMENTO
  );
}


// ============================================================
// AGUARDA REPORT TER INFO_CAPTURE
// ============================================================

async function obterRelatorio(
  conversationSpaceId,
  accessToken
) {
  const maxTentativas = 10;
  const intervaloMs = 2000;

  let ultimoRelatorio = null;

  console.log(
    "Aguardando Call Events Report..."
  );

  await esperar(2000);

  for (
    let tentativa = 1;
    tentativa <= maxTentativas;
    tentativa++
  ) {
    console.log(
      `Call Events Report - tentativa ${tentativa}/${maxTentativas}`
    );

    const resultado =
      await consultarRelatorio(
        conversationSpaceId,
        accessToken
      );


    // ----------------------------------------------------------
    // AINDA NÃO EXISTE
    // ----------------------------------------------------------

    if (
      resultado.status === 404
    ) {
      console.log(
        "Report ainda não existe."
      );

      if (
        tentativa <
        maxTentativas
      ) {
        await esperar(
          intervaloMs
        );

        continue;
      }

      throw new Error(
        "Call Events Report permaneceu 404 até o limite"
      );
    }


    // ----------------------------------------------------------
    // OUTRO ERRO
    // ----------------------------------------------------------

    if (!resultado.ok) {
      throw new Error(
        `Erro Call Events Report ${resultado.status}: ${JSON.stringify(resultado.data)}`
      );
    }


    const relatorio =
      resultado.data;

    ultimoRelatorio =
      relatorio;


    const actions =
      Array.isArray(
        relatorio?.actions
      )
        ? relatorio.actions
        : [];


    const temInfoCapture =
      possuiCapturaAgendamento(
        relatorio
      );


    console.log(
      "Estado do Report:",
      JSON.stringify({
        tentativa,

        infoCapture:
          temInfoCapture,

        quantidadeActions:
          actions.length,

        callReason:
          typeof relatorio?.callReason ===
            "string"
      })
    );


    if (temInfoCapture) {
      console.log(
        "INFO_CAPTURE encontrado."
      );

      return relatorio;
    }


    if (
      tentativa <
      maxTentativas
    ) {
      await esperar(
        intervaloMs
      );
    }
  }


  return ultimoRelatorio;
}


// ============================================================
// CONVERTE VALOR PARA TEXTO PESQUISÁVEL
// ============================================================

function valorParaTexto(valor) {
  if (
    valor === null ||
    valor === undefined
  ) {
    return "";
  }

  if (
    typeof valor === "string"
  ) {
    return valor;
  }

  if (
    typeof valor === "number" ||
    typeof valor === "boolean"
  ) {
    return String(valor);
  }

  try {
    return JSON.stringify(valor);
  } catch {
    return "";
  }
}


// ============================================================
// PROCURA RECURSIVAMENTE DADOS INTERESSANTES
// ============================================================

function procurarDadosInteressantes(
  valor,
  caminho = "root",
  encontrados = []
) {
  if (
    valor === null ||
    valor === undefined
  ) {
    return encontrados;
  }


  const palavras = [
    "air_",
    "air",
    "ai_insight",
    "ai insight",
    "appointment",
    "scheduling",
    "schedule",
    "agendamento",
    "agendar",
    "horario",
    "horário",
    "transcript",
    "livetranscript",
    "recording",
    "receptionist",
    "virtualreceptionist",
    "virtual receptionist",
    "info_capture",
    "form",
    "eventid",
    "query",
    "conversation"
  ];


  // ----------------------------------------------------------
  // STRING
  // ----------------------------------------------------------

  if (
    typeof valor === "string"
  ) {
    const texto =
      valor
        .toLowerCase();

    if (
      palavras.some(
        (palavra) =>
          texto.includes(
            palavra
          )
      )
    ) {
      encontrados.push({
        caminho,
        valor
      });
    }

    return encontrados;
  }


  // ----------------------------------------------------------
  // ARRAY
  // ----------------------------------------------------------

  if (
    Array.isArray(valor)
  ) {
    valor.forEach(
      (item, index) => {
        procurarDadosInteressantes(
          item,
          `${caminho}[${index}]`,
          encontrados
        );
      }
    );

    return encontrados;
  }


  // ----------------------------------------------------------
  // OBJETO
  // ----------------------------------------------------------

  if (
    typeof valor === "object"
  ) {
    Object.entries(
      valor
    ).forEach(
      ([chave, conteudo]) => {
        const chaveNormalizada =
          chave
            .toLowerCase();


        const chaveInteressante =
          palavras.some(
            (palavra) =>
              chaveNormalizada.includes(
                palavra
              )
          );


        if (
          chaveInteressante
        ) {
          encontrados.push({
            caminho:
              `${caminho}.${chave}`,

            valor:
              conteudo
          });
        }


        procurarDadosInteressantes(
          conteudo,
          `${caminho}.${chave}`,
          encontrados
        );
      }
    );
  }


  return encontrados;
}


// ============================================================
// PROCURA STRINGS COM POSSÍVEIS HORÁRIOS
// ============================================================

function procurarPossiveisHorarios(
  valor,
  caminho = "root",
  encontrados = []
) {
  if (
    valor === null ||
    valor === undefined
  ) {
    return encontrados;
  }


  if (
    typeof valor === "string"
  ) {
    const texto =
      valor.toLowerCase();


    const padroes = [
      /\b([01]?\d|2[0-3]):([0-5]\d)\b/,
      /\b([01]?\d|2[0-3])h([0-5]\d)\b/,
      /\b([01]?\d|2[0-3])\s*h\b/,
      /(?:às|as)\s+([01]?\d|2[0-3])/,
      /\bmeia\b/,
      /\bhoras?\b/
    ];


    if (
      padroes.some(
        (regex) =>
          regex.test(texto)
      )
    ) {
      encontrados.push({
        caminho,
        valor
      });
    }


    return encontrados;
  }


  if (
    Array.isArray(valor)
  ) {
    valor.forEach(
      (item, index) => {
        procurarPossiveisHorarios(
          item,
          `${caminho}[${index}]`,
          encontrados
        );
      }
    );

    return encontrados;
  }


  if (
    typeof valor === "object"
  ) {
    Object.entries(
      valor
    ).forEach(
      ([chave, conteudo]) => {
        procurarPossiveisHorarios(
          conteudo,
          `${caminho}.${chave}`,
          encontrados
        );
      }
    );
  }


  return encontrados;
}


// ============================================================
// REMOVE RESULTADOS DUPLICADOS
// ============================================================

function removerDuplicados(
  itens
) {
  const mapa =
    new Map();


  for (
    const item of itens
  ) {
    const chave =
      `${item.caminho}|${valorParaTexto(item.valor)}`;


    if (
      !mapa.has(chave)
    ) {
      mapa.set(
        chave,
        item
      );
    }
  }


  return [
    ...mapa.values()
  ];
}


// ============================================================
// PROCESSAMENTO DE DIAGNÓSTICO
// ============================================================

async function processarChamada(
  conversationSpaceId
) {
  if (
    processando.has(
      conversationSpaceId
    )
  ) {
    console.log(
      "Conversation já está sendo processada nesta instância:",
      conversationSpaceId
    );

    return;
  }


  processando.add(
    conversationSpaceId
  );


  try {
    console.log(
      "=================================================="
    );

    console.log(
      "===== DIAGNÓSTICO AVANÇADO GOTO ====="
    );

    console.log(
      "ConversationSpaceId:",
      conversationSpaceId
    );

    console.log(
      "=================================================="
    );


    // ----------------------------------------------------------
    // TOKEN
    // ----------------------------------------------------------

    const accessToken =
      await obterAccessTokenGoTo();


    // ----------------------------------------------------------
    // REPORT
    // ----------------------------------------------------------

    const relatorio =
      await obterRelatorio(
        conversationSpaceId,
        accessToken
      );


    if (!relatorio) {
      console.log(
        "Nenhum relatório retornado."
      );

      return;
    }


    // ==========================================================
    // RESUMO
    // ==========================================================

    console.log(
      "===== RESUMO DO REPORT ====="
    );

    console.log(
      JSON.stringify(
        {
          id:
            relatorio?.id ||
            null,

          callCreated:
            relatorio?.callCreated ||
            null,

          callEnded:
            relatorio?.callEnded ||
            null,

          direction:
            relatorio?.direction ||
            null,

          accountKey:
            relatorio?.accountKey ||
            null,

          callReason:
            relatorio?.callReason ||
            null,

          quantidadeActions:
            Array.isArray(
              relatorio?.actions
            )
              ? relatorio.actions.length
              : 0,

          quantidadeCallStates:
            Array.isArray(
              relatorio?.callStates
            )
              ? relatorio.callStates.length
              : 0,

          quantidadeParticipants:
            Array.isArray(
              relatorio?.participants
            )
              ? relatorio.participants.length
              : 0
        },
        null,
        2
      )
    );


    // ==========================================================
    // ACTIONS
    // ==========================================================

    const actions =
      Array.isArray(
        relatorio?.actions
      )
        ? relatorio.actions
        : [];


    console.log(
      "===== ACTIONS COMPLETAS ====="
    );

    console.log(
      JSON.stringify(
        actions,
        null,
        2
      )
    );


    // ==========================================================
    // TIPOS DAS ACTIONS
    // ==========================================================

    const tiposActions =
      actions.map(
        (action, index) => ({
          index,

          timestamp:
            action?.timestamp ||
            null,

          value:
            action?.type?.value ||
            null,

          eventId:
            action?.type?.eventId ||
            null,

          query:
            action?.type?.query ||
            null,

          form:
            action?.type?.form ||
            null
        })
      );


    console.log(
      "===== RESUMO DAS ACTIONS ====="
    );

    console.log(
      JSON.stringify(
        tiposActions,
        null,
        2
      )
    );


    // ==========================================================
    // ACTIONS AIR
    // ==========================================================

    const actionsAIR =
      actions.filter(
        (action) => {
          const texto =
            JSON.stringify(
              action
            ).toLowerCase();

          return (
            texto.includes(
              "air_"
            ) ||
            texto.includes(
              "scheduling"
            ) ||
            texto.includes(
              "appointment"
            )
          );
        }
      );


    console.log(
      "===== ACTIONS AIR / SCHEDULING ====="
    );

    console.log(
      JSON.stringify(
        actionsAIR,
        null,
        2
      )
    );


    // ==========================================================
    // INFO_CAPTURE
    // ==========================================================

    const infoCaptures =
      actions.filter(
        (action) =>
          action?.type?.value ===
          "INFO_CAPTURE"
      );


    console.log(
      "===== INFO_CAPTURE ====="
    );

    console.log(
      JSON.stringify(
        infoCaptures,
        null,
        2
      )
    );


    // ==========================================================
    // CALL STATES
    // ==========================================================

    const callStates =
      Array.isArray(
        relatorio?.callStates
      )
        ? relatorio.callStates
        : [];


    console.log(
      "===== CALL STATES COMPLETOS ====="
    );

    console.log(
      JSON.stringify(
        callStates,
        null,
        2
      )
    );


    // ==========================================================
    // CALL STATES DA IA RECEPCIONISTA
    // ==========================================================

    const callStatesIA =
      callStates.filter(
        (state) => {
          const texto =
            JSON.stringify(
              state
            ).toLowerCase();

          return (
            texto.includes(
              "virtualreceptionist"
            ) ||
            texto.includes(
              "virtual_receptionist"
            ) ||
            texto.includes(
              "receptionist"
            ) ||
            texto.includes(
              "scheduling"
            ) ||
            texto.includes(
              "appointment"
            ) ||
            texto.includes(
              "air_"
            )
          );
        }
      );


    console.log(
      "===== CALL STATES IA RECEPCIONISTA ====="
    );

    console.log(
      JSON.stringify(
        callStatesIA,
        null,
        2
      )
    );


    // ==========================================================
    // PARTICIPANTS
    // ==========================================================

    const participants =
      Array.isArray(
        relatorio?.participants
      )
        ? relatorio.participants
        : [];


    console.log(
      "===== PARTICIPANTS COMPLETOS ====="
    );

    console.log(
      JSON.stringify(
        participants,
        null,
        2
      )
    );


    // ==========================================================
    // TRANSCRIPTS
    // ==========================================================

    const transcripts = [];

    participants.forEach(
      (participant, index) => {
        if (
          participant?.transcripts
        ) {
          transcripts.push({
            participant:
              index,

            transcripts:
              participant.transcripts
          });
        }


        if (
          participant?.liveTranscripts
        ) {
          transcripts.push({
            participant:
              index,

            liveTranscripts:
              participant.liveTranscripts
          });
        }


        if (
          participant?.recordings
        ) {
          transcripts.push({
            participant:
              index,

            recordings:
              participant.recordings
          });
        }
      }
    );


    console.log(
      "===== TRANSCRIPTS / RECORDINGS ====="
    );

    console.log(
      JSON.stringify(
        transcripts,
        null,
        2
      )
    );


    // ==========================================================
    // BUSCA RECURSIVA
    // ==========================================================

    const encontrados =
      removerDuplicados(
        procurarDadosInteressantes(
          relatorio
        )
      );


    console.log(
      "===== CAMPOS INTERESSANTES ENCONTRADOS ====="
    );

    console.log(
      JSON.stringify(
        encontrados,
        null,
        2
      )
    );


    // ==========================================================
    // POSSÍVEIS HORÁRIOS
    // ==========================================================

    const possiveisHorarios =
      removerDuplicados(
        procurarPossiveisHorarios(
          relatorio
        )
      );


    console.log(
      "===== POSSÍVEIS HORÁRIOS ENCONTRADOS ====="
    );

    console.log(
      JSON.stringify(
        possiveisHorarios,
        null,
        2
      )
    );


    // ==========================================================
    // REPORT COMPLETO
    // ==========================================================

    console.log(
      "===== REPORT COMPLETO ====="
    );

    console.log(
      JSON.stringify(
        relatorio,
        null,
        2
      )
    );


    // ==========================================================
    // IMPORTANTE
    // ==========================================================

    console.log(
      "===== MODO DIAGNÓSTICO ====="
    );

    console.log(
      "Nenhum agendamento foi criado nesta execução."
    );

  } catch (error) {
    console.error(
      "ERRO NO DIAGNÓSTICO:",
      error
    );

  } finally {
    processando.delete(
      conversationSpaceId
    );

    console.log(
      "===== FIM DIAGNÓSTICO GOTO ====="
    );
  }
}


// ============================================================
// WEBHOOK
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {
    try {
      // --------------------------------------------------------
      // OPTIONS
      // --------------------------------------------------------

      if (
        req.method ===
        "OPTIONS"
      ) {
        res.setHeader(
          "Allow",
          "GET, POST, OPTIONS"
        );

        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, OPTIONS"
        );

        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization"
        );

        return res
          .status(200)
          .end();
      }


      // --------------------------------------------------------
      // GET
      // --------------------------------------------------------

      if (
        req.method ===
        "GET"
      ) {
        return res
          .status(200)
          .json({
            success:
              true,

            message:
              "Webhook GoTo ativo",

            mode:
              "diagnostico-avancado",

            background:
              true,

            scheduling:
              false
          });
      }


      // --------------------------------------------------------
      // SOMENTE POST
      // --------------------------------------------------------

      if (
        req.method !==
        "POST"
      ) {
        return res
          .status(405)
          .json({
            success:
              false,

            error:
              "Método não permitido"
          });
      }


      const payload =
        req.body;


      // --------------------------------------------------------
      // VALIDATION CODE
      // --------------------------------------------------------

      const validationCode =
        Array.isArray(
          payload
        )
          ? payload
              ?.[0]
              ?.data
              ?.validationCode

          : payload
              ?.data
              ?.validationCode;


      if (
        validationCode
      ) {
        return res
          .status(200)
          .json({
            validationResponse:
              validationCode
          });
      }


      // --------------------------------------------------------
      // POST VAZIO
      // --------------------------------------------------------

      if (
        !payload ||
        (
          typeof payload ===
            "object" &&

          !Array.isArray(
            payload
          ) &&

          Object.keys(
            payload
          ).length === 0
        )
      ) {
        return res
          .status(200)
          .end();
      }


      // --------------------------------------------------------
      // NORMALIZA EVENTO
      // --------------------------------------------------------

      const evento =
        Array.isArray(
          payload
        )
          ? payload[0]
          : payload;


      const content =
        evento?.content ||
        evento?.data?.content;


      const metadata =
        content?.metadata ||
        {};


      const state =
        content?.state ||
        {};


      const conversationSpaceId =
        metadata
          ?.conversationSpaceId;


      const accountKey =
        metadata
          ?.accountKey;


      console.log(
        "GOTO EVENT:",
        JSON.stringify({
          eventId:
            evento?.id ||
            null,

          conversationSpaceId:
            conversationSpaceId ||
            null,

          accountKey:
            accountKey ||
            null,

          state:
            state?.type ||
            null
        })
      );


      // --------------------------------------------------------
      // CONTA DEMO
      // --------------------------------------------------------

      if (
        accountKey &&
        accountKey !==
          GOTO_ACCOUNT_KEY
      ) {
        return res
          .status(200)
          .json({
            success:
              true,

            ignored:
              true,

            reason:
              "accountKey diferente"
          });
      }


      // --------------------------------------------------------
      // SOMENTE ENDING
      // --------------------------------------------------------

      if (
        state?.type !==
        "ENDING"
      ) {
        return res
          .status(200)
          .json({
            success:
              true,

            received:
              true,

            processed:
              false,

            state:
              state?.type ||
              null
          });
      }


      // --------------------------------------------------------
      // SEM ID
      // --------------------------------------------------------

      if (
        !conversationSpaceId
      ) {
        return res
          .status(200)
          .json({
            success:
              true,

            received:
              true,

            processed:
              false,

            reason:
              "conversationSpaceId não encontrado"
          });
      }


      // --------------------------------------------------------
      // DIAGNÓSTICO EM BACKGROUND
      // --------------------------------------------------------

      console.log(
        "Disparando diagnóstico:",
        conversationSpaceId
      );


      waitUntil(
        processarChamada(
          conversationSpaceId
        )
      );


      // --------------------------------------------------------
      // RESPONDE AO GOTO IMEDIATAMENTE
      // --------------------------------------------------------

      return res
        .status(200)
        .json({
          success:
            true,

          received:
            true,

          diagnostic:
            true,

          background:
            true,

          conversationSpaceId
        });

    } catch (error) {
      console.error(
        "Erro webhook GoTo:",
        error
      );


      return res
        .status(200)
        .json({
          success:
            false,

          error:
            error.message
        });
    }
  };