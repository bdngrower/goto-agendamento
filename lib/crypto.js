const crypto = require("crypto");

// ============================================================
// CHAVES MESTRAS PARA CRIPTOGRAFIA AES-256-GCM COM VERSIONAMENTO
// ============================================================

/**
 * Obtém a chave mestra para uma determinada versão (padrão v1).
 * Suporta rotação via variáveis M365_MASTER_ENCRYPTION_KEY_V1, _V2, etc.
 * Se apenas M365_MASTER_ENCRYPTION_KEY estiver definida, usa-a para a versão 1.
 */
function obterChaveMestra(versao = 1) {
  const envKeyVersao = process.env[`M365_MASTER_ENCRYPTION_KEY_V${versao}`];
  const envKeyPadrao = process.env.M365_MASTER_ENCRYPTION_KEY;
  const envKey = envKeyVersao || (versao === 1 ? envKeyPadrao : null);

  if (envKey && envKey.length >= 64) {
    return Buffer.from(envKey.slice(0, 64), "hex");
  }
  if (envKey) {
    return crypto.createHash("sha256").update(String(envKey)).digest();
  }
  // Chave de fallback segura para ambiente de teste/desenvolvimento
  return crypto
    .createHash("sha256")
    .update(`goto-agendamento-dev-master-key-v${versao}-2026`)
    .digest();
}

/**
 * Criptografa segredo com AES-256-GCM (criptografia autenticada).
 * Gera IV aleatório de 96 bits único a cada gravação (nunca reutilizado).
 * Retorna ciphertext (hex), iv (hex), authTag (hex) e keyVersion (int).
 */
function criptografarSegredo(textoPuro, versaoChave = 1) {
  if (!textoPuro) return null;
  const key = obterChaveMestra(versaoChave);
  const iv = crypto.randomBytes(12); // 96 bits recomendado para GCM (único por gravação)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(String(textoPuro), "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    keyVersion: Number(versaoChave) || 1
  };
}

/**
 * Descriptografa segredo com AES-256-GCM.
 * Valida rigorosamente a authTag antes de liberar o segredo.
 * Lança erro se a tag, IV ou dados tiverem sido adulterados.
 */
function descriptografarSegredo({ ciphertext, iv, authTag, keyVersion = 1 }) {
  if (!ciphertext || !iv || !authTag) return null;
  const key = obterChaveMestra(keyVersion || 1);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Recriptografa um segredo com uma nova versão da chave mestra (rotação segura).
 */
function rotacionarCriptografiaSegredo(dadosAntigos, novaVersaoChave) {
  const textoPuro = descriptografarSegredo(dadosAntigos);
  if (!textoPuro) throw new Error("Falha ao descriptografar segredo com chave anterior.");
  return criptografarSegredo(textoPuro, novaVersaoChave);
}

// ============================================================
// GERAÇÃO E VALIDAÇÃO DE CHAVES GOTO (API KEYS)
// ============================================================

/**
 * Gera uma nova chave GoTo no formato:
 * gt_live_<prefixo_8_chars>_<segredo_32_bytes_hex>
 */
function gerarChaveGoTo() {
  const prefixoAleatorio = crypto.randomBytes(4).toString("hex"); // 8 chars
  const segredo = crypto.randomBytes(32).toString("hex"); // 64 chars
  const keyPrefix = `gt_live_${prefixoAleatorio}`;
  const chaveCompleta = `${keyPrefix}_${segredo}`;
  const keyHash = hashChaveGoTo(chaveCompleta);

  return {
    chaveCompleta,
    keyPrefix,
    keyHash
  };
}

/**
 * Retorna o hash SHA-256 de uma chave em hexadecimal (64 chars).
 */
function hashChaveGoTo(chave) {
  return crypto
    .createHash("sha256")
    .update(String(chave || "").trim())
    .digest("hex");
}

/**
 * Compara duas strings/hashes em tempo constante contra timing attacks.
 */
function compararHashesSeguro(hashA, hashB) {
  if (!hashA || !hashB) return false;
  const bufA = Buffer.from(String(hashA));
  const bufB = Buffer.from(String(hashB));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extrai o prefixo de busca de uma chave GoTo.
 */
function extrairPrefixoChave(chave) {
  if (!chave || typeof chave !== "string") return null;
  const limpo = chave.trim();
  const partes = limpo.split("_");
  if (partes.length >= 3 && partes[0] === "gt" && partes[1] === "live") {
    return `gt_live_${partes[2]}`;
  }
  return limpo.slice(0, 16);
}

// ============================================================
// HASH, VERIFICAÇÃO E POLÍTICA DE SENHAS ADMIN
// ============================================================

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(senha, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verificarSenha(senha, hashArmazenado) {
  if (!senha || !hashArmazenado) return false;
  const [salt, hashOriginal] = hashArmazenado.split(":");
  if (!salt || !hashOriginal) return false;
  const hashTentativa = crypto.scryptSync(senha, salt, 64).toString("hex");
  return compararHashesSeguro(hashOriginal, hashTentativa);
}

/**
 * Validação de política de senha forte:
 * - Mínimo 10 caracteres
 * - Ao menos 1 letra maiúscula
 * - Ao menos 1 letra minúscula
 * - Ao menos 1 número
 * - Ao menos 1 caractere especial
 */
function validarForcaSenha(senha) {
  if (!senha || typeof senha !== "string") {
    return { valido: false, erro: "A senha não pode ser vazia." };
  }
  if (senha.length < 10) {
    return { valido: false, erro: "A senha deve ter no mínimo 10 caracteres." };
  }
  if (!/[A-Z]/.test(senha)) {
    return { valido: false, erro: "A senha deve conter ao menos uma letra maiúscula." };
  }
  if (!/[a-z]/.test(senha)) {
    return { valido: false, erro: "A senha deve conter ao menos uma letra minúscula." };
  }
  if (!/[0-9]/.test(senha)) {
    return { valido: false, erro: "A senha deve conter ao menos um número." };
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(senha)) {
    return { valido: false, erro: "A senha deve conter ao menos um caractere especial (!@#$%^&*...)." };
  }
  return { valido: true };
}

module.exports = {
  obterChaveMestra,
  criptografarSegredo,
  descriptografarSegredo,
  rotacionarCriptografiaSegredo,
  gerarChaveGoTo,
  hashChaveGoTo,
  compararHashesSeguro,
  extrairPrefixoChave,
  hashSenha,
  verificarSenha,
  validarForcaSenha
};
