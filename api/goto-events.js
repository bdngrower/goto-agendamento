module.exports = async function handler(req, res) {
  try {
    /*
     * Endpoint que receberá notificações enviadas
     * pelo Notification Channel do GoTo.
     */

    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Webhook GoTo ativo.",
        endpoint: "/api/goto-events"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido"
      });
    }

    const event = req.body;

    // Por enquanto vamos registrar o payload completo
    // para descobrir exatamente o que o GoTo entrega
    // nas chamadas da AI Receptionist.
    console.log(
      "================ GOTO EVENT ================"
    );

    console.log(
      JSON.stringify(event, null, 2)
    );

    console.log(
      "============================================"
    );

    /*
     * O GoTo precisa receber rapidamente uma
     * resposta 2xx do webhook.
     */
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