module.exports = async function handler(req, res) {
  try {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        error: "Variáveis do Azure não configuradas"
      });
    }

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials"
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json({
        success: false,
        error: "Erro ao obter token",
        details: tokenData
      });
    }

    return res.status(200).json({
      success: true,
      message: "Autenticação com Microsoft Graph funcionando",
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};