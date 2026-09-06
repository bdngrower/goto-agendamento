module.exports = async function handler(req, res) {
  try {
    // GoTo valida o endpoint usando OPTIONS
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      return res.status(200).end();
    }

    // Teste manual no navegador
    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Webhook GoTo ativo"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido"
      });
    }

    const payload = req.body;

    // Compatibilidade com validações que enviem validationCode
    const validationCode =
      Array.isArray(payload)
        ? payload?.[0]?.data?.validationCode
        : payload?.data?.validationCode;

    if (validationCode) {
      return res.status(200).json({
        validationResponse: validationCode
      });
    }

    // O Notification Channel também pode enviar POST vazio
    if (
      !payload ||
      (typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload).length === 0)
    ) {
      return res.status(200).end();
    }

    // Evento real
    console.log(
      "=============== GOTO EVENT ==============="
    );

    console.log(JSON.stringify(payload, null, 2));

    console.log(
      "=========================================="
    );

    return res.status(200).json({
      success: true,
      received: true
    });

  } catch (error) {
    console.error("Erro webhook GoTo:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};