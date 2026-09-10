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

  // GET: Obter detalhes da empresa
  if (req.method === "GET") {
    try {
      const empresa = await empresaRepo.obterEmpresaPorId(empresaId);
      if (!empresa) {
        return res.status(404).json({ success: false, error: "Empresa não encontrada." });
      }
      return res.status(200).json({ success: true, empresa });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // PUT / PATCH: Atualizar empresa
  if (req.method === "PUT" || req.method === "PATCH") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { nome, nomeFantasia, fusoHorario, ativo } = body;

      let empresa = await empresaRepo.obterEmpresaPorId(empresaId);
      if (!empresa) {
        return res.status(404).json({ success: false, error: "Empresa não encontrada." });
      }

      if (ativo !== undefined && ativo !== null) {
        empresa = await empresaRepo.ativarDesativarEmpresa(empresaId, Boolean(ativo));
      }

      if (nome || nomeFantasia !== undefined || fusoHorario) {
        empresa = await empresaRepo.atualizarEmpresa(empresaId, {
          nome,
          nomeFantasia,
          fusoHorario
        });
      }

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.atualizada",
        detalhes: { nome, ativo, fusoHorario },
        ip
      });

      return res.status(200).json({ success: true, empresa });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ success: false, error: "Método não permitido." });
};
