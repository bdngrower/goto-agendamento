const empresaRepo = require("../../../../lib/repositories/empresaRepository");
const auditoriaRepo = require("../../../../lib/repositories/auditoriaRepository");
const { autenticarAdmin } = require("../../../../lib/adminAuth");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = await autenticarAdmin(req, res);
  if (!auth) return;

  const empresaId = req.query.id;
  if (!empresaId) {
    return res.status(400).json({ success: false, error: "ID da empresa não informado." });
  }

  const { usuario, ip } = auth;

  // GET: Obter horários semanais e políticas
  if (req.method === "GET") {
    try {
      const [horarios, politica] = await Promise.all([
        empresaRepo.obterHorariosSemanais(empresaId),
        empresaRepo.obterPoliticaAgendamento(empresaId)
      ]);
      return res.status(200).json({ success: true, horarios, politica });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // POST / PUT: Atualizar horários semanais e/ou políticas
  if (req.method === "POST" || req.method === "PUT") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { horarios, politica } = body;

      if (Array.isArray(horarios)) {
        await empresaRepo.salvarHorariosSemanais(empresaId, horarios);
      }

      if (politica && typeof politica === "object") {
        await empresaRepo.salvarPoliticaAgendamento(empresaId, politica);
      }

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.horarios_atualizados",
        detalhes: {
          diasConfigurados: Array.isArray(horarios) ? horarios.length : 0,
          politicaAtualizada: Boolean(politica)
        },
        ip
      });

      return res.status(200).json({
        success: true,
        mensagem: "Horários e políticas de agendamento salvos com sucesso."
      });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ success: false, error: "Método não permitido." });
};
