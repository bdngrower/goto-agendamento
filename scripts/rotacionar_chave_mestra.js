/**
 * SCRIPT DE ROTAÇÃO SEGURA DA CHAVE MESTRA M365 (AES-256-GCM)
 * 
 * Uso:
 * node scripts/rotacionar_chave_mestra.js <versao_antiga> <nova_versao>
 * Exemplo:
 * node scripts/rotacionar_chave_mestra.js 1 2
 * 
 * Procedimento:
 * 1. Define M365_MASTER_ENCRYPTION_KEY_V2 com a nova chave nos segredos da Vercel.
 * 2. Executa esta rotina que itera todas as empresas com conexões ativas no banco.
 * 3. Para cada conexão cuja key_version == versao_antiga:
 *    - Descriptografa com a chave antiga e valida a authTag
 *    - Gera novo IV de 96 bits aleatório e criptografa com a nova versão
 *    - Salva no banco com atomicidade
 * 4. Ao concluir com 100% de sucesso, remove M365_MASTER_ENCRYPTION_KEY_V1 do ambiente.
 */

const db = require("../lib/db");
const { descriptografarSegredo, criptografarSegredo } = require("../lib/crypto");

async function rotacionarChaves() {
  const versaoAntiga = Number(process.argv[2]) || 1;
  const novaVersao = Number(process.argv[3]) || (versaoAntiga + 1);

  console.log(`\nIniciando rotação de chave mestra: Versão ${versaoAntiga} -> Versão ${novaVersao}...`);

  const pool = db.getPool();
  if (!pool) {
    console.error("Erro: Conexão com banco de dados PostgreSQL é obrigatória para rotação.");
    process.exit(1);
  }

  const res = await db.query(
    `SELECT empresa_id, client_secret_encrypted, client_secret_iv, client_secret_tag, key_version
     FROM goto_agendamento.empresas_conexoes_m365
     WHERE client_secret_encrypted IS NOT NULL AND key_version = $1`,
    [versaoAntiga]
  );

  console.log(`Conexões identificadas na versão ${versaoAntiga}: ${res.rows.length}`);

  let sucesso = 0;
  for (const con of res.rows) {
    try {
      const textoPuro = descriptografarSegredo({
        ciphertext: con.client_secret_encrypted,
        iv: con.client_secret_iv,
        authTag: con.client_secret_tag,
        keyVersion: con.key_version
      });

      if (!textoPuro) {
        throw new Error(`Falha ao descriptografar segredo da empresa ${con.empresa_id}`);
      }

      // Criptografa com a nova versão gerando novo IV e authTag
      const novoEncrypted = criptografarSegredo(textoPuro, novaVersao);

      await db.query(
        `UPDATE goto_agendamento.empresas_conexoes_m365
         SET client_secret_encrypted = $1,
             client_secret_iv = $2,
             client_secret_tag = $3,
             key_version = $4,
             atualizado_em = NOW()
         WHERE empresa_id = $5`,
        [
          novoEncrypted.ciphertext,
          novoEncrypted.iv,
          novoEncrypted.authTag,
          novoEncrypted.keyVersion,
          con.empresa_id
        ]
      );

      sucesso++;
    } catch (err) {
      console.error(`Falha ao rotacionar empresa ${con.empresa_id}:`, err.message);
    }
  }

  console.log(`✓ Rotação concluída com sucesso para ${sucesso} de ${res.rows.length} conexões.`);
  console.log("Nenhum segredo ou chave mestra foi registrado nos logs.");
  process.exit(0);
}

rotacionarChaves();
