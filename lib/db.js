const { Pool } = require("pg");

let pool = null;
let useMemoryStore = false;

// Banco em memória para testes, desenvolvimento local e fallback
const memoryDb = {
  empresas: new Map(),
  empresas_chaves_goto: new Map(),
  empresas_conexoes_m365: new Map(),
  empresas_politicas_agendamento: new Map(),
  empresas_horarios_semanais: new Map(),
  empresas_horarios_faixas: new Map(),
  empresas_excecoes_data: new Map(),
  empresas_excecoes_faixas: new Map(),
  usuarios_admin: new Map(),
  usuarios_sessoes: new Map(),
  m365_oauth_states: new Map(),
  registros_auditoria: []
};

const fs = require("fs");
const path = require("path");
const https = require("https");

function getSupabaseConfig() {
  const projectRef = process.env.SUPABASE_PROJECT_REF || "erporcirletltbnlbfxu";
  let token = process.env.SUPABASE_ACCESS_TOKEN || null;
  if (!token) {
    try {
      const mcpPath = path.resolve(process.env.USERPROFILE || "", ".gemini/config/mcp_config.json");
      if (fs.existsSync(mcpPath)) {
        const c = fs.readFileSync(mcpPath, "utf8").replace(/^\uFEFF/, "");
        const j = JSON.parse(c);
        token = j.mcpServers?.supabase?.env?.SUPABASE_ACCESS_TOKEN || null;
      }
    } catch (e) {}
  }
  return token ? { projectRef, token } : null;
}

function formatSqlWithParams(text, params = []) {
  if (!params || params.length === 0) return text;
  return text.replace(/\$(\d+)/g, (match, p1) => {
    const idx = parseInt(p1, 10) - 1;
    if (idx < 0 || idx >= params.length) return match;
    const val = params[idx];
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "number") return Number.isFinite(val) ? String(val) : "NULL";
    if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
    if (typeof val === "object") {
      const jsonStr = JSON.stringify(val).replace(/'/g, "''");
      return `'${jsonStr}'`;
    }
    const escaped = String(val).replace(/'/g, "''");
    return `'${escaped}'`;
  });
}

function executeSupabaseQuery(sql, { projectRef, token }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query: sql });
    const options = {
      hostname: "api.supabase.com",
      port: 443,
      path: `/v1/projects/${projectRef}/database/query`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || `HTTP ${res.statusCode}: ${data}`));
          } else {
            const rows = Array.isArray(parsed) ? parsed : [];
            resolve({ rows, rowCount: rows.length });
          }
        } catch (e) {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve({ rows: [], rowCount: 0 });
          }
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const supabaseBridge = {
  query: async (text, params) => {
    const cfg = getSupabaseConfig();
    if (!cfg) throw new Error("Credenciais do Supabase não encontradas.");
    const formatted = formatSqlWithParams(text, params);
    return await executeSupabaseQuery(formatted, cfg);
  }
};

function getPool() {
  if (useMemoryStore) return null;

  // 1. Se DATABASE_URL estiver configurado, utiliza o Pool PostgreSQL nativo (Vercel ou servidor)
  if (process.env.DATABASE_URL) {
    if (!pool) {
      const isLocalhost =
        process.env.DATABASE_URL.includes("localhost") ||
        process.env.DATABASE_URL.includes("127.0.0.1");

      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocalhost ? false : { rejectUnauthorized: false },
        max: 2,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 10000
      });

      pool.on("connect", (client) => {
        client.query("SET search_path TO goto_agendamento, public;").catch(() => {});
      });

      pool.on("error", (err) => {
        console.error("Erro inesperado no cliente do pool PostgreSQL:", err.message);
      });
    }
    return pool;
  }

  // 2. Se houver configuração do Supabase disponível, utiliza o bridge HTTP com o PostgreSQL real
  if (getSupabaseConfig()) {
    return supabaseBridge;
  }

  // 3. Caso contrário, fallback em memória
  useMemoryStore = true;
  return null;
}

/**
 * Executa uma consulta SQL no PostgreSQL ou no banco de memória.
 */
async function query(text, params = []) {
  const p = getPool();
  if (p) {
    try {
      return await p.query(text, params);
    } catch (err) {
      console.error("Erro na consulta PostgreSQL:", err.message);
      throw err;
    }
  }
  // Se não houver pool ou estiver em memória
  return { rows: [], rowCount: 0 };
}

function getMemoryDb() {
  return memoryDb;
}

function setUseMemoryStore(val) {
  useMemoryStore = Boolean(val);
}

function resetMemoryDb() {
  for (const k of Object.keys(memoryDb)) {
    if (Array.isArray(memoryDb[k])) {
      memoryDb[k] = [];
    } else if (memoryDb[k] instanceof Map) {
      memoryDb[k].clear();
    }
  }
}

module.exports = {
  query,
  getPool,
  getMemoryDb,
  setUseMemoryStore,
  resetMemoryDb
};
