// ============================================================
// CONFIGURAÇÕES
// ============================================================

const MAILBOX_ID =
  "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

const GRAPH_TIMEZONE =
  "E. South America Standard Time";

const TIMEZONE_SP =
  "America/Sao_Paulo";

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
// AUXILIARES DE FUSO E DATA/HORA (AMERICA/SAO_PAULO)
// ============================================================

function obterDataHoraAtualSP() {
  const agora = new Date();
  const formatador = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE_SP,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const partes = formatador.formatToParts(agora);
  const mapa = {};
  for (const p of partes) {
    mapa[p.type] = p.value;
  }
  const dataHoje = `${mapa.year}-${mapa.month}-${mapa.day}`;
  const horarioHoje = `${mapa.hour}:${mapa.minute}`;
  return { dataHoje, horarioHoje };
}

function validarDataEHorarioFuturo(data, horario) {
  if (!dataValida(data)) {
    return { valido: false, erro: "Data inválida. Use o formato AAAA-MM-DD." };
  }
  if (!horarioValido(horario)) {
    return { valido: false, erro: "Horário inválido. Use o formato HH:mm." };
  }

  const { dataHoje, horarioHoje } = obterDataHoraAtualSP();

  if (data < dataHoje) {
    return { valido: false, erro: "Não é possível selecionar uma data passada." };
  }

  if (data === dataHoje && horario <= horarioHoje) {
    return { valido: false, erro: "Para o dia de hoje, não é possível selecionar um horário que já passou." };
  }

  return { valido: true };
}


// ============================================================
// NORMALIZA TEXTO E MASCARAMENTO SEGURO
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

function canonicalizarTelefone(telefone) {
  let s = normalizarTelefone(telefone);
  if (s.startsWith("55") && (s.length === 12 || s.length === 13)) {
    s = s.substring(2);
  }
  return s;
}

function telefoneValido(telefone) {
  const s = canonicalizarTelefone(telefone);
  return s.length >= 10 && s.length <= 11;
}

function cpfValido(cpf) {
  const c = normalizarTelefone(cpf);
  return c.length === 11;
}

function mascararNome(nome) {
  const n = String(nome || "").trim();
  if (!n) return "";
  const partes = n.split(/\s+/);
  if (partes.length === 1) {
    const p = partes[0];
    return p.length > 2 ? `${p.substring(0, 2)}***` : "***";
  }
  return `${partes[0]} ${partes[partes.length - 1].substring(0, 1)}***`;
}

function mascararEventoId(eventoId) {
  const id = String(eventoId || "").trim();
  if (id.length <= 8) return id ? "***" : "";
  return `${id.substring(0, 4)}...${id.substring(id.length - 4)}`;
}

function mascararCpf(cpf) {
  const c = normalizarTelefone(cpf);
  if (c.length === 11) {
    return `***.${c.substring(3, 6)}.***-${c.substring(9, 11)}`;
  }
  return c ? "***" : "";
}

