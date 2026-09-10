const empresaRepo = require("../lib/repositories/empresaRepository");
const graphClient = require("../lib/graphClient");
const availabilityEngine = require("../lib/availabilityEngine");
const { verificarRateLimitEmpresa } = require("../lib/rateLimiter");
const { compararHashesSeguro, hashChaveGoTo } = require("../lib/crypto");

// ============================================================
// CONFIGURAÇÕES PADRÃO E FALLBACK LEGADO
// ============================================================

const LEGACY_MAILBOX_ID = "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";
const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const GRAPH_TIMEZONE_NAME = "E. South America Standard Time";
const OFFSET = "-03:00";
const DURACAO_PADRAO = 60;
const HORARIOS_PADRAO_LEGADO = [
  "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"
];

// ============================================================
// NORMALIZAÇÃO DE TEXTO E MASCARAMENTO SEGURO
// ============================================================

function normalizarTexto(valor) {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
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

function formatarCpfExibicao(cpf) {
  if (!cpf) return "Não informado";
  const digitos = String(cpf).replace(/\D/g, "");
  if (digitos.length === 11) {
    return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  const limpo = String(cpf).trim();
  return limpo || "Não informado";
}

function formatarTelefoneExibicao(telefone) {
  if (!telefone) return "Não informado";
  let digitos = String(telefone).replace(/\D/g, "");
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    digitos = digitos.substring(2);
  }
  if (digitos.length === 11) {
    return digitos.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  if (digitos.length === 10) {
    return digitos.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  if (digitos.length === 9) {
    return digitos.replace(/(\d{5})(\d{4})/, "$1-$2");
  }
  if (digitos.length === 8) {
    return digitos.replace(/(\d{4})(\d{4})/, "$1-$2");
  }
  const limpo = String(telefone).trim();
  return limpo || "Não informado";
}

function formatarDataPtBr(dataStr) {
  if (!dataStr) return "";
  const partes = String(dataStr).trim().split("-");
  if (partes.length === 3) {
    const [ano, mes, dia] = partes;
    return `${dia.padStart(2, "0")}/${mes.padStart(2, "0")}/${ano}`;
  }
  return String(dataStr).trim();
}

// ============================================================
// FORMATAÇÃO DE DATA E HORÁRIO PARA SÍNTESE DE VOZ (TTS GOTO)
// ============================================================

function formatarDataFalada(dateTime) {
  if (!dateTime) return "";
  const data = String(dateTime).substring(0, 10);
  const [ano, mes, dia] = data.split("-").map(Number);
  const nomesMeses = [
    "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];
  return `${dia} de ${nomesMeses[mes]} de ${ano}`;
}

function formatarDataCurtaFalada(dateTime) {
  if (!dateTime) return "";
  const data = String(dateTime).substring(0, 10);
  const [ano, mes, dia] = data.split("-").map(Number);
  const nomesMeses = [
    "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];
  return `${dia} de ${nomesMeses[mes]}`;
}

function falarHorario(horario) {
  if (!horario) return "";
  const [hora, minuto] = horario.substring(0, 5).split(":").map(Number);
  if (hora === 12 && minuto === 0) return "meio-dia";
  if (minuto === 0) return `${hora} horas`;
  if (minuto === 30) return `${hora} e meia`;
  return `${hora} e ${minuto}`;
}

// ============================================================
// AUXILIARES DE RESOLUÇÃO TEMPORAL NO FUSO DA EMPRESA
// ============================================================

function somarMinutosLocal(data, horario, minutosAdicionar) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const [hora, minuto] = horario.split(":").map(Number);

  const calculo = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto, 0));
  calculo.setUTCMinutes(calculo.getUTCMinutes() + minutosAdicionar);

  const dataFinal =
    `${calculo.getUTCFullYear()}-` +
    `${String(calculo.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(calculo.getUTCDate()).padStart(2, "0")}`;

  const horarioFinal =
    `${String(calculo.getUTCHours()).padStart(2, "0")}:` +
    `${String(calculo.getUTCMinutes()).padStart(2, "0")}`;

  return {
    data: dataFinal,
    horario: horarioFinal,
    dateTime: `${dataFinal}T${horarioFinal}:00`
  };
}

function proximoDia(dataStr) {
  const [ano, mes, dia] = dataStr.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + 1));
  const anoFinal = d.getUTCFullYear();
  const mesFinal = String(d.getUTCMonth() + 1).padStart(2, "0");
  const diaFinal = String(d.getUTCDate()).padStart(2, "0");
  return `${anoFinal}-${mesFinal}-${diaFinal}`;
}

