const { waitUntil } = require("@vercel/functions");


// ============================================================
// CONFIGURAÇÕES
// ============================================================

const GOTO_ACCOUNT_KEY =
  "5316599808366110732";

const FORMULARIO_AGENDAMENTO =
  "Agendamento Microsoft 365";

const URL_BASE =
  "https://goto-agendamento.vercel.app";

const URL_AGENDAR =
  `${URL_BASE}/api/agendar`;

const URL_CANCELAR =
  `${URL_BASE}/api/cancelar`;

const TIMEZONE =
  "America/Sao_Paulo";


// ============================================================
// CONTROLE LOCAL DE DUPLICIDADE
// ============================================================

const processando = new Set();


// ============================================================
// ESPERA
// ============================================================

function esperar(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}


// ============================================================
// NORMALIZA TEXTO
// ============================================================

function normalizarTexto(texto) {
  return String(
    texto || ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}


// ============================================================
// ACCESS TOKEN GOTO
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


  const basicAuth =
    Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");


  const response =
    await fetch(
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

        body:
          new URLSearchParams({
            grant_type:
              "refresh_token",

            refresh_token:
              refreshToken
          })
      }
    );


  const text =
    await response.text();


  let data;


  try {
    data =
      JSON.parse(text);
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
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          Accept:
            "application/json"
        }
      }
    );


  const text =
    await response.text();


  let data;


  try {
    data =
      JSON.parse(text);
  } catch {
    data = text;
  }


  return {
    ok:
      response.ok,

    status:
      response.status,

    data
  };
}


// ============================================================
// PROCURA CALL REASON DA IA
// ============================================================

function obterCallReasonIA(
  relatorio
) {
  const callStates =
    Array.isArray(
      relatorio?.callStates
    )
      ? relatorio.callStates
      : [];


  for (
    let i =
      callStates.length - 1;

    i >= 0;

    i--
  ) {
    const state =
      callStates[i];


    const participants =
      Array.isArray(
        state?.participants
      )
        ? state.participants
        : [];


    for (
      let j =
        participants.length - 1;

      j >= 0;

      j--
    ) {
      const participante =
        participants[j];


      const callReason =
        participante
          ?.status
          ?.outcome
          ?.callReason;


      if (
        typeof callReason === "string" &&
        callReason.trim()
      ) {
        return callReason.trim();
      }
    }
  }


  return null;
}


// ============================================================
// VERIFICA INFO_CAPTURE
// ============================================================

