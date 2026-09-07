// ============================================================
// CONFIGURAÇÕES
// ============================================================

const MAILBOX_ID =
  "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

const GRAPH_TIMEZONE =
  "E. South America Standard Time";

const OFFSET =
  "-03:00";

const DURACAO_MINUTOS =
  60;

const HORARIOS_POSSIVEIS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00"
];


// ============================================================
// NORMALIZA TEXTO
// ============================================================

function normalizarTexto(valor) {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}


// ============================================================
// NORMALIZA TELEFONE
// ============================================================

function normalizarTelefone(telefone) {
  return String(telefone || "")
    .replace(/\D/g, "");
}


// ============================================================
// DADOS RECEBIDOS
// ============================================================

function obterDados(req) {
  return {
    ...(req.query || {}),
    ...(req.body || {})
  };
}


// ============================================================
// VALIDA DATA
// ============================================================

function dataValida(data) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(data || "")
  );
}


// ============================================================
// VALIDA HORÁRIO
// ============================================================

function horarioValido(horario) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(
    String(horario || "")
  );
}


// ============================================================
// SOMA MINUTOS SEM ALTERAR O FUSO LÓGICO
// ============================================================

function somarMinutosLocal(
  data,
  horario,
  minutosAdicionar
) {
  const [ano, mes, dia] =
    data.split("-").map(Number);

  const [hora, minuto] =
    horario.split(":").map(Number);

  const calculo =
    new Date(
      Date.UTC(
        ano,
        mes - 1,
        dia,
        hora,
        minuto,
        0
      )
    );

  calculo.setUTCMinutes(
    calculo.getUTCMinutes() +
    minutosAdicionar
  );

  const dataFinal =
    `${calculo.getUTCFullYear()}-` +
    `${String(
      calculo.getUTCMonth() + 1
    ).padStart(2, "0")}-` +
    `${String(
      calculo.getUTCDate()
    ).padStart(2, "0")}`;

  const horarioFinal =
    `${String(
      calculo.getUTCHours()
    ).padStart(2, "0")}:` +
    `${String(
      calculo.getUTCMinutes()
    ).padStart(2, "0")}`;

  return {
    data: dataFinal,
    horario: horarioFinal,
    dateTime:
      `${dataFinal}T${horarioFinal}:00`
  };
}


// ============================================================
// PRÓXIMO DIA
// ============================================================

function proximoDia(data) {
  const [ano, mes, dia] =
    data.split("-").map(Number);

  const calculo =
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

  calculo.setUTCDate(
    calculo.getUTCDate() + 1
  );

  return (
    `${calculo.getUTCFullYear()}-` +
    `${String(
      calculo.getUTCMonth() + 1
    ).padStart(2, "0")}-` +
    `${String(
      calculo.getUTCDate()
    ).padStart(2, "0")}`
  );
}


// ============================================================
// FORMATA DATA PARA FALA
// ============================================================

function formatarDataFalada(dateTime) {
  if (!dateTime) {
    return "";
  }

  const data =
    String(dateTime)
      .substring(0, 10);

  const [ano, mes, dia] =
    data.split("-").map(Number);

  const nomesMeses = [
    "",
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro"
  ];

  return (
    `${dia} de ${nomesMeses[mes]} de ${ano}`
  );
}


// ============================================================
// FORMATA HORÁRIO PARA FALA
// ============================================================

function falarHorario(horario) {
  if (!horario) {
    return "";
  }

  const [hora, minuto] =
    horario
      .substring(0, 5)
      .split(":")
      .map(Number);

  if (
    hora === 12 &&
    minuto === 0
  ) {
    return "meio-dia";
  }

  if (minuto === 0) {
    return `${hora} horas`;
  }

  if (minuto === 30) {
    return `${hora} e meia`;
  }

  return `${hora} e ${minuto}`;
}


// ============================================================
// OBTÉM TOKEN MICROSOFT GRAPH
// ============================================================

