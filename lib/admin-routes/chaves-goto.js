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

  // GET: Listar chaves GoTo da empresa e checklist de prontidão
  if (req.method === "GET") {
    try {
      const [chaves, empresa, conexao, validacoes, horarios] = await Promise.all([
        empresaRepo.listarChavesGoTo(empresaId),
        empresaRepo.obterEmpresaPorId(empresaId),
        empresaRepo.obterConexaoM365(empresaId, false),
        auditoriaRepo.obterStatusValidacoesM365(empresaId),
        empresaRepo.obterHorariosSemanais(empresaId)
      ]);

      const empresaAtiva = Boolean(empresa && empresa.ativo);
      const m365Configurado = Boolean(conexao && (conexao.tenant_id || conexao.azure_tenant_id) && conexao.mailbox_email);
      const authValidada = validacoes?.auth?.status === "ok";
      const leituraValidada = validacoes?.leitura?.status === "ok";
      const gravacaoValidada = validacoes?.gravacao?.status === "ok";
      const horariosConfigurados = Array.isArray(horarios) && horarios.some(h => !h.fechado && (h.atendimento_24h || (h.faixas && h.faixas.length > 0)));

      const pendencias = [];
      if (!empresaAtiva) pendencias.push("Empresa deve estar ativa no sistema.");
      if (!m365Configurado) pendencias.push("Conexão Microsoft 365 e Mailbox de agenda devem estar configuradas.");
      if (!authValidada) pendencias.push("Teste 1 (Autenticação Microsoft 365) deve ser validado com sucesso.");
      if (!leituraValidada) pendencias.push("Teste 2 (Leitura da Agenda) deve ser validado com sucesso.");
      if (!gravacaoValidada) pendencias.push("Teste 3 (Gravação da Agenda) deve ser validado com sucesso.");
      if (!horariosConfigurados) pendencias.push("Ao menos um dia da semana deve ter horários de atendimento configurados.");

      const checklist = {
        empresaAtiva,
        m365Configurado,
        authValidada,
        leituraValidada,
        gravacaoValidada,
        horariosConfigurados,
        prontoParaGerar: pendencias.length === 0,
        pendencias
      };

      return res.status(200).json({ success: true, chaves, checklist });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // POST: Gerar nova chave GoTo (exibição única da chave completa)
  if (req.method === "POST") {
    try {
      const [empresa, conexao, validacoes, horarios] = await Promise.all([
        empresaRepo.obterEmpresaPorId(empresaId),
        empresaRepo.obterConexaoM365(empresaId, false),
        auditoriaRepo.obterStatusValidacoesM365(empresaId),
        empresaRepo.obterHorariosSemanais(empresaId)
      ]);

      const pendencias = [];
      if (!empresa || !empresa.ativo) pendencias.push("Empresa deve estar ativa no sistema.");
      const m365Ok = Boolean(conexao && (conexao.tenant_id || conexao.azure_tenant_id) && conexao.mailbox_email);
      if (!m365Ok) pendencias.push("Conexão Microsoft 365 e Mailbox de agenda devem estar configuradas.");
      if (validacoes?.auth?.status !== "ok") pendencias.push("Teste 1 (Autenticação M365) pendente.");
      if (validacoes?.leitura?.status !== "ok") pendencias.push("Teste 2 (Leitura M365) pendente.");
      if (validacoes?.gravacao?.status !== "ok") pendencias.push("Teste 3 (Gravação M365) pendente.");
      const temHorarios = Array.isArray(horarios) && horarios.some(h => !h.fechado && (h.atendimento_24h || (h.faixas && h.faixas.length > 0)));
      if (!temHorarios) pendencias.push("Horários de funcionamento semanais pendentes.");

      if (pendencias.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Geração de chave GoTo bloqueada: complete o onboarding antes de gerar a chave de integração.",
          pendencias
        });
      }

      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const nomeIdentificador = body.nomeIdentificador || "Chave GoTo Connect";

      const resultado = await empresaRepo.cadastrarChaveGoTo(empresaId, nomeIdentificador);

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.chave_goto_gerada",
        detalhes: { keyPrefix: resultado.keyPrefix, nomeIdentificador },
        ip
      });

      return res.status(201).json({
        success: true,
        chave: {
          id: resultado.id,
          nomeIdentificador: resultado.nomeIdentificador,
          keyPrefix: resultado.keyPrefix,
          chaveCompleta: resultado.chaveCompleta, // EXIBIÇÃO ÚNICA!
          criadoEm: resultado.criadoEm,
          instrucoesGoTo: {
            urlDestino: "https://goto-agendamento.vercel.app/api/agendamento",
            headerNome: "X-API-Key",
            contentType: "application/json",
            aviso: "Copie a chave completa agora. Por segurança, ela não será exibida novamente no painel."
          }
        }
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // DELETE: Revogar chave
  if (req.method === "DELETE") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const chaveId = req.query.chaveId || body.chaveId;

      if (!chaveId) {
        return res.status(400).json({ success: false, error: "ID da chave a revogar é obrigatório." });
      }

      await empresaRepo.revogarChaveGoTo(chaveId);

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.chave_goto_revogada",
        detalhes: { chaveId },
        ip
      });

      return res.status(200).json({ success: true, mensagem: "Chave revogada com sucesso." });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ success: false, error: "Método não permitido." });
};
