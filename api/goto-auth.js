module.exports = async function handler(req, res) {
  const clientId = process.env.GOTO_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({
      success: false,
      error: "GOTO_CLIENT_ID não configurado"
    });
  }

  const redirectUri =
    "https://goto-agendamento.vercel.app/api/goto-callback";

  const scopes = [
    "call-events.v1.notifications.manage",
    "call-events.v1.events.read",
    "cr.v1.read"
  ].join(" ");

  const authUrl =
    "https://authentication.logmeininc.com/oauth/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    "&response_type=code" +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}`;

  return res.redirect(authUrl);
};