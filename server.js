const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;

// Importar handlers da API
const handlers = {
  login: require("./api/admin/login"),
  logout: require("./api/admin/logout"),
  session: require("./api/admin/session"),
  empresas: require("./api/admin/empresas/index"),
  empresaIndex: require("./api/admin/empresas/[id]/index"),
  m365: require("./api/admin/empresas/[id]/m365"),
  m365Callback: require("./api/admin/m365/callback"),
  testarM365: require("./api/admin/empresas/[id]/testar-m365"),
  horarios: require("./api/admin/empresas/[id]/horarios"),
  excecoes: require("./api/admin/empresas/[id]/excecoes"),
  chavesGoto: require("./api/admin/empresas/[id]/chaves-goto"),
  previa: require("./api/admin/empresas/[id]/previa-disponibilidade"),
  agendamento: require("./api/agendamento")
};

function enhanceResponse(res) {
  res.status = function(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function(data) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = function(data) {
    if (typeof data === "object") {
      return res.json(data);
    }
    res.end(data);
    return res;
  };
  res.redirect = function(statusOrUrl, targetUrl) {
    let code = 302;
    let loc = statusOrUrl;
    if (typeof statusOrUrl === "number") {
      code = statusOrUrl;
      loc = targetUrl;
    }
    res.statusCode = code;
    res.setHeader("Location", loc);
    res.end();
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  enhanceResponse(res);

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  req.query = parsedUrl.query || {};

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, x-csrf-token");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  // 1. Roteamento de frontend estático
  if (pathname === "/" || pathname === "/admin" || pathname === "/admin/") {
    const filePath = path.join(__dirname, "public", "admin", "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 500;
        res.end("Erro ao carregar painel administrativo.");
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(data);
    });
    return;
  }

  // 2. Leitura do corpo (body) para requisições de API
  let bodyBuffer = "";
  req.on("data", chunk => {
    bodyBuffer += chunk;
  });

  req.on("end", async () => {
    if (bodyBuffer) {
      try {
        req.body = JSON.parse(bodyBuffer);
      } catch (e) {
        req.body = bodyBuffer;
      }
    } else {
      req.body = {};
    }

    try {
      // 3. Roteamento de API
      if (pathname === "/api/admin/login") {
        return await handlers.login(req, res);
      }
      if (pathname === "/api/admin/logout") {
        return await handlers.logout(req, res);
      }
      if (pathname === "/api/admin/session") {
        return await handlers.session(req, res);
      }
      if (pathname === "/api/admin/empresas") {
        return await handlers.empresas(req, res);
      }
      if (pathname === "/api/agendamento") {
        return await handlers.agendamento(req, res);
      }
      if (pathname === "/api/admin/m365/callback") {
        return await handlers.m365Callback(req, res);
      }

      // Rotas dinâmicas de empresa: /api/admin/empresas/:id/...
      const m365ActionMatch = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)\/m365\/([^\/]+)$/);
      if (m365ActionMatch) {
        req.query.id = m365ActionMatch[1];
        req.query.action = m365ActionMatch[2];
        return await handlers.m365(req, res);
      }

      const m365Match = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)\/m365$/);
      if (m365Match) {
        req.query.id = m365Match[1];
        return await handlers.m365(req, res);
      }

      const testarM365Match = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)\/testar-m365$/);
      if (testarM365Match) {
        req.query.id = testarM365Match[1];
        return await handlers.testarM365(req, res);
      }

      const horariosMatch = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)\/horarios$/);
      if (horariosMatch) {
        req.query.id = horariosMatch[1];
        return await handlers.horarios(req, res);
      }

      const excecoesMatch = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)\/excecoes$/);
      if (excecoesMatch) {
        req.query.id = excecoesMatch[1];
        return await handlers.excecoes(req, res);
      }

      const chavesMatch = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)\/chaves-goto$/);
      if (chavesMatch) {
        req.query.id = chavesMatch[1];
        return await handlers.chavesGoto(req, res);
      }

      const previaMatch = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)\/previa-disponibilidade$/);
      if (previaMatch) {
        req.query.id = previaMatch[1];
        return await handlers.previa(req, res);
      }

      const empresaDetalheMatch = pathname.match(/^\/api\/admin\/empresas\/([^\/]+)$/);
      if (empresaDetalheMatch) {
        req.query.id = empresaDetalheMatch[1];
        return await handlers.empresaIndex(req, res);
      }

      // 404
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: false, error: "Rota não encontrada." }));
    } catch (err) {
      console.error("Erro interno no servidor:", err);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: false, error: "Erro interno no servidor." }));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[GoTo Admin Server] Executando em http://localhost:${PORT}/admin`);
});
