const GOTO_ACCOUNT_KEY = "5316599808366110732";

const FORMULARIO_AGENDAMENTO =
  "Agendamento Microsoft 365";

const TIMEZONE = "America/Sao_Paulo";


// ============================================================
// OBTÉM NOVO ACCESS TOKEN DO GOTO
// ============================================================

async function obterAccessTokenGoTo() {
  const clientId = process.env.GOTO_CLIENT_ID;
  const clientSecret = process.env.GOTO_CLIENT_SECRET;
  const refreshToken = process.env.GOTO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
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
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Erro ao renovar token GoTo: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}


// ============================================================
// ESPERA
// ============================================================

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// ============================================================
// VERIFICA INFO_CAPTURE
// ============================================================

function possuiCapturaAgendamento(relatorio) {
  const actions = Array.isArray(relatorio?.actions)
    ? relatorio.actions
    : [];

  return actions.some((action) => {
    return (
      action?.type?.value === "INFO_CAPTURE" &&
      action?.type?.form?.name ===
        FORMULARIO_AGENDAMENTO
    );
  });
}


// ============================================================
// VERIFICA SE O REPORT JÁ ESTÁ COMPLETO
// ============================================================

function relatorioEstaPronto(relatorio) {
  const temCallReason =
    typeof relatorio?.callReason === "string" &&
    relatorio.callReason.trim().length > 0;

  const temInfoCapture =
    possuiCapturaAgendamento(relatorio);

  return temCallReason && temInfoCapture;
}


// ============================================================
// CONSULTA CALL EVENTS REPORT COM RETENTATIVA
// ============================================================

