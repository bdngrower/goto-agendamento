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

    const accountKey = "5316599808366110732";

    const channelId =
      "Webhook.8b34a9c5-9e5a-4f09-a88c-56c28ac1f8d1";

    const response = await fetch(
      "https://api.goto.com/call-events/v1/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          channelId,
          accountKeys: [
            {
              id: accountKey,
              events: [
                "STARTING",
                "ENDING"
              ]
            }
          ]
        })
      }
    );

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return res.status(200).json({
      gotoStatus: response.status,
      gotoOk: response.ok,
      accountKey,
      channelId,
      resposta: data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};