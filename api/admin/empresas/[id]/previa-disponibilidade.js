const empresaRepo = require("../../../../lib/repositories/empresaRepository");
const graphClient = require("../../../../lib/graphClient");
const availabilityEngine = require("../../../../lib/availabilityEngine");
const { autenticarAdmin } = require("../../../../lib/adminAuth");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = await autenticarAdmin(req, res);
  if (!auth) return;

  const empresaId = req.query.id;
  if (!empresaId) {
    return res.status(400).json({ success: false, error: "ID da empresa não informado." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  let dataStr = req.query.data || body.data;

  dataStr = availabilityEngine.normalizarDataEntrada(dataStr) || dataStr;

  if (!dataStr || !availabilityEngine.dataValida(dataStr)) {
    return res.status(400).json({
      success: false,
      error: "Data informada é inválida. Forneça uma data no formato AAAA-MM-DD ou DDMMAAAA."
    });
  }

  try {
    const tenantContext = await empresaRepo.obterTenantContext(empresaId);
    if (!tenantContext) {
      return res.status(404).json({ success: false, error: "Empresa não encontrada." });
    }

    const { empresa, fusoHorario, politica, horarios, excecoes, conexaoM365 } = tenantContext;

    // 1. Gera slots candidatos com o mesmo motor do agendamento público
    const candidatos = availabilityEngine.gerarSlotsCandidatos({
      data: dataStr,
      fusoHorario,
      politica,
      horarios,
      excecoes
    });

    if (!candidatos.valido || candidatos.fechado || candidatos.slots.length === 0) {
      return res.status(200).json({
        success: true,
        data: dataStr,
        fusoHorario,
        disponivel: false,
        quantidade: 0,
        motivo: candidatos.motivo || "SEM_VAGAS",
        horarios: [],
        mensagemVoz: "Não há horários disponíveis para a data selecionada."
      });
    }

    // 2. Consulta eventos ocupados no calendário Microsoft 365
    let eventosOcupados = [];
    if (conexaoM365 && conexaoM365.azure_tenant_id && conexaoM365.mailbox_email) {
      try {
        const accessToken = await graphClient.obterAccessTokenGraph(conexaoM365);
        eventosOcupados = await graphClient.consultarCalendarView({
          accessToken,
          mailboxEmail: conexaoM365.mailbox_email,
          inicio: `${dataStr}T00:00:00-03:00`,
          fim: `${dataStr}T23:59:59-03:00`,
          fusoHorario
        });
      } catch (e) {
        console.warn("Aviso na prévia ao consultar Graph M365:", e.message);
      }
    }

    // 3. Filtra slots livres
    const livres = availabilityEngine.filtrarSlotsLivres({
      slotsCandidatos: candidatos.slots,
      data: dataStr,
      eventosOcupados,
      duracaoMinutos: politica?.duracao_minutos || 60,
      bufferAntesMinutos: politica?.buffer_antes_minutos || 0,
      bufferDepoisMinutos: politica?.buffer_depois_minutos || 0
    });

    // 4. Monta resposta contratual idêntica à URA GoTo (até 4 opções)
    const limiteOpcoes = politica?.max_opcoes_retorno || 4;
    const selecionados = livres.slice(0, limiteOpcoes);

    const promptAudio = availabilityEngine.gerarMensagemDisponibilidade(selecionados);

    return res.status(200).json({
      success: true,
      data: dataStr,
      fusoHorario,
      disponivel: selecionados.length > 0,
      quantidade: selecionados.length,
      horarios: selecionados,
      horario1: selecionados[0] || "",
      horario2: selecionados[1] || "",
      horario3: selecionados[2] || "",
      horario4: selecionados[3] || "",
      mensagemVoz: promptAudio,
      totalSlotsCandidatos: candidatos.slots.length,
      totalEventosOcupadosCalendario: eventosOcupados.length
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