function validarDataEHorarioFuturoNoFuso(data, horario, fusoHorario = DEFAULT_TIMEZONE) {
  if (!availabilityEngine.dataValida(data)) {
    return { valido: false, erro: "Data inválida. Use o formato AAAA-MM-DD." };
  }
  if (!availabilityEngine.horarioValido(horario)) {
    return { valido: false, erro: "Horário inválido. Use o formato HH:mm." };
  }

  const { dataHoje, horarioHoje } = availabilityEngine.obterDataHoraAtualNoFuso(fusoHorario);

  if (data < dataHoje) {
    return { valido: false, erro: "Não é possível selecionar uma data passada." };
  }

  if (data === dataHoje && horario <= horarioHoje) {
    return { valido: false, erro: "Para o dia de hoje, não é possível selecionar um horário que já passou." };
  }

  return { valido: true };
}

// ============================================================
// BUSCA E EXTRAÇÃO DE METADADOS EM EVENTOS GRAPH
// ============================================================

function extrairMetadadosEvento(evento) {
  const corpo = String(evento.body?.content || evento.bodyPreview || "");

  let cpfEncontrado = "";
  const matchCpf = corpo.match(/CPF:\s*([0-9.\-]+)/i);
  if (matchCpf) {
    cpfEncontrado = normalizarTelefone(matchCpf[1]);
  }

  let telefoneEncontrado = "";
  const matchTelefone = corpo.match(/Telefone:\s*([0-9()+\-\s]+)/i);
  if (matchTelefone) {
    telefoneEncontrado = canonicalizarTelefone(matchTelefone[1]);
  }

  let nomeEncontrado = "";
  const matchNome = corpo.match(/Nome:\s*([^\r\n<]+)/i);
  if (matchNome) {
    nomeEncontrado = matchNome[1].trim();
  }

  return {
    cpf: cpfEncontrado,
    telefone: telefoneEncontrado,
    nome: nomeEncontrado
  };
}

function localizarEventosCpfTelefone(eventos, cpf = "", telefone = "") {
  const cpfBusca = normalizarTelefone(cpf);
  const telefoneBusca = canonicalizarTelefone(telefone);

  const temCpfValido = cpfValido(cpfBusca);
  const temTelefoneValido = telefoneValido(telefoneBusca);

  if (!temCpfValido && !temTelefoneValido) {
    return [];
  }

  return eventos.filter(evento => {
    if (evento.isCancelled) return false;

    const meta = extrairMetadadosEvento(evento);

    if (temCpfValido && temTelefoneValido) {
      return meta.cpf === cpfBusca && meta.telefone === telefoneBusca;
    }

    if (temCpfValido) {
      return meta.cpf === cpfBusca;
    }

    if (temTelefoneValido) {
      return meta.telefone === telefoneBusca;
    }

    return false;
  });
}

// ============================================================
// AUXILIARES DE PARSING DO BODY
// ============================================================

function obterDados(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.query || {};
}

// ============================================================
// VERIFICA INTERVALO LIVRE NO CALENDÁRIO M365
// ============================================================

