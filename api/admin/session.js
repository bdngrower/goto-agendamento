const { autenticarAdmin } = require("../../lib/adminAuth");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Método não permitido." });

  const auth = await autenticarAdmin(req, res);
  if (!auth) return;

  return res.status(200).json({
    success: true,
    usuario: {
      id: auth.usuario.usuarioId,
      nome: auth.usuario.nome,
      email: auth.usuario.email,
      mfaEnabled: auth.usuario.mfaEnabled || false
    },
    csrfToken: auth.usuario.csrfToken
  });
};
