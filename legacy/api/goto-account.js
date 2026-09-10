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

    const response = await fetch(
      "https://api.getgo.com/admin/rest/v1/me",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "Erro ao consultar conta GoTo",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      accounts: data.accounts || [],
      raw: data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};