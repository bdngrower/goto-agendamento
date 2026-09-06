const { waitUntil } = require("@vercel/functions");

const GOTO_ACCOUNT_KEY = "5316599808366110732";

const FORMULARIO_AGENDAMENTO =
  "Agendamento Microsoft 365";

const TIMEZONE = "America/Sao_Paulo";


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
// OBTÉM NOVO ACCESS TOKEN DO GOTO
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
// VERIFICA INFO_CAPTURE
// ============================================================

function possuiCapturaAgendamento(relatorio) {
  const actions =
    Array.isArray(relatorio?.actions)
      ? relatorio.actions
      : [];

  return actions.some((action) => {
    return (
      action?.type?.value ===
        "INFO_CAPTURE" &&

      action?.type?.form?.name ===
        FORMULARIO_AGENDAMENTO
    );
  });
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
    data =
      JSON.parse(text);
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
// AGUARDA O REPORT CONTER INFO_CAPTURE
// ============================================================

async function obterRelatorioCompleto(
  conversationSpaceId,
  accessToken
) {
  /*
   * Não dependemos mais de callReason.
   *
   * Os testes mostraram que:
   *
   * - INFO_CAPTURE aparece;
   * - callReason pode continuar undefined
   *   indefinidamente.
   *
   * Portanto o critério agora é:
   *
   * INFO_CAPTURE do nosso formulário encontrado.
   */

  const maxTentativas = 10;
  const intervaloMs = 2000;

  let ultimoRelatorio = null;

  console.log(
    "Aguardando INFO_CAPTURE no Call Events Report..."
  );

  // Pequeno atraso inicial para o GoTo terminar o pós-processamento.
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


    // ==========================================================
    // 404
    // ==========================================================

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
        "Call Events Report permaneceu 404 até o limite de tentativas"
      );
    }


    // ==========================================================
    // OUTROS ERROS
    // ==========================================================

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


    const callReason =
      typeof relatorio?.callReason ===
        "string"
        ? relatorio.callReason
        : null;


    console.log(
      "Estado do Report:",
      JSON.stringify({
        tentativa,

        infoCapture:
          temInfoCapture,

        quantidadeActions:
          actions.length,

        callReason:
          !!callReason
      })
    );


    // ==========================================================
    // INFO_CAPTURE ENCONTRADO
    // ==========================================================

    if (temInfoCapture) {
      console.log(
        "INFO_CAPTURE encontrado. Report pronto para análise."
      );

      return relatorio;
    }


    if (
      tentativa <
      maxTentativas
    ) {
      console.log(
        "INFO_CAPTURE ainda não apareceu. Aguardando..."
      );

      await esperar(
        intervaloMs
      );
    }
  }


  console.log(
    "Limite atingido. Usando último Report disponível."
  );

  return ultimoRelatorio;
}


// ============================================================
// COLETA TEXTOS ÚTEIS
// ============================================================

function obterTextosDaInteracao(
  relatorio
) {
  const textos = [];

  const actions =
    Array.isArray(relatorio?.actions)
      ? relatorio.actions
      : [];


  for (
    const action of actions
  ) {
    const query =
      action?.type?.query;

    if (
      typeof query ===
        "string" &&
      query.trim()
    ) {
      textos.push(
        query.trim()
      );
    }
  }


  if (
    typeof relatorio?.callReason ===
      "string" &&
    relatorio.callReason.trim()
  ) {
    textos.push(
      relatorio.callReason.trim()
    );
  }


  return [
    ...new Set(textos)
  ];
}


// ============================================================
// NORMALIZA TEXTO
// ============================================================

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}


// ============================================================
// CONVERTE HORA POR EXTENSO
// ============================================================

