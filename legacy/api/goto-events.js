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

const URL_AGENDAMENTO =
  `${URL_BASE}/api/agendamento`;

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
// EXTRAI DADOS DO FORMULÁRIO (INFO_CAPTURE)
// ============================================================

function extrairDadosFormulario(relatorio) {
  const dados = {
    nome: "",
    cpf: "",
    data: "",
    horario: ""
  };

  const actions = Array.isArray(relatorio?.actions) ? relatorio.actions : [];
  
  const actionForm = actions.find(
    (action) =>
      action?.type?.value === "INFO_CAPTURE" &&
      action?.type?.form?.name === FORMULARIO_AGENDAMENTO
  );

  if (!actionForm) {
    return dados;
  }

  const possiveisNomes = ["nome_cliente", "nome", "nome_completo"];
  const possiveisCPFs = ["cpf_cliente", "cpf"];
  const possiveisDatas = ["data_escolhida", "data"];
  const possiveisHorarios = ["horario_escolhido", "horario"];
  const chavesValor = ["value", "valor", "answer", "resposta", "text", "texto"];

  function buscarValor(obj, chavesBuscadas) {
    if (!obj || typeof obj !== "object") return null;

    for (const [key, value] of Object.entries(obj)) {
      if (chavesBuscadas.includes(key.toLowerCase())) {
        if (typeof value === "string" || typeof value === "number") {
          return String(value);
        }
        if (typeof value === "object" && value !== null) {
          for (const kValor of chavesValor) {
            if (value[kValor] !== undefined && value[kValor] !== null) {
              return String(value[kValor]);
            }
          }
        }
      }
      
      if (typeof value === "object" && value !== null) {
        const result = buscarValor(value, chavesBuscadas);
        if (result) return result;
      }
    }
    return null;
  }

  dados.nome = buscarValor(actionForm, possiveisNomes) || "";
  dados.cpf = buscarValor(actionForm, possiveisCPFs) || "";
  dados.data = buscarValor(actionForm, possiveisDatas) || "";
  dados.horario = buscarValor(actionForm, possiveisHorarios) || "";

  return dados;
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
// PORTUGUÊS + INGLÊS
// ============================================================

function identificarIntencao(
  callReason
) {
  const texto =
    normalizarTexto(
      callReason
    );


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
    "alterar a data",

    "reschedule",
    "rescheduling",
    "rescheduled",
    "change appointment",
    "change the appointment",
    "change appointment time",
    "change appointment date",
    "move appointment",
    "move the appointment"
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


  const palavrasCancelamento = [
    "cancelar",
    "cancelamento",
    "cancele",
    "cancelado",
    "desmarcar",
    "desmarcacao",

    "cancel",
    "cancellation",
    "canceling",
    "cancelling",
    "cancelled",
    "canceled"
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


  const palavrasAgendamento = [
    "agendar",
    "agendamento",
    "marcar",
    "compromisso",
    "horario",

    "schedule",
    "scheduling",
    "scheduled",
    "appointment",
    "book appointment",
    "booking appointment",
    "make an appointment"
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
// PORTUGUÊS + INGLÊS
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
  // 8:00 AM / 8:30 PM
  // Deve vir ANTES do parser 24h genérico.
  // ----------------------------------------------------------

  match =
    texto.match(
      /\b(1[0-2]|0?[1-9]):([0-5]\d)\s*(a\.?\s*m\.?|p\.?\s*m\.?)\b/i
    );


  if (match) {
    let hora =
      Number(
        match[1]
      );


    const minuto =
      Number(
        match[2]
      );


    const periodo =
      normalizarTexto(
        match[3]
      )
        .replace(
          /\s/g,
          ""
        )
        .replace(
          /\./g,
          ""
        );


    if (
      periodo === "pm" &&
      hora !== 12
    ) {
      hora += 12;
    }


    if (
      periodo === "am" &&
      hora === 12
    ) {
      hora = 0;
    }


    return (
      String(
        hora
      ).padStart(
        2,
        "0"
      ) +
      ":" +
      String(
        minuto
      ).padStart(
        2,
        "0"
      )
    );
  }


  // ----------------------------------------------------------
  // 8 AM / 8 PM
  // ----------------------------------------------------------

  match =
    texto.match(
      /\b(1[0-2]|0?[1-9])\s*(a\.?\s*m\.?|p\.?\s*m\.?)\b/i
    );


  if (match) {
    let hora =
      Number(
        match[1]
      );


    const periodo =
      normalizarTexto(
        match[2]
      )
        .replace(
          /\s/g,
          ""
        )
        .replace(
          /\./g,
          ""
        );


    if (
      periodo === "pm" &&
      hora !== 12
    ) {
      hora += 12;
    }


    if (
      periodo === "am" &&
      hora === 12
    ) {
      hora = 0;
    }


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
// MONTA DATA ISO
// ============================================================

function montarDataISO(
  ano,
  mes,
  dia
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


// ============================================================
// VALIDA DATA REAL
// ============================================================

function dataExiste(
  ano,
  mes,
  dia
) {
  const data =
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


  return (
    data.getUTCFullYear() ===
      ano &&

    data.getUTCMonth() ===
      mes - 1 &&

    data.getUTCDate() ===
      dia
  );
}


// ============================================================
// DEFINE ANO PARA DATA SEM ANO
// ============================================================

function resolverAnoDataSemAno(
  anoAtual,
  mesAtual,
  diaAtual,
  mes,
  dia
) {
  let ano =
    anoAtual;


  if (
    !dataExiste(
      ano,
      mes,
      dia
    )
  ) {
    return null;
  }


  const dataInformada =
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


  const dataChamada =
    new Date(
      Date.UTC(
        anoAtual,
        mesAtual - 1,
        diaAtual,
        12,
        0,
        0
      )
    );


  if (
    dataInformada <
    dataChamada
  ) {
    ano =
      anoAtual + 1;
  }


  if (
    !dataExiste(
      ano,
      mes,
      dia
    )
  ) {
    return null;
  }


  return ano;
}


// ============================================================
// EXTRAI DATA
// PORTUGUÊS + INGLÊS
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


  const textoNormalizado =
    normalizarTexto(
      texto
    );


  const meses = {
    // Português
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
    dezembro: 12,

    // Inglês
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,

    // Inglês abreviado
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    sept: 9,
    oct: 10,
    nov: 11,
    dec: 12
  };


  const criada =
    new Date(
      callCreated
    );


  const dataLocal =
    dataLocalISO(
      criada
    );


  const [
    anoAtual,
    mesAtual,
    diaAtual
  ] =
    dataLocal
      .split("-")
      .map(Number);


  let match;


  // ==========================================================
  // PORTUGUÊS
  // 8 DE SETEMBRO DE 2026
  // ==========================================================

  match =
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
      dataExiste(
        ano,
        mes,
        dia
      )
    ) {
      return montarDataISO(
        ano,
        mes,
        dia
      );
    }
  }


  // ==========================================================
  // PORTUGUÊS
  // 8 DE SETEMBRO
  // ==========================================================

  match =
    texto.match(
      /(?:dia\s+)?(\d{1,2})\s+de\s+([a-záéíóúâêôãõç]+)(?!\s+de\s+\d{4})/
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


    const mes =
      meses[
        nomeMes
      ];


    if (mes) {
      const ano =
        resolverAnoDataSemAno(
          anoAtual,
          mesAtual,
          diaAtual,
          mes,
          dia
        );


      if (ano) {
        return montarDataISO(
          ano,
          mes,
          dia
        );
      }
    }
  }


  // ==========================================================
  // INGLÊS
  // SEPTEMBER 9TH, 2026
  // SEPTEMBER 9, 2026
  // ==========================================================

  match =
    texto.match(
      /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/i
    );


  if (match) {
    const nomeMes =
      normalizarTexto(
        match[1]
      );


    const mes =
      meses[
        nomeMes
      ];


    const dia =
      Number(
        match[2]
      );


    const ano =
      Number(
        match[3]
      );


    if (
      mes &&
      dataExiste(
        ano,
        mes,
        dia
      )
    ) {
      return montarDataISO(
        ano,
        mes,
        dia
      );
    }
  }


  // ==========================================================
  // INGLÊS
  // SEPTEMBER 9TH
  // SEPTEMBER 9
  // ==========================================================

  match =
    texto.match(
      /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
    );


  if (match) {
    const nomeMes =
      normalizarTexto(
        match[1]
      );


    const mes =
      meses[
        nomeMes
      ];


    const dia =
      Number(
        match[2]
      );


    if (mes) {
      const ano =
        resolverAnoDataSemAno(
          anoAtual,
          mesAtual,
          diaAtual,
          mes,
          dia
        );


      if (ano) {
        return montarDataISO(
          ano,
          mes,
          dia
        );
      }
    }
  }


  // ==========================================================
  // INGLÊS
  // 9TH OF SEPTEMBER 2026
  // 9 OF SEPTEMBER 2026
  // ==========================================================

  match =
    texto.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\s+(\d{4})\b/i
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
      dataExiste(
        ano,
        mes,
        dia
      )
    ) {
      return montarDataISO(
        ano,
        mes,
        dia
      );
    }
  }


  // ==========================================================
  // INGLÊS
  // 9TH OF SEPTEMBER
  // ==========================================================

  match =
    texto.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)([a-z]+)\b/i
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


    const mes =
      meses[
        nomeMes
      ];


    if (mes) {
      const ano =
        resolverAnoDataSemAno(
          anoAtual,
          mesAtual,
          diaAtual,
          mes,
          dia
        );


      if (ano) {
        return montarDataISO(
          ano,
          mes,
          dia
        );
      }
    }
  }


  // ==========================================================
  // SOMENTE DIA (PORTUGUÊS E INGLÊS)
  // ==========================================================

  match =
    texto.match(
      /\b(?:no\s+|para\s+o\s+)?dia\s+(\d{1,2})\b/
    ) ||
    texto.match(
      /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/
    );


  if (match) {
    const diaEscolhido =
      Number(
        match[1]
      );


    let mesPrevisto =
      mesAtual;


    let anoPrevisto =
      anoAtual;


    if (
      diaEscolhido < diaAtual
    ) {
      mesPrevisto++;


      if (
        mesPrevisto > 12
      ) {
        mesPrevisto = 1;

        anoPrevisto++;
      }
    }


    if (
      dataExiste(
        anoPrevisto,
        mesPrevisto,
        diaEscolhido
      )
    ) {
      return montarDataISO(
        anoPrevisto,
        mesPrevisto,
        diaEscolhido
      );
    }
  }


  // ==========================================================
  // DEPOIS DE AMANHÃ
  // Precisa vir antes de "amanhã".
  // ==========================================================

  if (
    textoNormalizado.includes(
      "depois de amanha"
    ) ||
    textoNormalizado.includes(
      "day after tomorrow"
    )
  ) {
    const base =
      new Date(
        Date.UTC(
          anoAtual,
          mesAtual - 1,
          diaAtual,
          12,
          0,
          0
        )
      );


    base.setUTCDate(
      base.getUTCDate() + 2
    );


    return montarDataISO(
      base.getUTCFullYear(),
      base.getUTCMonth() + 1,
      base.getUTCDate()
    );
  }


  // ==========================================================
  // AMANHÃ / TOMORROW
  // ==========================================================

  if (
    textoNormalizado.includes(
      "amanha"
    ) ||
    textoNormalizado.includes(
      "tomorrow"
    )
  ) {
    const base =
      new Date(
        Date.UTC(
          anoAtual,
          mesAtual - 1,
          diaAtual,
          12,
          0,
          0
        )
      );


    base.setUTCDate(
      base.getUTCDate() + 1
    );


    return montarDataISO(
      base.getUTCFullYear(),
      base.getUTCMonth() + 1,
      base.getUTCDate()
    );
  }


  // ==========================================================
  // HOJE / TODAY
  // ==========================================================

  if (
    textoNormalizado.includes(
      "hoje"
    ) ||
    textoNormalizado.includes(
      "today"
    )
  ) {
    return dataLocal;
  }


  // ==========================================================
  // DIAS DA SEMANA
  // PORTUGUÊS + INGLÊS
  // ==========================================================

  const diasSemana = [
    {
      nomes: [
        "domingo",
        "sunday"
      ],
      numero: 0
    },

    {
      nomes: [
        "segunda",
        "segunda-feira",
        "segunda feira",
        "monday"
      ],
      numero: 1
    },

    {
      nomes: [
        "terca",
        "terca-feira",
        "terca feira",
        "tuesday"
      ],
      numero: 2
    },

    {
      nomes: [
        "quarta",
        "quarta-feira",
        "quarta feira",
        "wednesday"
      ],
      numero: 3
    },

    {
      nomes: [
        "quinta",
        "quinta-feira",
        "quinta feira",
        "thursday"
      ],
      numero: 4
    },

    {
      nomes: [
        "sexta",
        "sexta-feira",
        "sexta feira",
        "friday"
      ],
      numero: 5
    },

    {
      nomes: [
        "sabado",
        "saturday"
      ],
      numero: 6
    }
  ];


  for (
    const diaSemana
    of diasSemana
  ) {
    const encontrado =
      diaSemana.nomes.some(
        (nome) =>
          textoNormalizado.includes(
            nome
          )
      );


    if (!encontrado) {
      continue;
    }


    const base =
      new Date(
        Date.UTC(
          anoAtual,
          mesAtual - 1,
          diaAtual,
          12,
          0,
          0
        )
      );


    const atual =
      base.getUTCDay();


    let diferenca =
      (
        diaSemana.numero -
        atual +
        7
      ) % 7;


    if (
      diferenca === 0
    ) {
      diferenca = 7;
    }


    base.setUTCDate(
      base.getUTCDate() +
      diferenca
    );


    return montarDataISO(
      base.getUTCFullYear(),
      base.getUTCMonth() + 1,
      base.getUTCDate()
    );
  }


  return null;
}


