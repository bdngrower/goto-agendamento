module.exports = async function handler(req, res) {
  try {
    const { code, error, error_description } = req.query;

    if (error) {
      return res.status(400).json({
        success: false,
        error,
        error_description
      });
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        error: "Authorization code não recebido"
      });
    }

    const clientId = process.env.GOTO_CLIENT_ID;
    const clientSecret = process.env.GOTO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        error: "Credenciais GoTo não configuradas"
      });
    }

    const redirectUri =
      "https://goto-agendamento.vercel.app/api/goto-callback";

    const basicAuth = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      "https://authentication.logmeininc.com/oauth/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json({
        success: false,
        error: "Erro ao obter token do GoTo",
        details: tokenData
      });
    }

    const secure = "Secure; HttpOnly; SameSite=Lax; Path=/";

    res.setHeader("Set-Cookie", [
      `goto_access_token=${encodeURIComponent(tokenData.access_token)}; Max-Age=${tokenData.expires_in || 3600}; ${secure}`,
      `goto_refresh_token=${encodeURIComponent(tokenData.refresh_token)}; Max-Age=2592000; ${secure}`
    ]);

    return res.status(200).json({
      success: true,
      message: "Autenticação GoTo realizada com sucesso.",
      principal: tokenData.principal,
      scope: tokenData.scope,
      expires_in: tokenData.expires_in,
      next: "/api/goto-account"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};