const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;

// Importar handlers principais (exatamente as mesmas 3 serverless functions de produção)
const adminDispatcher = require("./api/admin");
const m365CallbackHandler = require("./api/m365-callback");
const agendamentoHandler = require("./api/agendamento");

function enhanceResponse(res) {
  if (!res.status) {
    res.status = function(code) {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = function(data) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return res;
    };
  }
  if (!res.send) {
    res.send = function(data) {
      if (typeof data === "object") {
        return res.json(data);
      }
      res.end(data);
      return res;
    };
  }
  if (!res.redirect) {
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
  }
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

  // 1. Roteamento de frontend estático (/admin)
  if (pathname === "/" || pathname === "/admin" || pathname.startsWith("/admin/")) {
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

  // 2. Leitura de corpo de requisição
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
      // 3. API Pública GoTo
      if (pathname === "/api/agendamento") {
        return await agendamentoHandler(req, res);
      }

      // 4. Callback Microsoft OAuth
      if (pathname === "/api/admin/m365/callback") {
        return await m365CallbackHandler(req, res);
      }

      // 5. Dispatcher Geral Administrativo
      if (pathname.startsWith("/api/admin/") || pathname === "/api/admin") {
        return await adminDispatcher(req, res);
      }

      // 404
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: false, error: "Rota não encontrada." }));
    } catch (err) {
      console.error("Erro interno no servidor local:", err);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: false, error: "Erro interno no servidor." }));
      }
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[GoTo Admin Server] Executando em http://localhost:${PORT}/admin`);
  });
}

module.exports = server;
