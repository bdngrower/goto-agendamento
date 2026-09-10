// api/graph-mail-webhook.js

module.exports = async function handler(req, res) {
  try {
    // 1. Validation Token (Verificação de criação de subscription pelo Microsoft Graph)
    const validationToken = req.query.validationToken;
    if (validationToken) {
      console.log("GRAPH WEBHOOK VALIDATION");
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(validationToken);
    }

    // 2. Método GET para teste básico
    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Microsoft Graph mail webhook ativo"
      });
    }

    // 3. Apenas POST para notificações
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    // 4. Recebimento de Notificações
    const expectedClientState = process.env.GRAPH_WEBHOOK_CLIENT_STATE;
    const body = req.body || {};
    const notifications = body.value || [];

    if (notifications.length > 0) {
      console.log(`GRAPH MAIL NOTIFICATION RECEIVED: ${notifications.length} notificação(ões)`);

      for (const notification of notifications) {
        // Validação de clientState
        if (expectedClientState && notification.clientState !== expectedClientState) {
          console.log("CLIENT STATE INVALIDO");
          continue;
        }

        // Extrair dados de forma segura (mascarando identificadores longos)
        const changeType = notification.changeType || "unknown";
        const subId = notification.subscriptionId 
          ? `${notification.subscriptionId.substring(0, 8)}***` 
          : "unknown";
        
        let msgId = "unknown";
        if (notification.resourceData && notification.resourceData.id) {
          msgId = `${notification.resourceData.id.substring(0, 15)}***`;
        }

        if (changeType === "created") {
          console.log(`GRAPH MESSAGE CREATED | Sub: ${subId} | Msg: ${msgId}`);
        } else {
          console.log(`GRAPH NOTIFICATION: ${changeType} | Sub: ${subId} | Msg: ${msgId}`);
        }
      }
    }

    // Responder rapidamente para o Microsoft Graph
    return res.status(202).send();

  } catch (error) {
    console.error("Erro no graph-mail-webhook:", error.message);
    return res.status(500).send();
  }
};
