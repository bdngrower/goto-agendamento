const crypto = require("crypto");
const db = require("../db");
const {
  criptografarSegredo,
  descriptografarSegredo,
  gerarChaveGoTo,
  hashChaveGoTo,
  compararHashesSeguro,
  extrairPrefixoChave
} = require("../crypto");

// ============================================================
// AUXILIARES DE UUID
// ============================================================

function gerarId() {
  return crypto.randomUUID();
}

// ============================================================
// EMPRESAS (TENANTS)
// ============================================================

async function criarEmpresa({
  nome,
  nomeFantasia = "",
  slug,
  fusoHorario = "America/Sao_Paulo",
  ativo = true
}) {
  const p = db.getPool();
  const id = gerarId();
  const agora = new Date().toISOString();

  if (p) {
    const res = await db.query(
      `INSERT INTO goto_agendamento.empresas (id, nome, nome_fantasia, slug, fuso_horario, ativo, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [id, nome, nomeFantasia, slug, fusoHorario, ativo, agora]
    );
    return res.rows[0];
  }

  // Memory store
  const mem = db.getMemoryDb();
  const empresa = {
    id,
    nome,
    nome_fantasia: nomeFantasia,
    slug,
    fuso_horario: fusoHorario,
    ativo,
    criado_em: agora,
    atualizado_em: agora
  };
  mem.empresas.set(id, empresa);
  return empresa;
}

async function obterEmpresaPorId(id) {
  const p = db.getPool();
  if (p) {
    const res = await db.query(`SELECT * FROM goto_agendamento.empresas WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }
  return db.getMemoryDb().empresas.get(id) || null;
}

async function obterEmpresaPorSlug(slug) {
  const p = db.getPool();
  if (p) {
    const res = await db.query(`SELECT * FROM goto_agendamento.empresas WHERE slug = $1`, [slug]);
    return res.rows[0] || null;
  }
  for (const emp of db.getMemoryDb().empresas.values()) {
    if (emp.slug === slug) return emp;
  }
  return null;
}

async function listarEmpresas() {
  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `SELECT 
        e.*,
        m.status_conexao as m365_status,
        m.mailbox_email as m365_mailbox,
        m.ultimo_teste_sucesso as m365_ultimo_teste_sucesso,
        m.ultimo_teste_em as m365_ultimo_teste_em,
        COUNT(DISTINCT c.id) FILTER (WHERE c.ativo = TRUE) as chaves_ativas_count,
        COUNT(DISTINCT c.id) as chaves_total_count
       FROM goto_agendamento.empresas e
       LEFT JOIN goto_agendamento.empresas_conexoes_m365 m ON m.empresa_id = e.id
       LEFT JOIN goto_agendamento.empresas_chaves_goto c ON c.empresa_id = e.id
       GROUP BY e.id, m.id
       ORDER BY e.criado_em ASC`
    );
    return res.rows.map(r => ({
      ...r,
      chaves_ativas_count: Number(r.chaves_ativas_count || 0),
      chaves_total_count: Number(r.chaves_total_count || 0)
    }));
  }

  const mem = db.getMemoryDb();
  return Array.from(mem.empresas.values()).map(emp => {
    const con = mem.empresas_conexoes_m365.get(emp.id);
    let chavesAtivas = 0;
    let chavesTotal = 0;
    for (const c of mem.empresas_chaves_goto.values()) {
      if (c.empresa_id === emp.id) {
        chavesTotal++;
        if (c.ativo) chavesAtivas++;
      }
    }
    return {
      ...emp,
      m365_status: con?.status_conexao || "nao_configurado",
      m365_mailbox: con?.mailbox_email || "",
      m365_ultimo_teste_sucesso: con?.ultimo_teste_sucesso || false,
      m365_ultimo_teste_em: con?.ultimo_teste_em || null,
      chaves_ativas_count: chavesAtivas,
      chaves_total_count: chavesTotal
    };
  });
}

async function atualizarEmpresa(id, { nome, nomeFantasia, fusoHorario }) {
  const agora = new Date().toISOString();
  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `UPDATE goto_agendamento.empresas
       SET nome = COALESCE($2, nome),
           nome_fantasia = COALESCE($3, nome_fantasia),
           fuso_horario = COALESCE($4, fuso_horario),
           atualizado_em = $5
       WHERE id = $1
       RETURNING *`,
      [id, nome, nomeFantasia, fusoHorario, agora]
    );
    return res.rows[0] || null;
  }
  const mem = db.getMemoryDb();
  const emp = mem.empresas.get(id);
  if (!emp) return null;
  if (nome !== undefined) emp.nome = nome;
  if (nomeFantasia !== undefined) emp.nome_fantasia = nomeFantasia;
  if (fusoHorario !== undefined) emp.fuso_horario = fusoHorario;
  emp.atualizado_em = agora;
  return emp;
}

