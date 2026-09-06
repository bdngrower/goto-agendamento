module.exports = async function handler(req, res) {
  try {
    const cookies = req.headers.cookie || "";
    const match = cookies.match(/goto_access_token=([^;]+)/);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Token não encontrado. Acesse /api/goto-auth novamente."
      });
    }

    const accessToken = decodeURIComponent(match[1]);

    async function testar(nome, url) {
      try {
        const r = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });

        let data;

        try {
          data = await r.json();
        } catch {
          data = await r.text();
        }

        return {
          nome,
          status: r.status,
          ok: r.ok,
          data
        };
      } catch (error) {
        return {
          nome,
          erro: error.message
        };
      }
    }

    const resultados = [];

    resultados.push(
      await testar(
        "Identity - usuário atual",
        "https://api.getgo.com/identity/v1/Users/me"
      )
    );

    resultados.push(
      await testar(
        "Admin - contas",
        "https://api.getgo.com/admin/rest/v1/me"
      )
    );

    return res.status(200).json({
      success: true,
      resultados
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};