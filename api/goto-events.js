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
// CONSULTA CALL EVENTS REPORT COM RETENTATIVA
// ============================================================

async function obterRelatorio(
  conversationSpaceId,
  accessToken
) {
  const url =
    "https://api.goto.com/call-events-report/v1/reports/" +
    encodeURIComponent(conversationSpaceId);

  const maxTentativas = 5;

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

    if (response.ok) {
      console.log(
        `Call Events Report disponível na tentativa ${tentativa}`
      );

      return data;
    }

    // O evento ENDING pode chegar antes de o relatório
    // pós-chamada estar completamente disponível.
    if (
      response.status === 404 &&
      tentativa < maxTentativas
    ) {
      console.log(
        `Relatório ainda não disponível. Aguardando 2 segundos antes da próxima tentativa...`
      );

      await esperar(2000);
      continue;
    }

    throw new Error(
      `Erro Call Events Report ${response.status}: ${JSON.stringify(data)}`
    );
  }

  throw new Error(
    "Call Events Report não ficou disponível após várias tentativas"
  );
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
// CONVERTE NÚMERO POR EXTENSO
// ============================================================

function numeroPorExtenso(texto) {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

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
    dezessete: 17,
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

    // 14:45
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

    // 14h45
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

    // às 17 horas
    match = texto.match(
      /(?:às|as)\s+([01]?\d|2[0-3])(?:\s*horas?)?\b/
    );

    if (match) {
      return (
        String(Number(match[1])).padStart(2, "0") +
        ":00"
      );
    }

    // às dez e meia
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

    // às quatorze horas
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

    const match = texto.match(
      /(?:dia\s+)?(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/
    );

    if (match) {
      const dia = Number(match[1]);

      const nomeMes = match[2]
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

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

  // amanhã
  if (
    textos.some((texto) =>
      texto.toLowerCase().includes("amanhã")
    )
  ) {
    const criada = new Date(callCreated);

    const dataLocal = dataLocalISO(criada);

    const [ano, mes, dia] =
      dataLocal.split("-").map(Number);

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

  // hoje
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
        nome: telefone
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
    // OPTIONS
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

    // GET
    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Webhook GoTo ativo",
        automation:
          "Agendamento automático habilitado"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido"
      });
    }

    const payload = req.body;

    // validationCode
    const validationCode =
      Array.isArray(payload)
        ? payload?.[0]?.data?.validationCode
        : payload?.data?.validationCode;

    if (validationCode) {
      return res.status(200).json({
        validationResponse: validationCode
      });
    }

    // POST vazio
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

    // Só conta demo
    if (
      accountKey &&
      accountKey !== GOTO_ACCOUNT_KEY
    ) {
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: "accountKey diferente"
      });
    }

    // Só processa ao terminar
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

    // Token GoTo
    const accessToken =
      await obterAccessTokenGoTo();

    // Call Events Report
    const relatorio =
      await obterRelatorio(
        conversationSpaceId,
        accessToken
      );

    console.log(
      "Call Reason:",
      relatorio?.callReason
    );

    // Confirma INFO_CAPTURE
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

    // Extrai dados
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

    // Não cria nada se não tiver certeza da data/hora
    if (!data || !horario) {
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

    // Cria agendamento
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

    return res.status(200).json({
      success: false,
      error: error.message
    });
  }
};