async function ativarDesativarEmpresa(id, ativo) {
  const agora = new Date().toISOString();
  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `UPDATE goto_agendamento.empresas SET ativo = $2, atualizado_em = $3 WHERE id = $1 RETURNING *`,
      [id, Boolean(ativo), agora]
    );
    return res.rows[0] || null;
  }
  const emp = db.getMemoryDb().empresas.get(id);
  if (!emp) return null;
  emp.ativo = Boolean(ativo);
  emp.atualizado_em = agora;
  return emp;
}

// ============================================================
// CHAVES GOTO (API KEYS)
// ============================================================

async function cadastrarChaveGoTo(empresaId, nomeIdentificador = "Chave Padrão") {
  const { chaveCompleta, keyPrefix, keyHash } = gerarChaveGoTo();
  const id = gerarId();
  const agora = new Date().toISOString();

  const p = db.getPool();
  if (p) {
    await db.query(
      `INSERT INTO goto_agendamento.empresas_chaves_goto (id, empresa_id, nome_identificador, key_prefix, key_hash, ativo, criado_em)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [id, empresaId, nomeIdentificador, keyPrefix, keyHash, agora]
    );
  } else {
    const mem = db.getMemoryDb();
    mem.empresas_chaves_goto.set(id, {
      id,
      empresa_id: empresaId,
      nome_identificador: nomeIdentificador,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      ativo: true,
      criado_em: agora,
      ultimo_uso_em: null,
      revogado_em: null
    });
  }

  return {
    id,
    empresaId,
    nomeIdentificador,
    keyPrefix,
    chaveCompleta, // Retornada apenas neste momento da criação
    criadoEm: agora
  };
}

async function revogarChaveGoTo(chaveId) {
  const agora = new Date().toISOString();
  const p = db.getPool();
  if (p) {
    await db.query(
      `UPDATE goto_agendamento.empresas_chaves_goto SET ativo = FALSE, revogado_em = $2 WHERE id = $1`,
      [chaveId, agora]
    );
    return true;
  }
  const chave = db.getMemoryDb().empresas_chaves_goto.get(chaveId);
  if (!chave) return false;
  chave.ativo = false;
  chave.revogado_em = agora;
  return true;
}

async function listarChavesGoTo(empresaId) {
  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `SELECT id, empresa_id, nome_identificador, key_prefix, ativo, criado_em, ultimo_uso_em, revogado_em
       FROM goto_agendamento.empresas_chaves_goto
       WHERE empresa_id = $1
       ORDER BY criado_em DESC`,
      [empresaId]
    );
    return res.rows;
  }
  const lista = [];
  for (const c of db.getMemoryDb().empresas_chaves_goto.values()) {
    if (c.empresa_id === empresaId) {
      lista.push({
        id: c.id,
        empresa_id: c.empresa_id,
        nome_identificador: c.nome_identificador,
        key_prefix: c.key_prefix,
        ativo: c.ativo,
        criado_em: c.criado_em,
        ultimo_uso_em: c.ultimo_uso_em,
        revogado_em: c.revogado_em
      });
    }
  }
  return lista.sort((a, b) => (b.criado_em > a.criado_em ? 1 : -1));
}

/**
 * Resolve empresa a partir da chave GoTo via Hash seguro e TimingSafeEqual.
 */
async function obterEmpresaPorApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  const limpo = apiKey.trim();
  const hashTentativa = hashChaveGoTo(limpo);
  const prefix = extrairPrefixoChave(limpo);

  const p = db.getPool();
  let chaveEncontrada = null;

  if (p) {
    // Busca pelo prefixo para velocidade O(1)
    const res = await db.query(
      `SELECT c.*, e.ativo as empresa_ativa, e.nome as empresa_nome, e.fuso_horario, e.slug
       FROM goto_agendamento.empresas_chaves_goto c
       JOIN goto_agendamento.empresas e ON e.id = c.empresa_id
       WHERE c.key_prefix = $1 AND c.ativo = TRUE`,
      [prefix]
    );

    for (const row of res.rows) {
      if (compararHashesSeguro(row.key_hash, hashTentativa)) {
        chaveEncontrada = row;
        break;
      }
    }

    if (!chaveEncontrada) {
      // Fallback: se for chave antiga sem prefixo, busca todas ativas
      const resAll = await db.query(
        `SELECT c.*, e.ativo as empresa_ativa, e.nome as empresa_nome, e.fuso_horario, e.slug
         FROM goto_agendamento.empresas_chaves_goto c
         JOIN goto_agendamento.empresas e ON e.id = c.empresa_id
         WHERE c.ativo = TRUE`
      );
      for (const row of resAll.rows) {
        if (compararHashesSeguro(row.key_hash, hashTentativa)) {
          chaveEncontrada = row;
          break;
        }
      }
    }

    if (chaveEncontrada) {
      if (!chaveEncontrada.empresa_ativa) {
        return { erro: "Empresa desativada", empresa: null, chave: chaveEncontrada };
      }
      // Atualiza último uso de forma assíncrona
      db.query(
        `UPDATE goto_agendamento.empresas_chaves_goto SET ultimo_uso_em = NOW() WHERE id = $1`,
        [chaveEncontrada.id]
      ).catch(() => {});

      const empresa = await obterEmpresaPorId(chaveEncontrada.empresa_id);
      return { empresa, chave: chaveEncontrada };
    }
  } else {
    // Memory store
    const mem = db.getMemoryDb();
    for (const c of mem.empresas_chaves_goto.values()) {
      if (c.ativo && compararHashesSeguro(c.key_hash, hashTentativa)) {
        const emp = mem.empresas.get(c.empresa_id);
        if (!emp || !emp.ativo) {
          return { erro: "Empresa desativada", empresa: null, chave: c };
        }
        c.ultimo_uso_em = new Date().toISOString();
        return { empresa: emp, chave: c };
      }
    }
  }

  return null;
}

// ============================================================
// VALIDAÇÃO DE SOBREPOSIÇÃO DE FAIXAS DE HORÁRIO
// ============================================================

function validarSobreposicaoFaixas(faixas) {
  if (!Array.isArray(faixas) || faixas.length <= 1) return { valido: true };

  const intervalos = [];
  for (const f of faixas) {
    const inicio = f.horaInicio || f.hora_inicio;
    const fim = f.horaFim || f.hora_fim;
    if (!inicio || !fim) continue;

    const [hI, mI] = inicio.split(":").map(Number);
    const [hF, mF] = fim.split(":").map(Number);
    let minInicio = hI * 60 + mI;
    let minFim = hF * 60 + mF;

    if (fim === "24:00" || (minFim === 0 && minInicio > 0)) minFim = 1440;
    if (minFim < minInicio) minFim += 1440; // Cruzamento de meia-noite

    intervalos.push({ minInicio, minFim, inicio, fim });
  }

  intervalos.sort((a, b) => a.minInicio - b.minInicio);

  for (let i = 1; i < intervalos.length; i++) {
    const anterior = intervalos[i - 1];
    const atual = intervalos[i];
    if (atual.minInicio < anterior.minFim) {
      return {
        valido: false,
        erro: `Sobreposição de horários detectada: faixa ${anterior.inicio}-${anterior.fim} sobrepõe ${atual.inicio}-${atual.fim}.`
      };
    }
  }
  return { valido: true };
}

// ============================================================
// CONEXÃO MICROSOFT 365 (MULTITENANT GLOBAL APP REGISTRATION)
// ============================================================

/**
 * Salva a conexão do tenant após autorização/admin consent do Microsoft Entra ID.
 */
async function salvarConexaoM365Tenant(empresaId, { tenantId, tenantDisplayName = "", usuarioId = null }) {
  const agora = new Date().toISOString();
  const p = db.getPool();

  if (p) {
    const res = await db.query(
      `INSERT INTO goto_agendamento.empresas_conexoes_m365 AS c
        (empresa_id, nome_conexao, tipo_autenticacao, tenant_id, tenant_display_name,
         conectado_em, conectado_por, status_consentimento, status_conexao,
         status_autenticacao, status_leitura, status_gravacao, atualizado_em)
       VALUES ($1, $2, 'global_multitenant_app', $3, $4, $5, $6, 'concedido', 'conectado', 'pendente', 'pendente', 'pendente', $5)
       ON CONFLICT (empresa_id) DO UPDATE
       SET tenant_id = EXCLUDED.tenant_id,
           tenant_display_name = COALESCE(EXCLUDED.tenant_display_name, c.tenant_display_name),
           conectado_em = EXCLUDED.conectado_em,
           conectado_por = EXCLUDED.conectado_por,
           status_consentimento = 'concedido',
           status_conexao = 'conectado',
           status_autenticacao = 'pendente',
           status_leitura = 'pendente',
           status_gravacao = 'pendente',
           atualizado_em = EXCLUDED.atualizado_em
       RETURNING *`,
      [
        empresaId,
        `M365 - ${tenantDisplayName || tenantId}`,
        tenantId,
        tenantDisplayName || tenantId,
        agora,
        usuarioId
      ]
    );
    return res.rows[0];
  }

  const mem = db.getMemoryDb();
  let con = mem.empresas_conexoes_m365.get(empresaId) || { id: gerarId(), empresa_id: empresaId };
  con.nome_conexao = `M365 - ${tenantDisplayName || tenantId}`;
  con.tipo_autenticacao = "global_multitenant_app";
  con.tenant_id = tenantId;
  con.azure_tenant_id = tenantId;
  con.tenant_display_name = tenantDisplayName || tenantId;
  con.conectado_em = agora;
  con.conectado_por = usuarioId;
  con.status_consentimento = "concedido";
  con.status_conexao = "conectado";
  con.status_autenticacao = "pendente";
  con.status_leitura = "pendente";
  con.status_gravacao = "pendente";
  con.atualizado_em = agora;
  mem.empresas_conexoes_m365.set(empresaId, con);
  return con;
}

/**
 * Salva a mailbox de agenda selecionada para a empresa.
 */
async function salvarMailboxM365(empresaId, { mailboxEmail, mailboxDisplayName = "", mailboxId = "" }) {
  const agora = new Date().toISOString();
  const emailNorm = String(mailboxEmail || "").toLowerCase().trim();
  const p = db.getPool();

  if (p) {
    const res = await db.query(
      `UPDATE goto_agendamento.empresas_conexoes_m365
       SET mailbox_email = $2,
           mailbox_display_name = $3,
           mailbox_id = $4,
           status_autenticacao = 'pendente',
           status_leitura = 'pendente',
           status_gravacao = 'pendente',
           atualizado_em = $5
       WHERE empresa_id = $1
       RETURNING *`,
      [empresaId, emailNorm, mailboxDisplayName || emailNorm, mailboxId || emailNorm, agora]
    );
    return res.rows[0];
  }

  const mem = db.getMemoryDb();
  const con = mem.empresas_conexoes_m365.get(empresaId);
  if (con) {
    con.mailbox_email = emailNorm;
    con.mailbox_display_name = mailboxDisplayName || emailNorm;
    con.mailbox_id = mailboxId || emailNorm;
    con.status_autenticacao = "pendente";
    con.status_leitura = "pendente";
    con.status_gravacao = "pendente";
    con.atualizado_em = agora;
  }
  return con;
}

/**
 * Desconecta a organização Microsoft 365 da empresa.
 * Remove os dados de conexão do tenant e da mailbox, resetando os status dos testes.
 */
async function desconectarM365(empresaId) {
  const p = db.getPool();
  if (p) {
    await db.query(`DELETE FROM goto_agendamento.empresas_conexoes_m365 WHERE empresa_id = $1`, [empresaId]);
    return true;
  }
  const mem = db.getMemoryDb();
  mem.empresas_conexoes_m365.delete(empresaId);
  return true;
}

/**
 * Compatibilidade legada para testes locais.
 */
async function salvarConexaoM365(
  empresaId,
  {
    nomeConexao = "Conexão Principal M365",
    tipoAutenticacao = "global_multitenant_app",
    azureTenantId,
    tenantId,
    azureClientId,
    clientSecret,
    keyVersion = 1,
    mailboxEmail,
    statusConexao = "conectado"
  }
) {
  const agora = new Date().toISOString();
  const tId = tenantId || azureTenantId;
  const p = db.getPool();

  if (p) {
    const res = await db.query(
      `INSERT INTO goto_agendamento.empresas_conexoes_m365 AS c
        (empresa_id, nome_conexao, tipo_autenticacao, tenant_id, azure_tenant_id,
         mailbox_email, status_conexao, status_consentimento, atualizado_em)
       VALUES ($1, $2, $3, $4, $4, $5, $6, 'concedido', $7)
       ON CONFLICT (empresa_id) DO UPDATE
       SET nome_conexao = EXCLUDED.nome_conexao,
           tipo_autenticacao = EXCLUDED.tipo_autenticacao,
           tenant_id = EXCLUDED.tenant_id,
           azure_tenant_id = EXCLUDED.azure_tenant_id,
           mailbox_email = EXCLUDED.mailbox_email,
           status_conexao = EXCLUDED.status_conexao,
           status_consentimento = 'concedido',
           atualizado_em = EXCLUDED.atualizado_em
       RETURNING *`,
      [
        empresaId,
        nomeConexao,
        tipoAutenticacao,
        tId,
        mailboxEmail || null,
        statusConexao,
        agora
      ]
    );
    return res.rows[0];
  }

  const mem = db.getMemoryDb();
  let con = mem.empresas_conexoes_m365.get(empresaId);
  if (!con) {
    con = { id: gerarId(), empresa_id: empresaId };
  }
  con.nome_conexao = nomeConexao;
  con.tipo_autenticacao = tipoAutenticacao;
  con.tenant_id = tId;
  con.azure_tenant_id = tId;
  con.mailbox_email = mailboxEmail;
  con.status_conexao = statusConexao;
  con.status_consentimento = "concedido";
  con.atualizado_em = agora;
  mem.empresas_conexoes_m365.set(empresaId, con);
  return con;
}

/**
 * Obtém configuração M365 da empresa (zero segredos expostos).
 */
async function obterConexaoM365(empresaId, descriptografar = false) {
  const p = db.getPool();
  let con = null;
  if (p) {
    const res = await db.query(
      `SELECT * FROM goto_agendamento.empresas_conexoes_m365 WHERE empresa_id = $1`,
      [empresaId]
    );
    con = res.rows[0] || null;
  } else {
    con = db.getMemoryDb().empresas_conexoes_m365.get(empresaId) || null;
  }

  if (!con) return null;

  const resultado = { ...con };
  resultado.tenant_id = con.tenant_id || con.azure_tenant_id || "";
  resultado.azure_tenant_id = resultado.tenant_id;
  resultado.conectado = Boolean(resultado.tenant_id && resultado.status_consentimento === "concedido");

  return resultado;
}

async function atualizarStatusTesteM365(empresaId, { status, sucesso = true, erro = null }) {
  const agora = new Date().toISOString();
  const p = db.getPool();
  if (p) {
    await db.query(
      `UPDATE goto_agendamento.empresas_conexoes_m365 
       SET status_conexao = $2, ultimo_teste_sucesso = $3, ultimo_teste_em = $4, ultimo_erro = $5, atualizado_em = $4
       WHERE empresa_id = $1`,
      [empresaId, status, Boolean(sucesso), agora, erro]
    );
    return;
  }
  const con = db.getMemoryDb().empresas_conexoes_m365.get(empresaId);
  if (con) {
    con.status_conexao = status;
    con.ultimo_teste_sucesso = Boolean(sucesso);
    con.ultimo_teste_em = agora;
    con.ultimo_erro = erro;
    con.atualizado_em = agora;
  }
}

// ============================================================
// CONTROLE DE STATES OAUTH2 (PROTEÇÃO CSRF E REPLAY ATTACKS)
// ============================================================

async function criarOAuthState(empresaId, usuarioId) {
  const state = crypto.randomBytes(32).toString("hex");
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 15 * 60 * 1000).toISOString(); // 15 minutos de validade

  const p = db.getPool();
  if (p) {
    await db.query(
      `INSERT INTO goto_agendamento.m365_oauth_states (state, empresa_id, usuario_id, expira_em, utilizado)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [state, empresaId, usuarioId, expiraEm]
    );
    return state;
  }

  const mem = db.getMemoryDb();
  mem.m365_oauth_states.set(state, {
    state,
    empresa_id: empresaId,
    usuario_id: usuarioId,
    expira_em: expiraEm,
    utilizado: false,
    criado_em: agora.toISOString()
  });
  return state;
}

