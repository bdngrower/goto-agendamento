const empresaRepo = require("../repositories/empresaRepository");
const auditoriaRepo = require("../repositories/auditoriaRepository");
const { autenticarAdmin } = require("../adminAuth");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = await autenticarAdmin(req, res);
  if (!auth) return;

  const empresaId = req.query.id;
  if (!empresaId) {
    return res.status(400).json({ success: false, error: "ID da empresa não informado." });
  }

  const { usuario, ip } = auth;

  // GET: Listar exceções de data
  if (req.method === "GET") {
    try {
      const excecoes = await empresaRepo.listarExcecoesData(empresaId);
      return res.status(200).json({ success: true, excecoes });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // POST: Cadastrar ou atualizar exceção
  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { data, descricao, fechado, faixas } = body;

      if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        return res.status(400).json({
          success: false,
          error: "Data no formato AAAA-MM-DD é obrigatória."
        });
      }

      await empresaRepo.salvarExcecaoData(empresaId, {
        data,
        descricao: descricao || "Data Especial",
        fechado: fechado !== undefined ? Boolean(fechado) : true,
        faixas: Array.isArray(faixas) ? faixas : []
      });

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.excecao_salva",
        detalhes: { data, descricao, fechado },
        ip
      });

      return res.status(200).json({
        success: true,
        mensagem: `Exceção para a data ${data} salva com sucesso.`
      });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  // DELETE: Remover exceção por data
  if (req.method === "DELETE") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const data = req.query.data || body.data;

      if (!data) {
        return res.status(400).json({ success: false, error: "Data da exceção a remover é obrigatória." });
      }

      await empresaRepo.removerExcecaoData(empresaId, data);

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.excecao_removida",
        detalhes: { data },
        ip
      });

      return res.status(200).json({
        success: true,
        mensagem: `Exceção para a data ${data} removida com sucesso.`
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ success: false, error: "Método não permitido." });
};
