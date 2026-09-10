// ============================================================
// MOTOR DE DISPONIBILIDADE E REGRAS DE HORÁRIOS
// ============================================================

/**
 * Normaliza e valida qualquer formato de data aceito:
 * - YYYY-MM-DD (ex: 2026-10-15)
 * - DDMMAAAA (ex: 15102026, discagem DTMF)
 * - DD/MM/AAAA (ex: 15/10/2026)
 * Retorna sempre no formato canônico YYYY-MM-DD ou null se inválida.
 */
function normalizarDataEntrada(entrada) {
  if (!entrada) return null;
  const limpo = String(entrada).trim();

  // Caso 1: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpo)) {
    return dataValida(limpo) ? limpo : null;
  }

  // Caso 2: DDMMAAAA (8 dígitos DTMF)
  if (/^\d{8}$/.test(limpo)) {
    const dia = limpo.substring(0, 2);
    const mes = limpo.substring(2, 4);
    const ano = limpo.substring(4, 8);
    const formatada = `${ano}-${mes}-${dia}`;
    return dataValida(formatada) ? formatada : null;
  }

  // Caso 3: DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(limpo)) {
    const [dia, mes, ano] = limpo.split("/");
    const formatada = `${ano}-${mes}-${dia}`;
    return dataValida(formatada) ? formatada : null;
  }

  return null;
}

/**
 * Validação rigorosa de datas reais no calendário (ano bissexto, dias por mês).
 */
function dataValida(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const [ano, mes, dia] = data.split("-").map(Number);
  if (ano < 2000 || ano > 2100) return false;
  if (mes < 1 || mes > 12) return false;
  if (dia < 1 || dia > 31) return false;

  const diasPorMes = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  if (bissexto) diasPorMes[1] = 29;

  return dia <= diasPorMes[mes - 1];
}