async function validarEConsumirOAuthState(state) {
  if (!state || typeof state !== "string") {
    return { valido: false, erro: "State OAuth2 não fornecido ou inválido." };
  }

  const agora = new Date().toISOString();
  const p = db.getPool();

  if (p) {
    const res = await db.query(
      `SELECT * FROM goto_agendamento.m365_oauth_states WHERE state = $1`,
      [state]
    );
    const reg = res.rows[0];

    if (!reg) {
      return { valido: false, erro: "State OAuth2 desconhecido ou não encontrado." };
    }
    if (reg.utilizado) {
      return { valido: false, erro: "State OAuth2 já foi utilizado (tentativa de replay rejeitada)." };
    }
    if (reg.expira_em && new Date(reg.expira_em).toISOString() < agora) {
      return { valido: false, erro: "State OAuth2 expirou. Inicie o fluxo novamente." };
    }

    // Marca como utilizado atômico
    await db.query(
      `UPDATE goto_agendamento.m365_oauth_states SET utilizado = TRUE WHERE state = $1`,
      [state]
    );

    return {
      valido: true,
      empresaId: reg.empresa_id,
      usuarioId: reg.usuario_id
    };
  }

  const mem = db.getMemoryDb();
  const reg = mem.m365_oauth_states.get(state);

  if (!reg) {
    return { valido: false, erro: "State OAuth2 desconhecido ou não encontrado." };
  }
  if (reg.utilizado) {
    return { valido: false, erro: "State OAuth2 já foi utilizado (tentativa de replay rejeitada)." };
  }
  if (reg.expira_em && reg.expira_em < agora) {
    return { valido: false, erro: "State OAuth2 expirou. Inicie o fluxo novamente." };
  }

  reg.utilizado = true;
  return {
    valido: true,
    empresaId: reg.empresa_id,
    usuarioId: reg.usuario_id
  };
}