async function verificarIntervaloLivre({
  accessToken,
  conexaoM365,
  fusoHorario = DEFAULT_TIMEZONE,
  data,
  horario,
  duracaoMinutos = DURACAO_PADRAO,
  ignorarEventoId = null
}) {
  const fimCalculado = somarMinutosLocal(data, horario, duracaoMinutos);
  const mailbox = conexaoM365?.mailbox_email || conexaoM365?.mailboxEmail || LEGACY_MAILBOX_ID;

  const inicioConsulta = `${data}T${horario}:00${OFFSET}`;
  const fimConsulta = `${fimCalculado.data}T${fimCalculado.horario}:00${OFFSET}`;

  const eventos = await graphClient.consultarCalendarView({
    accessToken,
    mailboxEmail: mailbox,
    inicio: inicioConsulta,
    fim: fimConsulta,
    fusoHorario
  });

  const conflitos = eventos.filter(evento => {
    if (ignorarEventoId && evento.id === ignorarEventoId) return false;
    if (evento.isCancelled) return false;
    return true;
  });

  return {
    livre: conflitos.length === 0,
    conflitos,
    fim: fimCalculado
  };
}

// ============================================================
// AÇÃO 1: CONSULTAR DISPONIBILIDADE
// ============================================================

async function acaoConsultarDisponibilidade({ tenantContext, dados }) {
  const dataBruta = dados.data;
  const data = availabilityEngine.normalizarDataEntrada(dataBruta);

  if (!data) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "consultar_disponibilidade",
        data: dataBruta || "",
        disponivel: false,
        quantidade: 0,
        horarios: [],
        mensagem: "Data inválida. Por favor informe uma data no formato ano, mês e dia."
      }
    };
  }

  const fuso = tenantContext.fusoHorario || DEFAULT_TIMEZONE;
  const { dataHoje, horarioHoje } = availabilityEngine.obterDataHoraAtualNoFuso(fuso);

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

  // Gera slots candidatos de acordo com as regras da empresa ou fallback legado
  let slotsCandidatos = [];

  if (tenantContext.horarios && tenantContext.horarios.length > 0) {
    const resSlots = availabilityEngine.gerarSlotsCandidatos({
      data,
      fusoHorario: fuso,
      politica: tenantContext.politica || {},
      horarios: tenantContext.horarios || [],
      excecoes: tenantContext.excecoes || []
    });

    if (!resSlots.valido || resSlots.fechado || resSlots.slots.length === 0) {
      return {
        status: 200,
        body: {
          success: true,
          acao: "consultar_disponibilidade",
          data,
          disponivel: false,
          quantidade: 0,
          horarios: [],
          horario1: "",
          horario2: "",
          horario3: "",
          horario4: "",
          mensagem: "Não há horários disponíveis para a data informada. Por favor, escolha outra data."
        }
      };
    }
    slotsCandidatos = resSlots.slots;
  } else {
    // Horários padrão de fallback legado
    slotsCandidatos = HORARIOS_PADRAO_LEGADO;
  }

  // Consulta eventos no calendário Microsoft 365 da empresa
  const conexaoM365 = tenantContext.conexaoM365;
  const accessToken = await graphClient.obterAccessTokenGraph(conexaoM365);
  const mailbox = conexaoM365?.mailbox_email || conexaoM365?.mailboxEmail || LEGACY_MAILBOX_ID;

  const diaSeguinte = proximoDia(data);
  const eventos = await graphClient.consultarCalendarView({
    accessToken,
    mailboxEmail: mailbox,
    inicio: `${data}T00:00:00${OFFSET}`,
    fim: `${diaSeguinte}T00:00:00${OFFSET}`,
    fusoHorario: fuso,
    select: "id,subject,start,end,isAllDay"
  });

  const duracao = tenantContext.politica?.duracao_minutos || DURACAO_PADRAO;
  const maxOpcoes = tenantContext.politica?.max_opcoes_retorno || 4;

  function horarioEstaLivre(horario) {
    if (data === dataHoje && horario <= horarioHoje) {
      return false;
    }

    const [hora, minuto] = horario.split(":").map(Number);
    const inicioSlot = new Date(`${data}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00${OFFSET}`);
    const fimSlot = new Date(inicioSlot.getTime() + duracao * 60 * 1000);

    return !eventos.some(evento => {
      if (evento.isAllDay) return true;
      const inicioEvento = new Date(`${evento.start?.dateTime}${OFFSET}`);
      const fimEvento = new Date(`${evento.end?.dateTime}${OFFSET}`);
      return inicioSlot < fimEvento && fimSlot > inicioEvento;
    });
  }

  const horariosLivres = slotsCandidatos.filter(horarioEstaLivre);
  const selecionados = horariosLivres.slice(0, maxOpcoes);

  let mensagem;
  if (selecionados.length === 0) {
    mensagem = "Não há horários disponíveis para a data informada. Por favor, escolha outra data.";
  } else if (selecionados.length === 1) {
    mensagem = `Encontrei um horário disponível. Para ${falarHorario(selecionados[0])}, pressione 1.`;
  } else {
    const partes = selecionados.map((h, index) => `Para ${falarHorario(h)}, pressione ${index + 1}.`);
    mensagem = `Encontrei ${selecionados.length} horários disponíveis. ${partes.join(" ")}`;
  }

  return {
    status: 200,
    body: {
      success: true,
      acao: "consultar_disponibilidade",
      data,
      disponivel: selecionados.length > 0,
      quantidade: selecionados.length,
      horarios: selecionados,
      horario1: selecionados[0] || "",
      horario2: selecionados[1] || "",
      horario3: selecionados[2] || "",
      horario4: selecionados[3] || "",
      mensagem
    }
  };
}