function horarioValido(horario) {
  if (!/^\d{2}:\d{2}$/.test(horario)) return false;
  const [h, m] = horario.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Obtém data e hora atuais no fuso horário IANA informado.
 */
function obterDataHoraAtualNoFuso(fusoHorario = "America/Sao_Paulo") {
  const agora = new Date();
  const formatador = new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoHorario,
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
  return { dataHoje, horarioHoje, agora };
}

/**
 * Obtém o dia da semana (0=Domingo, 1=Segunda, ..., 6=Sábado) para uma data YYYY-MM-DD.
 */
function obterDiaDaSemana(dataStr) {
  const [ano, mes, dia] = dataStr.split("-").map(Number);
  // Usa Date UTC para evitar desvios de timezone
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
  return d.getUTCDay();
}

/**
 * Converte HH:mm para total de minutos desde a meia-noite.
 */
function horaParaMinutos(horaStr) {
  const [h, m] = horaStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Converte total de minutos para HH:mm.
 */
function minutosParaHora(minutos) {
  let h = Math.floor(minutos / 60) % 24;
  let m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Adiciona minutos a uma data e horário.
 */
function somarMinutos(dataStr, horarioStr, minutosAdicionar) {
  let [ano, mes, dia] = dataStr.split("-").map(Number);
  let [h, m] = horarioStr.split(":").map(Number);

  let totalMinutos = h * 60 + m + minutosAdicionar;
  let diasAdicionais = Math.floor(totalMinutos / 1440);
  let minutosRestantes = ((totalMinutos % 1440) + 1440) % 1440;

  const d = new Date(Date.UTC(ano, mes - 1, dia + diasAdicionais));
  const anoFinal = d.getUTCFullYear();
  const mesFinal = String(d.getUTCMonth() + 1).padStart(2, "0");
  const diaFinal = String(d.getUTCDate()).padStart(2, "0");

  return {
    data: `${anoFinal}-${mesFinal}-${diaFinal}`,
    horario: minutosParaHora(minutosRestantes)
  };
}

/**
 * Calcula a diferença em dias entre duas datas YYYY-MM-DD.
 */
function diferencaEmDias(dataInicio, dataFim) {
  const [a1, m1, d1] = dataInicio.split("-").map(Number);
  const [a2, m2, d2] = dataFim.split("-").map(Number);
  const t1 = Date.UTC(a1, m1 - 1, d1);
  const t2 = Date.UTC(a2, m2 - 1, d2);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/**
 * Gera os slots candidatos para uma data considerando regras de horário da empresa.
 */
function gerarSlotsCandidatos({
  data,
  fusoHorario = "America/Sao_Paulo",
  politica = {},
  horarios = [],
  excecoes = []
}) {
  const duracao = politica.duracao_minutos || politica.duracaoMinutos || 60;
  const intervalo = politica.intervalo_entre_slots || politica.intervaloEntreSlots || 60;
  const bufferAntes = politica.buffer_antes_minutos || politica.bufferAntesMinutos || 0;
  const bufferDepois = politica.buffer_depois_minutos || politica.bufferDepoisMinutos || 0;
  const antecedenciaMinutos = politica.antecedencia_minima_minutos || politica.antecedenciaMinimaMinutos || 0;
  const limiteMaximoDias = politica.limite_maximo_dias || politica.limiteMaximoDias || 60;

  const { dataHoje, horarioHoje } = obterDataHoraAtualNoFuso(fusoHorario);

  // 1. Validações preliminares de data
  if (data < dataHoje) {
    return { valido: false, motivo: "DATA_PASSADA", slots: [] };
  }

  const diasFuturos = diferencaEmDias(dataHoje, data);
  if (diasFuturos > limiteMaximoDias) {
    return { valido: false, motivo: "LIMITE_MAXIMO_DIAS", slots: [] };
  }

  // 2. Verifica Exceções da data
  const excecao = excecoes.find(e => e.data === data);
  let faixasAtendimento = [];

  if (excecao) {
    if (excecao.fechado) {
      return { valido: true, fechado: true, motivo: excecao.descricao || "FERIADO_FECHADO", slots: [] };
    }
    faixasAtendimento = excecao.faixas || [];
  } else {
    // 3. Verifica Horários Semanais
    const diaSemana = obterDiaDaSemana(data);
    const configDia = horarios.find(h => Number(h.dia_semana ?? h.diaSemana) === diaSemana);

    if (!configDia || configDia.fechado) {
      return { valido: true, fechado: true, motivo: "DIA_FECHADO", slots: [] };
    }

    if (configDia.atendimento_24h || configDia.atendimento24h) {
      faixasAtendimento = [{ horaInicio: "00:00", horaFim: "24:00" }];
    } else {
      faixasAtendimento = configDia.faixas || [];
    }
  }

  if (faixasAtendimento.length === 0) {
    return { valido: true, fechado: true, motivo: "SEM_FAIXAS", slots: [] };
  }

  // 4. Gera slots candidatos dentro de cada faixa
  const slots = [];
  const minutosHojeAtual = horaParaMinutos(horarioHoje);

  for (const faixa of faixasAtendimento) {
    const inicioStr = faixa.horaInicio || faixa.hora_inicio;
    const fimStr = faixa.horaFim || faixa.hora_fim;
    if (!inicioStr || !fimStr) continue;

    let minInicio = horaParaMinutos(inicioStr);
    let minFim = horaParaMinutos(fimStr);

    // Se o fim for 24:00 ou 00:00 indicando meia-noite
    if (fimStr === "24:00" || (minFim === 0 && minInicio > 0)) {
      minFim = 1440;
    }

    // Suporte a jornada atravessando meia-noite (ex: 20:00 às 02:00)
    let jornadaCruzaMeiaNoite = false;
    if (minFim < minInicio) {
      jornadaCruzaMeiaNoite = true;
      minFim += 1440;
    }

    let slotAtualMin = minInicio;
    while (slotAtualMin + bufferAntes + duracao + bufferDepois <= minFim) {
      const horaSlot = minutosParaHora(slotAtualMin);

      // Validação de horário no passado se a data for hoje
      let slotElegivel = true;
      if (data === dataHoje) {
        if (slotAtualMin <= minutosHojeAtual + antecedenciaMinutos) {
          slotElegivel = false;
        }
      }

      if (slotElegivel && !slots.includes(horaSlot)) {
        slots.push(horaSlot);
      }

      slotAtualMin += intervalo;
    }
  }

  return {
    valido: true,
    fechado: false,
    slots: slots.sort()
  };
}

/**
 * Avalia slots candidatos contra os eventos ocupados no Microsoft Graph.
 */
function filtrarSlotsLivres({
  data,
  slotsCandidatos,
  eventosOcupados = [],
  duracaoMinutos = 60,
  bufferAntesMinutos = 0,
  bufferDepoisMinutos = 0,
  ignorarEventoId = null
}) {
  const livres = [];

  for (const slot of slotsCandidatos) {
    const slotInicioMin = horaParaMinutos(slot) - bufferAntesMinutos;
    const slotFimMin = horaParaMinutos(slot) + duracaoMinutos + bufferDepoisMinutos;

    let temConflito = false;

    for (const evento of eventosOcupados) {
      if (ignorarEventoId && evento.id === ignorarEventoId) continue;
      if (evento.isCancelled) continue;

      // Obter horários do evento no Microsoft Graph
      // Graph retorna start.dateTime e end.dateTime no fuso solicitado
      const evtStartStr = evento.start?.dateTime || "";
      const evtEndStr = evento.end?.dateTime || "";

      if (!evtStartStr || !evtEndStr) continue;

      const evtDataStart = evtStartStr.slice(0, 10);
      const evtHoraStart = evtStartStr.slice(11, 16);
      const evtDataEnd = evtEndStr.slice(0, 10);
      const evtHoraEnd = evtEndStr.slice(11, 16);

      // Evento de dia inteiro
      if (evento.isAllDay) {
        if (evtDataStart <= data && evtDataEnd > data) {
          temConflito = true;
          break;
        }
        continue;
      }

      // Converte horários do evento para minutos
      let evtInicioMin = horaParaMinutos(evtHoraStart);
      let evtFimMin = horaParaMinutos(evtHoraEnd);

      if (evtDataStart < data) evtInicioMin = 0;
      if (evtDataEnd > data) evtFimMin = 1440;

      // Checagem de sobreposição de intervalos: max(startA, startB) < min(endA, endB)
      if (Math.max(slotInicioMin, evtInicioMin) < Math.min(slotFimMin, evtFimMin)) {
        temConflito = true;
        break;
      }
    }

    if (!temConflito) {
      livres.push(slot);
    }
  }

  return livres;
}

/**
 * Monta mensagem de áudio DTMF para GoTo Connect.
 */
function gerarMensagemDisponibilidade(horarios = []) {
  if (horarios.length === 0) {
    return "Não há horários disponíveis para a data informada. Por favor, escolha outra data.";
  }

  function formatarHoraTexto(horaStr) {
    const [h, m] = horaStr.split(":").map(Number);
    if (m === 0) {
      return `${h} horas`;
    }
    return `${h} horas e ${m} minutos`;
  }

  if (horarios.length === 1) {
    return `Encontrei um horário disponível. Para ${formatarHoraTexto(horarios[0])}, pressione 1.`;
  }

  const partes = horarios.map((h, i) => `Para ${formatarHoraTexto(h)}, pressione ${i + 1}.`);
  return `Encontrei ${horarios.length} horários disponíveis. ${partes.join(" ")}`;
}

module.exports = {
  normalizarDataEntrada,
  dataValida,
  horarioValido,
  obterDataHoraAtualNoFuso,
  obterDiaDaSemana,
  horaParaMinutos,
  minutosParaHora,
  somarMinutos,
  diferencaEmDias,
  gerarSlotsCandidatos,
  filtrarSlotsLivres,
  gerarMensagemDisponibilidade
};