// ============================================================
// POLÍTICAS DE AGENDAMENTO
// ============================================================

async function salvarPoliticaAgendamento(empresaId, dados = {}) {
  const duracao = dados.duracaoMinutos || 60;
  const intervalo = dados.intervaloEntreSlots || 60;
  const bufferAntes = dados.bufferAntesMinutos || 0;
  const bufferDepois = dados.bufferDepoisMinutos || 0;
  const antecedencia = dados.antecedenciaMinimaMinutos || 60;
  const limiteDias = dados.limiteMaximoDias || 60;
  const maxOpcoes = dados.maxOpcoesRetorno || 4;
  const agora = new Date().toISOString();

  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `INSERT INTO goto_agendamento.empresas_politicas_agendamento 
        (empresa_id, duracao_minutos, intervalo_entre_slots, buffer_antes_minutos,
         buffer_depois_minutos, antecedencia_minima_minutos, limite_maximo_dias, max_opcoes_retorno, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (empresa_id) DO UPDATE
       SET duracao_minutos = EXCLUDED.duracao_minutos,
           intervalo_entre_slots = EXCLUDED.intervalo_entre_slots,
           buffer_antes_minutos = EXCLUDED.buffer_antes_minutos,
           buffer_depois_minutos = EXCLUDED.buffer_depois_minutos,
           antecedencia_minima_minutos = EXCLUDED.antecedencia_minima_minutos,
           limite_maximo_dias = EXCLUDED.limite_maximo_dias,
           max_opcoes_retorno = EXCLUDED.max_opcoes_retorno,
           atualizado_em = EXCLUDED.atualizado_em
       RETURNING *`,
      [
        empresaId,
        duracao,
        intervalo,
        bufferAntes,
        bufferDepois,
        antecedencia,
        limiteDias,
        maxOpcoes,
        agora
      ]
    );
    return res.rows[0];
  }

  const mem = db.getMemoryDb();
  const pol = {
    id: gerarId(),
    empresa_id: empresaId,
    duracao_minutos: duracao,
    intervalo_entre_slots: intervalo,
    buffer_antes_minutos: bufferAntes,
    buffer_depois_minutos: bufferDepois,
    antecedencia_minima_minutos: antecedencia,
    limite_maximo_dias: limiteDias,
    max_opcoes_retorno: maxOpcoes,
    atualizado_em: agora
  };
  mem.empresas_politicas_agendamento.set(empresaId, pol);
  return pol;
}

