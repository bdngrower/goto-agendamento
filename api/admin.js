const url = require("url");

// Handlers modulares em lib/admin-routes
const routes = {
  login: require("../lib/admin-routes/login"),
  logout: require("../lib/admin-routes/logout"),
  session: require("../lib/admin-routes/session"),
  empresas: require("../lib/admin-routes/empresas"),
  empresaDetalhe: require("../lib/admin-routes/empresa-detalhe"),
  m365: require("../lib/admin-routes/m365"),
  m365Callback: require("../lib/admin-routes/m365-callback"),
  testarM365: require("../lib/admin-routes/testar-m365"),
  horarios: require("../lib/admin-routes/horarios"),
  excecoes: require("../lib/admin-routes/excecoes"),
  chavesGoto: require("../lib/admin-routes/chaves-goto"),
  previa: require("../lib/admin-routes/previa-disponibilidade")
};

function ensureResponseHelpers(res) {
  if (!res.status) {
    res.status = function (code) {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = function (data) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return res;
    };
  }
  if (!res.send) {
    res.send = function (data) {
      if (typeof data === "object" && data !== null) {
        return res.json(data);
      }
      res.end(data);
      return res;
    };
  }
  if (!res.redirect) {
    res.redirect = function (statusOrUrl, targetUrl) {
      let code = 302;
      let loc = statusOrUrl;
      if (typeof statusOrUrl === "number") {
        code = statusOrUrl;
        loc = targetUrl;
      }
      res.statusCode = code;
      if (typeof res.status === "function") res.status(code);
      res.setHeader("Location", loc);
      res.end();
      return res;
    };
  }
  return res;
}

async function ensureBodyParsed(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try {
        req.body = JSON.parse(req.body);
      } catch (_) {
        // mantém como string se não for JSON válido
      }
    }
    return;
  }

  if (typeof req.on !== "function") {
    req.body = {};
    return;
  }

  // Buffering se executado em ambiente sem pre-parsing de body
  await new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (raw) {
        try {
          req.body = JSON.parse(raw);
        } catch (_) {
          req.body = raw;
        }
      } else {
        req.body = {};
      }
      resolve();
    });
    req.on("error", () => {
      req.body = {};
      resolve();
    });
  });
}

module.exports = async function handler(req, res) {
  ensureResponseHelpers(res);

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  // Tratamento de preflight CORS se necessário
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const parsedUrl = new URL(req.url || "/", "http://localhost");
  const rawPath = parsedUrl.pathname || "/";
  // Remove barra final para matching limpo (exceto raiz)
  const pathname = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;

  const searchParams = Object.fromEntries(parsedUrl.searchParams.entries());
  req.query = { ...searchParams, ...(req.query || {}) };

  await ensureBodyParsed(req);

  try {
    // 1. Rotas estáticas
    if (pathname === "/api/admin/login" || pathname === "/admin/login") {
      return await routes.login(req, res);
    }
    if (pathname === "/api/admin/logout" || pathname === "/admin/logout") {
      return await routes.logout(req, res);
    }
    if (pathname === "/api/admin/session" || pathname === "/admin/session") {
      return await routes.session(req, res);
    }
    if (pathname === "/api/admin/empresas" || pathname === "/admin/empresas") {
      return await routes.empresas(req, res);
    }
    if (pathname === "/api/admin/m365/callback" || pathname === "/admin/m365/callback") {
      return await routes.m365Callback(req, res);
    }

    // 2. Rotas dinâmicas: /api/admin/empresas/:id/...
    const m365SubMatch = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)\/m365\/([^/]+)$/);
    if (m365SubMatch) {
      req.query.id = m365SubMatch[1];
      req.query.action = m365SubMatch[2];
      return await routes.m365(req, res);
    }

    const m365Match = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)\/m365$/);
    if (m365Match) {
      req.query.id = m365Match[1];
      return await routes.m365(req, res);
    }

    const testarM365Match = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)\/testar-m365$/);
    if (testarM365Match) {
      req.query.id = testarM365Match[1];
      return await routes.testarM365(req, res);
    }

    const horariosMatch = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)\/horarios$/);
    if (horariosMatch) {
      req.query.id = horariosMatch[1];
      return await routes.horarios(req, res);
    }

    const excecoesMatch = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)\/excecoes$/);
    if (excecoesMatch) {
      req.query.id = excecoesMatch[1];
      return await routes.excecoes(req, res);
    }

    const chavesMatch = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)\/chaves-goto$/);
    if (chavesMatch) {
      req.query.id = chavesMatch[1];
      return await routes.chavesGoto(req, res);
    }

    const previaMatch = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)\/previa-disponibilidade$/);
    if (previaMatch) {
      req.query.id = previaMatch[1];
      return await routes.previa(req, res);
    }

    const empresaDetalheMatch = pathname.match(/^(?:\/api)?\/admin\/empresas\/([^/]+)$/);
    if (empresaDetalheMatch) {
      req.query.id = empresaDetalheMatch[1];
      return await routes.empresaDetalhe(req, res);
    }

    // 404
    return res.status(404).json({ success: false, error: "Rota administrativa não encontrada." });
  } catch (err) {
    console.error("Erro interno no dispatcher administrativo /api/admin:", err);
    if (!res.writableEnded) {
      return res.status(500).json({ success: false, error: "Erro interno no servidor administrativo." });
    }
  }
};
