// ============================================================
// CONFIGURAÇÕES DO POC
// ============================================================

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
        "Content-Type":
          "application/x-www-form-urlencoded",
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
// CONSULTA CALL EVENTS REPORT
// ============================================================

async function obterRelatorio(
  conversationSpaceId,
  accessToken
) {
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
    throw new Error(
      `Erro Call Events Report ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}


// ============================================================
// VERIFICA SE FOI NOSSO FORMULÁRIO DE AGENDAMENTO
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
// RETORNA TEXTO MAIS ÚTIL PARA EXTRAÇÃO
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
// CONVERTE NÚMEROS EM PORTUGUÊS
// ============================================================

function numeroPorExtenso(texto) {
  const mapa = {
    zero: 0,
    uma: 1,
    um: 1,
    duas: 2,
    dois: 2,
    tres: 3,
    três: 3,
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
    vinte: 20,
    trinta: 30,
    quarenta: 40,
    cinquenta: 50
  };

  return mapa[
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  ];
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
    // 14h45
    // ----------------------------------------------------------

    match = texto.match(
      /\b([01]?\d|2[0-3])h([0-5]\d)\b/
    );

    if (match) {
      return (
        String(Number(match[1])).padStart(2, "0") +
        ":" +
        match[2]
      );
    }

    // ----------------------------------------------------------
    // 17 horas / às 17
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
// FORMATA DATA YYYY-MM-DD NO FUSO DE SÃO PAULO
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
  const meses = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    março: 3,
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

      const nomeMes = match[2]
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      const mapaNormalizado = {
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

      const mes = mapaNormalizado[nomeMes];

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
  // amanhã
  // ------------------------------------------------------------

  if (
    textos.some((texto) =>
      texto.toLowerCase().includes("amanhã")
    )
  ) {
    const criada = new Date(callCreated);

    const dataLocal = dataLocalISO(criada);

    const [ano, mes, dia] =
      dataLocal.split("-").map(Number);

    // Meio-dia evita problemas de DST ao somar dia.
    const base = new Date(
      Date.UTC(ano, mes - 1, dia, 12, 0, 0)
    );

    base.setUTCDate(base.getUTCDate() + 1);

    return (
      `${base.getUTCFullYear()}-` +
      `${String(base.getUTCMonth() + 1).padStart(2, "0")}-` +
      `${String(base.getUTCDate()).padStart(2, "0")}`
    );
  }

  // ------------------------------------------------------------
  // hoje
  // ------------------------------------------------------------

  if (
    textos.some((texto) =>
      texto.toLowerCase().includes("hoje")
    )
  ) {
    return dataLocalISO(new Date(callCreated));
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

    const number =
      participante?.type?.number;

    if (
      number &&
      participante?.type?.value === "PHONE_NUMBER"
    ) {
      return number;
    }
  }

  return "";
}


// ============================================================
// CHAMA NOSSA API DE AGENDAMENTO
// ============================================================

async function criarAgendamento({
  data,
  horario,
  telefone,
  conversationSpaceId
}) {
  const apiKey = process.env.GOTO_API_KEY;

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
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
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

  const text = await response.text();

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    result = text;
  }

  return {
    status: response.status,
    ok: response.ok,
    result
  };
}


// ============================================================
// HANDLER PRINCIPAL
// ============================================================

module.exports = async function handler(req, res) {
  try {
    // ----------------------------------------------------------
    // VALIDAÇÃO DO WEBHOOK
    // ----------------------------------------------------------

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

      return res.status(200).end();
    }


    // ----------------------------------------------------------
    // TESTE MANUAL
    // ----------------------------------------------------------

    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Webhook GoTo ativo",
        automation: "Agendamento automático habilitado"
      });
    }


    // ----------------------------------------------------------
    // SOMENTE POST
    // ----------------------------------------------------------

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido"
      });
    }


    const payload = req.body;


    // ----------------------------------------------------------
    // VALIDATION CODE
    // ----------------------------------------------------------

    const validationCode =
      Array.isArray(payload)
        ? payload?.[0]?.data?.validationCode
        : payload?.data?.validationCode;

    if (validationCode) {
      return res.status(200).json({
        validationResponse: validationCode
      });
    }


    // ----------------------------------------------------------
    // POST VAZIO
    // ----------------------------------------------------------

    if (
      !payload ||
      (
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload).length === 0
      )
    ) {
      return res.status(200).end();
    }


    console.log(
      "=============== GOTO EVENT ==============="
    );

    console.log(
      JSON.stringify(payload, null, 2)
    );

    console.log(
      "=========================================="
    );


    // ----------------------------------------------------------
    // NORMALIZA EVENTO
    // ----------------------------------------------------------

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
      metadata?.conversationSpaceId;

    const accountKey =
      metadata?.accountKey;


    // ----------------------------------------------------------
    // SOMENTE NOSSA CONTA DEMO
    // ----------------------------------------------------------

    if (
      accountKey &&
      accountKey !== GOTO_ACCOUNT_KEY
    ) {
      console.log(
        "Evento ignorado - accountKey diferente:",
        accountKey
      );

      return res.status(200).json({
        success: true,
        ignored: true,
        reason: "accountKey diferente"
      });
    }


    // ----------------------------------------------------------
    // ESPERA A CHAMADA TERMINAR
    // ----------------------------------------------------------

    if (state?.type !== "ENDING") {
      return res.status(200).json({
        success: true,
        received: true,
        processed: false,
        state: state?.type || null
      });
    }


    if (!conversationSpaceId) {
      return res.status(200).json({
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


    // ----------------------------------------------------------
    // TOKEN GOTO
    // ----------------------------------------------------------

    const accessToken =
      await obterAccessTokenGoTo();


    // ----------------------------------------------------------
    // CALL EVENTS REPORT
    // ----------------------------------------------------------

    const relatorio =
      await obterRelatorio(
        conversationSpaceId,
        accessToken
      );


    console.log(
      "Call Reason:",
      relatorio?.callReason
    );


    // ----------------------------------------------------------
    // VERIFICA INFO_CAPTURE
    // ----------------------------------------------------------

    const possuiCaptura =
      possuiCapturaAgendamento(relatorio);

    if (!possuiCaptura) {
      console.log(
        "Chamada não contém captura de agendamento."
      );

      return res.status(200).json({
        success: true,
        received: true,
        processed: false,
        reason:
          "INFO_CAPTURE de agendamento não encontrado"
      });
    }


    // ----------------------------------------------------------
    // EXTRAI DADOS
    // ----------------------------------------------------------

    const textos =
      obterTextosDaInteracao(relatorio);

    const horario =
      extrairHorario(textos);

    const data =
      extrairData(
        textos,
        relatorio?.callCreated
      );

    const telefone =
      obterTelefone(relatorio);


    console.log(
      "DADOS EXTRAÍDOS:",
      JSON.stringify(
        {
          data,
          horario,
          telefone,
          callReason:
            relatorio?.callReason
        },
        null,
        2
      )
    );


    // ----------------------------------------------------------
    // SEGURANÇA:
    // NÃO AGENDA SE NÃO ENTENDER DATA/HORA
    // ----------------------------------------------------------

    if (!data || !horario) {
      console.log(
        "Não foi possível extrair data/horário."
      );

      return res.status(200).json({
        success: true,
        received: true,
        processed: false,
        reason:
          "Data ou horário não identificado",
        data,
        horario,
        callReason:
          relatorio?.callReason
      });
    }


    // ----------------------------------------------------------
    // CRIA O AGENDAMENTO
    // ----------------------------------------------------------

    const resultado =
      await criarAgendamento({
        data,
        horario,
        telefone,
        conversationSpaceId
      });


    console.log(
      "RESULTADO AGENDAMENTO:",
      JSON.stringify(resultado, null, 2)
    );


    return res.status(200).json({
      success: true,
      received: true,
      processed: true,

      conversationSpaceId,

      dadosExtraidos: {
        data,
        horario,
        telefone
      },

      agendamento: resultado
    });

  } catch (error) {
    console.error(
      "Erro webhook GoTo:",
      error
    );

    // Retornamos 200 para o GoTo não ficar
    // reenviando indefinidamente durante o POC.
    return res.status(200).json({
      success: false,
      error: error.message
    });
  }
};