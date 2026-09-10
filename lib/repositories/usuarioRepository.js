const crypto = require("crypto");
const db = require("../db");
const { hashSenha, verificarSenha, validarForcaSenha } = require("../crypto");

function gerarId() {
  return crypto.randomUUID();
}

/**
 * Cria novo usuário administrador aplicando política de senha forte.
 */
async function criarUsuarioAdmin({ email, nome, senha }) {
  const emailNorm = String(email || "").toLowerCase().trim();
  const nomeNorm = String(nome || "").trim();

  const validacaoSenha = validarForcaSenha(senha);
  if (!validacaoSenha.valido) {
    throw new Error(validacaoSenha.erro);
  }

  const id = gerarId();
  const senhaHash = hashSenha(senha);
  const agora = new Date().toISOString();

  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `INSERT INTO goto_agendamento.usuarios_admin (id, email, nome, senha_hash, ativo, mfa_enabled, criado_em)
       VALUES ($1, $2, $3, $4, TRUE, FALSE, $5)
       RETURNING id, email, nome, ativo, mfa_enabled, criado_em`,
      [id, emailNorm, nomeNorm, senhaHash, agora]
    );
    return res.rows[0];
  }

  const mem = db.getMemoryDb();
  const user = {
    id,
    email: emailNorm,
    nome: nomeNorm,
    senha_hash: senhaHash,
    ativo: true,
    mfa_enabled: false,
    tentativas_falhas: 0,
    bloqueado_ate: null,
    ultimo_login_em: null,
    criado_em: agora
  };
  mem.usuarios_admin.set(id, user);
  return { id, email: user.email, nome: user.nome, ativo: user.ativo, mfa_enabled: false, criado_em: agora };
}

/**
 * Verifica se a conta do usuário está temporariamente bloqueada por tentativas repetidas.
 */
async function verificarBloqueioConta(email) {
  const emailNorm = String(email || "").toLowerCase().trim();
  const agora = new Date().toISOString();

  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `SELECT bloqueado_ate FROM goto_agendamento.usuarios_admin WHERE email = $1`,
      [emailNorm]
    );
    if (res.rows[0]?.bloqueado_ate) {
      const bloqueio = new Date(res.rows[0].bloqueado_ate).toISOString();
      if (bloqueio > agora) {
        return { bloqueado: true, bloqueadoAte: bloqueio };
      }
    }
    return { bloqueado: false };
  }

  const mem = db.getMemoryDb();
  for (const u of mem.usuarios_admin.values()) {
    if (u.email === emailNorm) {
      if (u.bloqueado_ate && u.bloqueado_ate > agora) {
        return { bloqueado: true, bloqueadoAte: u.bloqueado_ate };
      }
    }
  }
  return { bloqueado: false };
}

/**
 * Registra o resultado da tentativa de login para proteção contra força bruta.
 */