function possuiCapturaAgendamento(
  relatorio
) {
  const actions =
    Array.isArray(
      relatorio?.actions
    )
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
// AGUARDA REPORT COMPLETO
// ============================================================

async function obterRelatorioCompleto(
  conversationSpaceId,
  accessToken
) {
  const maxTentativas = 10;

  const intervaloMs = 2000;

  let ultimoRelatorio = null;


  await esperar(1500);


  for (
    let tentativa = 1;

    tentativa <=
      maxTentativas;

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
    // REPORT AINDA NÃO EXISTE
    // ----------------------------------------------------------

    if (
      resultado.status === 404
    ) {
      console.log(
        "Report ainda não disponível."
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


    const callReason =
      obterCallReasonIA(
        relatorio
      );


    const infoCapture =
      possuiCapturaAgendamento(
        relatorio
      );


    console.log(
      "Estado do Report:",
      JSON.stringify({
        tentativa,

        infoCapture,

        callReason:
          callReason || null,

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
            : 0
      })
    );


    /*
     * Para nossa automação, o callReason é a peça
     * principal para descobrir a intenção.
     *
     * O INFO_CAPTURE continua sendo útil para
     * confirmar que passou pelo fluxo configurado.
     */

    if (callReason) {
      console.log(
        "Call Events Report pronto para processamento."
      );

      return relatorio;
    }


    if (
      tentativa <
      maxTentativas
    ) {
      console.log(
        "Report ainda incompleto. Aguardando..."
      );


      await esperar(
        intervaloMs
      );
    }
  }


  return ultimoRelatorio;
}


// ============================================================
// IDENTIFICA INTENÇÃO
// ============================================================

function identificarIntencao(
  callReason
) {
  const texto =
    normalizarTexto(
      callReason
    );


  // ----------------------------------------------------------
  // REAGENDAMENTO
  // Fica preparado, mas ainda não executamos.
  // Tem prioridade porque "reagendamento" contém "agendamento".
  // ----------------------------------------------------------

  const palavrasReagendamento = [
    "reagendar",
    "reagendamento",
    "remarcar",
    "remarcacao",
    "mudar o horario",
    "mudar horario",
    "alterar o horario",
    "alterar horario",
    "mudar a data",
    "alterar a data"
  ];


  if (
    palavrasReagendamento.some(
      (palavra) =>
        texto.includes(
          palavra
        )
    )
  ) {
    return "REAGENDAR";
  }


  // ----------------------------------------------------------
  // CANCELAMENTO
  // ----------------------------------------------------------

  const palavrasCancelamento = [
    "cancelar",
    "cancelamento",
    "cancele",
    "cancelado",
    "desmarcar",
    "desmarcacao"
  ];


  if (
    palavrasCancelamento.some(
      (palavra) =>
        texto.includes(
          palavra
        )
    )
  ) {
    return "CANCELAR";
  }


  // ----------------------------------------------------------
  // AGENDAMENTO
  // ----------------------------------------------------------

  const palavrasAgendamento = [
    "agendar",
    "agendamento",
    "marcar",
    "compromisso",
    "horario"
  ];


  if (
    palavrasAgendamento.some(
      (palavra) =>
        texto.includes(
          palavra
        )
    )
  ) {
    return "AGENDAR";
  }


  return "DESCONHECIDA";
}


// ============================================================
// NÚMERO POR EXTENSO
// ============================================================

function numeroPorExtenso(
  texto
) {
  const normalizado =
    normalizarTexto(
      texto
    );


  const mapa = {
    zero: 0,

    um: 1,
    uma: 1,

    dois: 2,
    duas: 2,

    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,

    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,

    quatorze: 14,
    catorze: 14,

    quinze: 15,

    dezesseis: 16,
    dezassete: 17,
    dezessete: 17,

    dezoito: 18,
    dezenove: 19,
    vinte: 20
  };


  return mapa[
    normalizado
  ];
}


// ============================================================
// EXTRAI HORÁRIO
// ============================================================

function extrairHorario(
  textoOriginal
) {
  if (!textoOriginal) {
    return null;
  }


  const texto =
    String(
      textoOriginal
    ).toLowerCase();


  let match;


  // ----------------------------------------------------------
  // 15:45
  // ----------------------------------------------------------

  match =
    texto.match(
      /\b([01]?\d|2[0-3]):([0-5]\d)\b/
    );


  if (match) {
    return (
      String(
        Number(
          match[1]
        )
      ).padStart(
        2,
        "0"
      ) +
      ":" +
      match[2]
    );
  }


  // ----------------------------------------------------------
  // 15h45
  // ----------------------------------------------------------

  match =
    texto.match(
      /\b([01]?\d|2[0-3])\s*h\s*([0-5]\d)\b/
    );


  if (match) {
    return (
      String(
        Number(
          match[1]
        )
      ).padStart(
        2,
        "0"
      ) +
      ":" +
      match[2]
    );
  }


  // ----------------------------------------------------------
  // 15 horas e 45 minutos
  // ----------------------------------------------------------

  match =
    texto.match(
      /\b([01]?\d|2[0-3])\s*horas?\s+e\s+([0-5]?\d)\s*minutos?\b/
    );


  if (match) {
    return (
      String(
        Number(
          match[1]
        )
      ).padStart(
        2,
        "0"
      ) +
      ":" +
      String(
        Number(
          match[2]
        )
      ).padStart(
        2,
        "0"
      )
    );
  }


  // ----------------------------------------------------------
  // ÀS 15
  // ----------------------------------------------------------

  match =
    texto.match(
      /(?:às|as)\s+([01]?\d|2[0-3])(?:\s*horas?)?\b/
    );


  if (match) {
    return (
      String(
        Number(
          match[1]
        )
      ).padStart(
        2,
        "0"
      ) +
      ":00"
    );
  }


  // ----------------------------------------------------------
  // DEZ E MEIA
  // ----------------------------------------------------------

  match =
    texto.match(
      /(?:às|as)\s+([a-záéíóúâêôãõç]+)\s+e\s+meia/
    );


  if (match) {
    const hora =
      numeroPorExtenso(
        match[1]
      );


    if (
      Number.isInteger(
        hora
      ) &&
      hora >= 0 &&
      hora <= 23
    ) {
      return (
        String(
          hora
        ).padStart(
          2,
          "0"
        ) +
        ":30"
      );
    }
  }


  return null;
}


// ============================================================
// DATA LOCAL
// ============================================================

function dataLocalISO(
  date
) {
  const partes =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          TIMEZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    ).formatToParts(
      date
    );


  const ano =
    partes.find(
      (parte) =>
        parte.type ===
        "year"
    )?.value;


  const mes =
    partes.find(
      (parte) =>
        parte.type ===
        "month"
    )?.value;


  const dia =
    partes.find(
      (parte) =>
        parte.type ===
        "day"
    )?.value;


  return (
    `${ano}-${mes}-${dia}`
  );
}


// ============================================================
// EXTRAI DATA
// ============================================================

function extrairData(
  textoOriginal,
  callCreated
) {
  if (
    !textoOriginal ||
    !callCreated
  ) {
    return null;
  }


  const texto =
    String(
      textoOriginal
    ).toLowerCase();


  let match =
    texto.match(
      /(?:dia\s+)?(\d{1,2})\s+de\s+([a-záéíóúâêôãõç]+)\s+de\s+(\d{4})/
    );


  if (match) {
    const dia =
      Number(
        match[1]
      );


    const nomeMes =
      normalizarTexto(
        match[2]
      );


    const meses = {
      janeiro: 1,
      fevereiro: 2,
      marco: 3,
      abril: 4,
      maio: 5,
      junho: 6,
      julho: 7,
      agosto: 8,
      setembro: 9,
      outubro: 10,
      novembro: 11,
      dezembro: 12
    };


    const mes =
      meses[
        nomeMes
      ];


    const ano =
      Number(
        match[3]
      );


    if (mes) {
      return (
        `${ano}-` +
        `${String(
          mes
        ).padStart(
          2,
          "0"
        )}-` +
        `${String(
          dia
        ).padStart(
          2,
          "0"
        )}`
      );
    }
  }


  const criada =
    new Date(
      callCreated
    );


  const dataLocal =
    dataLocalISO(
      criada
    );


  const [
    ano,
    mes,
    dia
  ] =
    dataLocal
      .split("-")
      .map(Number);


  // ----------------------------------------------------------
  // AMANHÃ
  // ----------------------------------------------------------

  if (
    normalizarTexto(
      texto
    ).includes(
      "amanha"
    )
  ) {
    const base =
      new Date(
        Date.UTC(
          ano,
          mes - 1,
          dia,
          12,
          0,
          0
        )
      );


    base.setUTCDate(
      base.getUTCDate() + 1
    );


    return (
      `${base.getUTCFullYear()}-` +
      `${String(
        base.getUTCMonth() + 1
      ).padStart(
        2,
        "0"
      )}-` +
      `${String(
        base.getUTCDate()
      ).padStart(
        2,
        "0"
      )}`
    );
  }


  // ----------------------------------------------------------
  // HOJE
  // ----------------------------------------------------------

  if (
    normalizarTexto(
      texto
    ).includes(
      "hoje"
    )
  ) {
    return dataLocal;
  }


  return null;
}


// ============================================================
// TELEFONE DO CHAMADOR
// ============================================================

function obterTelefone(
  relatorio
) {
  // ----------------------------------------------------------
  // PARTICIPANTS PRINCIPAL
  // ----------------------------------------------------------

  const participants =
    Array.isArray(
      relatorio?.participants
    )
      ? relatorio.participants
      : [];


  for (
    const participant
    of participants
  ) {
    const caller =
      participant
        ?.type
        ?.caller
        ?.number;


    if (caller) {
      return caller;
    }
  }


  // ----------------------------------------------------------
  // FALLBACK CALL STATES
  // ----------------------------------------------------------

  const callStates =
    Array.isArray(
      relatorio?.callStates
    )
      ? relatorio.callStates
      : [];


  for (
    const state
    of callStates
  ) {
    const stateParticipants =
      Array.isArray(
        state?.participants
      )
        ? state.participants
        : [];


    for (
      const participant
      of stateParticipants
    ) {
      const caller =
        participant
          ?.type
          ?.caller
          ?.number;


      if (caller) {
        return caller;
      }
    }
  }


  return "";
}


// ============================================================
// CHAMA API INTERNA
// ============================================================

async function chamarApiInterna(
  url,
  body
) {
  const apiKey =
    process.env.GOTO_API_KEY;


  if (!apiKey) {
    throw new Error(
      "GOTO_API_KEY não configurada"
    );
  }


  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-api-key":
            apiKey
        },

        body:
          JSON.stringify(
            body
          )
      }
    );


  const text =
    await response.text();


  let result;


  try {
    result =
      JSON.parse(text);
  } catch {
    result = text;
  }


  return {
    ok:
      response.ok,

    status:
      response.status,

    result
  };
}