// ============================================================
// AÇÃO 2: CONSULTAR AGENDAMENTOS
// ============================================================

async function acaoConsultarAgendamentos({ tenantContext, dados }) {
  const fuso = tenantContext.fusoHorario || DEFAULT_TIMEZONE;
  const { dataHoje, horarioHoje } = availabilityEngine.obterDataHoraAtualNoFuso(fuso);

  const telefone = normalizarTelefone(dados.telefone);
  const cpf = normalizarTelefone(dados.cpf);

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

  const conexaoM365 = tenantContext.conexaoM365;
  const accessToken = await graphClient.obterAccessTokenGraph(conexaoM365);
  const mailbox = conexaoM365?.mailbox_email || conexaoM365?.mailboxEmail || LEGACY_MAILBOX_ID;

  // Consulta de hoje até 365 dias
  const inicio = `${dataHoje}T00:00:00${OFFSET}`;
  const limite = new Date();
  limite.setUTCDate(limite.getUTCDate() + 365);
  const fim = limite.toISOString();

  const eventos = await graphClient.consultarCalendarView({
    accessToken,
    mailboxEmail: mailbox,
    inicio,
    fim,
    fusoHorario: fuso
  });

  const encontrados = localizarEventosCpfTelefone(eventos, cpf, telefone);

  const todosAgendamentos = encontrados
    .map(evento => {
      const data = evento?.start?.dateTime?.substring(0, 10) || "";
      const horario = evento?.start?.dateTime?.substring(11, 16) || "";

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
    .filter(item => {
      if (!item.data || !item.horario) return false;
      if (item.data < dataHoje) return false;
      if (item.data === dataHoje && item.horario <= horarioHoje) return false;
      return true;
    });

  // Ordena cronologicamente
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
      acao: "consultar_agendamentos",
      quantidade: agendamentos.length,
      evento1Id: agendamentos[0]?.id || "",
      evento1Data: agendamentos[0]?.data || "",
      evento1Horario: agendamentos[0]?.horario || "",
      evento2Id: agendamentos[1]?.id || "",
      evento2Data: agendamentos[1]?.data || "",
      evento2Horario: agendamentos[1]?.horario || "",
      evento3Id: agendamentos[2]?.id || "",
      evento3Data: agendamentos[2]?.data || "",
      evento3Horario: agendamentos[2]?.horario || "",
      evento4Id: agendamentos[3]?.id || "",
      evento4Data: agendamentos[3]?.data || "",
      evento4Horario: agendamentos[3]?.horario || "",
      agendamentos,
      mensagem
    }
  };
}