async function obterPoliticaAgendamento(empresaId) {
  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `SELECT * FROM goto_agendamento.empresas_politicas_agendamento WHERE empresa_id = $1`,
      [empresaId]
    );
    if (res.rows[0]) return res.rows[0];
  } else {
    const pol = db.getMemoryDb().empresas_politicas_agendamento.get(empresaId);
    if (pol) return pol;
  }
  // Padrão
  return {
    duracao_minutos: 60,
    intervalo_entre_slots: 60,
    buffer_antes_minutos: 0,
    buffer_depois_minutos: 0,
    antecedencia_minima_minutos: 60,
    limite_maximo_dias: 60,
    max_opcoes_retorno: 4
  };
}

// ============================================================
// HORÁRIOS SEMANAIS E FAIXAS
// ============================================================

/**
 * listaDias: array com objetos:
 * {
 *   diaSemana: 0..6 (0=Dom, 1=Seg, ... 6=Sab),
 *   fechado: boolean,
 *   atendimento24h: boolean,
 *   faixas: [ { horaInicio: '08:00', horaFim: '11:00' }, ... ]
 * }
 */
async function salvarHorariosSemanais(empresaId, listaDias = []) {
  const p = db.getPool();
  if (p) {
    for (const d of listaDias) {
      const res = await db.query(
        `INSERT INTO goto_agendamento.empresas_horarios_semanais (empresa_id, dia_semana, fechado, atendimento_24h)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (empresa_id, dia_semana) DO UPDATE
         SET fechado = EXCLUDED.fechado, atendimento_24h = EXCLUDED.atendimento_24h
         RETURNING id`,
        [empresaId, d.diaSemana, Boolean(d.fechado), Boolean(d.atendimento24h)]
      );
      const horarioId = res.rows[0].id;
      await db.query(`DELETE FROM goto_agendamento.empresas_horarios_faixas WHERE horario_semanal_id = $1`, [horarioId]);

      if (!d.fechado && !d.atendimento24h && Array.isArray(d.faixas)) {
        const check = validarSobreposicaoFaixas(d.faixas);
        if (!check.valido) throw new Error(check.erro);
        let ordem = 1;
        for (const f of d.faixas) {
          await db.query(
            `INSERT INTO goto_agendamento.empresas_horarios_faixas (horario_semanal_id, hora_inicio, hora_fim, ordem)
             VALUES ($1, $2, $3, $4)`,
            [horarioId, f.horaInicio, f.horaFim, ordem++]
          );
        }
      }
    }
  } else {
    const mem = db.getMemoryDb();
    for (const d of listaDias) {
      if (!d.fechado && !d.atendimento24h && Array.isArray(d.faixas)) {
        const check = validarSobreposicaoFaixas(d.faixas);
        if (!check.valido) throw new Error(check.erro);
      }
      const key = `${empresaId}_${d.diaSemana}`;
      let item = mem.empresas_horarios_semanais.get(key);
      if (!item) {
        item = { id: gerarId(), empresa_id: empresaId, dia_semana: d.diaSemana };
        mem.empresas_horarios_semanais.set(key, item);
      }
      item.fechado = Boolean(d.fechado);
      item.atendimento_24h = Boolean(d.atendimento24h);

      const faixas = [];
      if (!d.fechado && !d.atendimento24h && Array.isArray(d.faixas)) {
        let ordem = 1;
        for (const f of d.faixas) {
          faixas.push({
            id: gerarId(),
            horario_semanal_id: item.id,
            hora_inicio: f.horaInicio,
            hora_fim: f.horaFim,
            ordem: ordem++
          });
        }
      }
      mem.empresas_horarios_faixas.set(item.id, faixas);
    }
  }
}

