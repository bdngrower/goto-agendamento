const db = require("./db");

// ============================================================
// RATE LIMITER ATÔMICO E COMPATÍVEL COM VERCEL SERVERLESS
// ============================================================
// Arquitetura comprovadamente atômica:
// 1. Upstash Redis: Script LUA executado via EVAL (atomicidade garantida no engine do Redis;
//    elimina race condition entre INCR e EXPIRE; impede chave sem TTL).
// 2. PostgreSQL: INSERT ... ON CONFLICT (key) DO UPDATE (com trava exclusiva de linha 'row-level lock').
// 3. Memória: Operação síncrona no event-loop (para ambiente de teste e offline).

const janelasMemoria = new Map();

/**
 * Script Lua executado atomicamente no Redis.
 */
const SCRIPT_LUA_RATELIMIT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`.trim();

/**
 * Incrementa e avalia contador de taxa de forma estritamente atômica.
 * @param {string} chave - Identificador do bucket (ex: 'ratelimit:empresa:uuid')
 * @param {number} limite - Número máximo de requisições permitidas
 * @param {number} janelaSegundos - Duração da janela em segundos
 */
async function incrementarRateLimit(chave, limite, janelaSegundos) {
  const agoraMs = Date.now();
  const janelaMs = janelaSegundos * 1000;

  // 1. Upstash Redis REST via Script LUA Atômico
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    try {
      const resEval = await fetch(upstashUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["EVAL", SCRIPT_LUA_RATELIMIT, 1, chave, String(janelaSegundos)])
      });

      if (resEval.ok) {
        const data = await resEval.json();
        const contador = Number(data?.result || 1);
        return {
          permitido: contador <= limite,
          restantes: Math.max(0, limite - contador),
          contador,
          limite
        };
      }
    } catch (e) {
      console.warn("Aviso: Falha ao consultar Upstash Redis rate limit, recorrendo ao banco:", e.message);
    }
  }

  // 2. PostgreSQL Tabela Atômica com Row-Level Lock
  const pool = db.getPool();
  if (pool) {
    try {
      const res = await db.query(
        `INSERT INTO goto_agendamento.rate_limits (key, points, expira_em)
         VALUES ($1, 1, NOW() + interval '1 millisecond' * $2)
         ON CONFLICT (key) DO UPDATE
         SET points = CASE WHEN goto_agendamento.rate_limits.expira_em < NOW() THEN 1 ELSE goto_agendamento.rate_limits.points + 1 END,
             expira_em = CASE WHEN goto_agendamento.rate_limits.expira_em < NOW() THEN NOW() + interval '1 millisecond' * $2 ELSE goto_agendamento.rate_limits.expira_em END
         RETURNING points, expira_em`,
        [chave, janelaMs]
      );
      const points = res.rows[0]?.points || 1;
      return {
        permitido: points <= limite,
        restantes: Math.max(0, limite - points),
        contador: points,
        limite
      };
    } catch (e) {
      // Fallback gracioso caso banco esteja fora ou tabela não criada
    }
  }

  // 3. Fallback em memória atômico (Síncrono no event-loop do Node.js)
  let registros = janelasMemoria.get(chave);
  if (!registros) {
    registros = [];
    janelasMemoria.set(chave, registros);
  }

  const limitePassado = agoraMs - janelaMs;
  registros = registros.filter(t => t > limitePassado);
  janelasMemoria.set(chave, registros);

  if (registros.length >= limite) {
    return {
      permitido: false,
      restantes: 0,
      contador: registros.length,
      limite
    };
  }

  registros.push(agoraMs);
  return {
    permitido: true,
    restantes: limite - registros.length,
    contador: registros.length,
    limite
  };
}

/**
 * Rate limit para API pública de agendamento por empresa (Padrão: 60 req/min).
 */
async function verificarRateLimitEmpresa(empresaId, limite = 60, janelaSegundos = 60) {
  if (!empresaId) return { permitido: true };
  return await incrementarRateLimit(`ratelimit:empresa:${empresaId}`, limite, janelaSegundos);
}

/**
 * Rate limit para Login administrativo por IP e usuário (Padrão: 5 tentativas por 15 min).
 */
async function verificarRateLimitLogin(ip, email, limite = 5, janelaSegundos = 900) {
  const chaveIp = `ratelimit:login:ip:${ip || "unknown"}`;
  const chaveUser = `ratelimit:login:user:${String(email || "").toLowerCase().trim()}`;

  const resIp = await incrementarRateLimit(chaveIp, limite, janelaSegundos);
  if (!resIp.permitido) return { permitido: false, motivo: "IP_BLOQUEADO", restantes: 0 };

  if (email) {
    const resUser = await incrementarRateLimit(chaveUser, limite, janelaSegundos);
    if (!resUser.permitido) return { permitido: false, motivo: "USUARIO_BLOQUEADO", restantes: 0 };
  }

  return { permitido: true, restantes: resIp.restantes };
}

/**
 * Rate limit para APIs administrativas autenticadas (Padrão: 120 req/min por admin).
 */
async function verificarRateLimitAdmin(usuarioIdOuIp, limite = 120, janelaSegundos = 60) {
  if (!usuarioIdOuIp) return { permitido: true };
  return await incrementarRateLimit(`ratelimit:admin:${usuarioIdOuIp}`, limite, janelaSegundos);
}

function resetarRateLimitMemoria() {
  janelasMemoria.clear();
}

module.exports = {
  SCRIPT_LUA_RATELIMIT,
  incrementarRateLimit,
  verificarRateLimitEmpresa,
  verificarRateLimitLogin,
  verificarRateLimitAdmin,
  resetarRateLimitMemoria
};