// ============================================================
// TELEFONE DO CHAMADOR
// ============================================================

function obterTelefone(
  relatorio
) {
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
// CHAMA API UNIFICADA
// ============================================================

async function chamarApiAgendamento(
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
      URL_AGENDAMENTO,
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


    const accessToken =
      await obterAccessTokenGoTo();


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
    // DIAGNÓSTICO TEMPORÁRIO
    // ==========================================================
    const relatorioSanitizado = JSON.parse(JSON.stringify(relatorio));
    
    const sanitizarObj = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizarObj(obj[key]);
        } else if (typeof obj[key] === 'string') {
          const lKey = key.toLowerCase();
          if (lKey.includes('token') || lKey.includes('secret') || lKey.includes('key')) {
            obj[key] = '*** REDACTED ***';
          }
        }
      }
    };
    sanitizarObj(relatorioSanitizado);

    console.log(
      "===== CALL EVENTS REPORT COMPLETO =====",
      JSON.stringify(relatorioSanitizado, null, 2)
    );

    const targetKeys = [
      "nome_cliente", "cpf_cliente", "data_escolhida", "horario_escolhido",
      "nome", "cpf", "data", "horario"
    ];

    const foundPaths = {};
    targetKeys.forEach(k => foundPaths[k] = []);

    function searchPaths(obj, currentPath) {
      if (!obj) return;
      if (typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          const newPath = currentPath ? `${currentPath}.${k}` : k;
          
          targetKeys.forEach(target => {
            if (k.toLowerCase().includes(target)) {
              foundPaths[target].push(`${newPath} (CHAVE)`);
            }
          });

          if (typeof v === 'string') {
            const vLower = v.toLowerCase();
            targetKeys.forEach(target => {
              if (vLower.includes(target)) {
                foundPaths[target].push(`${newPath} = "${v}"`);
              }
            });
          }

          if (typeof v === 'object' && v !== null) {
            searchPaths(v, newPath);
          }
        }
      }
    }

    searchPaths(relatorio, "relatorio");

    console.log("===== BUSCA DE CAMPOS CAPTURADOS =====");
    targetKeys.forEach(target => {
      console.log(`\n${target}:`);
      if (foundPaths[target].length > 0) {
        foundPaths[target].forEach(p => console.log(p));
      } else {
        console.log(`Nenhuma ocorrência encontrada para ${target}`);
      }
    });
    // ==========================================================


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


    const intencao =
      identificarIntencao(
        callReason
      );


    console.log(
      "INTENÇÃO IDENTIFICADA:",
      intencao
    );


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
        await chamarApiAgendamento({
          acao:
            "cancelar",

          telefone,

          conversationSpaceId,

          callReason
        });


      console.log(
        "RESULTADO /API/AGENDAMENTO - CANCELAR:",
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
        "Fluxo escolhido: REAGENDAMENTO"
      );


      console.log(
        "Reagendamento aguardando fluxo interativo da Custom Connection."
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

      console.log(
        "Agendamento é executado em tempo real pela Custom Connection."
      );

      console.log(
        "Nenhuma criação pós-chamada será executada."
      );

      return;
    }


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

            api:
              "/api/agendamento",

            mode:
              "api-unificada-bilingue",

            background:
              true,

            agendamento:
              true,

            cancelamento:
              true,

            reagendamento:
              "aguardando fluxo interativo"
          });
      }


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


      console.log(
        "Disparando processamento:",
        conversationSpaceId
      );


      waitUntil(
        processarChamada(
          conversationSpaceId
        )
      );


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