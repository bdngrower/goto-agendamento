const empresaRepo = require("../lib/repositories/empresaRepository");
const usuarioRepo = require("../lib/repositories/usuarioRepository");
const { hashChaveGoTo } = require("../lib/crypto");
const db = require("../lib/db");

async function seedEmpresaAtual() {
  console.log("Iniciando seed da empresa atual (Brasinfo TI)...");

  // 1. Cria a empresa padrão se não existir
  let empresa = await empresaRepo.obterEmpresaPorSlug("brasinfo-ti");
  if (!empresa) {
    empresa = await empresaRepo.criarEmpresa({
      nome: "Brasinfo TI",
      nomeFantasia: "Brasinfo Tecnologia",
      slug: "brasinfo-ti",
      fusoHorario: "America/Sao_Paulo",
      ativo: true
    });
    console.log("Empresa Brasinfo TI criada com ID:", empresa.id);
  } else {
    console.log("Empresa Brasinfo TI já cadastrada com ID:", empresa.id);
  }

  // 2. Chave GoTo
  const chavesExistentes = await empresaRepo.listarChavesGoTo(empresa.id);
  const chaveLegada = process.env.GOTO_API_KEY;

  if (chaveLegada) {
    const hashLegado = hashChaveGoTo(chaveLegada);
    const jaTem = chavesExistentes.some(c => c.key_prefix === chaveLegada.slice(0, 16));
    if (!jaTem) {
      // Cadastra chave existente da variável de ambiente no banco
      const p = db.getPool();
      if (p) {
        await db.query(
          `INSERT INTO goto_agendamento.empresas_chaves_goto (empresa_id, nome_identificador, key_prefix, key_hash, ativo)
           VALUES ($1, 'Chave Legada Produção', $2, $3, TRUE)`,
          [empresa.id, chaveLegada.slice(0, 16), hashLegado]
        );
      } else {
        db.getMemoryDb().empresas_chaves_goto.set("chave-legada-prod", {
          id: "chave-legada-prod",
          empresa_id: empresa.id,
          nome_identificador: "Chave Legada Produção",
          key_prefix: chaveLegada.slice(0, 16),
          key_hash: hashLegado,
          ativo: true,
          criado_em: new Date().toISOString()
        });
      }
      console.log("Chave GoTo legada cadastrada no banco com sucesso.");
    }
  } else if (chavesExistentes.length === 0) {
    const novaChave = await empresaRepo.cadastrarChaveGoTo(empresa.id, "Chave Principal GoTo");
    console.log("Nova chave GoTo gerada:", novaChave.keyPrefix);
  }

  // 3. Conexão Microsoft 365
  const mailboxPadrao = "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";
  await empresaRepo.salvarConexaoM365(empresa.id, {
    nomeConexao: "Calendário Microsoft 365 Brasinfo",
    tipoAutenticacao: "custom_app",
    azureTenantId: process.env.AZURE_TENANT_ID || "mock-tenant",
    azureClientId: process.env.AZURE_CLIENT_ID || "mock-client",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "mock-secret",
    mailboxEmail: mailboxPadrao,
    statusConexao: "conectado"
  });
  console.log("Conexão Microsoft 365 configurada para Brasinfo TI.");

  // 4. Política de Agendamento
  await empresaRepo.salvarPoliticaAgendamento(empresa.id, {
    duracaoMinutos: 60,
    intervaloEntreSlots: 60,
    bufferAntesMinutos: 0,
    bufferDepoisMinutos: 0,
    antecedenciaMinimaMinutos: 60,
    limiteMaximoDias: 60,
    maxOpcoesRetorno: 4
  });
  console.log("Política de agendamento configurada.");

  // 5. Horários Semanais
  const horarios = [
    { diaSemana: 0, fechado: true, atendimento24h: false, faixas: [] }, // Domingo fechado
    {
      diaSemana: 1, // Segunda
      fechado: false,
      atendimento24h: false,
      faixas: [{ horaInicio: "09:00", horaFim: "17:00" }]
    },
    {
      diaSemana: 2, // Terça
      fechado: false,
      atendimento24h: false,
      faixas: [{ horaInicio: "09:00", horaFim: "17:00" }]
    },
    {
      diaSemana: 3, // Quarta
      fechado: false,
      atendimento24h: false,
      faixas: [{ horaInicio: "09:00", horaFim: "17:00" }]
    },
    {
      diaSemana: 4, // Quinta
      fechado: false,
      atendimento24h: false,
      faixas: [{ horaInicio: "09:00", horaFim: "17:00" }]
    },
    {
      diaSemana: 5, // Sexta
      fechado: false,
      atendimento24h: false,
      faixas: [{ horaInicio: "09:00", horaFim: "17:00" }]
    },
    { diaSemana: 6, fechado: true, atendimento24h: false, faixas: [] } // Sábado fechado
  ];
  await empresaRepo.salvarHorariosSemanais(empresa.id, horarios);
  console.log("Horários semanais configurados (Seg-Sex 09:00-17:00).");

  // 6. Usuário Administrador Inicial
  try {
    await usuarioRepo.criarUsuarioAdmin({
      email: "admin@brasinfoti.com.br",
      nome: "Administrador Brasinfo",
      senha: process.env.ADMIN_INITIAL_PASSWORD || "Admin@Brasinfo2026!"
    });
    console.log("Usuário admin inicial criado (admin@brasinfoti.com.br).");
  } catch (e) {
    // Já existe
  }

  console.log("Seed concluído com sucesso!");
  return empresa;
}

if (require.main === module) {
  seedEmpresaAtual()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("Erro no seed:", err);
      process.exit(1);
    });
}

module.exports = { seedEmpresaAtual };
