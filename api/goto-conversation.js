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

    const conversationSpaceId =
      req.query.id || "0694093a-b82d-3815-8023-595ede98dad1";

    const url =
      "https://api.goto.com/call-events/v1/conversation-spaces/" +
      encodeURIComponent(conversationSpaceId) +
      "/events";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

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
      urlUsada: url,
      conversationSpaceId,
      resposta: data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};