function mascararTelefone(telefone) {
  const t = canonicalizarTelefone(telefone);
  if (t.length >= 8) {
    return `${t.substring(0, 2)}****${t.substring(t.length - 4)}`;
  }
  return t ? "***" : "";
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
// VALIDA DATA REAL
// ============================================================

function dataValida(data) {
  const str = String(data || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) {
    return false;
  }

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    return false;
  }

  const isBissexto =
    ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);

  const diasPorMes = [
    0,
    31,
    isBissexto ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  return dia <= diasPorMes[mes];
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

function formatarDataCurtaFalada(dateTime) {
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
    `${dia} de ${nomesMeses[mes]}`
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
  let url =
    `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}` +
    `/calendarView` +
    `?startDateTime=${encodeURIComponent(inicio)}` +
    `&endDateTime=${encodeURIComponent(fim)}` +
    `&$top=100` +
    `&$select=${encodeURIComponent(select)}`;

  const todosEventos = [];
  let iteracoes = 0;
  const MAX_ITERACOES = 20; // até 2000 eventos para segurança

  while (url && iteracoes < MAX_ITERACOES) {
    iteracoes++;

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

    if (Array.isArray(resultado.data?.value)) {
      todosEventos.push(...resultado.data.value);
    }

    // Avança para a próxima página se houver nextLink
    url = resultado.data?.["@odata.nextLink"] || null;
  }

  return todosEventos;
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
      status: 200,

      body: {
        success: false,
        acao: "consultar_disponibilidade",
        data: data || "",
        disponivel: false,
        quantidade: 0,
        horarios: [],
        mensagem: "Data inválida. Por favor informe uma data no formato ano, mês e dia."
      }
    };
  }

  const { dataHoje, horarioHoje } = obterDataHoraAtualSP();

  if (data < dataHoje) {
    return {
      status: 200,

      body: {
        success: false,
        acao: "consultar_disponibilidade",
        data,
        disponivel: false,
        quantidade: 0,
        horarios: [],
        mensagem: "Não é possível consultar disponibilidade para uma data que já passou."
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
    if (data === dataHoje && horario <= horarioHoje) {
      return false;
    }

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
// EXTRAÇÃO E CORRESPONDÊNCIA SEGURA DE CPF E TELEFONE
// ============================================================

function extrairCpfDoEvento(evento) {
  const content = String(evento?.body?.content || evento?.bodyPreview || "");
  const match = content.match(/CPF:\s*([\d\s.-]+)/i);
  if (match) {
    const limpo = normalizarTelefone(match[1]);
    if (limpo.length === 11) {
      return limpo;
    }
  }
  return null;
}

function extrairTelefoneDoEvento(evento) {
  const content = String(evento?.body?.content || evento?.bodyPreview || "");
  const match = content.match(/Telefone:\s*([^\r\n]+)/i);
  if (match) {
    const limpo = canonicalizarTelefone(match[1]);
    if (limpo.length >= 10 && limpo.length <= 11) {
      return limpo;
    }
  }
  return null;
}

function localizarEventosCpfTelefone(
  eventos,
  cpfEsperado,
  telefoneEsperado
) {
  const cpfNorm = cpfValido(cpfEsperado) ? normalizarTelefone(cpfEsperado) : null;
  const telNorm = telefoneValido(telefoneEsperado) ? canonicalizarTelefone(telefoneEsperado) : null;

  // Se nenhum identificador válido for informado, rejeita
  if (!cpfNorm && !telNorm) {
    return [];
  }

  return eventos.filter((evento) => {
    const cpfEvento = extrairCpfDoEvento(evento);
    const telEvento = extrairTelefoneDoEvento(evento);

    // Se ambos foram informados na busca, ambos devem pertencer obrigatoriamente ao mesmo evento
    if (cpfNorm && telNorm) {
      return cpfEvento === cpfNorm && telEvento === telNorm;
    }

    // Se somente o CPF foi informado
    if (cpfNorm) {
      return cpfEvento === cpfNorm;
    }

    // Se somente o Telefone foi informado
    if (telNorm) {
      return telEvento === telNorm;
    }

    return false;
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
    normalizarTelefone(dados.telefone);
  const cpf =
    normalizarTelefone(dados.cpf);

  if (!telefone && !cpf) {
    return {
      status: 200,

      body: {
        success: false,
        acao: "consultar_agendamentos",
        mensagem: "CPF ou telefone não informado. Por favor informe seus dados."
      }
    };
  }

  const { dataHoje, horarioHoje } = obterDataHoraAtualSP();

  // Início do dia atual em SP para cobrir todos os eventos de hoje
  const inicio = `${dataHoje}T00:00:00${OFFSET}`;

  const limite = new Date();
  limite.setUTCDate(limite.getUTCDate() + 365);
  const fim = limite.toISOString();

  const eventos =
    await consultarCalendarView({
      accessToken,
      inicio,
      fim
    });

  const encontrados =
    localizarEventosCpfTelefone(
      eventos,
      cpf,
      telefone
    );

  const todosAgendamentos =
    encontrados
      .map((evento) => {
        const data =
          evento?.start?.dateTime?.substring(0, 10) || "";
        const horario =
          evento?.start?.dateTime?.substring(11, 16) || "";

        return {
          id: evento.id,
          subject: evento.subject,
          data,
          horario,
          dataFalado: formatarDataFalada(evento?.start?.dateTime),
          dataCurtaFalado: formatarDataCurtaFalada(evento?.start?.dateTime),
          horarioFalado: falarHorario(horario),
          inicio: evento?.start?.dateTime,
          fim: evento?.end?.dateTime
        };
      })
      .filter((item) => {
        if (!item.data || !item.horario) return false;
        if (item.data < dataHoje) return false;
        if (item.data === dataHoje && item.horario <= horarioHoje) return false;
        return true;
      });

  // Ordenar do mais próximo para o mais distante
  todosAgendamentos.sort((a, b) => {
    if (a.data !== b.data) return a.data.localeCompare(b.data);
    return a.horario.localeCompare(b.horario);
  });

  const agendamentos = todosAgendamentos.slice(0, 4);

  let mensagem;

  if (agendamentos.length === 0) {
    mensagem = "Não encontrei nenhum agendamento futuro em seu cadastro.";
  } else if (agendamentos.length === 1) {
    mensagem = `Encontrei um agendamento para o dia ${agendamentos[0].dataCurtaFalado}, às ${agendamentos[0].horarioFalado}. Para selecionar este agendamento, pressione 1.`;
  } else {
    const contagemTexto =
      agendamentos.length === 2 ? "dois" :
      agendamentos.length === 3 ? "três" : "quatro";

    const partes = agendamentos.map((ag, index) => {
      return `Para o dia ${ag.dataCurtaFalado}, às ${ag.horarioFalado}, pressione ${index + 1}.`;
    });

    mensagem = `Encontrei ${contagemTexto} agendamentos. ${partes.join(" ")}`;
  }

  return {
    status: 200,

    body: {
      success: true,

      acao:
        "consultar_agendamentos",

      telefone: dados.telefone || "",
      cpf: dados.cpf || "",

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
  console.log(`NOME MASCARADO: ${mascararNome(nome)}`);
  console.log(`TELEFONE MASCARADO: ${mascararTelefone(telefone)}`);
  console.log(`CPF MASCARADO: ${mascararCpf(cpf)}`);

  const validacao = validarDataEHorarioFuturo(data, horario);
  if (!validacao.valido) {
    return {
      status: 200,

      body: {
        success: false,
        acao: "agendar",
        mensagem: validacao.erro
      }
    };
  }

  // Prevenção de duplicidade: se o cliente já tiver agendamento idêntico nessa data e horário
  if (cpf || telefone) {
    const consulta = await acaoConsultarAgendamentos({
      accessToken,
      dados: {
        cpf,
        telefone
      }
    });

    const existentes = consulta.body?.agendamentos || [];
    const duplicado = existentes.find(a => a.data === data && a.horario === horario);
    if (duplicado) {
      console.log("Agendamento idêntico já existente para o cliente.");
      return {
        status: 200,
        body: {
          success: true,
          acao: "agendar",
          data,
          horario,
          eventoId: duplicado.id,
          mensagem: `Agendamento já realizado para ${formatarDataFalada(data)} às ${falarHorario(horario)}.`
        }
      };
    }
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
      status: 200,

      body: {
        success: false,
        acao: "agendar",
        disponivel: false,
        mensagem: "Desculpe, esse horário não está mais disponível. Por favor, escolha outro horário."
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
    const cLimpo = normalizarTelefone(c);
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
    console.error("Erro ao criar evento Graph:", JSON.stringify(resultado.data));
    return {
      status: 502,

      body: {
        success: false,
        acao: "agendar",
        error:
          "Erro ao criar agendamento no sistema. Por favor, tente novamente mais tarde."
      }
    };
  }

  console.log("Evento criado com sucesso.");
  console.log(`EVENTO ID MASCARADO: ${mascararEventoId(resultado.data?.id)}`);
  console.log(`DATA: ${data}`);
  console.log(`HORÁRIO: ${horario}`);
  console.log(`NOME MASCARADO: ${mascararNome(nome)}`);

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
  const telefone = normalizarTelefone(dados.telefone);
  const cpf = normalizarTelefone(dados.cpf);

  let data = dados.data || "";
  if (data) {
    const dMatch = data.match(/(\d{4}-\d{2}-\d{2})/);
    if (dMatch) data = dMatch[1];
  }

  let horario = dados.horario || "";
  if (horario) {
    const hMatch = horario.match(/(\d{2}:\d{2})/);
    if (hMatch) horario = hMatch[1];
  }

  if (!telefone && !cpf) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "cancelar",
        mensagem: "CPF ou telefone não informado. Por favor informe seus dados para cancelar."
      }
    };
  }

  if (!dataValida(data) || !horarioValido(horario)) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "cancelar",
        mensagem: "Data ou horário informado inválido para cancelamento."
      }
    };
  }

  // Consultar compromissos futuros do cliente
  const consulta = await acaoConsultarAgendamentos({
    accessToken,
    dados: {
      telefone,
      cpf
    }
  });

  const agendamentos = consulta.body?.agendamentos || [];

  // Localizar correspondentes com data e horário exatos
  const correspondentes = agendamentos.filter(
    a => a.data === data && a.horario === horario
  );

  if (correspondentes.length === 0) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "cancelar",
        mensagem: "Não encontrei nenhum agendamento para a data e horário informados."
      }
    };
  }

  if (correspondentes.length > 1) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "cancelar",
        mensagem: "Encontrei mais de um agendamento no mesmo horário. Por favor, fale com um atendente para cancelar."
      }
    };
  }

  const eventoAlvo = correspondentes[0];

  const resultado = await graphRequest({
    accessToken,
    url: `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${encodeURIComponent(eventoAlvo.id)}`,
    method: "DELETE"
  });

  if (!resultado.ok) {
    console.error("Erro ao cancelar evento Graph:", JSON.stringify(resultado.data));
    return {
      status: 502,
      body: {
        success: false,
        acao: "cancelar",
        error: "Erro ao cancelar agendamento no sistema. Por favor, tente novamente mais tarde."
      }
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      acao: "cancelar",
      data,
      horario,
      mensagem: "Agendamento cancelado com sucesso."
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
  const telefone = normalizarTelefone(dados.telefone);
  const cpf = normalizarTelefone(dados.cpf);

  let dataAnterior = dados.dataAnterior || dados.data_anterior || "";
  if (dataAnterior) {
    const dMatch = dataAnterior.match(/(\d{4}-\d{2}-\d{2})/);
    if (dMatch) dataAnterior = dMatch[1];
  }

  let horarioAnterior = dados.horarioAnterior || dados.horario_anterior || "";
  if (horarioAnterior) {
    const hMatch = horarioAnterior.match(/(\d{2}:\d{2})/);
    if (hMatch) horarioAnterior = hMatch[1];
  }

  let novaData = dados.novaData || dados.nova_data || dados.data || "";
  if (novaData) {
    const ndMatch = novaData.match(/(\d{4}-\d{2}-\d{2})/);
    if (ndMatch) novaData = ndMatch[1];
  }

  let novoHorario = dados.novoHorario || dados.novo_horario || dados.horario || "";
  if (novoHorario) {
    const nhMatch = novoHorario.match(/(\d{2}:\d{2})/);
    if (nhMatch) novoHorario = nhMatch[1];
  }

  if (!telefone && !cpf) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: "CPF ou telefone não informado. Por favor informe seus dados."
      }
    };
  }

  if (!dataValida(dataAnterior) || !horarioValido(horarioAnterior)) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: "Data ou horário anterior informado é inválido."
      }
    };
  }

  const validacaoNovo = validarDataEHorarioFuturo(novaData, novoHorario);
  if (!validacaoNovo.valido) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: validacaoNovo.erro
      }
    };
  }

  // 1. Localizar exatamente o compromisso antigo
  const consulta = await acaoConsultarAgendamentos({
    accessToken,
    dados: {
      telefone,
      cpf
    }
  });

  const agendamentos = consulta.body?.agendamentos || [];

  // Idempotência: se já estiver reagendado para essa nova data e novo horário
  const jaReagendado = agendamentos.find(
    a => a.data === novaData && a.horario === novoHorario
  );
  if (jaReagendado) {
    return {
      status: 200,
      body: {
        success: true,
        acao: "reagendar",
        novaData,
        novoHorario,
        mensagem: "Agendamento reagendado com sucesso."
      }
    };
  }

  const correspondentes = agendamentos.filter(
    a => a.data === dataAnterior && a.horario === horarioAnterior
  );

  if (correspondentes.length === 0) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: "Não encontrei o agendamento anterior para reagendar."
      }
    };
  }

  if (correspondentes.length > 1) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: "Encontrei mais de um agendamento no mesmo horário anterior. Por favor, fale com um atendente."
      }
    };
  }

  const eventoAlvo = correspondentes[0];
  const eventoId = eventoAlvo.id;

  // 2. Validar se a nova data e o novo horário estão disponíveis imediatamente antes da alteração
  const disponibilidade = await verificarIntervaloLivre({
    accessToken,
    data: novaData,
    horario: novoHorario,
    ignorarEventoId: eventoId
  });

  if (!disponibilidade.livre) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: "O novo horário solicitado não está disponível. Por favor, escolha outro horário."
      }
    };
  }

  // 3. Obter evento atual para manter integridade do corpo
  const eventoAtual = await obterEvento({
    accessToken,
    eventoId
  });

  if (!eventoAtual) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: "O evento não foi encontrado no calendário para ser reagendado."
      }
    };
  }

  const inicio = `${novaData}T${novoHorario}:00`;
  const fim = disponibilidade.fim.dateTime;

  const partesData = novaData.split("-");
  const dataExibicao = partesData.length === 3 ? `${partesData[2]}/${partesData[1]}/${partesData[0]}` : novaData;

  const bodyContentRegex = /Data:\s*[\d/]+\r?\nHorário:\s*\d{2}:\d{2}/i;
  const novoBodyText = `Data: ${dataExibicao}\nHorário: ${novoHorario}`;

  let novoBodyContent = eventoAtual.body?.content || "";
  if (bodyContentRegex.test(novoBodyContent)) {
    novoBodyContent = novoBodyContent.replace(bodyContentRegex, novoBodyText);
  } else {
    novoBodyContent += `\n\n[REAGENDADO] Nova Data: ${dataExibicao} - Novo Horário: ${novoHorario}`;
  }

  const patch = {
    start: {
      dateTime: inicio,
      timeZone: GRAPH_TIMEZONE
    },
    end: {
      dateTime: fim,
      timeZone: GRAPH_TIMEZONE
    },
    body: {
      contentType: "Text",
      content: novoBodyContent
    }
  };

  const resultado = await graphRequest({
    accessToken,
    url: `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${encodeURIComponent(eventoId)}`,
    method: "PATCH",
    body: patch
  });

  if (!resultado.ok) {
    console.error("Erro ao reagendar evento Graph:", JSON.stringify(resultado.data));
    return {
      status: 502,
      body: {
        success: false,
        acao: "reagendar",
        error: "Erro ao reagendar compromisso no sistema. Por favor, tente novamente mais tarde."
      }
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      acao: "reagendar",
      novaData,
      novoHorario,
      mensagem: "Agendamento reagendado com sucesso."
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

      // Registro seguro e mascarado (sem PII aberta nem chaves)
      console.log(
        "AGENDAMENTO API:",
        JSON.stringify({
          acao,
          telefone: mascararTelefone(dados.telefone),
          cpf: mascararCpf(dados.cpf),
          data: dados.data || dados.novaData || dados.dataAnterior || null,
          horario: dados.horario || dados.novoHorario || dados.horarioAnterior || null
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
        error.message
      );

      const isGraphError = String(error.message || "").includes("Graph") || String(error.message || "").includes("calendário");
      const statusCode = isGraphError ? 502 : 500;

      return res
        .status(statusCode)
        .json({
          success: false,

          error:
            "Ocorreu um erro interno ao processar a solicitação no sistema. Por favor, tente novamente mais tarde."
        });
    }
  };