// ============================================================
// AÇÃO 3: AGENDAR
// ============================================================

async function acaoAgendar({ tenantContext, dados }) {
  const dataBruta = dados.data;
  const data = availabilityEngine.normalizarDataEntrada(dataBruta) || dataBruta;
  const horario = dados.horario;
  const fuso = tenantContext.fusoHorario || DEFAULT_TIMEZONE;

  const validacao = validarDataEHorarioFuturoNoFuso(data, horario, fuso);
  if (!validacao.valido) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "agendar",
        data: data || "",
        horario: horario || "",
        mensagem: validacao.erro
      }
    };
  }

  const nome = dados.nome || "Cliente";
  const telefone = dados.telefone || "";
  const cpf = dados.cpf || "";
  const conversationSpaceId = dados.conversationSpaceId || "";

  console.log("===== API AGENDAMENTO =====");
  console.log("AÇÃO: agendar");
  console.log(`DATA: ${data}`);
  console.log(`HORÁRIO: ${horario}`);
  console.log(`NOME MASCARADO: ${mascararNome(nome)}`);
  console.log(`TELEFONE MASCARADO: ${mascararTelefone(telefone)}`);
  console.log(`CPF MASCARADO: ${mascararCpf(cpf)}`);

  const conexaoM365 = tenantContext.conexaoM365;
  const accessToken = await graphClient.obterAccessTokenGraph(conexaoM365);
  const mailbox = conexaoM365?.mailbox_email || conexaoM365?.mailboxEmail || LEGACY_MAILBOX_ID;

  // 1. Idempotência: verificar se o cliente já possui agendamento idêntico
  if (telefone || cpf) {
    const consulta = await acaoConsultarAgendamentos({
      tenantContext,
      dados: { cpf, telefone }
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

  // 2. Verificar se o intervalo está livre
  const duracao = tenantContext.politica?.duracao_minutos || DURACAO_PADRAO;
  const disponibilidade = await verificarIntervaloLivre({
    accessToken,
    conexaoM365,
    fusoHorario: fuso,
    data,
    horario,
    duracaoMinutos: duracao
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

  const inicio = `${data}T${horario}:00`;
  const fim = disponibilidade.fim.dateTime;

  const nomeExibicao = (nome && String(nome).trim()) ? String(nome).trim() : "Cliente";
  const cpfFormatado = formatarCpfExibicao(cpf);
  const telefoneFormatado = formatarTelefoneExibicao(telefone);
  const dataExibicao = formatarDataPtBr(data);

  const callReason = dados.callReason || dados.motivo || "";

  const linhasCorpo = [
    "Agendamento realizado via GoTo",
    `Nome: ${nomeExibicao}`,
    `CPF: ${cpfFormatado}`,
    `Telefone: ${telefoneFormatado}`,
    `Data: ${dataExibicao}`,
    `Horário: ${horario}`
  ];

  if (conversationSpaceId) {
    linhasCorpo.push(`ConversationSpaceId: ${conversationSpaceId}`);
  }
  if (callReason) {
    linhasCorpo.push(`Motivo identificado pela IA: ${callReason}`);
  }

  const descricao = linhasCorpo.join("\n");

  const evento = {
    subject: `Agendamento GoTo - ${nomeExibicao}`,
    body: {
      contentType: "Text",
      content: descricao
    },
    start: {
      dateTime: inicio,
      timeZone: GRAPH_TIMEZONE_NAME
    },
    end: {
      dateTime: fim,
      timeZone: GRAPH_TIMEZONE_NAME
    },
    showAs: "busy"
  };

  const eventoCriado = await graphClient.criarEvento({
    accessToken,
    mailboxEmail: mailbox,
    evento,
    fusoHorario: fuso
  });

  console.log("Evento criado com sucesso.");
  console.log(`EVENTO ID MASCARADO: ${mascararEventoId(eventoCriado?.id)}`);
  console.log(`DATA: ${data}`);
  console.log(`HORÁRIO: ${horario}`);
  console.log(`NOME MASCARADO: ${mascararNome(nome)}`);

  return {
    status: 200,
    body: {
      success: true,
      acao: "agendar",
      data,
      horario,
      eventoId: eventoCriado?.id || "",
      webLink: eventoCriado?.webLink || "",
      mensagem: `Agendamento realizado para ${formatarDataFalada(data)} às ${falarHorario(horario)}.`
    }
  };
}

// ============================================================
// AÇÃO 4: CANCELAR
// ============================================================

async function acaoCancelar({ tenantContext, dados }) {
  const telefone = normalizarTelefone(dados.telefone);
  const cpf = normalizarTelefone(dados.cpf);

  const dataBruta = dados.data || "";
  const data = availabilityEngine.normalizarDataEntrada(dataBruta) || dataBruta;

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

  if (!availabilityEngine.dataValida(data) || !availabilityEngine.horarioValido(horario)) {
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
    tenantContext,
    dados: { telefone, cpf }
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
  const conexaoM365 = tenantContext.conexaoM365;
  const accessToken = await graphClient.obterAccessTokenGraph(conexaoM365);
  const mailbox = conexaoM365?.mailbox_email || conexaoM365?.mailboxEmail || LEGACY_MAILBOX_ID;

  await graphClient.cancelarEvento({
    accessToken,
    mailboxEmail: mailbox,
    eventoId: eventoAlvo.id
  });

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
// AÇÃO 5: REAGENDAR
// ============================================================

async function acaoReagendar({ tenantContext, dados }) {
  const telefone = normalizarTelefone(dados.telefone);
  const cpf = normalizarTelefone(dados.cpf);

  let dataAnterior = dados.dataAnterior || dados.data_anterior || "";
  dataAnterior = availabilityEngine.normalizarDataEntrada(dataAnterior) || dataAnterior;

  let horarioAnterior = dados.horarioAnterior || dados.horario_anterior || "";
  if (horarioAnterior) {
    const hMatch = horarioAnterior.match(/(\d{2}:\d{2})/);
    if (hMatch) horarioAnterior = hMatch[1];
  }

  let novaData = dados.novaData || dados.nova_data || dados.data || "";
  novaData = availabilityEngine.normalizarDataEntrada(novaData) || novaData;

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

  if (!availabilityEngine.dataValida(dataAnterior) || !availabilityEngine.horarioValido(horarioAnterior)) {
    return {
      status: 200,
      body: {
        success: false,
        acao: "reagendar",
        mensagem: "Data ou horário anterior informado é inválido."
      }
    };
  }

  const fuso = tenantContext.fusoHorario || DEFAULT_TIMEZONE;
  const validacaoNovo = validarDataEHorarioFuturoNoFuso(novaData, novoHorario, fuso);
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

  const consulta = await acaoConsultarAgendamentos({
    tenantContext,
    dados: { telefone, cpf }
  });

  const agendamentos = consulta.body?.agendamentos || [];

  // Idempotência
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
        mensagem: "Encontrei mais de um agendamento no horário anterior. Por favor, fale com um atendente."
      }
    };
  }

  const eventoAnterior = correspondentes[0];
  const duracao = tenantContext.politica?.duracao_minutos || DURACAO_PADRAO;
  const conexaoM365 = tenantContext.conexaoM365;
  const accessToken = await graphClient.obterAccessTokenGraph(conexaoM365);
  const mailbox = conexaoM365?.mailbox_email || conexaoM365?.mailboxEmail || LEGACY_MAILBOX_ID;

  const disponibilidade = await verificarIntervaloLivre({
    accessToken,
    conexaoM365,
    fusoHorario: fuso,
    data: novaData,
    horario: novoHorario,
    duracaoMinutos: duracao,
    ignorarEventoId: eventoAnterior.id
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

  const novoFim = disponibilidade.fim.dateTime;

  await graphClient.atualizarEvento({
    accessToken,
    mailboxEmail: mailbox,
    eventoId: eventoAnterior.id,
    alteracoes: {
      start: {
        dateTime: `${novaData}T${novoHorario}:00`,
        timeZone: GRAPH_TIMEZONE_NAME
      },
      end: {
        dateTime: novoFim,
        timeZone: GRAPH_TIMEZONE_NAME
      }
    },
    fusoHorario: fuso
  });

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
// CONSTRUÇÃO DO CONTEXTO DE FALLBACK (CLIENTE LEGADO)
// ============================================================

function construirContextoLegado() {
  return {
    empresa: {
      id: "legacy-brasinfo",
      nome: "Brasinfo TI",
      slug: "brasinfo-ti",
      fuso_horario: DEFAULT_TIMEZONE,
      ativo: true
    },
    fusoHorario: DEFAULT_TIMEZONE,
    conexaoM365: {
      azure_tenant_id: process.env.AZURE_TENANT_ID,
      azure_client_id: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      mailbox_email: LEGACY_MAILBOX_ID
    },
    politica: {
      duracao_minutos: 60,
      intervalo_entre_slots: 60,
      max_opcoes_retorno: 4
    },
    horarios: [
      { dia_semana: 1, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "17:00" }] },
      { dia_semana: 2, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "17:00" }] },
      { dia_semana: 3, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "17:00" }] },
      { dia_semana: 4, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "17:00" }] },
      { dia_semana: 5, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "17:00" }] }
    ],
    excecoes: []
  };
}

