const usuarioRepo = require("../repositories/usuarioRepository");
const auditoriaRepo = require("../repositories/auditoriaRepository");
const { verificarRateLimitLogin } = require("../rateLimiter");

module.exports = async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método não permitido. Utilize POST." });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "127.0.0.1";
  const userAgent = req.headers["user-agent"] || "";

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { email, senha } = body;

    if (!email || !senha) {
      return res.status(400).json({ success: false, error: "E-mail e senha são obrigatórios." });
    }

    // 1. Rate limiting de tentativas de login por IP e usuário
    const rl = await verificarRateLimitLogin(ip, email);
    if (!rl.permitido) {
      await auditoriaRepo.registrarAuditoria({
        empresaId: null,
        usuarioId: null,
        acao: "usuario.login_bloqueado_ratelimit",
        detalhes: { email: String(email).toLowerCase().trim() },
        ip
      });
      return res.status(429).json({
        success: false,
        error: "Muitas tentativas de login. Acesso temporariamente bloqueado por 15 minutos."
      });
    }

    // 2. Autenticação e verificação de bloqueio por força bruta
    const resultado = await usuarioRepo.autenticarUsuario(email, senha);
    if (!resultado.sucesso) {
      await auditoriaRepo.registrarAuditoria({
        empresaId: null,
        usuarioId: null,
        acao: "usuario.login_falha",
        detalhes: { email: String(email).toLowerCase().trim(), motivo: resultado.erro },
        ip
      });
      const statusCode = resultado.bloqueado ? 423 : 401; // 423 Locked
      return res.status(statusCode).json({ success: false, error: resultado.erro });
    }

    // 3. Criação de sessão com rotação segura e token CSRF
    const { token, csrfToken, expiraEm } = await usuarioRepo.criarSessao(resultado.usuario.id, ip, userAgent);

    await auditoriaRepo.registrarAuditoria({
      empresaId: null,
      usuarioId: resultado.usuario.id,
      acao: "usuario.login_sucesso",
      detalhes: { email: resultado.usuario.email },
      ip
    });

    const isProd = process.env.NODE_ENV === "production" || !req.headers.host?.includes("localhost");
    const cookieOptions = [
      `goto_admin_session=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${8 * 3600}`,
      isProd ? "Secure" : ""
    ].filter(Boolean).join("; ");

    res.setHeader("Set-Cookie", cookieOptions);

    return res.status(200).json({
      success: true,
      usuario: {
        id: resultado.usuario.id,
        nome: resultado.usuario.nome,
        email: resultado.usuario.email,
        mfaEnabled: resultado.usuario.mfa_enabled || false
      },
      csrfToken,
      expiraEm
    });
  } catch (err) {
    console.error("Erro no login administrativo:", err);
    return res.status(500).json({ success: false, error: "Erro interno no servidor de autenticação." });
  }
};
