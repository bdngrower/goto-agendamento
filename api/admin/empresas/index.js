const empresaRepo = require("../../../lib/repositories/empresaRepository");
const auditoriaRepo = require("../../../lib/repositories/auditoriaRepository");
const { autenticarAdmin } = require("../../../lib/adminAuth");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = await autenticarAdmin(req, res);
  if (!auth) return;

  const { usuario, ip } = auth;

  // GET: Listar todas as empresas
  if (req.method === "GET") {
    try {
      const empresas = await empresaRepo.listarEmpresas();
      return res.status(200).json({ success: true, empresas });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // POST: Cadastrar nova empresa
  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { nome, nomeFantasia, slug, fusoHorario, ativo } = body;

      if (!nome || !slug) {
        return res.status(400).json({
          success: false,
          error: "Razão Social (nome) e identificador (slug) são obrigatórios."
        });
      }

      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({
          success: false,
          error: "O slug deve conter apenas letras minúsculas, números e hífens."
        });
      }

      const existente = await empresaRepo.obterEmpresaPorSlug(slug);
      if (existente) {
        return res.status(409).json({
          success: false,
          error: `O identificador (slug) "${slug}" já está em uso por outra empresa.`
        });
      }

      const nova = await empresaRepo.criarEmpresa({
        nome,
        nomeFantasia,
        slug,
        fusoHorario: fusoHorario || "America/Sao_Paulo",
        ativo: ativo !== undefined ? Boolean(ativo) : true
      });

      // Inicializa política padrão
      await empresaRepo.salvarPoliticaAgendamento(nova.id, {
        duracaoMinutos: 60,
        intervaloEntreSlots: 60,
        antecedenciaMinimaMinutos: 60,
        limiteMaximoDias: 60,
        maxOpcoesRetorno: 4
      });

      // Inicializa horários semanais padrão (Seg a Sex 09:00 - 18:00, Sáb/Dom fechado)
      await empresaRepo.salvarHorariosSemanais(nova.id, [
        { diaSemana: 0, fechado: true, faixas: [] },
        { diaSemana: 1, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "18:00" }] },
        { diaSemana: 2, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "18:00" }] },
        { diaSemana: 3, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "18:00" }] },
        { diaSemana: 4, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "18:00" }] },
        { diaSemana: 5, fechado: false, faixas: [{ horaInicio: "09:00", horaFim: "18:00" }] },
        { diaSemana: 6, fechado: true, faixas: [] }
      ]);

      await auditoriaRepo.registrarAuditoria({
        empresaId: nova.id,
        usuarioId: usuario.usuarioId,
        acao: "empresa.criada",
        detalhes: { slug: nova.slug, nome: nova.nome },
        ip
      });

      return res.status(201).json({ success: true, empresa: nova });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ success: false, error: "Método não permitido." });
};
