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

    const accountKey = "945437456073062917";

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
                "ACTIVE",
                "ENDING"
              ]
            }
          ]
        })
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }

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