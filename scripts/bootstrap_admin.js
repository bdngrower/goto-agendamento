/**
 * SCRIPT DE BOOTSTRAP DO PRIMEIRO ADMINISTRADOR
 * 
 * Execução segura e única via CLI:
 * node scripts/bootstrap_admin.js [email_opcional]
 * 
 * Segurança:
 * 1. Verifica se já existe qualquer administrador na tabela 'usuarios_admin'.
 * 2. Se já existir, aborta imediatamente para impedir criação não autorizada.
 * 3. Gera uma senha forte e aleatória de 16 caracteres em tempo de execução.
 * 4. Aplica hash scrypt com salt de 128 bits.
 * 5. Exibe a senha exclusivamente uma vez na saída padrão do terminal.
 * 6. NENHUMA senha permanente precisa ou deve ser salva em variáveis de ambiente.
 */

const crypto = require("crypto");
const db = require("../lib/db");
const usuarioRepo = require("../lib/repositories/usuarioRepository");

function gerarSenhaAleatoriaForte() {
  const maiusculas = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const minusculas = "abcdefghijkmnopqrstuvwxyz";
  const numeros = "23456789";
  const especiais = "!@#$%&*-_=+";
  
  let senha = "";
  senha += maiusculas[crypto.randomInt(maiusculas.length)];
  senha += minusculas[crypto.randomInt(minusculas.length)];
  senha += numeros[crypto.randomInt(numeros.length)];
  senha += especiais[crypto.randomInt(especiais.length)];

  const todos = maiusculas + minusculas + numeros + especiais;
  for (let i = 4; i < 16; i++) {
    senha += todos[crypto.randomInt(todos.length)];
  }

  // Embaralha
  return senha.split("").sort(() => 0.5 - Math.random()).join("");
}

async function bootstrap() {
  console.log("\n=======================================================");
  console.log("   BOOTSTRAP SEGURO DO PRIMEIRO ADMINISTRADOR INTERNO   ");
  console.log("=======================================================\n");

  const email = process.argv[2] || "admin@empresa.com";
  const nome = "Administrador Principal";

  const pool = db.getPool();
  if (pool) {
    const check = await db.query(`SELECT COUNT(*) as total FROM goto_agendamento.usuarios_admin`);
    const total = Number(check.rows[0]?.total || 0);
    if (total > 0) {
      console.warn("ALERTA DE SEGURANÇA: Já existem administradores cadastrados na base de dados.");
      console.warn("O script de bootstrap inicial foi desativado automaticamente por segurança.");
      process.exit(0);
    }
  }

  const senhaGerada = gerarSenhaAleatoriaForte();

  try {
    const usuario = await usuarioRepo.criarUsuarioAdmin({
      email,
      nome,
      senha: senhaGerada
    });

    console.log("✓ Primeiro administrador criado com sucesso no banco de dados!");
    console.log("\n-------------------------------------------------------");
    console.log(`E-mail: ${usuario.email}`);
    console.log(`Senha de Primeiro Acesso: ${senhaGerada}`);
    console.log("-------------------------------------------------------");
    console.log("\nAVISO IMPORTANTE:");
    console.log("1. Copie e armazene esta senha em seu cofre corporativo de senhas.");
    console.log("2. Esta senha foi exibida apenas nesta sessão do terminal.");
    console.log("3. Nenhuma senha permanente foi gravada em arquivos .env ou repositório.");
    console.log("4. Ao efetuar login, o sistema exigirá troca periódica.");
    console.log("=======================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("Falha ao criar administrador inicial:", err.message);
    process.exit(1);
  }
}

bootstrap();
