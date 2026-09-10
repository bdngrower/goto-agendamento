const usuarioRepo = require("./repositories/usuarioRepository");
const { verificarRateLimitAdmin } = require("./rateLimiter");
const { compararHashesSeguro } = require("./crypto");

/**
 * Faz o parse de cookies do cabeçalho HTTP.
 */
function parseCookies(cookieHeader = "") {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(cookie => {
    const parts = cookie.split("=");
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join("=").trim());
    }
  });
  return cookies;
}

/**
 * Middleware de autenticação, CSRF e rate limit para rotas administrativas.
 * Retorna { usuario, ip, csrfToken } ou envia resposta de erro HTTP e retorna null.
 */
async function autenticarAdmin(req, res) {
  // Cabeçalhos universais de segurança
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "127.0.0.1";
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.goto_admin_session || req.headers["authorization"]?.replace("Bearer ", "")?.trim();

  if (!token) {
    res.status(401).json({
      success: false,
      error: "Sessão não autenticada. Faça login para continuar."
    });
    return null;
  }

  let usuario = null;
  try {
    usuario = await usuarioRepo.validarSessao(token);
  } catch (errDb) {
    console.error("Falha no banco de dados durante validação de sessão:", errDb.message);
    res.status(503).json({
      success: false,
      error: "Serviço temporariamente indisponível devido a instabilidade de conexão com o banco de dados. Tente novamente em instantes."
    });
    return null;
  }

  if (!usuario) {
    res.status(401).json({
      success: false,
      error: "Sessão expirada ou inválida. Por favor, faça login novamente."
    });
    return null;
  }

  // Rate limit para requisições autenticadas (120 req/min)
  const rl = await verificarRateLimitAdmin(usuario.usuarioId || ip);
  if (!rl.permitido) {
    res.status(429).json({
      success: false,
      error: "Limite de requisições administrativas excedido. Tente novamente em 1 minuto."
    });
    return null;
  }

  // Proteção CSRF obrigatória para métodos de mutação (POST, PUT, DELETE, PATCH)
  const metodo = (req.method || "").toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(metodo)) {
    const csrfHeader = req.headers["x-csrf-token"];
    if (!csrfHeader || !usuario.csrfToken || !compararHashesSeguro(csrfHeader, usuario.csrfToken)) {
      res.status(403).json({
        success: false,
        error: "Falha de validação de segurança CSRF. Requisição bloqueada."
      });
      return null;
    }
  }

  return { usuario, ip, token };
}

module.exports = {
  parseCookies,
  autenticarAdmin
};
