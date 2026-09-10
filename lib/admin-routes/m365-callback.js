const empresaRepo = require("../repositories/empresaRepository");
const auditoriaRepo = require("../repositories/auditoriaRepository");

module.exports = async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  if (req.method !== "GET") {
    return res.status(405).send("Método não permitido. Utilize GET.");
  }

  const query = req.query || {};
  const { state, tenant, admin_consent, error, error_description } = query;

  if (!state) {
    return res.redirect(302, "/admin?m365_erro=" + encodeURIComponent("State OAuth2 ausente no retorno da Microsoft."));
  }

  // 1. Validação e consumo atômico do state (proteção contra replay e cross-tenant spoofing)
  const checagemState = await empresaRepo.validarEConsumirOAuthState(state);
  if (!checagemState.valido) {
    return res.redirect(302, "/admin?m365_erro=" + encodeURIComponent(checagemState.erro));
  }

  const { empresaId, usuarioId } = checagemState;

  // 2. Tratar recusa ou erro reportado pelo Microsoft Entra ID
  if (error || admin_consent === "False") {
    const motivoErro = error_description || error || "Consentimento administrativo recusado pelo usuário.";
    await auditoriaRepo.registrarAuditoria({
      empresaId,
      usuarioId,
      acao: "empresa.m365_consentimento_recusado",
      detalhes: { error, errorDescription: motivoErro }
    });
    return res.redirect(
      302,
      `/admin?empresaId=${empresaId}&tab=tab-m365&m365_erro=${encodeURIComponent(motivoErro)}`
    );
  }

  // 3. Validar presença do identificador do tenant autorizado
  if (!tenant) {
    return res.redirect(
      302,
      `/admin?empresaId=${empresaId}&tab=tab-m365&m365_erro=${encodeURIComponent("Identificador do Tenant Microsoft não retornado pelo Entra ID.")}`
    );
  }

  try {
    // 4. Salva a conexão do tenant aprovado no banco de dados da empresa
    await empresaRepo.salvarConexaoM365Tenant(empresaId, {
      tenantId: tenant,
      tenantDisplayName: `Tenant ${tenant.substring(0, 8)}...`,
      usuarioId
    });

    // 5. Registra auditoria
    await auditoriaRepo.registrarAuditoria({
      empresaId,
      usuarioId,
      acao: "empresa.m365_conectado",
      detalhes: { tenantId: tenant }
    });

    // 6. Redireciona o navegador de volta para a aba M365 da empresa
    return res.redirect(
      302,
      `/admin?empresaId=${empresaId}&tab=tab-m365&m365_status=conectado`
    );
  } catch (err) {
    console.error("Erro ao persistir conexão M365 no callback:", err);
    return res.redirect(
      302,
      `/admin?empresaId=${empresaId}&tab=tab-m365&m365_erro=${encodeURIComponent("Erro interno ao associar organização Microsoft à empresa.")}`
    );
  }
};
