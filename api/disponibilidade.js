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
    data: data,
    disponivel: true,

    horario1: "09:00",
    horario2: "10:30",
    horario3: "14:00",
    horario4: "15:30",

    mensagem: "Tenho disponibilidade às nove horas, dez e trinta, quatorze horas ou quinze e trinta."
  });
};