const crypto = require("crypto");
const db = require("../db");

function gerarId() {
  return crypto.randomUUID();
}

async function registrarAuditoria({ empresaId = null, usuarioId = null, acao, detalhes = {}, ip = "" }) {
  const id = gerarId();
  const agora = new Date().toISOString();

  // Sanitizar detalhes para garantir que senhas, tokens ou segredos não sejam persistidos
  const detalhesLimpos = { ...detalhes };
  delete detalhesLimpos.senha;
  delete detalhesLimpos.clientSecret;
  delete detalhesLimpos.client_secret;
  delete detalhesLimpos.token;
  delete detalhesLimpos.apiKey;

  const p = db.getPool();
  if (p) {
    try {
      await db.query(
        `INSERT INTO goto_agendamento.registros_auditoria (id, empresa_id, usuario_id, acao, detalhes, ip, criado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, empresaId, usuarioId, acao, JSON.stringify(detalhesLimpos), ip, agora]
      );
    } catch (err) {
      console.error("Erro ao registrar auditoria:", err.message);
    }
  } else {
    db.getMemoryDb().registros_auditoria.push({
      id,
      empresa_id: empresaId,
      usuario_id: usuarioId,
      acao,
      detalhes: detalhesLimpos,
      ip,
      criado_em: agora
    });
  }
}

async function listarAuditoria({ empresaId = null, limite = 50 } = {}) {
  const p = db.getPool();
  if (p) {
    let sql = `SELECT a.*, u.nome as usuario_nome, u.email as usuario_email, e.nome as empresa_nome
               FROM goto_agendamento.registros_auditoria a
               LEFT JOIN goto_agendamento.usuarios_admin u ON u.id = a.usuario_id
               LEFT JOIN goto_agendamento.empresas e ON e.id = a.empresa_id`;
    const params = [];
    if (empresaId) {
      sql += ` WHERE a.empresa_id = $1`;
      params.push(empresaId);
    }
    sql += ` ORDER BY a.criado_em DESC LIMIT $${params.length + 1}`;
    params.push(limite);
    const res = await db.query(sql, params);
    return res.rows;
  }

  const mem = db.getMemoryDb();
  let lista = [...mem.registros_auditoria];
  if (empresaId) {
    lista = lista.filter(item => item.empresa_id === empresaId);
  }
  return lista.sort((a, b) => (b.criado_em > a.criado_em ? 1 : -1)).slice(0, limite);
}

async function obterStatusValidacoesM365(empresaId) {
  const statusPadrao = {
    auth: { status: "pendente" },
    leitura: { status: "pendente" },
    gravacao: { status: "pendente" }
  };

  if (!empresaId) return statusPadrao;

  const p = db.getPool();
  let registros = [];

  if (p) {
    const res = await db.query(
      `SELECT DISTINCT ON (acao) acao, detalhes, criado_em
       FROM goto_agendamento.registros_auditoria
       WHERE empresa_id = $1 AND acao IN ('empresa.m365_teste_auth', 'empresa.m365_teste_leitura', 'empresa.m365_teste_gravacao')
       ORDER BY acao, criado_em DESC`,
      [empresaId]
    );
    registros = res.rows;
  } else {
    const mem = db.getMemoryDb();
    const map = new Map();
    for (const item of mem.registros_auditoria) {
      if (item.empresa_id === empresaId && item.acao.startsWith("empresa.m365_teste_")) {
        if (!map.has(item.acao) || item.criado_em > map.get(item.acao).criado_em) {
          map.set(item.acao, item);
        }
      }
    }
    registros = Array.from(map.values());
  }

  for (const reg of registros) {
    const detalhes = typeof reg.detalhes === "string" ? JSON.parse(reg.detalhes) : (reg.detalhes || {});
    const sucesso = Boolean(detalhes.sucesso);

    if (reg.acao === "empresa.m365_teste_auth") {
      statusPadrao.auth = {
        status: sucesso ? "ok" : "erro",
        testadoEm: reg.criado_em,
        tempoMs: detalhes.tempoMs,
        erro: sucesso ? null : detalhes.erro
      };
    } else if (reg.acao === "empresa.m365_teste_leitura") {
      statusPadrao.leitura = {
        status: sucesso ? "ok" : "erro",
        testadoEm: reg.criado_em,
        tempoMs: detalhes.tempoMs,
        mailbox: detalhes.mailbox,
        erro: sucesso ? null : detalhes.erro
      };
    } else if (reg.acao === "empresa.m365_teste_gravacao") {
      statusPadrao.gravacao = {
        status: sucesso ? "ok" : "erro",
        testadoEm: reg.criado_em,
        tempoMs: detalhes.tempoMs,
        eventoCriadoId: detalhes.eventoCriadoId,
        eventoRemovido: detalhes.eventoRemovido,
        erro: sucesso ? null : detalhes.erro
      };
    }
  }

  return statusPadrao;
}

module.exports = {
  registrarAuditoria,
  listarAuditoria,
  obterStatusValidacoesM365
};