async function obterRelatorio(
  conversationSpaceId,
  accessToken
) {
  const url =
    "https://api.goto.com/call-events-report/v1/reports/" +
    encodeURIComponent(conversationSpaceId);

  /*
   * O ENDING chega antes de todos os dados de IA
   * estarem enriquecidos no Call Events Report.
   *
   * Portanto:
   * - 404 = relatório ainda não existe
   * - 200 sem callReason = relatório existe,
   *   mas ainda está incompleto
   */
  const maxTentativas = 8;
  const intervaloMs = 2000;

  let ultimoRelatorio = null;

  // Dá um pequeno tempo inicial para o pós-processamento.
  await esperar(1500);

  for (
    let tentativa = 1;
    tentativa <= maxTentativas;
    tentativa++
  ) {
    console.log(
      `Consultando Call Events Report - tentativa ${tentativa}/${maxTentativas}`
    );

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

    // ----------------------------------------------------------
    // REPORT EXISTE
    // ----------------------------------------------------------

    if (response.ok) {
      ultimoRelatorio = data;

      const temCallReason =
        typeof data?.callReason === "string" &&
        data.callReason.trim().length > 0;

      const temInfoCapture =
        possuiCapturaAgendamento(data);

      console.log(
        "Estado do Report:",
        JSON.stringify({
          tentativa,
          callReason: temCallReason,
          infoCapture: temInfoCapture,
          quantidadeActions:
            Array.isArray(data?.actions)
              ? data.actions.length
              : 0
        })
      );

      if (relatorioEstaPronto(data)) {
        console.log(
          `Call Events Report completo na tentativa ${tentativa}`
        );

        return data;
      }

      // Ainda está sendo enriquecido pelo GoTo.
      if (tentativa < maxTentativas) {
        console.log(
          "Report respondeu 200, mas ainda está incompleto. Aguardando..."
        );

        await esperar(intervaloMs);
        continue;
      }

      /*
       * Se chegou ao limite, devolvemos o último Report
       * para que a lógica abaixo possa decidir se há
       * informação suficiente ou não.
       */
      console.log(
        "Limite de tentativas atingido. Usando último Report disponível."
      );

      return ultimoRelatorio;
    }

    // ----------------------------------------------------------
    // REPORT AINDA NÃO EXISTE
    // ----------------------------------------------------------

    if (
      response.status === 404 &&
      tentativa < maxTentativas
    ) {
      console.log(
        "Call Events Report ainda não existe. Aguardando..."
      );

      await esperar(intervaloMs);
      continue;
    }

    throw new Error(
      `Erro Call Events Report ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (ultimoRelatorio) {
    return ultimoRelatorio;
  }

  throw new Error(
    "Call Events Report não ficou disponível"
  );
}


// ============================================================
// COLETA TEXTOS ÚTEIS DA INTERAÇÃO
// ============================================================

function obterTextosDaInteracao(relatorio) {
  const textos = [];

  const actions = Array.isArray(relatorio?.actions)
    ? relatorio.actions
    : [];

  for (const action of actions) {
    if (
      action?.type?.value === "KNOWLEDGE_SEARCH" &&
      typeof action?.type?.query === "string"
    ) {
      textos.push(action.type.query);
    }
  }

  if (typeof relatorio?.callReason === "string") {
    textos.push(relatorio.callReason);
  }

  return textos;
}


// ============================================================
// NORMALIZA TEXTO
// ============================================================

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}


// ============================================================
// CONVERTE NÚMERO POR EXTENSO
// ============================================================

function numeroPorExtenso(texto) {
  const normalizado = normalizarTexto(texto);

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

  return mapa[normalizado];
}


// ============================================================
// EXTRAI HORÁRIO
// ============================================================

function extrairHorario(textos) {
  for (const textoOriginal of textos) {
    const texto = textoOriginal.toLowerCase();

    // ----------------------------------------------------------
    // 14:45
    // ----------------------------------------------------------

    let match = texto.match(
      /\b([01]?\d|2[0-3]):([0-5]\d)\b/
    );

    if (match) {
      return (
        String(Number(match[1])).padStart(2, "0") +
        ":" +
        match[2]
      );
    }

    // ----------------------------------------------------------
    // 14h45 / 14 h 45
    // ----------------------------------------------------------

    match = texto.match(
      /\b([01]?\d|2[0-3])\s*h\s*([0-5]\d)\b/
    );

    if (match) {
      return (
        String(Number(match[1])).padStart(2, "0") +
        ":" +
        match[2]
      );
    }

    // ----------------------------------------------------------
    // às 17 horas / às 17
    // ----------------------------------------------------------

    match = texto.match(
      /(?:às|as)\s+([01]?\d|2[0-3])(?:\s*horas?)?\b/
    );

    if (match) {
      return (
        String(Number(match[1])).padStart(2, "0") +
        ":00"
      );
    }

    // ----------------------------------------------------------
    // dez e meia
    // ----------------------------------------------------------

    match = texto.match(
      /(?:às|as)\s+([a-záéíóúâêôãõç]+)\s+e\s+meia/
    );

    if (match) {
      const hora = numeroPorExtenso(match[1]);

      if (
        Number.isInteger(hora) &&
        hora >= 0 &&
        hora <= 23
      ) {
        return (
          String(hora).padStart(2, "0") +
          ":30"
        );
      }
    }

    // ----------------------------------------------------------
    // quatorze horas
    // ----------------------------------------------------------

    match = texto.match(
      /(?:às|as)\s+([a-záéíóúâêôãõç]+)\s+horas?/
    );

    if (match) {
      const hora = numeroPorExtenso(match[1]);

      if (
        Number.isInteger(hora) &&
        hora >= 0 &&
        hora <= 23
      ) {
        return (
          String(hora).padStart(2, "0") +
          ":00"
        );
      }
    }
  }

  return null;
}


// ============================================================
// DATA LOCAL EM YYYY-MM-DD
// ============================================================

function dataLocalISO(date) {
  const partes =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

  const ano =
    partes.find((p) => p.type === "year")?.value;

  const mes =
    partes.find((p) => p.type === "month")?.value;

  const dia =
    partes.find((p) => p.type === "day")?.value;

  return `${ano}-${mes}-${dia}`;
}


// ============================================================
// EXTRAI DATA
// ============================================================

function extrairData(textos, callCreated) {
  for (const textoOriginal of textos) {
    const texto = textoOriginal.toLowerCase();

    // ----------------------------------------------------------
    // dia 6 de setembro de 2026
    // ----------------------------------------------------------

    const match = texto.match(
      /(?:dia\s+)?(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/
    );

    if (match) {
      const dia = Number(match[1]);

      const nomeMes = normalizarTexto(match[2]);

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

      const mes = meses[nomeMes];
      const ano = Number(match[3]);

      if (mes) {
        return (
          `${ano}-` +
          `${String(mes).padStart(2, "0")}-` +
          `${String(dia).padStart(2, "0")}`
        );
      }
    }
  }

  // ------------------------------------------------------------
  // AMANHÃ
  // ------------------------------------------------------------

  if (
    textos.some((texto) =>
      normalizarTexto(texto).includes("amanha")
    )
  ) {
    const criada = new Date(callCreated);

    const dataLocal = dataLocalISO(criada);

    const [ano, mes, dia] =
      dataLocal.split("-").map(Number);

    const base = new Date(
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
      ).padStart(2, "0")}-` +
      `${String(
        base.getUTCDate()
      ).padStart(2, "0")}`
    );
  }

  // ------------------------------------------------------------
  // HOJE
  // ------------------------------------------------------------

  if (
    textos.some((texto) =>
      normalizarTexto(texto).includes("hoje")
    )
  ) {
    return dataLocalISO(
      new Date(callCreated)
    );
  }

  return null;
}


// ============================================================
// DESCOBRE TELEFONE DO CHAMADOR
// ============================================================