function numeroPorExtenso(texto) {
  const normalizado =
    normalizarTexto(texto);

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
// EXTRAI HORÁRIO DOS TEXTOS
// ============================================================

function extrairHorario(
  textos
) {
  for (
    const textoOriginal
    of textos
  ) {
    const texto =
      textoOriginal.toLowerCase();


    // ==========================================================
    // 14:45
    // ==========================================================

    let match =
      texto.match(
        /\b([01]?\d|2[0-3]):([0-5]\d)\b/
      );

    if (match) {
      return (
        String(
          Number(match[1])
        ).padStart(
          2,
          "0"
        ) +
        ":" +
        match[2]
      );
    }


    // ==========================================================
    // 14h45 / 14 h 45
    // ==========================================================

    match =
      texto.match(
        /\b([01]?\d|2[0-3])\s*h\s*([0-5]\d)\b/
      );

    if (match) {
      return (
        String(
          Number(match[1])
        ).padStart(
          2,
          "0"
        ) +
        ":" +
        match[2]
      );
    }


    // ==========================================================
    // 14h
    // ==========================================================

    match =
      texto.match(
        /\b([01]?\d|2[0-3])\s*h\b/
      );

    if (match) {
      return (
        String(
          Number(match[1])
        ).padStart(
          2,
          "0"
        ) +
        ":00"
      );
    }


    // ==========================================================
    // às 17 horas / às 17
    // ==========================================================

    match =
      texto.match(
        /(?:às|as)\s+([01]?\d|2[0-3])(?:\s*horas?)?\b/
      );

    if (match) {
      return (
        String(
          Number(match[1])
        ).padStart(
          2,
          "0"
        ) +
        ":00"
      );
    }


    // ==========================================================
    // às dez e meia
    // ==========================================================

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


    // ==========================================================
    // às quatorze horas
    // ==========================================================

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
    new Intl
      .DateTimeFormat(
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
      )
      .formatToParts(
        date
      );


  const ano =
    partes.find(
      (p) =>
        p.type === "year"
    )?.value;


  const mes =
    partes.find(
      (p) =>
        p.type === "month"
    )?.value;


  const dia =
    partes.find(
      (p) =>
        p.type === "day"
    )?.value;


  return (
    `${ano}-${mes}-${dia}`
  );
}


// ============================================================
// EXTRAI DATA
// ============================================================

function extrairData(
  textos,
  callCreated
) {
  // ============================================================
  // DATA ESCRITA
  // ============================================================

  for (
    const textoOriginal
    of textos
  ) {
    const texto =
      textoOriginal
        .toLowerCase();


    const match =
      texto.match(
        /(?:dia\s+)?(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/
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
  }


  // ============================================================
  // AMANHÃ
  // ============================================================

  const temAmanha =
    textos.some(
      (texto) =>
        normalizarTexto(
          texto
        ).includes(
          "amanha"
        )
    );


  if (temAmanha) {
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


  // ============================================================
  // HOJE
  // ============================================================

  const temHoje =
    textos.some(
      (texto) =>
        normalizarTexto(
          texto
        ).includes(
          "hoje"
        )
    );


  if (temHoje) {
    return dataLocalISO(
      new Date(
        callCreated
      )
    );
  }


  return null;
}


// ============================================================
// TELEFONE
// ============================================================

function obterTelefone(
  relatorio
) {
  const participantes =
    Array.isArray(
      relatorio?.participants
    )
      ? relatorio.participants
      : [];


  for (
    const participante
    of participantes
  ) {
    const caller =
      participante
        ?.type
        ?.caller
        ?.number;


    if (caller) {
      return caller;
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
  conversationSpaceId
}) {
  const apiKey =
    process.env
      .GOTO_API_KEY;


  if (!apiKey) {
    throw new Error(
      "GOTO_API_KEY não configurada"
    );
  }


  const response =
    await fetch(
      "https://goto-agendamento.vercel.app/api/agendar",
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

            conversationSpaceId
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
    result =
      text;
  }


  return {
    status:
      response.status,

    ok:
      response.ok,

    result
  };
}


// ============================================================
// PROCESSAMENTO DA CHAMADA
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
      "========== PROCESSAMENTO BACKGROUND =========="
    );

    console.log(
      "ConversationSpaceId:",
      conversationSpaceId
    );


    // ==========================================================
    // TOKEN GOTO
    // ==========================================================

    const accessToken =
      await obterAccessTokenGoTo();


    // ==========================================================
    // RELATÓRIO
    // ==========================================================

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


    // ==========================================================
    // ACTIONS COMPLETAS
    // ==========================================================

    const actions =
      Array.isArray(
        relatorio?.actions
      )
        ? relatorio.actions
        : [];


    console.log(
      "=========================================="
    );

    console.log(
      "ACTIONS COMPLETAS:"
    );

    console.log(
      JSON.stringify(
        actions,
        null,
        2
      )
    );

    console.log(
      "=========================================="
    );


    // ==========================================================
    // INFO_CAPTURE COMPLETO
    // ==========================================================

    const infoCaptures =
      actions.filter(
        (action) =>
          action
            ?.type
            ?.value ===
          "INFO_CAPTURE"
      );


    console.log(
      "=========================================="
    );

    console.log(
      "INFO_CAPTURE COMPLETO:"
    );

    console.log(
      JSON.stringify(
        infoCaptures,
        null,
        2
      )
    );

    console.log(
      "=========================================="
    );


    // ==========================================================
    // FORMULÁRIO ESPECÍFICO
    // ==========================================================

    const infoCaptureAgendamento =
      infoCaptures.find(
        (action) =>
          action
            ?.type
            ?.form
            ?.name ===
          FORMULARIO_AGENDAMENTO
      );


    console.log(
      "=========================================="
    );

    console.log(
      "INFO_CAPTURE AGENDAMENTO:"
    );

    console.log(
      JSON.stringify(
        infoCaptureAgendamento ||
        null,
        null,
        2
      )
    );

    console.log(
      "=========================================="
    );


    // ==========================================================
    // CALL REASON
    // ==========================================================

    console.log(
      "Call Reason final:",
      relatorio?.callReason ||
        null
    );


    // ==========================================================
    // CONFIRMA INFO_CAPTURE
    // ==========================================================

    const possuiCaptura =
      possuiCapturaAgendamento(
        relatorio
      );


    if (!possuiCaptura) {
      console.log(
        "Ignorado: INFO_CAPTURE do formulário de agendamento não encontrado."
      );

      return;
    }


    // ==========================================================
    // TEXTOS PARA EXTRAÇÃO
    // ==========================================================

    const textos =
      obterTextosDaInteracao(
        relatorio
      );


    console.log(
      "TEXTOS PARA EXTRAÇÃO:",
      JSON.stringify(
        textos,
        null,
        2
      )
    );


    // ==========================================================
    // EXTRAI HORÁRIO
    // ==========================================================

    const horario =
      extrairHorario(
        textos
      );


    // ==========================================================
    // EXTRAI DATA
    // ==========================================================

    const data =
      extrairData(
        textos,
        relatorio?.callCreated
      );


    // ==========================================================
    // TELEFONE
    // ==========================================================

    const telefone =
      obterTelefone(
        relatorio
      );


    // ==========================================================
    // RESULTADO DA EXTRAÇÃO
    // ==========================================================

    console.log(
      "DADOS EXTRAÍDOS:",
      JSON.stringify(
        {
          data,
          horario,
          telefone,

          callReason:
            relatorio
              ?.callReason ||
            null
        },
        null,
        2
      )
    );


    // ==========================================================
    // SEGURANÇA
    // ==========================================================

    if (
      !data ||
      !horario
    ) {
      console.log(
        "AGENDAMENTO NÃO CRIADO: data ou horário não identificado."
      );

      console.log(
        "Precisamos analisar INFO_CAPTURE COMPLETO acima."
      );

      return;
    }


    // ==========================================================
    // CRIA AGENDAMENTO
    // ==========================================================

    const resultado =
      await criarAgendamento({
        data,
        horario,
        telefone,
        conversationSpaceId
      });


    console.log(
      "RESULTADO AGENDAMENTO:",
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
        "AGENDAMENTO PROCESSADO COM SUCESSO."
      );
    } else {
      console.log(
        "API /agendar retornou erro."
      );
    }

  } catch (error) {
    console.error(
      "ERRO NO PROCESSAMENTO BACKGROUND:",
      error
    );

  } finally {
    processando.delete(
      conversationSpaceId
    );

    console.log(
      "========== FIM PROCESSAMENTO BACKGROUND =========="
    );
  }
}


// ============================================================
// HANDLER DO WEBHOOK
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {
    try {
      // ========================================================
      // OPTIONS
      // ========================================================

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


      // ========================================================
      // GET TESTE
      // ========================================================

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

            automation:
              "Agendamento automático em background habilitado",

            diagnostic:
              "INFO_CAPTURE completo habilitado",

            background:
              true
          });
      }


      // ========================================================
      // SOMENTE POST
      // ========================================================

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


      // ========================================================
      // VALIDATION CODE
      // ========================================================

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


      // ========================================================
      // POST VAZIO
      // ========================================================

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


      // ========================================================
      // NORMALIZA EVENTO
      // ========================================================

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
        content?.metadata || {};


      const state =
        content?.state || {};


      const conversationSpaceId =
        metadata
          ?.conversationSpaceId;


      const accountKey =
        metadata
          ?.accountKey;


      // ========================================================
      // LOG RESUMIDO
      // ========================================================

      console.log(
        "GOTO EVENT:",
        JSON.stringify({
          id:
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


      // ========================================================
      // SOMENTE CONTA DEMO
      // ========================================================

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


      // ========================================================
      // SOMENTE ENDING
      // ========================================================

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


      // ========================================================
      // SEM CONVERSATION ID
      // ========================================================

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


      // ========================================================
      // PROCESSAMENTO BACKGROUND
      // ========================================================

      console.log(
        "Disparando processamento background:",
        conversationSpaceId
      );


      waitUntil(
        processarChamada(
          conversationSpaceId
        )
      );


      // ========================================================
      // RESPONDE IMEDIATAMENTE
      // ========================================================

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