async function registrarResultadoLogin(email, sucesso) {
  const emailNorm = String(email || "").toLowerCase().trim();
  const agora = new Date().toISOString();

  const p = db.getPool();
  if (p) {
    if (sucesso) {
      await db.query(
        `UPDATE goto_agendamento.usuarios_admin
         SET tentativas_falhas_login = 0, bloqueado_ate = NULL, ultimo_login_em = NOW()
         WHERE email = $1`,
        [emailNorm]
      );
    } else {
      // Incrementa falhas e bloqueia por 15 minutos se atingir 5 falhas
      await db.query(
        `UPDATE goto_agendamento.usuarios_admin
         SET tentativas_falhas_login = tentativas_falhas_login + 1,
             bloqueado_ate = CASE WHEN tentativas_falhas_login + 1 >= 5 THEN NOW() + interval '15 minutes' ELSE bloqueado_ate END
         WHERE email = $1`,
        [emailNorm]
      );
    }
    return;
  }

  const mem = db.getMemoryDb();
  for (const u of mem.usuarios_admin.values()) {
    if (u.email === emailNorm) {
      if (sucesso) {
        u.tentativas_falhas = 0;
        u.bloqueado_ate = null;
        u.ultimo_login_em = agora;
      } else {
        u.tentativas_falhas = (u.tentativas_falhas || 0) + 1;
        if (u.tentativas_falhas >= 5) {
          u.bloqueado_ate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
      }
      break;
    }
  }
}

/**
 * Autentica usuário com verificação de bloqueio e senha forte.
 */
async function autenticarUsuario(email, senha) {
  if (!email || !senha) return { sucesso: false, erro: "Credenciais não fornecidas" };
  const emailNorm = email.toLowerCase().trim();

  // Verifica bloqueio
  const statusBloqueio = await verificarBloqueioConta(emailNorm);
  if (statusBloqueio.bloqueado) {
    return {
      sucesso: false,
      bloqueado: true,
      erro: "Conta temporariamente bloqueada devido a tentativas repetidas de login. Tente novamente em 15 minutos."
    };
  }

  const p = db.getPool();
  let user = null;

  if (p) {
    const res = await db.query(
      `SELECT * FROM goto_agendamento.usuarios_admin WHERE email = $1 AND ativo = TRUE`,
      [emailNorm]
    );
    user = res.rows[0];
  } else {
    for (const u of db.getMemoryDb().usuarios_admin.values()) {
      if (u.email === emailNorm && u.ativo) {
        user = u;
        break;
      }
    }
  }

  if (!user && p) {
    // Fallback: verificar se usuário existe no auth.users do Supabase
    try {
      const authRes = await db.query(
        `SELECT id, email, encrypted_password, raw_user_meta_data FROM auth.users WHERE email = $1`,
        [emailNorm]
      );
      if (authRes.rows[0]?.encrypted_password) {
        const checkAuth = await db.query(
          "SELECT (extensions.crypt($1, $2) = $2) as match",
          [senha, authRes.rows[0].encrypted_password]
        );
        if (checkAuth.rows[0]?.match) {
          const nomeAuto = authRes.rows[0].raw_user_meta_data?.name || authRes.rows[0].raw_user_meta_data?.full_name || "Administrador";
          const provRes = await db.query(
            `INSERT INTO goto_agendamento.usuarios_admin (id, email, nome, senha_hash, ativo)
             VALUES ($1, $2, $3, $4, TRUE)
             ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash
             RETURNING *`,
            [authRes.rows[0].id, emailNorm, nomeAuto, authRes.rows[0].encrypted_password]
          );
          user = provRes.rows[0];
        }
      }
    } catch (e) {
      console.warn("Aviso ao verificar auth.users:", e.message);
    }
  }

  if (!user) {
    await registrarResultadoLogin(emailNorm, false);
    return { sucesso: false, erro: "E-mail ou senha inválidos." };
  }

  let senhaCorreta = false;
  if (user.senha_hash && user.senha_hash.startsWith("$2")) {
    if (p) {
      const checkRes = await db.query(
        "SELECT (extensions.crypt($1, $2) = $2) as match",
        [senha, user.senha_hash]
      );
      senhaCorreta = Boolean(checkRes.rows[0]?.match);
    }
  } else {
    senhaCorreta = verificarSenha(senha, user.senha_hash);
  }

  if (!senhaCorreta) {
    await registrarResultadoLogin(emailNorm, false);
    return { sucesso: false, erro: "E-mail ou senha inválidos." };
  }

  // Sucesso: reseta tentativas
  await registrarResultadoLogin(emailNorm, true);

  return {
    sucesso: true,
    usuario: {
      id: user.id,
      email: user.email,
      nome: user.nome,
      mfaEnabled: user.mfa_enabled || false
    }
  };
}

/**
 * Cria sessão com rotação segura: invalida sessões anteriores do usuário,
 * gera CSRF token dedicado e armazena apenas o HASH SHA-256 do token de sessão.
 */
async function criarSessao(usuarioId, ip = "", userAgent = "") {
  const rawSessionToken = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawSessionToken).digest("hex");
  const expiraEm = new Date(Date.now() + 8 * 3600 * 1000).toISOString(); // 8 horas
  const id = gerarId();

  const p = db.getPool();
  if (p) {
    // Rotação de sessão: exclui sessões ativas anteriores do mesmo usuário
    await db.query(`DELETE FROM goto_agendamento.usuarios_sessoes WHERE usuario_id = $1`, [usuarioId]);

    await db.query(
      `INSERT INTO goto_agendamento.usuarios_sessoes (id, usuario_id, token_hash, csrf_token, ip_origem, user_agent, expira_em, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [id, usuarioId, tokenHash, csrfToken, ip, userAgent, expiraEm]
    );
  } else {
    const mem = db.getMemoryDb();
    // Rotação em memória
    for (const [hash, s] of mem.usuarios_sessoes.entries()) {
      if (s.usuario_id === usuarioId) {
        mem.usuarios_sessoes.delete(hash);
      }
    }
    mem.usuarios_sessoes.set(tokenHash, {
      id,
      usuario_id: usuarioId,
      token_hash: tokenHash,
      csrf_token: csrfToken,
      ip_origem: ip,
      user_agent: userAgent,
      expira_em: expiraEm,
      criado_em: new Date().toISOString()
    });
  }

  return {
    token: rawSessionToken,
    csrfToken,
    expiraEm
  };
}

/**
 * Valida sessão pelo rawToken (calculando hash e conferindo validade no banco).
 */
async function validarSessao(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const agora = new Date().toISOString();

  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `SELECT s.*, u.nome, u.email, u.ativo, u.mfa_enabled
       FROM goto_agendamento.usuarios_sessoes s
       JOIN goto_agendamento.usuarios_admin u ON u.id = s.usuario_id
       WHERE s.token_hash = $1 AND s.expira_em > $2 AND u.ativo = TRUE`,
      [tokenHash, agora]
    );
    if (res.rows[0]) {
      return {
        sessaoId: res.rows[0].id,
        usuarioId: res.rows[0].usuario_id,
        nome: res.rows[0].nome,
        email: res.rows[0].email,
        csrfToken: res.rows[0].csrf_token,
        mfaEnabled: res.rows[0].mfa_enabled
      };
    }
    return null;
  }

  const s = db.getMemoryDb().usuarios_sessoes.get(tokenHash);
  if (!s || s.expira_em <= agora) return null;
  const u = db.getMemoryDb().usuarios_admin.get(s.usuario_id);
  if (!u || !u.ativo) return null;

  return {
    sessaoId: s.id,
    usuarioId: u.id,
    nome: u.nome,
    email: u.email,
    csrfToken: s.csrf_token,
    mfaEnabled: u.mfa_enabled || false
  };
}

/**
 * Invalidação real da sessão no banco de dados.
 */
async function encerrarSessao(rawToken) {
  if (!rawToken) return false;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const p = db.getPool();
  if (p) {
    await db.query(`DELETE FROM goto_agendamento.usuarios_sessoes WHERE token_hash = $1`, [tokenHash]);
    return true;
  }
  return db.getMemoryDb().usuarios_sessoes.delete(tokenHash);
}

module.exports = {
  criarUsuarioAdmin,
  verificarBloqueioConta,
  registrarResultadoLogin,
  autenticarUsuario,
  criarSessao,
  validarSessao,
  encerrarSessao
};