// ============================================================
// HANDLER PRINCIPAL /api/agendamento
// ============================================================

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST" && req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido. Utilize POST."
      });
    }

    // ========================================================
    // AUTENTICAÇÃO E RESOLUÇÃO DE TENANT POR X-API-KEY
    // ========================================================

    const apiKey = req.headers["x-api-key"] || req.query.apiKey;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API Key inválida"
      });
    }

    let tenantContext = null;
    let falhaBanco = false;

    // 1. Tenta resolver empresa no repositório de banco
    try {
      const resolucao = await empresaRepo.obterEmpresaPorApiKey(apiKey);
      if (resolucao?.erro === "Empresa desativada") {
        return res.status(403).json({
          success: false,
          error: "Empresa desativada"
        });
      }

      if (resolucao?.empresa) {
        // Rate limit atômico por empresa
        const rl = await verificarRateLimitEmpresa(resolucao.empresa.id);
        if (!rl.permitido) {
          return res.status(429).json({
            success: false,
            error: "Limite de requisições excedido. Tente novamente em instantes."
          });
        }

        tenantContext = await empresaRepo.obterTenantContext(resolucao.empresa.id);
      }
    } catch (errDb) {
      falhaBanco = true;
      console.error("Falha técnica no banco de dados durante resolução de API key:", errDb.message);
    }

    // 2. Comportamento rigoroso de fallback e fail-safe
    const chaveLegada = process.env.GOTO_API_KEY;
    const ehChaveLegadaExata = chaveLegada && compararHashesSeguro(hashChaveGoTo(apiKey), hashChaveGoTo(chaveLegada));

    if (falhaBanco) {
      // Se o banco falhou:
      // - Somente a chave legada exata pode utilizar o contexto legado
      // - Chaves desconhecidas ou de outras empresas NUNCA caem no tenant legado e recebem 503 técnico
      if (ehChaveLegadaExata) {
        tenantContext = construirContextoLegado();
      } else {
        return res.status(503).json({
          success: false,
          error: "Erro de serviço temporário: banco de dados indisponível. Tente novamente em instantes."
        });
      }
    } else if (!tenantContext) {
      // Banco respondeu normalmente, mas a chave não foi encontrada:
      if (ehChaveLegadaExata) {
        tenantContext = construirContextoLegado();
      } else {
        return res.status(401).json({
          success: false,
          error: "API Key inválida"
        });
      }
    }

    if (!tenantContext) {
      return res.status(401).json({
        success: false,
        error: "API Key inválida"
      });
    }

    // Validação de conexão M365 ativa
    if (tenantContext.conexaoM365 && (tenantContext.conexaoM365.status_conexao === "desativado" || tenantContext.conexaoM365.ativo === false)) {
      return res.status(503).json({
        success: false,
        error: "Conexão Microsoft 365 da empresa está desativada. Contate o suporte administrativo."
      });
    }

    // ========================================================
    // PARSING DE DADOS DA REQUISIÇÃO (BLOQUEIA EMPRESA_ID NO PAYLOAD)
    // ========================================================

    const dados = obterDados(req);
    // Segurança estrita: o tenant é determinado unicamente pela chave; remove do payload qualquer tentativa de spoofing
    delete dados.empresa_id;
    delete dados.empresaId;
    delete dados.cliente_id;
    delete dados.clienteId;
    delete dados.tenant_id;
    delete dados.tenantId;
    delete dados.mailbox;
    delete dados.mailboxEmail;
    delete dados.azureTenantId;
    delete dados.azureClientId;

    const acao = normalizarTexto(dados.acao).replace(/\s+/g, "_");

    if (!acao) {
      return res.status(400).json({
        success: false,
        error: "Ação não informada",
        acoesDisponiveis: [
          "consultar_disponibilidade",
          "consultar_agendamentos",
          "agendar",
          "cancelar",
          "reagendar"
        ]
      });
    }

    // Log sanitizado (sem expor PII completa, tokens ou API keys)
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

    let resultado;

    switch (acao) {
      case "consultar_disponibilidade":
      case "disponibilidade":
        resultado = await acaoConsultarDisponibilidade({ tenantContext, dados });
        break;

      case "consultar_agendamentos":
      case "listar_agendamentos":
      case "agendamentos":
        resultado = await acaoConsultarAgendamentos({ tenantContext, dados });
        break;

      case "agendar":
        resultado = await acaoAgendar({ tenantContext, dados });
        break;

      case "cancelar":
        resultado = await acaoCancelar({ tenantContext, dados });
        break;

      case "reagendar":
      case "remarcar":
        resultado = await acaoReagendar({ tenantContext, dados });
        break;

      default:
        return res.status(400).json({
          success: false,
          error: `Ação desconhecida: ${acao}`,
          acoesDisponiveis: [
            "consultar_disponibilidade",
            "consultar_agendamentos",
            "agendar",
            "cancelar",
            "reagendar"
          ]
        });
    }

    return res.status(resultado.status).json(resultado.body);

  } catch (error) {
    console.error("Erro /api/agendamento:", error.message);

    const isGraphError =
      String(error.message || "").includes("Graph") ||
      String(error.message || "").includes("calendário") ||
      String(error.message || "").includes("503") ||
      String(error.message || "").includes("500");

    const statusCode = isGraphError ? 502 : 500;

    return res.status(statusCode).json({
      success: false,
      error: "Ocorreu um erro interno ao processar a solicitação no sistema. Por favor, tente novamente mais tarde."
    });
  }
};

module.exports.formatarCpfExibicao = formatarCpfExibicao;
module.exports.formatarTelefoneExibicao = formatarTelefoneExibicao;
module.exports.formatarDataPtBr = formatarDataPtBr;