async function obterHorariosSemanais(empresaId) {
  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `SELECT h.*, 
              COALESCE(
                json_agg(
                  json_build_object('horaInicio', to_char(f.hora_inicio, 'HH24:MI'), 'horaFim', to_char(f.hora_fim, 'HH24:MI'), 'ordem', f.ordem)
                  ORDER BY f.ordem
                ) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) as faixas
       FROM goto_agendamento.empresas_horarios_semanais h
       LEFT JOIN goto_agendamento.empresas_horarios_faixas f ON f.horario_semanal_id = h.id
       WHERE h.empresa_id = $1
       GROUP BY h.id
       ORDER BY h.dia_semana ASC`,
      [empresaId]
    );
    return res.rows;
  }

  const mem = db.getMemoryDb();
  const resultado = [];
  for (let dia = 0; dia <= 6; dia++) {
    const key = `${empresaId}_${dia}`;
    const h = mem.empresas_horarios_semanais.get(key);
    if (h) {
      const faixas = mem.empresas_horarios_faixas.get(h.id) || [];
      resultado.push({
        dia_semana: dia,
        fechado: h.fechado,
        atendimento_24h: h.atendimento_24h,
        faixas: faixas.map(f => ({ horaInicio: f.hora_inicio, horaFim: f.hora_fim }))
      });
    }
  }
  return resultado;
}

