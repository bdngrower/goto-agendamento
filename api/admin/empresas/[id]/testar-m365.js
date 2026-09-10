const empresaRepo = require("../../../../lib/repositories/empresaRepository");
const auditoriaRepo = require("../../../../lib/repositories/auditoriaRepository");
const graphClient = require("../../../../lib/graphClient");
const { autenticarAdmin } = require("../../../../lib/adminAuth");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = await autenticarAdmin(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método não permitido. Utilize POST." });
  }

  const empresaId = req.query.id;
  if (!empresaId) {
    return res.status(400).json({ success: false, error: "ID da empresa não informado." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const tipo = req.query.tipo || body.tipo || "leitura"; // 'auth', 'leitura', 'gravacao', 'completo'

  const { usuario, ip } = auth;

  try {
    const conexao = await empresaRepo.obterConexaoM365(empresaId, true);
    if (!conexao || !conexao.azure_tenant_id || !conexao.mailbox_email) {
      return res.status(400).json({
        success: false,
        error: "Conexão Microsoft 365 incompleta. Configure Tenant ID e Mailbox antes de testar."
      });
    }

    if (tipo === "auth") {
      const resAuth = await graphClient.testarAutenticacaoM365(conexao);
      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.m365_teste_auth",
        detalhes: { sucesso: resAuth.sucesso, tempoMs: resAuth.tempoMs },
        ip
      });
      const statusHttp = resAuth.sucesso ? 200 : 400;
      return res.status(statusHttp).json({ success: resAuth.sucesso, ...resAuth });
    }

    if (tipo === "gravacao") {
      const resGravacao = await graphClient.testarGravacaoM365(conexao);
      await auditoriaRepo.registrarAuditoria({
        empresaId,
        usuarioId: usuario.usuarioId,
        acao: "empresa.m365_teste_gravacao",
        detalhes: { sucesso: resGravacao.sucesso, tempoMs: resGravacao.tempoMs },
        ip
      });
      const statusHttp = resGravacao.sucesso ? 200 : 400;
      return res.status(statusHttp).json({ success: resGravacao.sucesso, ...resGravacao });
    }

    if (tipo === "completo") {
      const resAuth = await graphClient.testarAutenticacaoM365(conexao);
      let resLeitura = { sucesso: false, erro: "Autenticação prévia falhou" };
      let resGravacao = { sucesso: false, erro: "Autenticação prévia falhou" };

      if (resAuth.sucesso) {
        resLeitura = await graphClient.testarLeituraM365(conexao);
        if (resLeitura.sucesso) {
          resGravacao = await graphClient.testarGravacaoM365(conexao);
        }
      }

      const sucessoGeral = resAuth.sucesso && resLeitura.sucesso && resGravacao.sucesso;
      await empresaRepo.atualizarStatusTesteM365(empresaId, {
        status: sucessoGeral ? "ativo" : "falha",
        sucesso: sucessoGeral,
        erro: sucessoGeral ? null : (resAuth.erro || resLeitura.erro || resGravacao.erro)
      });

      return res.status(sucessoGeral ? 200 : 400).json({
        success: sucessoGeral,
        autenticacao: resAuth,
        leitura: resLeitura,
        gravacao: resGravacao
      });
    }

    // Padrão: 'leitura' (somente leitura pontual e segura)
    const teste = await graphClient.testarLeituraM365(conexao);

    await empresaRepo.atualizarStatusTesteM365(empresaId, {
      status: teste.sucesso ? "ativo" : "falha",
      sucesso: teste.sucesso,
      erro: teste.sucesso ? null : teste.erro
    });

    await auditoriaRepo.registrarAuditoria({
      empresaId,
      usuarioId: usuario.usuarioId,
      acao: "empresa.m365_teste_leitura",
      detalhes: { sucesso: teste.sucesso, mailbox: conexao.mailbox_email, tempoMs: teste.tempoMs, erro: teste.erro },
      ip
    });

    return res.status(teste.sucesso ? 200 : 400).json({
      success: teste.sucesso,
      sucesso: teste.sucesso,
      mensagem: teste.mensagem,
      erro: teste.erro,
      tempoMs: teste.tempoMs
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
