module.exports = async function handler(req, res) {
  try {
    const cookies = req.headers.cookie || "";
    const match = cookies.match(/goto_access_token=([^;]+)/);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Token GoTo não encontrado. Acesse /api/goto-auth novamente."
      });
    }

    const accessToken = decodeURIComponent(match[1]);

    const webhookUrl =
      "https://goto-agendamento.vercel.app/api/goto-events";

    const nickname = "goto-agendamento-365";

    const response = await fetch(
      `https://api.goto.com/notification-channel/v1/channels/${nickname}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          channelType: "Webhook",
          webhookChannelData: {
            webhook: {
              url: webhookUrl
            }
          }
        })
      }
    );

    const data = await response.json();

    return res.status(response.status).json({
      success: response.ok,
      status: response.status,
      data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};