// ============================================================
// EXCEÇÕES E DATAS ESPECIAIS (FERIADOS, HORÁRIOS REDUZIDOS)
// ============================================================

async function salvarExcecaoData(empresaId, { data, descricao = "", fechado = true, faixas = [] }) {
  if (!fechado && Array.isArray(faixas)) {
    const check = validarSobreposicaoFaixas(faixas);
    if (!check.valido) throw new Error(check.erro);
  }

  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `INSERT INTO goto_agendamento.empresas_excecoes_data (empresa_id, data, descricao, fechado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (empresa_id, data) DO UPDATE
       SET descricao = EXCLUDED.descricao, fechado = EXCLUDED.fechado
       RETURNING id`,
      [empresaId, data, descricao, Boolean(fechado)]
    );
    const excecaoId = res.rows[0].id;
    await db.query(`DELETE FROM goto_agendamento.empresas_excecoes_faixas WHERE excecao_id = $1`, [excecaoId]);

    if (!fechado && Array.isArray(faixas)) {
      let ordem = 1;
      for (const f of faixas) {
        await db.query(
          `INSERT INTO goto_agendamento.empresas_excecoes_faixas (excecao_id, hora_inicio, hora_fim, ordem)
           VALUES ($1, $2, $3, $4)`,
          [excecaoId, f.horaInicio, f.horaFim, ordem++]
        );
      }
    }
    return { id: excecaoId, empresaId, data, descricao, fechado };
  }

  const mem = db.getMemoryDb();
  const key = `${empresaId}_${data}`;
  const item = {
    id: gerarId(),
    empresa_id: empresaId,
    data,
    descricao,
    fechado: Boolean(fechado)
  };
  mem.empresas_excecoes_data.set(key, item);

  const faixasArr = [];
  if (!fechado && Array.isArray(faixas)) {
    let ordem = 1;
    for (const f of faixas) {
      faixasArr.push({
        id: gerarId(),
        excecao_id: item.id,
        hora_inicio: f.horaInicio,
        hora_fim: f.horaFim,
        ordem: ordem++
      });
    }
  }
  mem.empresas_excecoes_faixas.set(item.id, faixasArr);
  return item;
}

