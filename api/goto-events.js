const { waitUntil } = require("@vercel/functions");


// ============================================================
// CONFIGURAÇÕES
// ============================================================

const GOTO_ACCOUNT_KEY =
  "5316599808366110732";

const FORMULARIO_AGENDAMENTO =
  "Agendamento Microsoft 365";

const TIMEZONE =
  "America/Sao_Paulo";

const URL_AGENDAR =
  "https://goto-agendamento.vercel.app/api/agendar";


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
// CONFIRMA INFO_CAPTURE
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
// PROCURA CALL REASON DA IA NOS CALL STATES
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


  /*
   * Percorremos de trás para frente porque
   * normalmente o resultado final da IA aparece
   * nos últimos estados da chamada.
   */

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
        typeof callReason ===
          "string" &&
        callReason.trim()
      ) {
        return callReason.trim();
      }
    }
  }


  return null;
}


// ============================================================
// REPORT ESTÁ PRONTO?
// ============================================================

function relatorioEstaPronto(
  relatorio
) {
  const infoCapture =
    possuiCapturaAgendamento(
      relatorio
    );


  const callReason =
    obterCallReasonIA(
      relatorio
    );


  return (
    infoCapture &&
    !!callReason
  );
}


// ============================================================
// AGUARDA REPORT TER INFO_CAPTURE + CALL REASON
// ============================================================

async function obterRelatorioCompleto(
  conversationSpaceId,
  accessToken
) {
  const maxTentativas = 10;

  const intervaloMs = 2000;

  let ultimoRelatorio = null;


  /*
   * Pequeno atraso inicial.
   *
   * O evento ENDING pode chegar alguns instantes
   * antes do Call Events Report terminar de ser
   * preenchido.
   */

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
        "Call Events Report permaneceu 404 até o limite de tentativas"
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


    const infoCapture =
      possuiCapturaAgendamento(
        relatorio
      );


    const callReason =
      obterCallReasonIA(
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


    // ----------------------------------------------------------
    // REPORT PRONTO
    // ----------------------------------------------------------

    if (
      relatorioEstaPronto(
        relatorio
      )
    ) {
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


  console.log(
    "Limite de tentativas atingido."
  );


  return ultimoRelatorio;
}


// ============================================================
// NORMALIZA TEXTO
// ============================================================

function normalizarTexto(
  texto
) {
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
    dezasseis: 16,

    dezessete: 17,
    dezassete: 17,

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
  // 16:45
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
  // 16h45
  // 16 h 45
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
  // 16 horas e 45 minutos
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
  // às 16h
  // ----------------------------------------------------------

  match =
    texto.match(
      /(?:às|as)\s+([01]?\d|2[0-3])\s*h\b/
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
  // às 16 horas
  // às 16
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
  // às dez e meia
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


  // ----------------------------------------------------------
  // às quatorze horas
  // ----------------------------------------------------------

  match =
    texto.match(
      /(?:às|as)\s+([a-záéíóúâêôãõç]+)\s+horas?/
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
        ":00"
      );
    }
  }


  return null;
}


// ============================================================
// DATA LOCAL YYYY-MM-DD
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


  // ----------------------------------------------------------
  // 6 de setembro de 2026
  // dia 6 de setembro de 2026
  // ----------------------------------------------------------

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


    if (
      mes &&
      dia >= 1 &&
      dia <= 31
    ) {
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


  // ----------------------------------------------------------
  // DATA BASE DA CHAMADA
  // ----------------------------------------------------------

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
  // TENTA PARTICIPANTS PRINCIPAL
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
  // FALLBACK: CALL STATES
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
// CHAMA /API/AGENDAR
// ============================================================

async function criarAgendamento({
  data,
  horario,
  telefone,
  conversationSpaceId,
  callReason
}) {
  const apiKey =
    process.env.GOTO_API_KEY;


  if (!apiKey) {
    throw new Error(
      "GOTO_API_KEY não configurada"
    );
  }


  const response =
    await fetch(
      URL_AGENDAR,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-api-key":
            apiKey
        },

        body:
          JSON.stringify({
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
          })
      }
    );


  const text =
    await response.text();


  let result;


  try {
    result =
      JSON.parse(
        text
      );
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
// PROCESSA A CHAMADA
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
      "===== PROCESSANDO AGENDAMENTO GOTO ====="
    );

    console.log(
      "ConversationSpaceId:",
      conversationSpaceId
    );

    console.log(
      "=================================================="
    );


    // ----------------------------------------------------------
    // ACCESS TOKEN
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
    // CONFIRMA INFO_CAPTURE
    // ----------------------------------------------------------

    const possuiCaptura =
      possuiCapturaAgendamento(
        relatorio
      );


    if (!possuiCaptura) {
      console.log(
        "Chamada ignorada: INFO_CAPTURE do formulário não encontrado."
      );

      return;
    }


    // ----------------------------------------------------------
    // CALL REASON CORRETO
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
        "Agendamento não criado: callReason da IA não encontrado."
      );

      return;
    }


    // ----------------------------------------------------------
    // EXTRAÇÃO
    // ----------------------------------------------------------

    const horario =
      extrairHorario(
        callReason
      );


    const data =
      extrairData(
        callReason,
        relatorio?.callCreated
      );


    const telefone =
      obterTelefone(
        relatorio
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


    // ----------------------------------------------------------
    // VALIDAÇÃO
    // ----------------------------------------------------------

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


    // ----------------------------------------------------------
    // CHAMA API DE AGENDAMENTO
    // ----------------------------------------------------------

    console.log(
      "Chamando /api/agendar..."
    );


    const resultado =
      await criarAgendamento({
        data,
        horario,
        telefone,
        conversationSpaceId,
        callReason
      });


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
        "===== AGENDAMENTO CRIADO COM SUCESSO ====="
      );
    } else {
      console.log(
        "===== ERRO AO CRIAR AGENDAMENTO ====="
      );
    }

  } catch (error) {
    console.error(
      "ERRO NO PROCESSAMENTO DO AGENDAMENTO:",
      error
    );

  } finally {
    processando.delete(
      conversationSpaceId
    );


    console.log(
      "===== FIM PROCESSAMENTO AGENDAMENTO ====="
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
      // TESTE MANUAL
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
              "agendamento-real",

            source:
              "callStates.participants.status.outcome.callReason",

            background:
              true,

            scheduling:
              true
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
      // SEM CONVERSATION SPACE ID
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
      // PROCESSA EM BACKGROUND
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
      // RESPONDE IMEDIATAMENTE AO GOTO
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

          scheduling:
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