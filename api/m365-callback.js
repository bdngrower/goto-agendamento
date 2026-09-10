const url = require("url");
const callbackHandler = require("../lib/admin-routes/m365-callback");

function ensureResponseHelpers(res) {
  if (!res.status) {
    res.status = function (code) {
      res.statusCode = code;
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
  if (!res.send) {
    res.send = function (data) {
      res.end(data);
      return res;
    };
  }
  return res;
}

module.exports = async function handler(req, res) {
  ensureResponseHelpers(res);
  const parsed = new URL(req.url || "/", "http://localhost");
  const searchParams = Object.fromEntries(parsed.searchParams.entries());
  req.query = { ...searchParams, ...(req.query || {}) };
  return callbackHandler(req, res);
};