async function removerExcecaoData(empresaId, data) {
  const p = db.getPool();
  if (p) {
    await db.query(`DELETE FROM goto_agendamento.empresas_excecoes_data WHERE empresa_id = $1 AND data = $2`, [empresaId, data]);
    return true;
  }
  const key = `${empresaId}_${data}`;
  const item = db.getMemoryDb().empresas_excecoes_data.get(key);
  if (item) {
    db.getMemoryDb().empresas_excecoes_faixas.delete(item.id);
    db.getMemoryDb().empresas_excecoes_data.delete(key);
    return true;
  }
  return false;
}

async function listarExcecoesData(empresaId) {
  const p = db.getPool();
  if (p) {
    const res = await db.query(
      `SELECT e.*, 
              COALESCE(
                json_agg(
                  json_build_object('horaInicio', to_char(f.hora_inicio, 'HH24:MI'), 'horaFim', to_char(f.hora_fim, 'HH24:MI'), 'ordem', f.ordem)
                  ORDER BY f.ordem
                ) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) as faixas
       FROM goto_agendamento.empresas_excecoes_data e
       LEFT JOIN goto_agendamento.empresas_excecoes_faixas f ON f.excecao_id = e.id
       WHERE e.empresa_id = $1
       GROUP BY e.id
       ORDER BY e.data ASC`,
      [empresaId]
    );
    return res.rows;
  }

  const mem = db.getMemoryDb();
  const resultado = [];
  for (const item of mem.empresas_excecoes_data.values()) {
    if (item.empresa_id === empresaId) {
      const faixas = mem.empresas_excecoes_faixas.get(item.id) || [];
      resultado.push({
        id: item.id,
        data: item.data,
        descricao: item.descricao,
        fechado: item.fechado,
        faixas: faixas.map(f => ({ horaInicio: f.hora_inicio, horaFim: f.hora_fim }))
      });
    }
  }
  return resultado.sort((a, b) => (a.data > b.data ? 1 : -1));
}

// ============================================================
// TENANT CONTEXT CONSOLIDADO
// ============================================================

async function obterTenantContext(empresaId) {
  const empresa = await obterEmpresaPorId(empresaId);
  if (!empresa) return null;

  const [politica, horarios, excecoes, conexaoM365] = await Promise.all([
    obterPoliticaAgendamento(empresaId),
    obterHorariosSemanais(empresaId),
    listarExcecoesData(empresaId),
    obterConexaoM365(empresaId, true) // Descriptografa segredo para uso em memória
  ]);

  return {
    empresa,
    fusoHorario: empresa.fuso_horario || "America/Sao_Paulo",
    politica,
    horarios,
    excecoes,
    conexaoM365
  };
}

module.exports = {
  criarEmpresa,
  obterEmpresaPorId,
  obterEmpresaPorSlug,
  listarEmpresas,
  atualizarEmpresa,
  ativarDesativarEmpresa,
  cadastrarChaveGoTo,
  revogarChaveGoTo,
  listarChavesGoTo,
  obterEmpresaPorApiKey,
  salvarConexaoM365,
  salvarConexaoM365Tenant,
  salvarMailboxM365,
  desconectarM365,
  criarOAuthState,
  validarEConsumirOAuthState,
  obterConexaoM365,
  atualizarStatusTesteM365,
  salvarPoliticaAgendamento,
  obterPoliticaAgendamento,
  salvarHorariosSemanais,
  obterHorariosSemanais,
  salvarExcecaoData,
  removerExcecaoData,
  listarExcecoesData,
  obterTenantContext,
  validarSobreposicaoFaixas
};
