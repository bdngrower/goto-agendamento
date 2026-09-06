module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Webhook GoTo ativo."
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido"
      });
    }

    const payload = req.body;

    // Validação inicial feita pelo GoTo
    if (Array.isArray(payload)) {
      const validationCode =
        payload?.[0]?.data?.validationCode;

      if (validationCode) {
        console.log(
          "Validação de webhook GoTo:",
          validationCode
        );

        return res.status(200).json({
          validationResponse: validationCode
        });
      }
    }

    // Eventos normais após o canal estar configurado
    console.log(
      "=============== GOTO EVENT ==============="
    );

    console.log(
      JSON.stringify(payload, null, 2)
    );

    console.log(
      "=========================================="
    );

    return res.status(200).json({
      success: true,
      received: true
    });

  } catch (error) {
    console.error("Erro no webhook GoTo:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};