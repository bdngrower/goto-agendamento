module.exports = async function handler(req, res) {
  try {
    const {
      code,
      error,
      error_description
    } = req.query;

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

    const clientId =
      process.env.GOTO_CLIENT_ID;

    const clientSecret =
      process.env.GOTO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        error:
          "GOTO_CLIENT_ID ou GOTO_CLIENT_SECRET não configurados"
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
          "Content-Type":
            "application/x-www-form-urlencoded",
          Accept: "application/json"
        },

        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri
        })
      }
    );

    const text =
      await tokenResponse.text();

    let tokenData;

    try {
      tokenData =
        JSON.parse(text);
    } catch {
      tokenData = text;
    }

    if (!tokenResponse.ok) {
      return res
        .status(tokenResponse.status)
        .json({
          success: false,
          error:
            "Erro ao obter token GoTo",
          details: tokenData
        });
    }

    if (!tokenData?.access_token) {
      return res.status(500).json({
        success: false,
        error:
          "GoTo não retornou access_token",
        details: tokenData
      });
    }

    const cookies = [
      `goto_access_token=${encodeURIComponent(
        tokenData.access_token
      )}; Max-Age=${
        tokenData.expires_in || 3600
      }; Path=/; HttpOnly; Secure; SameSite=Lax`
    ];

    if (tokenData.refresh_token) {
      cookies.push(
        `goto_refresh_token=${encodeURIComponent(
          tokenData.refresh_token
        )}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`
      );
    }

    res.setHeader(
      "Set-Cookie",
      cookies
    );

    return res.status(200).json({
      success: true,

      message:
        "Autenticação GoTo realizada com sucesso.",

      principal:
        tokenData.principal || null,

      scope:
        tokenData.scope || null,

      expires_in:
        tokenData.expires_in || null,

      // TEMPORÁRIO PARA O POC
      // REMOVER DEPOIS DE SALVAR NA VERCEL
      refresh_token_para_configurar_na_vercel:
        tokenData.refresh_token || null,

      next:
        "/api/goto-account"
    });

  } catch (error) {
    console.error(
      "Erro callback GoTo:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};