const usuarioRepo = require("../repositories/usuarioRepository");
const auditoriaRepo = require("../repositories/auditoriaRepository");
const { parseCookies } = require("../adminAuth");

module.exports = async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método não permitido. Utilize POST." });
  }

  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.goto_admin_session || req.headers["authorization"]?.replace("Bearer ", "")?.trim();
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "127.0.0.1";

  if (token) {
    const usuario = await usuarioRepo.validarSessao(token);
    if (usuario) {
      await auditoriaRepo.registrarAuditoria({
        empresaId: null,
        usuarioId: usuario.usuarioId,
        acao: "usuario.logout",
        detalhes: { email: usuario.email },
        ip
      });
    }
    await usuarioRepo.encerrarSessao(token);
  }

  res.setHeader(
    "Set-Cookie",
    `goto_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
  );

  return res.status(200).json({ success: true, mensagem: "Sessão encerrada com sucesso." });
};