// ============================================================
// PROCESSA CHAMADA
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
      "Conversation já está em processamento:",
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
      "===== PROCESSANDO CHAMADA GOTO ====="
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
      await obterRelatorioCompleto(
        conversationSpaceId,
        accessToken
      );


    if (!relatorio) {
      console.log(
        "Nenhum relatório retornado."
      );

      return;
    }


    // ----------------------------------------------------------
    // CALL REASON
    // ----------------------------------------------------------

    const callReason =
      obterCallReasonIA(
        relatorio
      );


    console.log(
      "CALL REASON IA:",
      callReason
    );


    if (!callReason) {
      console.log(
        "Não foi possível identificar a intenção da chamada."
      );

      return;
    }


    // ----------------------------------------------------------
    // INTENÇÃO
    // ----------------------------------------------------------

    const intencao =
      identificarIntencao(
        callReason
      );


    console.log(
      "INTENÇÃO IDENTIFICADA:",
      intencao
    );


    // ----------------------------------------------------------
    // TELEFONE
    // ----------------------------------------------------------

    const telefone =
      obterTelefone(
        relatorio
      );


    console.log(
      "TELEFONE:",
      telefone
    );


    // ==========================================================
    // CANCELAMENTO
    // ==========================================================

    if (
      intencao ===
      "CANCELAR"
    ) {
      console.log(
        "Fluxo escolhido: CANCELAMENTO"
      );


      const resultado =
        await chamarApiInterna(
          URL_CANCELAR,
          {
            telefone,

            conversationSpaceId,

            callReason
          }
        );


      console.log(
        "RESULTADO /API/CANCELAR:",
        JSON.stringify(
          resultado,
          null,
          2
        )
      );


      if (
        resultado.ok
      ) {
        console.log(
          "===== CANCELAMENTO PROCESSADO COM SUCESSO ====="
        );
      } else {
        console.log(
          "===== CANCELAMENTO NÃO CONCLUÍDO ====="
        );
      }


      return;
    }


    // ==========================================================
    // REAGENDAMENTO
    // ==========================================================

    if (
      intencao ===
      "REAGENDAR"
    ) {
      console.log(
        "Fluxo de REAGENDAMENTO identificado."
      );

      console.log(
        "Reagendamento ainda não implementado no backend."
      );

      return;
    }


    // ==========================================================
    // AGENDAMENTO
    // ==========================================================

    if (
      intencao ===
      "AGENDAR"
    ) {
      console.log(
        "Fluxo escolhido: AGENDAMENTO"
      );


      const horario =
        extrairHorario(
          callReason
        );


      const data =
        extrairData(
          callReason,
          relatorio?.callCreated
        );


      console.log(
        "DADOS EXTRAÍDOS:",
        JSON.stringify(
          {
            data,
            horario,
            telefone,
            callReason
          },
          null,
          2
        )
      );


      if (
        !data ||
        !horario
      ) {
        console.log(
          "AGENDAMENTO NÃO CRIADO."
        );

        console.log(
          "Motivo: data ou horário não identificado."
        );

        return;
      }


      const resultado =
        await chamarApiInterna(
          URL_AGENDAR,
          {
            data,

            horario,

            nome:
              telefone
                ? `Telefone ${telefone}`
                : "Cliente GoTo",

            telefone,

            conversationSpaceId,

            origem:
              "GoTo IA Recepcionista",

            callReason
          }
        );


      console.log(
        "RESULTADO /API/AGENDAR:",
        JSON.stringify(
          resultado,
          null,
          2
        )
      );


      if (
        resultado.ok
      ) {
        console.log(
          "===== AGENDAMENTO PROCESSADO COM SUCESSO ====="
        );
      } else {
        console.log(
          "===== AGENDAMENTO NÃO CONCLUÍDO ====="
        );
      }


      return;
    }


    // ==========================================================
    // DESCONHECIDA
    // ==========================================================

    console.log(
      "Nenhuma automação executada."
    );

    console.log(
      "Intenção não reconhecida:",
      callReason
    );

  } catch (error) {
    console.error(
      "ERRO NO PROCESSAMENTO DA CHAMADA:",
      error
    );

  } finally {
    processando.delete(
      conversationSpaceId
    );


    console.log(
      "===== FIM PROCESSAMENTO GOTO ====="
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
              "agendar-cancelar",

            background:
              true,

            agendamento:
              true,

            cancelamento:
              true,

            reagendamento:
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
      // SEM CONVERSATION ID
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
      // BACKGROUND
      // --------------------------------------------------------

      console.log(
        "Disparando processamento:",
        conversationSpaceId
      );


      waitUntil(
        processarChamada(
          conversationSpaceId
        )
      );


      // --------------------------------------------------------
      // RESPONDE AO GOTO
      // --------------------------------------------------------

      return res
        .status(200)
        .json({
          success:
            true,

          received:
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