async function obterAccessTokenGraph() {
  const tenantId =
    process.env.AZURE_TENANT_ID;

  const clientId =
    process.env.AZURE_CLIENT_ID;

  const clientSecret =
    process.env.AZURE_CLIENT_SECRET;

  if (
    !tenantId ||
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "AZURE_TENANT_ID, AZURE_CLIENT_ID ou AZURE_CLIENT_SECRET não configurados"
    );
  }

  const response =
    await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            client_id:
              clientId,

            client_secret:
              clientSecret,

            scope:
              "https://graph.microsoft.com/.default",

            grant_type:
              "client_credentials"
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
      `Erro ao obter token Graph ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (!data?.access_token) {
    throw new Error(
      "Microsoft Graph não retornou access_token"
    );
  }

  return data.access_token;
}


// ============================================================
// REQUISIÇÃO GRAPH
// ============================================================

async function graphRequest({
  accessToken,
  url,
  method = "GET",
  body = null
}) {
  const headers = {
    Authorization:
      `Bearer ${accessToken}`,

    Prefer:
      `outlook.timezone="${GRAPH_TIMEZONE}"`
  };

  if (body !== null) {
    headers["Content-Type"] =
      "application/json";
  }

  const response =
    await fetch(
      url,
      {
        method,
        headers,

        body:
          body !== null
            ? JSON.stringify(body)
            : undefined
      }
    );

  if (
    response.status === 204
  ) {
    return {
      ok: true,
      status: 204,
      data: null
    };
  }

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
// CONSULTA CALENDÁRIO POR INTERVALO
// ============================================================

async function consultarCalendarView({
  accessToken,
  inicio,
  fim,
  select =
    "id,subject,start,end,isAllDay,bodyPreview,body,webLink"
}) {
  const url =
    `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}` +
    `/calendarView` +
    `?startDateTime=${encodeURIComponent(inicio)}` +
    `&endDateTime=${encodeURIComponent(fim)}` +
    `&$top=100` +
    `&$select=${encodeURIComponent(select)}`;

  const resultado =
    await graphRequest({
      accessToken,
      url
    });

  if (!resultado.ok) {
    throw new Error(
      `Erro ao consultar calendário ${resultado.status}: ${JSON.stringify(resultado.data)}`
    );
  }

  return Array.isArray(
    resultado.data?.value
  )
    ? resultado.data.value
    : [];
}


// ============================================================
// VERIFICA DISPONIBILIDADE DE UM INTERVALO
// ============================================================

async function verificarIntervaloLivre({
  accessToken,
  data,
  horario,
  duracaoMinutos =
    DURACAO_MINUTOS,
  ignorarEventoId = null
}) {
  const fimCalculado =
    somarMinutosLocal(
      data,
      horario,
      duracaoMinutos
    );

  const inicioConsulta =
    `${data}T${horario}:00${OFFSET}`;

  const fimConsulta =
    `${fimCalculado.data}T${fimCalculado.horario}:00${OFFSET}`;

  const eventos =
    await consultarCalendarView({
      accessToken,
      inicio:
        inicioConsulta,
      fim:
        fimConsulta
    });

  const conflitos =
    eventos.filter(
      (evento) => {
        if (
          ignorarEventoId &&
          evento.id ===
            ignorarEventoId
        ) {
          return false;
        }

        return true;
      }
    );

  return {
    livre:
      conflitos.length === 0,

    conflitos,

    fim:
      fimCalculado
  };
}


// ============================================================
// CONSULTAR DISPONIBILIDADE
// ============================================================

async function acaoConsultarDisponibilidade({
  accessToken,
  dados
}) {
  const data =
    dados.data;

  if (!dataValida(data)) {
    return {
      status: 400,

      body: {
        success: false,
        error:
          "Data inválida. Use YYYY-MM-DD."
      }
    };
  }

  const inicioDia =
    `${data}T00:00:00${OFFSET}`;

  const diaSeguinte =
    proximoDia(
      data
    );

  const fimDia =
    `${diaSeguinte}T00:00:00${OFFSET}`;

  const eventos =
    await consultarCalendarView({
      accessToken,
      inicio:
        inicioDia,
      fim:
        fimDia,

      select:
        "id,subject,start,end,isAllDay"
    });

  function horarioEstaLivre(
    horario
  ) {
    const [hora, minuto] =
      horario
        .split(":")
        .map(Number);

    const inicioSlot =
      new Date(
        `${data}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00${OFFSET}`
      );

    const fimSlot =
      new Date(
        inicioSlot.getTime() +
        DURACAO_MINUTOS *
          60 *
          1000
      );

    return !eventos.some(
      (evento) => {
        if (
          evento.isAllDay
        ) {
          return true;
        }

        const inicioEvento =
          new Date(
            `${evento.start.dateTime}${OFFSET}`
          );

        const fimEvento =
          new Date(
            `${evento.end.dateTime}${OFFSET}`
          );

        return (
          inicioSlot <
            fimEvento &&
          fimSlot >
            inicioEvento
        );
      }
    );
  }

  const horariosLivres =
    HORARIOS_POSSIVEIS.filter(
      horarioEstaLivre
    );

  const selecionados =
    horariosLivres.slice(
      0,
      4
    );

  let mensagem;

  if (
    selecionados.length === 0
  ) {
    mensagem =
      "Não encontrei horários disponíveis para essa data.";
  } else if (
    selecionados.length === 1
  ) {
    mensagem =
      `Tenho disponibilidade às ${falarHorario(selecionados[0])}.`;
  } else {
    const falados =
      selecionados.map(
        falarHorario
      );

    const ultimo =
      falados.pop();

    mensagem =
      `Tenho disponibilidade às ${falados.join(", ")} ou ${ultimo}.`;
  }

  return {
    status: 200,

    body: {
      success: true,

      acao:
        "consultar_disponibilidade",

      data,

      disponivel:
        horariosLivres.length > 0,

      quantidade:
        horariosLivres.length,

      horario1:
        selecionados[0] || "",

      horario2:
        selecionados[1] || "",

      horario3:
        selecionados[2] || "",

      horario4:
        selecionados[3] || "",

      horarios:
        horariosLivres,

      mensagem
    }
  };
}


// ============================================================
// LOCALIZA EVENTOS PELO CPF OU TELEFONE
// ============================================================

function localizarEventosCpfTelefone(
  eventos,
  cpfEsperado,
  telefoneEsperado
) {
  const numTelEsperado = normalizarTelefone(telefoneEsperado);
  const numCpfEsperado = normalizarTelefone(cpfEsperado); // removes non-digits

  if (!numTelEsperado && !numCpfEsperado) {
    return [];
  }

  return eventos.filter((evento) => {
    let matches = false;
    
    // Check subject
    const assuntoStr = String(evento?.subject || "");
    const subjectDigits = normalizarTelefone(assuntoStr);
    
    if (numTelEsperado && subjectDigits.includes(numTelEsperado)) matches = true;
    if (numCpfEsperado && subjectDigits.includes(numCpfEsperado)) matches = true;
    
    // Check body content robustly
    const bodyContent = String(evento?.body?.content || evento?.bodyPreview || "");
    
    // Check for explicit "Telefone: +5511999999999" format
    if (numTelEsperado) {
      const phoneMatch = bodyContent.match(/Telefone:\s*([+\d\s.-]+)/i);
      if (phoneMatch) {
        const phoneFound = normalizarTelefone(phoneMatch[1]);
        if (phoneFound.includes(numTelEsperado) || numTelEsperado.includes(phoneFound)) {
          matches = true;
        }
      } else if (normalizarTelefone(bodyContent).includes(numTelEsperado)) {
         matches = true;
      }
    }
    
    // Check for explicit "CPF: 123.456.789-00" format
    if (numCpfEsperado) {
      const cpfMatch = bodyContent.match(/CPF:\s*([\d\s.-]+)/i);
      if (cpfMatch) {
        const cpfFound = normalizarTelefone(cpfMatch[1]);
        if (cpfFound === numCpfEsperado) {
          matches = true;
        }
      } else if (normalizarTelefone(bodyContent).includes(numCpfEsperado)) {
         matches = true;
      }
    }

    return matches;
  });
}


// ============================================================
// CONSULTAR AGENDAMENTOS DO CLIENTE
// ============================================================

async function acaoConsultarAgendamentos({
  accessToken,
  dados
}) {
  const telefone =
    dados.telefone;
  const cpf =
    dados.cpf;

  if (!telefone && !cpf) {
    return {
      status: 400,

      body: {
        success: false,
        error:
          "CPF ou Telefone não informado"
      }
    };
  }

  const inicio =
    new Date()
      .toISOString();

  const limite =
    new Date();

  limite.setUTCDate(
    limite.getUTCDate() +
    365
  );

  const eventos =
    await consultarCalendarView({
      accessToken,
      inicio,
      fim:
        limite.toISOString()
    });

  const encontrados =
    localizarEventosCpfTelefone(
      eventos,
      cpf,
      telefone
    );

  const agendamentos =
    encontrados.map(
      (evento) => {
        const data =
          evento
            ?.start
            ?.dateTime
            ?.substring(
              0,
              10
            ) ||
          "";

        const horario =
          evento
            ?.start
            ?.dateTime
            ?.substring(
              11,
              16
            ) ||
          "";

        return {
          id:
            evento.id,

          subject:
            evento.subject,

          data,

          horario,

          dataFalado:
            formatarDataFalada(
              evento
                ?.start
                ?.dateTime
            ),

          horarioFalado:
            falarHorario(
              horario
            ),

          inicio:
            evento
              ?.start
              ?.dateTime,

          fim:
            evento
              ?.end
              ?.dateTime
        };
      }
    );

  let mensagem;

  if (
    agendamentos.length === 0
  ) {
    mensagem =
      "Não encontrei nenhum agendamento futuro para este telefone.";
  }

  else if (
    agendamentos.length === 1
  ) {
    const agendamento =
      agendamentos[0];

    mensagem =
      `Encontrei um agendamento para o dia ${agendamento.dataFalado}, às ${agendamento.horarioFalado}.`;
  }

  else {
    const partes =
      agendamentos
        .slice(0, 4)
        .map(
          (agendamento) =>
            `dia ${agendamento.dataFalado}, às ${agendamento.horarioFalado}`
        );

    const ultimo =
      partes.pop();

    mensagem =
      `Encontrei ${agendamentos.length} agendamentos. `;

    if (
      partes.length > 0
    ) {
      mensagem +=
        `${partes.join(", ")} e ${ultimo}.`;
    } else {
      mensagem +=
        `${ultimo}.`;
    }
  }

  return {
    status: 200,

    body: {
      success: true,

      acao:
        "consultar_agendamentos",

      telefone,

      quantidade:
        agendamentos.length,

      evento1Id:
        agendamentos[0]?.id ||
        "",

      evento1Data:
        agendamentos[0]?.data ||
        "",

      evento1Horario:
        agendamentos[0]?.horario ||
        "",

      evento2Id:
        agendamentos[1]?.id ||
        "",

      evento2Data:
        agendamentos[1]?.data ||
        "",

      evento2Horario:
        agendamentos[1]?.horario ||
        "",

      evento3Id:
        agendamentos[2]?.id ||
        "",

      evento3Data:
        agendamentos[2]?.data ||
        "",

      evento3Horario:
        agendamentos[2]?.horario ||
        "",

      evento4Id:
        agendamentos[3]?.id ||
        "",

      evento4Data:
        agendamentos[3]?.data ||
        "",

      evento4Horario:
        agendamentos[3]?.horario ||
        "",

      agendamentos,

      mensagem
    }
  };
}


// ============================================================
// AGENDAR
// ============================================================

async function acaoAgendar({
  accessToken,
  dados
}) {
  const data =
    dados.data;

  const horario =
    dados.horario;

  const nome =
    dados.nome ||
    "Cliente GoTo";

  const cpf =
    dados.cpf ||
    "";

  const telefone =
    dados.telefone ||
    "";

  const conversationSpaceId =
    dados.conversationSpaceId ||
    "";

  const callReason =
    dados.callReason ||
    "";

  console.log("===== API AGENDAMENTO =====");
  console.log("AÇÃO: agendar");
  console.log(`DATA: ${data}`);
  console.log(`HORÁRIO: ${horario}`);
  console.log(`NOME: ${nome}`);
  console.log(`TELEFONE: ${telefone}`);
  console.log(`CPF RECEBIDO: ${cpf ? "SIM" : "NÃO"}`);
  console.log("\nConsultando disponibilidade...");

  if (!dataValida(data)) {
    return {
      status: 400,

      body: {
        success: false,
        error:
          "Data inválida. Use YYYY-MM-DD."
      }
    };
  }

  if (!horarioValido(horario)) {
    return {
      status: 400,

      body: {
        success: false,
        error:
          "Horário inválido. Use HH:mm."
      }
    };
  }

  const disponibilidade =
    await verificarIntervaloLivre({
      accessToken,
      data,
      horario
    });

  if (!disponibilidade.livre) {
    console.log("Horário indisponível.");
    return {
      status: 409,

      body: {
        success: false,

        disponivel: false,

        error:
          "Esse horário não está mais disponível",

        mensagem:
          "Desculpe, esse horário acabou de ficar indisponível."
      }
    };
  }

  console.log("Horário disponível.");
  console.log("Criando evento no Microsoft Graph...");

  const inicio =
    `${data}T${horario}:00`;

  const fim =
    disponibilidade
      .fim
      .dateTime;

  function formatarCpf(c) {
    const cLimpo = c.replace(/\D/g, "");
    if (cLimpo.length === 11) {
      return cLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }
    return c;
  }
  
  const cpfFormatado = cpf ? formatarCpf(cpf) : "";

  const partesData = data.split("-");
  const dataExibicao = partesData.length === 3 ? `${partesData[2]}/${partesData[1]}/${partesData[0]}` : data;

  const descricao = [
    "Agendamento criado automaticamente pela integração GoTo.",
    "",
    nome ? `Nome: ${nome}` : null,
    cpfFormatado ? `CPF: ${cpfFormatado}` : null,
    telefone ? `Telefone: ${telefone}` : null,
    "",
    `Data: ${dataExibicao}`,
    `Horário: ${horario}`,
    "Origem: GoTo IA Recepcionista",
    conversationSpaceId ? `\nConversationSpaceId: ${conversationSpaceId}` : null,
    callReason ? `Motivo identificado pela IA: ${callReason}` : null
  ]
    .filter(item => item !== null)
    .join("\n");

  const evento = {
    subject:
      `Agendamento GoTo - ${nome}`,

    body: {
      contentType:
        "Text",

      content:
        descricao
    },

    start: {
      dateTime:
        inicio,

      timeZone:
        GRAPH_TIMEZONE
    },

    end: {
      dateTime:
        fim,

      timeZone:
        GRAPH_TIMEZONE
    },

    showAs:
      "busy"
  };

  const resultado =
    await graphRequest({
      accessToken,

      url:
        `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events`,

      method:
        "POST",

      body:
        evento
    });

  if (!resultado.ok) {
    return {
      status:
        resultado.status,

      body: {
        success: false,
        error:
          "Erro ao criar evento",
        details:
          resultado.data
      }
    };
  }

  console.log("Evento criado com sucesso.");
  console.log(`EVENTO ID: ${resultado.data?.id}`);
  console.log(`DATA: ${data}`);
  console.log(`HORÁRIO: ${horario}`);
  console.log(`NOME: ${nome}`);

  return {
    status: 200,

    body: {
      success: true,

      acao:
        "agendar",

      data,

      horario,

      eventoId:
        resultado.data?.id ||
        "",

      webLink:
        resultado.data?.webLink ||
        "",

      mensagem:
        `Agendamento realizado para ${formatarDataFalada(data)} às ${falarHorario(horario)}.`
    }
  };
}


// ============================================================
// BUSCA EVENTO ESPECÍFICO
// ============================================================

async function obterEvento({
  accessToken,
  eventoId
}) {
  const resultado =
    await graphRequest({
      accessToken,

      url:
        `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${encodeURIComponent(eventoId)}`
    });

  if (!resultado.ok) {
    return null;
  }

  return resultado.data;
}


// ============================================================
// CANCELAR
// ============================================================

async function acaoCancelar({
  accessToken,
  dados
}) {
  let eventoId =
    dados.eventoId ||
    dados.evento_id ||
    "";

  const telefone =
    dados.telefone ||
    "";
    
  const cpf =
    dados.cpf ||
    "";
    
  let dataFiltro = dados.data || "";
  if (dataFiltro) {
    const dMatch = dataFiltro.match(/(\d{4}-\d{2}-\d{2})/);
    if (dMatch) dataFiltro = dMatch[1];
  }
  
  let horarioFiltro = dados.horario || "";
  if (horarioFiltro) {
    const hMatch = horarioFiltro.match(/(\d{2}:\d{2})/);
    if (hMatch) horarioFiltro = hMatch[1];
  }

  // ----------------------------------------------------------
  // FALLBACK:
  // SE NÃO RECEBER EVENTO ID, TENTA LOCALIZAR PELO CPF/TELEFONE.
  // SÓ CANCELA SE HOUVER UM ÚNICO (ou um único exato com data/hora).
  // ----------------------------------------------------------

  if (
    !eventoId &&
    (telefone || cpf)
  ) {
    const consulta =
      await acaoConsultarAgendamentos({
        accessToken,
        dados: {
          telefone,
          cpf
        }
      });

    let agendamentos =
      consulta
        .body
        ?.agendamentos ||
      [];
      
    // Se a IA passou a data e o horário, filtramos a lista
    if (dataFiltro && horarioFiltro && agendamentos.length > 0) {
      agendamentos = agendamentos.filter(a => a.data === dataFiltro && a.horario === horarioFiltro);
    }

    if (
      agendamentos.length === 0
    ) {
      return {
        status: 404,

        body: {
          success: false,
          encontrado: false,

          error:
            "Nenhum agendamento futuro encontrado",

          mensagem:
            "Não encontrei nenhum agendamento futuro para este telefone."
        }
      };
    }

    if (
      agendamentos.length > 1
    ) {
      return {
        status: 409,

        body: {
          success: false,

          ambiguo: true,

          quantidade:
            agendamentos.length,

          agendamentos,

          mensagem:
            consulta
              .body
              .mensagem
        }
      };
    }

    eventoId =
      agendamentos[0].id;
  }

  if (!eventoId) {
    return {
      status: 400,

      body: {
        success: false,

        error:
          "eventoId não informado"
      }
    };
  }

  const evento =
    await obterEvento({
      accessToken,
      eventoId
    });

  if (!evento) {
    return {
      status: 404,

      body: {
        success: false,

        error:
          "Evento não encontrado"
      }
    };
  }

  const resultado =
    await graphRequest({
      accessToken,

      url:
        `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${encodeURIComponent(eventoId)}`,

      method:
        "DELETE"
    });

  if (!resultado.ok) {
    return {
      status:
        resultado.status,

      body: {
        success: false,

        error:
          "Erro ao cancelar agendamento",

        details:
          resultado.data
      }
    };
  }

  const data =
    evento
      ?.start
      ?.dateTime
      ?.substring(
        0,
        10
      );

  const horario =
    evento
      ?.start
      ?.dateTime
      ?.substring(
        11,
        16
      );

  return {
    status: 200,

    body: {
      success: true,

      acao:
        "cancelar",

      cancelado:
        true,

      eventoId,

      data,

      horario,

      mensagem:
        `Agendamento do dia ${formatarDataFalada(data)}, às ${falarHorario(horario)}, cancelado com sucesso.`
    }
  };
}


// ============================================================
// REAGENDAR
// ============================================================

async function acaoReagendar({
  accessToken,
  dados
}) {
  const eventoId =
    dados.eventoId ||
    dados.evento_id;

  const data =
    dados.data ||
    dados.novaData ||
    dados.nova_data;

  const horario =
    dados.horario ||
    dados.novoHorario ||
    dados.novo_horario;

  const cpf =
    dados.cpf ||
    "";
    
  const telefone =
    dados.telefone ||
    "";
    
  let dataFiltro = dados.dataAnterior || dados.data_anterior || "";
  if (dataFiltro) {
    const dMatch = dataFiltro.match(/(\d{4}-\d{2}-\d{2})/);
    if (dMatch) dataFiltro = dMatch[1];
  }
  
  let horarioFiltro = dados.horarioAnterior || dados.horario_anterior || "";
  if (horarioFiltro) {
    const hMatch = horarioFiltro.match(/(\d{2}:\d{2})/);
    if (hMatch) horarioFiltro = hMatch[1];
  }

  if (
    !eventoId &&
    (telefone || cpf)
  ) {
    const consulta =
      await acaoConsultarAgendamentos({
        accessToken,
        dados: {
          telefone,
          cpf
        }
      });

    let agendamentos =
      consulta
        .body
        ?.agendamentos ||
      [];
      
    if (dataFiltro && horarioFiltro && agendamentos.length > 0) {
      agendamentos = agendamentos.filter(a => a.data === dataFiltro && a.horario === horarioFiltro);
    }
    
    if (agendamentos.length === 0) {
       return {
         status: 404,
         body: {
           success: false,
           error: "Agendamento original não encontrado",
           mensagem: "Não encontrei o agendamento original que você deseja reagendar."
         }
       };
    }
    
    if (agendamentos.length > 1) {
       return {
         status: 409,
         body: {
           success: false,
           ambiguo: true,
           quantidade: agendamentos.length,
           mensagem: consulta.body.mensagem
         }
       };
    }
    
    eventoId = agendamentos[0].id;
  }

  if (!eventoId) {
    return {
      status: 400,

      body: {
        success: false,

        error:
          "eventoId não informado e busca por CPF/Telefone falhou"
      }
    };
  }

  if (!dataValida(data)) {
    return {
      status: 400,

      body: {
        success: false,

        error:
          "Nova data inválida"
      }
    };
  }

  if (!horarioValido(horario)) {
    return {
      status: 400,

      body: {
        success: false,

        error:
          "Novo horário inválido"
      }
    };
  }

  const eventoAtual =
    await obterEvento({
      accessToken,
      eventoId
    });

  if (!eventoAtual) {
    return {
      status: 404,

      body: {
        success: false,

        error:
          "Evento não encontrado"
      }
    };
  }

  const disponibilidade =
    await verificarIntervaloLivre({
      accessToken,

      data,

      horario,

      ignorarEventoId:
        eventoId
    });

  if (!disponibilidade.livre) {
    return {
      status: 409,

      body: {
        success: false,

        disponivel: false,

        error:
          "Novo horário indisponível",

        mensagem:
          "Esse novo horário não está disponível."
      }
    };
  }

  const inicio =
    `${data}T${horario}:00`;

  const fim =
    disponibilidade
      .fim
      .dateTime;

  const partesData = data.split("-");
  const dataExibicao = partesData.length === 3 ? `${partesData[2]}/${partesData[1]}/${partesData[0]}` : data;

  const bodyContentRegex = /Data:\s*[\d/]+\r?\nHorário:\s*\d{2}:\d{2}/i;
  const novoBodyText = `Data: ${dataExibicao}\nHorário: ${horario}`;

  let novoBodyContent = eventoAtual.body?.content || "";
  if (bodyContentRegex.test(novoBodyContent)) {
    novoBodyContent = novoBodyContent.replace(bodyContentRegex, novoBodyText);
  } else {
    novoBodyContent += `\n\n[REAGENDADO] Nova Data: ${dataExibicao} - Novo Horário: ${horario}`;
  }

  const patch = {
    start: {
      dateTime:
        inicio,

      timeZone:
        GRAPH_TIMEZONE
    },

    end: {
      dateTime:
        fim,

      timeZone:
        GRAPH_TIMEZONE
    },
    
    body: {
      contentType: "Text",
      content: novoBodyContent
    }
  };

  const resultado =
    await graphRequest({
      accessToken,

      url:
        `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${encodeURIComponent(eventoId)}`,

      method:
        "PATCH",

      body:
        patch
    });

  if (!resultado.ok) {
    return {
      status:
        resultado.status,

      body: {
        success: false,

        error:
          "Erro ao reagendar",

        details:
          resultado.data
      }
    };
  }

  return {
    status: 200,

    body: {
      success: true,

      acao:
        "reagendar",

      reagendado:
        true,

      eventoId,

      data,

      horario,

      mensagem:
        `Agendamento reagendado para o dia ${formatarDataFalada(data)}, às ${falarHorario(horario)}.`
    }
  };
}


// ============================================================
// HANDLER PRINCIPAL
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {
    try {
      // ========================================================
      // GET E POST
      // ========================================================

      if (
        req.method !== "GET" &&
        req.method !== "POST"
      ) {
        return res
          .status(405)
          .json({
            success: false,

            error:
              "Método não permitido. Use GET ou POST."
          });
      }

      // ========================================================
      // API KEY
      // ========================================================

      const apiKey =
        req.headers[
          "x-api-key"
        ];

      const expectedKey =
        process.env
          .GOTO_API_KEY;

      if (!expectedKey) {
        return res
          .status(500)
          .json({
            success: false,

            error:
              "GOTO_API_KEY não configurada no servidor"
          });
      }

      if (
        !apiKey ||
        apiKey !== expectedKey
      ) {
        return res
          .status(401)
          .json({
            success: false,

            error:
              "API Key inválida"
          });
      }

      // ========================================================
      // DADOS
      // ========================================================

      const dados =
        obterDados(
          req
        );

      const acao =
        normalizarTexto(
          dados.acao
        )
          .replace(/\s+/g, "_");

      if (!acao) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Ação não informada",

            acoesDisponiveis: [
              "consultar_disponibilidade",
              "consultar_agendamentos",
              "agendar",
              "cancelar",
              "reagendar"
            ]
          });
      }

      console.log(
        "AGENDAMENTO API:",
        JSON.stringify({
          acao,

          telefone:
            dados.telefone ||
            null,

          data:
            dados.data ||
            dados.novaData ||
            null,

          horario:
            dados.horario ||
            dados.novoHorario ||
            null,

          eventoId:
            dados.eventoId ||
            null
        })
      );

      // ========================================================
      // TOKEN GRAPH
      // ========================================================

      const accessToken =
        await obterAccessTokenGraph();

      let resultado;

      // ========================================================
      // ROTEAMENTO
      // ========================================================

      switch (acao) {

        case "consultar_disponibilidade":
        case "disponibilidade":

          resultado =
            await acaoConsultarDisponibilidade({
              accessToken,
              dados
            });

          break;


        case "consultar_agendamentos":
        case "listar_agendamentos":
        case "agendamentos":

          resultado =
            await acaoConsultarAgendamentos({
              accessToken,
              dados
            });

          break;


        case "agendar":

          resultado =
            await acaoAgendar({
              accessToken,
              dados
            });

          break;


        case "cancelar":

          resultado =
            await acaoCancelar({
              accessToken,
              dados
            });

          break;


        case "reagendar":
        case "remarcar":

          resultado =
            await acaoReagendar({
              accessToken,
              dados
            });

          break;


        default:

          return res
            .status(400)
            .json({
              success: false,

              error:
                `Ação desconhecida: ${acao}`,

              acoesDisponiveis: [
                "consultar_disponibilidade",
                "consultar_agendamentos",
                "agendar",
                "cancelar",
                "reagendar"
              ]
            });
      }

      return res
        .status(
          resultado.status
        )
        .json(
          resultado.body
        );

    } catch (error) {
      console.error(
        "Erro /api/agendamento:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          error:
            error.message
        });
    }
  };