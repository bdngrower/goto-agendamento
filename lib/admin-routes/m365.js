const empresaRepo = require("../repositories/empresaRepository");
const auditoriaRepo = require("../repositories/auditoriaRepository");
const graphClient = require("../graphClient");
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
  const action = req.query.action || req.body?.action;

  // 1. AÇÃO: Iniciar conexão (gera URL oficial de Admin Consent Microsoft Entra)
  if (action === "iniciar-conexao" || action === "conectar") {
    try {
      const clientId = process.env.M365_APP_CLIENT_ID;
      if (!clientId) {
        return res.status(500).json({
          success: false,
          error: "M365_APP_CLIENT_ID não está configurado nas variáveis de ambiente da aplicação GoTo Agendamento."
        });
      }

      // Default redirect URI
      const host = req.headers.host || "localhost:3000";
      const protocol = req.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
      const redirectUri = process.env.M365_REDIRECT_URI || `${protocol}://${host}/api/admin/m365/callback`;

      const state = await empresaRepo.criarOAuthState(empresaId, usuario.usuarioId);

      // Endpoint oficial da Microsoft para concessão de consentimento organizacional (Multitenant Application Permissions)
      const urlAutorizacao = `https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=${encodeURIComponent(
        clientId
      )}&scope=https://graph.microsoft.com/.default&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      return res.status(200).json({
        success: true,
        urlAutorizacao,
        state
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // 2. AÇÃO: Buscar ou validar mailbox no Microsoft Graph (privilégio mínimo)
  if (action === "buscar-mailbox" || action === "mailboxes") {
    try {
      const queryBusca = req.query.q || req.body?.q;
      if (!queryBusca) {
        return res.status(400).json({ success: false, error: "Parâmetro 'q' (termo ou e-mail) obrigatório." });
      }

      const conexao = await empresaRepo.obterConexaoM365(empresaId);
      if (!conexao || !conexao.tenant_id) {
        return res.status(400).json({ success: false, error: "A organização Microsoft 365 ainda não foi conectada." });
      }

      const resultados = await graphClient.buscarOuValidarMailbox({
        conexaoM365: conexao,
        query: queryBusca
      });

      return res.status(200).json({
        success: true,
        resultados
      });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  // 3. AÇÃO: Selecionar mailbox de agenda
  if (action === "selecionar-mailbox") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { mailboxEmail, mailboxDisplayName, mailboxId } = body;

      if (!mailboxEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailboxEmail.trim())) {
        return res.status(400).json({ success: false, error: "E-mail de mailbox válido é obrigatório." });
      }

      const conexaoAtualizada = await empresaRepo.salvarMailboxM365(empresaId, {
        mailboxEmail: mailboxEmail.trim(),
        mailboxDisplayName: mailboxDisplayName || mailboxEmail.trim(),
        mailboxId: mailboxId || mailboxEmail.trim()
      });

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.m365_mailbox_selecionada",
        detalhes: { mailbox: mailboxEmail.trim() },
        ip
      });

      return res.status(200).json({
        success: true,
        conexao: conexaoAtualizada
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // 4. AÇÃO: Desconectar Microsoft 365
  if (action === "desconectar" || req.method === "DELETE") {
    try {
      await empresaRepo.desconectarM365(empresaId);

      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.m365_desconectado",
        detalhes: { empresaId },
        ip
      });

      return res.status(200).json({
        success: true,
        mensagem: "Organização Microsoft 365 e mailbox desconectadas com sucesso."
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // 5. GET: Obter status da conexão M365 da empresa
  if (req.method === "GET") {
    try {
      const [conexao, validacoes] = await Promise.all([
        empresaRepo.obterConexaoM365(empresaId, false),
        auditoriaRepo.obterStatusValidacoesM365(empresaId)
      ]);

      const conectado = Boolean(conexao && conexao.tenant_id && conexao.status_consentimento === "concedido");

      return res.status(200).json({
        success: true,
        conexao: {
          conectado,
          tenantId: conexao?.tenant_id || "",
          tenantDisplayName: conexao?.tenant_display_name || conexao?.tenant_id || "",
          conectadoEm: conexao?.conectado_em || null,
          mailboxEmail: conexao?.mailbox_email || "",
          mailboxDisplayName: conexao?.mailbox_display_name || conexao?.mailbox_email || "",
          mailboxId: conexao?.mailbox_id || "",
          statusConsentimento: conexao?.status_consentimento || "pendente",
          statusConexao: conectado ? "conectado" : "nao_configurado",
          validacoes
        }
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ success: false, error: "Método não permitido." });
};