function obterTelefone(relatorio) {
  const participantes =
    Array.isArray(relatorio?.participants)
      ? relatorio.participants
      : [];

  for (const participante of participantes) {
    const caller =
      participante?.type?.caller?.number;

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
    process.env.GOTO_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GOTO_API_KEY não configurada"
    );
  }

  const response = await fetch(
    "https://goto-agendamento.vercel.app/api/agendar",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",

        "x-api-key":
          apiKey
      },

      body: JSON.stringify({
        data,
        horario,

        nome: telefone
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
      JSON.parse(text);
  } catch {
    result = text;
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
// HANDLER PRINCIPAL
// ============================================================

module.exports =
  async function handler(req, res) {
    try {
      // --------------------------------------------------------
      // OPTIONS
      // --------------------------------------------------------

      if (req.method === "OPTIONS") {
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

      if (req.method === "GET") {
        return res
          .status(200)
          .json({
            success: true,

            message:
              "Webhook GoTo ativo",

            automation:
              "Agendamento automático habilitado"
          });
      }


      // --------------------------------------------------------
      // SOMENTE POST
      // --------------------------------------------------------

      if (req.method !== "POST") {
        return res
          .status(405)
          .json({
            success: false,
            error:
              "Método não permitido"
          });
      }


      const payload = req.body;


      // --------------------------------------------------------
      // VALIDATION CODE
      // --------------------------------------------------------

      const validationCode =
        Array.isArray(payload)
          ? payload?.[0]?.data
              ?.validationCode
          : payload?.data
              ?.validationCode;

      if (validationCode) {
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
          !Array.isArray(payload) &&
          Object.keys(payload)
            .length === 0
        )
      ) {
        return res
          .status(200)
          .end();
      }


      console.log(
        "=============== GOTO EVENT ==============="
      );

      console.log(
        JSON.stringify(
          payload,
          null,
          2
        )
      );

      console.log(
        "=========================================="
      );


      // --------------------------------------------------------
      // NORMALIZA EVENTO
      // --------------------------------------------------------

      const evento =
        Array.isArray(payload)
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


      // --------------------------------------------------------
      // SOMENTE CONTA DEMO
      // --------------------------------------------------------

      if (
        accountKey &&
        accountKey !==
          GOTO_ACCOUNT_KEY
      ) {
        return res
          .status(200)
          .json({
            success: true,
            ignored: true,
            reason:
              "accountKey diferente"
          });
      }


      // --------------------------------------------------------
      // SOMENTE ENDING
      // --------------------------------------------------------

      if (
        state?.type !== "ENDING"
      ) {
        return res
          .status(200)
          .json({
            success: true,
            received: true,
            processed: false,
            state:
              state?.type || null
          });
      }


      if (!conversationSpaceId) {
        return res
          .status(200)
          .json({
            success: true,
            received: true,
            processed: false,
            reason:
              "conversationSpaceId não encontrado"
          });
      }


      console.log(
        "Processando chamada encerrada:",
        conversationSpaceId
      );


      // --------------------------------------------------------
      // TOKEN GOTO
      // --------------------------------------------------------

      const accessToken =
        await obterAccessTokenGoTo();


      // --------------------------------------------------------
      // CALL EVENTS REPORT
      // --------------------------------------------------------

      const relatorio =
        await obterRelatorio(
          conversationSpaceId,
          accessToken
        );


      console.log(
        "Call Reason:",
        relatorio?.callReason
      );


      // --------------------------------------------------------
      // CONFIRMA INFO_CAPTURE
      // --------------------------------------------------------

      const possuiCaptura =
        possuiCapturaAgendamento(
          relatorio
        );

      if (!possuiCaptura) {
        console.log(
          "Chamada não contém captura de agendamento."
        );

        return res
          .status(200)
          .json({
            success: true,
            received: true,
            processed: false,
            reason:
              "INFO_CAPTURE de agendamento não encontrado"
          });
      }


      // --------------------------------------------------------
      // EXTRAI DADOS
      // --------------------------------------------------------

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

      const horario =
        extrairHorario(textos);

      const data =
        extrairData(
          textos,
          relatorio
            ?.callCreated
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
            callReason:
              relatorio
                ?.callReason
          },
          null,
          2
        )
      );


      // --------------------------------------------------------
      // SEGURANÇA
      // --------------------------------------------------------

      if (
        !data ||
        !horario
      ) {
        return res
          .status(200)
          .json({
            success: true,
            received: true,
            processed: false,

            reason:
              "Data ou horário não identificado",

            data,
            horario,

            callReason:
              relatorio
                ?.callReason
          });
      }


      // --------------------------------------------------------
      // CRIA AGENDAMENTO
      // --------------------------------------------------------

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


      return res
        .status(200)
        .json({
          success: true,
          received: true,
          processed: true,

          conversationSpaceId,

          dadosExtraidos: {
            data,
            horario,
            telefone
          },

          agendamento:
            resultado
        });

    } catch (error) {
      console.error(
        "Erro webhook GoTo:",
        error
      );

      return res
        .status(200)
        .json({
          success: false,
          error:
            error.message
        });
    }
  };