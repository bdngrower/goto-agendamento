module.exports = async function handler(req, res) {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.GOTO_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({
      success: false,
      error: "GOTO_API_KEY não configurada no servidor"
    });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      error: "API Key inválida"
    });
  }

  return res.status(200).json({
    success: true,
    message: "Conexão com o GoTo funcionando",
    timestamp: new Date().toISOString()
  });
};