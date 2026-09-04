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

  const data = req.body?.data || req.query?.data || "2026-09-08";

  return res.status(200).json({
    success: true,
    data,
    disponivel: true,
    horarios: [
      "09:00",
      "10:30",
      "14:00",
      "15:30"
    ]
  });
};