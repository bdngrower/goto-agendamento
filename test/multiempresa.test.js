const assert = require("assert");
const db = require("../lib/db");
const empresaRepo = require("../lib/repositories/empresaRepository");
const usuarioRepo = require("../lib/repositories/usuarioRepository");
const availabilityEngine = require("../lib/availabilityEngine");
const graphClient = require("../lib/graphClient");
const cryptoLib = require("../lib/crypto");
const handler = require("../api/agendamento");
const adminLoginHandler = require("../lib/admin-routes/login");
const adminLogoutHandler = require("../lib/admin-routes/logout");
const adminSessionHandler = require("../lib/admin-routes/session");
const adminEmpresasHandler = require("../lib/admin-routes/empresas");
const adminPreviaHandler = require("../lib/admin-routes/previa-disponibilidade");
const adminTestarM365Handler = require("../lib/admin-routes/testar-m365");
const adminChavesGotoHandler = require("../lib/admin-routes/chaves-goto");
const adminDispatcher = require("../api/admin");
const m365CallbackHandler = require("../api/m365-callback");
const rateLimiter = require("../lib/rateLimiter");

// Ativa armazenamento em memória para os testes
db.setUseMemoryStore(true);
db.resetMemoryDb();

// Configura variáveis legadas
process.env.GOTO_API_KEY = "legacy-secret-key-prod";
process.env.AZURE_TENANT_ID = "mock-tenant-legacy";
process.env.AZURE_CLIENT_ID = "mock-client-legacy";
process.env.AZURE_CLIENT_SECRET = "mock-secret-legacy";

// Simulação de chamadas do Microsoft Graph por empresa/mailbox
const mailboxCalendars = new Map(); // mailboxEmail -> array de eventos
let graphTokenCalls = [];
let graphEventCreations = [];

global.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  // 1. Obtenção de token Azure
  if (urlStr.includes("login.microsoftonline.com")) {
    graphTokenCalls.push({ url: urlStr, body: options.body });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "mock-access-token-xyz" }),
      json: async () => ({ access_token: "mock-access-token-xyz" })
    };
  }

  // 2. CalendarView por mailbox
  if (urlStr.includes("/calendarView")) {
    // Extrai o mailbox da URL
    const match = urlStr.match(/users\/([^\/]+)\/calendarView/);
    const mailbox = match ? decodeURIComponent(match[1]) : "default";
    const eventos = mailboxCalendars.get(mailbox) || [];
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: eventos }),
      json: async () => ({ value: eventos })
    };
  }

  // 3. Criar evento POST
  if (urlStr.includes("/calendar/events") && options.method === "POST") {
    const match = urlStr.match(/users\/([^\/]+)\/calendar\/events/);
    const mailbox = match ? decodeURIComponent(match[1]) : "default";
    const body = JSON.parse(options.body);
    const novo = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      ...body
    };
    graphEventCreations.push({ mailbox, evento: novo });
    const list = mailboxCalendars.get(mailbox) || [];
    list.push(novo);
    mailboxCalendars.set(mailbox, list);

    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(novo),
      json: async () => novo
    };
  }

  // 4. Atualizar evento PATCH
  if (urlStr.includes("/calendar/events/") && options.method === "PATCH") {
    const match = urlStr.match(/users\/([^\/]+)\/calendar\/events\/([^\/]+)/);
    const mailbox = match ? decodeURIComponent(match[1]) : "default";
    const id = match ? decodeURIComponent(match[2]) : "";
    const body = JSON.parse(options.body);
    const list = mailboxCalendars.get(mailbox) || [];
    const item = list.find(e => e.id === id);
    if (item) {
      Object.assign(item, body);
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(item || {}),
      json: async () => item || {}
    };
  }

  // 5. Cancelar evento DELETE
  if (urlStr.includes("/calendar/events/") && options.method === "DELETE") {
    const match = urlStr.match(/users\/([^\/]+)\/calendar\/events\/([^\/]+)/);
    const mailbox = match ? decodeURIComponent(match[1]) : "default";
    const id = match ? decodeURIComponent(match[2]) : "";
    const list = mailboxCalendars.get(mailbox) || [];
    const index = list.findIndex(e => e.id === id);
    if (index !== -1) {
      list.splice(index, 1);
    }
    return {
      ok: true,
      status: 204,
      text: async () => "",
      json: async () => null
    };
  }

  return {
    ok: true,
    status: 200,
    text: async () => "{}",
    json: async () => ({})
  };
};

function invokeHandler(req) {
  req.method = req.method || "POST";
  return new Promise((resolve) => {
    const res = {
      _status: 200,
      _headers: {},
      _body: null,
      status(code) {
        this._status = code;
        return this;
      },
      setHeader(name, val) {
        this._headers[name] = val;
        return this;
      },
      json(data) {
        this._body = data;
        resolve({ status: this._status, headers: this._headers, body: this._body });
      },
      send(data) {
        this._body = data;
        resolve({ status: this._status, headers: this._headers, body: this._body });
      },
      end() {
        resolve({ status: this._status, headers: this._headers, body: this._body });
      }
    };
    handler(req, res).catch(err => {
      resolve({ status: 500, body: { success: false, error: err.message } });
    });
  });
}

function invokeAdmin(handlerFn, req) {
  req.method = req.method || "GET";
  req.headers = req.headers || {};
  return new Promise((resolve) => {
    const res = {
      _status: 200,
      _headers: {},
      _body: null,
      status(code) {
        this._status = code;
        return this;
      },
      setHeader(name, val) {
        this._headers[name.toLowerCase()] = val;
        return this;
      },
      json(data) {
        this._body = data;
        resolve({ status: this._status, headers: this._headers, body: this._body });
      },
      send(data) {
        this._body = data;
        resolve({ status: this._status, headers: this._headers, body: this._body });
      },
      redirect(statusOrUrl, targetUrl) {
        let code = 302;
        let loc = statusOrUrl;
        if (typeof statusOrUrl === "number") {
          code = statusOrUrl;
          loc = targetUrl;
        }
        this._status = code;
        this._headers["location"] = loc;
        resolve({ status: code, headers: this._headers, body: null });
      },
      end() {
        resolve({ status: this._status, headers: this._headers, body: this._body });
      }
    };
    handlerFn(req, res).catch(err => {
      resolve({ status: 500, headers: res._headers, body: { success: false, error: err.message } });
    });
  });
}

async function runMultiempresaTests() {
  console.log("=== INICIANDO SUÍTE COMPLETA DE TESTES MULTIEMPRESA ===\n");

  // ============================================================
  // SETUP: CRIAR DUAS EMPRESAS COM CALENDÁRIOS E CHAVES DISTINTAS
  // ============================================================

  // Empresa A: Clínica Alfa (São Paulo)
  const empA = await empresaRepo.criarEmpresa({
    nome: "Clínica Alfa",
    slug: "clinica-alfa",
    fusoHorario: "America/Sao_Paulo"
  });
  const chaveA = await empresaRepo.cadastrarChaveGoTo(empA.id, "Chave GoTo Alfa");
  await empresaRepo.salvarConexaoM365(empA.id, {
    azureTenantId: "tenant-alfa",
    azureClientId: "client-alfa",
    clientSecret: "secret-alfa-super-seguro",
    mailboxEmail: "agenda@clinicaalfa.com.br",
    statusConexao: "conectado"
  });
  await empresaRepo.salvarPoliticaAgendamento(empA.id, {
    duracaoMinutos: 60,
    intervaloEntreSlots: 60,
    antecedenciaMinimaMinutos: 0,
    limiteMaximoDias: 60
  });
  // Horário semanal Alfa: Seg-Sex: 08:00–11:00 e 13:00–18:00
  await empresaRepo.salvarHorariosSemanais(empA.id, [
    { diaSemana: 0, fechado: true },
    { diaSemana: 1, fechado: false, faixas: [{ horaInicio: "08:00", horaFim: "11:00" }, { horaInicio: "13:00", horaFim: "18:00" }] },
    { diaSemana: 2, fechado: false, faixas: [{ horaInicio: "08:00", horaFim: "11:00" }, { horaInicio: "13:00", horaFim: "18:00" }] },
    { diaSemana: 3, fechado: false, faixas: [{ horaInicio: "08:00", horaFim: "11:00" }, { horaInicio: "13:00", horaFim: "18:00" }] },
    { diaSemana: 4, fechado: false, faixas: [{ horaInicio: "08:00", horaFim: "11:00" }, { horaInicio: "13:00", horaFim: "18:00" }] },
    { diaSemana: 5, fechado: false, faixas: [{ horaInicio: "08:00", horaFim: "11:00" }, { horaInicio: "13:00", horaFim: "18:00" }] },
    { diaSemana: 6, fechado: true }
  ]);

  // Empresa B: Hospital Beta (Manaus - Fuso America/Manaus)
  const empB = await empresaRepo.criarEmpresa({
    nome: "Hospital Beta",
    slug: "hospital-beta",
    fusoHorario: "America/Manaus"
  });
  const chaveB = await empresaRepo.cadastrarChaveGoTo(empB.id, "Chave GoTo Beta");
  await empresaRepo.salvarConexaoM365(empB.id, {
    azureTenantId: "tenant-beta",
    azureClientId: "client-beta",
    clientSecret: "secret-beta-super-seguro",
    mailboxEmail: "consultas@hospitalbeta.com.br",
    statusConexao: "conectado"
  });
  await empresaRepo.salvarPoliticaAgendamento(empB.id, {
    duracaoMinutos: 30,
    intervaloEntreSlots: 30,
    antecedenciaMinimaMinutos: 0,
    limiteMaximoDias: 90
  });
  // Horário semanal Beta: 24h todos os dias
  await empresaRepo.salvarHorariosSemanais(empB.id, [
    { diaSemana: 0, fechado: false, atendimento24h: true },
    { diaSemana: 1, fechado: false, atendimento24h: true },
    { diaSemana: 2, fechado: false, atendimento24h: true },
    { diaSemana: 3, fechado: false, atendimento24h: true },
    { diaSemana: 4, fechado: false, atendimento24h: true },
    { diaSemana: 5, fechado: false, atendimento24h: true },
    { diaSemana: 6, fechado: false, atendimento24h: true }
  ]);

  // 1. Duas empresas com API keys diferentes
  console.log("1. Testando identificação de empresas por API keys diferentes...");
  {
    const resA = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" } // Quarta-feira
    });
    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resA.body.success, true);

    const resB = await invokeHandler({
      headers: { "x-api-key": chaveB.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resB.status, 200);
    assert.strictEqual(resB.body.success, true);
    console.log("   -> OK! Ambas as empresas resolveram suas chaves com sucesso.");
  }

  // 2 e 3. Calendários Microsoft 365 diferentes e impossibilidade de acesso cruzado
  console.log("2 e 3. Testando isolamento estrito de calendários M365 (sem acesso cruzado)...");
  {
    // Criar um agendamento na Empresa A
    const resAgendarA = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: {
        acao: "agendar",
        nome: "Paciente Alfa",
        cpf: "11122233344",
        telefone: "11988887777",
        data: "2026-10-14",
        horario: "09:00"
      }
    });
    assert.strictEqual(resAgendarA.status, 200);
    assert.strictEqual(resAgendarA.body.success, true);

    // O evento foi para a caixa postal da Empresa A
    const eventosAlfa = mailboxCalendars.get("agenda@clinicaalfa.com.br") || [];
    assert.strictEqual(eventosAlfa.length, 1);
    assert.strictEqual(eventosAlfa[0].subject, "Agendamento GoTo - Paciente Alfa");

    // A caixa postal da Empresa B deve estar completamente vazia
    const eventosBeta = mailboxCalendars.get("consultas@hospitalbeta.com.br") || [];
    assert.strictEqual(eventosBeta.length, 0);

    // Empresa B tenta consultar o CPF do paciente da Empresa A: deve retornar ZERO!
    const resConsultaB = await invokeHandler({
      headers: { "x-api-key": chaveB.chaveCompleta },
      body: {
        acao: "consultar_agendamentos",
        cpf: "11122233344"
      }
    });
    assert.strictEqual(resConsultaB.status, 200);
    assert.strictEqual(resConsultaB.body.quantidade, 0);

    // Empresa B tenta cancelar o agendamento da Empresa A: deve falhar!
    const resCancelaB = await invokeHandler({
      headers: { "x-api-key": chaveB.chaveCompleta },
      body: {
        acao: "cancelar",
        cpf: "11122233344",
        data: "2026-10-14",
        horario: "09:00"
      }
    });
    assert.strictEqual(resCancelaB.status, 200);
    assert.strictEqual(resCancelaB.body.success, false);
    assert.strictEqual(eventosAlfa.length, 1); // Continua intacto na Empresa A
    console.log("   -> OK! Isolamento total comprovado entre Empresa A e Empresa B.");
  }

  // 4. Chave revogada
  console.log("4. Testando chave GoTo revogada...");
  {
    await empresaRepo.revogarChaveGoTo(chaveA.id);
    const resRevogada = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resRevogada.status, 401);
    assert.strictEqual(resRevogada.body.error, "API Key inválida");
    console.log("   -> OK! Chave revogada retornou HTTP 401.");

    // Gera nova chave para Empresa A continuar os testes
    const novaChaveA = await empresaRepo.cadastrarChaveGoTo(empA.id, "Chave Nova Alfa");
    chaveA.chaveCompleta = novaChaveA.chaveCompleta;
    chaveA.id = novaChaveA.id;
  }

  // 5. Empresa desativada
  console.log("5. Testando empresa desativada...");
  {
    await empresaRepo.ativarDesativarEmpresa(empB.id, false);
    const resDesativada = await invokeHandler({
      headers: { "x-api-key": chaveB.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resDesativada.status, 403);
    assert.strictEqual(resDesativada.body.error, "Empresa desativada");
    console.log("   -> OK! Empresa desativada retornou HTTP 403.");

    // Reativa a Empresa B
    await empresaRepo.ativarDesativarEmpresa(empB.id, true);
  }

  // 6. Horário semanal dividido entre manhã e tarde
  console.log("6. Testando horários divididos entre manhã e tarde (08:00–11:00 e 13:00–18:00)...");
  {
    // Limpa eventos para testar slots teóricos
    mailboxCalendars.set("agenda@clinicaalfa.com.br", []);
    const resTurnos = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resTurnos.status, 200);
    assert.strictEqual(resTurnos.body.success, true);
    // Faixa 1: 08:00, 09:00, 10:00 (11:00 fecha, slot de 60m às 10h acaba às 11h)
    // Faixa 2: 13:00, 14:00, 15:00, 16:00, 17:00
    // O almoço (11:00 às 13:00) NÃO deve ser oferecido!
    const slots = resTurnos.body.horarios;
    assert.ok(slots.includes("08:00") || slots.includes("09:00"));
    assert.strictEqual(slots.includes("11:00"), false);
    assert.strictEqual(slots.includes("12:00"), false);
    console.log("   -> OK! Turnos de manhã e tarde respeitados e horário de almoço excluído.");
  }

  // 7. Fim de semana fechado
  console.log("7. Testando fim de semana fechado...");
  {
    const resSabado = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-17" } // Sábado
    });
    assert.strictEqual(resSabado.status, 200);
    assert.strictEqual(resSabado.body.success, true);
    assert.strictEqual(resSabado.body.disponivel, false);
    assert.strictEqual(resSabado.body.quantidade, 0);

    const resDomingo = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-18" } // Domingo
    });
    assert.strictEqual(resDomingo.status, 200);
    assert.strictEqual(resDomingo.body.disponivel, false);
    assert.strictEqual(resDomingo.body.quantidade, 0);
    console.log("   -> OK! Sábado e Domingo retornaram fechados sem vagas.");
  }

  // 8. Funcionamento 24 horas
  console.log("8. Testando funcionamento 24 horas (Empresa B)...");
  {
    const res24h = await invokeHandler({
      headers: { "x-api-key": chaveB.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-18" } // Domingo em hospital 24h
    });
    assert.strictEqual(res24h.status, 200);
    assert.strictEqual(res24h.body.success, true);
    assert.strictEqual(res24h.body.disponivel, true);
    assert.strictEqual(res24h.body.quantidade, 4); // Limite de 4 opções
    assert.strictEqual(res24h.body.horario1, "00:00");
    console.log("   -> OK! Atendimento 24h verificado gerando slots de madrugada.");
  }

  // 9. Exceção de feriado (dia fechado prevalece sobre regra semanal)
  console.log("9. Testando exceção de feriado sobrepondo regra semanal...");
  {
    // Cadastrar feriado na Empresa A em 2026-10-14 (que era quarta-feira aberta)
    await empresaRepo.salvarExcecaoData(empA.id, {
      data: "2026-10-14",
      descricao: "Feriado Local",
      fechado: true
    });

    const resFeriado = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resFeriado.status, 200);
    assert.strictEqual(resFeriado.body.disponivel, false);
    assert.strictEqual(resFeriado.body.quantidade, 0);
    console.log("   -> OK! Feriado prevaleceu e bloqueou o dia que normalmente é aberto.");

    // Remove a exceção para testes subsequentes
    await empresaRepo.removerExcecaoData(empA.id, "2026-10-14");
  }

  // 10. Abertura excepcional em fim de semana
  console.log("10. Testando abertura excepcional em sábado fechado...");
  {
    // Cadastrar abertura especial no Sábado 2026-10-17 com horário reduzido 09:00 às 12:00
    await empresaRepo.salvarExcecaoData(empA.id, {
      data: "2026-10-17",
      descricao: "Plantão Especial de Sábado",
      fechado: false,
      faixas: [{ horaInicio: "09:00", horaFim: "12:00" }]
    });

    const resAbertura = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-17" }
    });
    assert.strictEqual(resAbertura.status, 200);
    assert.strictEqual(resAbertura.body.disponivel, true);
    assert.ok(resAbertura.body.horarios.includes("09:00"));
    assert.ok(resAbertura.body.horarios.includes("10:00"));
    assert.strictEqual(resAbertura.body.horarios.includes("14:00"), false); // fora da faixa especial
    console.log("   -> OK! Abertura excepcional no fim de semana funcionou conforme faixas.");
  }

  // 11. Jornada atravessando meia-noite (22:00 às 02:00)
  console.log("11. Testando jornada de trabalho atravessando meia-noite...");
  {
    const slotsCruza = availabilityEngine.gerarSlotsCandidatos({
      data: "2026-10-20",
      fusoHorario: "America/Sao_Paulo",
      politica: { duracaoMinutos: 60, intervaloEntreSlots: 60, limiteMaximoDias: 60 },
      horarios: [
        {
          diaSemana: 2,
          fechado: false,
          faixas: [{ horaInicio: "22:00", horaFim: "02:00" }]
        }
      ]
    });
    assert.strictEqual(slotsCruza.valido, true);
    assert.strictEqual(slotsCruza.fechado, false);
    assert.deepStrictEqual(slotsCruza.slots, ["00:00", "01:00", "22:00", "23:00"]);
    console.log("   -> OK! Jornada noturna atravessando meia-noite calculada perfeitamente.");
  }

  // 12. Agendamento que ultrapassaria o fechamento
  console.log("12. Testando agendamento que ultrapassaria o horário de fechamento...");
  {
    const slotsLimite = availabilityEngine.gerarSlotsCandidatos({
      data: "2026-10-20",
      fusoHorario: "America/Sao_Paulo",
      politica: { duracaoMinutos: 60, intervaloEntreSlots: 30, limiteMaximoDias: 60 }, // duração 60m
      horarios: [
        {
          diaSemana: 2,
          fechado: false,
          faixas: [{ horaInicio: "08:00", horaFim: "09:30" }] // fecha às 09:30
        }
      ]
    });
    // Slots possíveis: 08:00 (vai até 09:00 <= 09:30), 08:30 (vai até 09:30 <= 09:30)
    // 09:00 NÃO PODE SER OFERECIDO porque 09:00 + 60m = 10:00 > 09:30!
    assert.ok(slotsLimite.slots.includes("08:00"));
    assert.ok(slotsLimite.slots.includes("08:30"));
    assert.strictEqual(slotsLimite.slots.includes("09:00"), false);
    console.log("   -> OK! Slot que ultrapassaria fechamento foi descartado corretamente.");
  }

  // 13. Duração e intervalo configuráveis
  console.log("13. Testando duração e intervalo configuráveis (30 min duração, 15 min passo)...");
  {
    const slotsPasso = availabilityEngine.gerarSlotsCandidatos({
      data: "2026-10-20",
      fusoHorario: "America/Sao_Paulo",
      politica: { duracaoMinutos: 30, intervaloEntreSlots: 15, limiteMaximoDias: 60 },
      horarios: [
        {
          diaSemana: 2,
          fechado: false,
          faixas: [{ horaInicio: "10:00", horaFim: "11:00" }]
        }
      ]
    });
    // Slots: 10:00, 10:15, 10:30 (todos cabem com 30m)
    assert.deepStrictEqual(slotsPasso.slots, ["10:00", "10:15", "10:30"]);
    console.log("   -> OK! Duração e passo customizados funcionaram perfeitamente.");
  }

  // 14. Normalização de datas DTMF
  console.log("14. Testando normalização de datas por DTMF (YYYY-MM-DD, DDMMAAAA, DD/MM/AAAA)...");
  {
    assert.strictEqual(availabilityEngine.normalizarDataEntrada("2026-10-15"), "2026-10-15");
    assert.strictEqual(availabilityEngine.normalizarDataEntrada("15102026"), "2026-10-15");
    assert.strictEqual(availabilityEngine.normalizarDataEntrada("15/10/2026"), "2026-10-15");
    assert.strictEqual(availabilityEngine.normalizarDataEntrada("31022026"), null); // 31 de fevereiro
    assert.strictEqual(availabilityEngine.normalizarDataEntrada("invalido"), null);

    // Testar chamada à API com formato DDMMAAAA (DTMF do GoTo)
    const resDtmf = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "14102026" }
    });
    assert.strictEqual(resDtmf.status, 200);
    assert.strictEqual(resDtmf.body.success, true);
    assert.strictEqual(resDtmf.body.data, "2026-10-14"); // Convertido para YYYY-MM-DD
    console.log("   -> OK! Entradas DTMF normalizadas com rigor para formato canônico.");
  }

  // 15. Fuso horário diferente
  console.log("15. Testando fusos horários diferentes (America/Sao_Paulo vs America/Manaus)...");
  {
    const horaSP = availabilityEngine.obterDataHoraAtualNoFuso("America/Sao_Paulo");
    const horaManaus = availabilityEngine.obterDataHoraAtualNoFuso("America/Manaus");
    assert.ok(horaSP.dataHoje);
    assert.ok(horaManaus.dataHoje);
    // Manaus é UTC-4 e Brasília é UTC-3 (diferença de 1 hora)
    const minSP = availabilityEngine.horaParaMinutos(horaSP.horarioHoje);
    const minManaus = availabilityEngine.horaParaMinutos(horaManaus.horarioHoje);
    const diff = (minSP - minManaus + 1440) % 1440;
    assert.strictEqual(diff, 60);
    console.log("   -> OK! Fusos horários IANA calculados com precisão de timezone real.");
  }

  // 16. Eventos ocupados em cada calendário (colisão em A não afeta B)
  console.log("16. Testando impacto de evento ocupado isolado por empresa...");
  {
    // Coloca evento ocupado às 08:00 na Empresa A
    mailboxCalendars.set("agenda@clinicaalfa.com.br", [
      {
        id: "evt-bloqueio-alfa",
        subject: "Reunião de Equipe",
        start: { dateTime: "2026-10-14T08:00:00" },
        end: { dateTime: "2026-10-14T09:00:00" }
      }
    ]);

    const resDispAlfa = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resDispAlfa.body.horarios.includes("08:00"), false); // Bloqueado em A!
    assert.strictEqual(resDispAlfa.body.horarios[0], "09:00");

    // Na Empresa B, o calendário está limpo e 24h continua disponível
    const resDispBeta = await invokeHandler({
      headers: { "x-api-key": chaveB.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resDispBeta.body.disponivel, true);
    assert.strictEqual(resDispBeta.body.horarios[0], "00:00");
    console.log("   -> OK! Conflito em calendário de Empresa A não afetou Empresa B.");
  }

  // 17. Compatibilidade do cliente atual (Fallback de chave legada)
  console.log("17. Testando compatibilidade e fallback com a chave legada de produção...");
  {
    const resLegado = await invokeHandler({
      headers: { "x-api-key": "legacy-secret-key-prod" },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resLegado.status, 200);
    assert.strictEqual(resLegado.body.success, true);
    console.log("   -> OK! Fallback transparente manteve o cliente legado 100% funcional.");
  }

  // 18. Falha no banco de dados + chave legada válida (continuidade operacional)
  console.log("18. Testando falha no banco de dados com chave legada válida...");
  const obterEmpresaOriginal = empresaRepo.obterEmpresaPorApiKey;
  try {
    empresaRepo.obterEmpresaPorApiKey = async () => {
      throw new Error("ECONNREFUSED: Banco de dados indisponível");
    };

    const resFallbackBanco = await invokeHandler({
      headers: { "x-api-key": "legacy-secret-key-prod" },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resFallbackBanco.status, 200);
    assert.strictEqual(resFallbackBanco.body.success, true);
    console.log("   -> OK! Falha de banco com chave legada ativou fallback e manteve serviço.");

    // 19. Falha no banco de dados + chave desconhecida (NUNCA permite acesso ao tenant legado)
    console.log("19. Testando falha no banco de dados com chave desconhecida...");
    const resFalhaDesconhecida = await invokeHandler({
      headers: { "x-api-key": "chave-desconhecida-ou-de-outro-cliente" },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resFalhaDesconhecida.status, 503);
    assert.strictEqual(resFalhaDesconhecida.body.success, false);
    assert.ok(resFalhaDesconhecida.body.error.includes("banco de dados indisponível"));
    console.log("   -> OK! Chave não legada durante falha de banco recebeu 503 técnico (zero vazamento).");
  } finally {
    empresaRepo.obterEmpresaPorApiKey = obterEmpresaOriginal;
  }

  // 20. Banco ativo + chave desconhecida
  console.log("20. Testando banco ativo com chave inexistente...");
  {
    const resChaveInvalida = await invokeHandler({
      headers: { "x-api-key": "chave-inexistente-123" },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resChaveInvalida.status, 401);
    assert.strictEqual(resChaveInvalida.body.success, false);
    assert.strictEqual(resChaveInvalida.body.error, "API Key inválida");
    console.log("   -> OK! Chave inexistente com banco ativo retornou 401.");
  }

  // 21. Validação estrita de sobreposição de faixas de atendimento
  console.log("21. Testando validação contra sobreposição de faixas de atendimento...");
  {
    let erroDetectado = false;
    try {
      await empresaRepo.salvarHorariosSemanais(empA.id, [
        {
          diaSemana: 1,
          fechado: false,
          faixas: [
            { horaInicio: "08:00", horaFim: "12:00" },
            { horaInicio: "11:00", horaFim: "15:00" }
          ]
        }
      ]);
    } catch (err) {
      erroDetectado = true;
      assert.ok(err.message.includes("Sobreposição de horários detectada"));
    }
    assert.strictEqual(erroDetectado, true, "Deveria ter rejeitado sobreposição de horários!");

    await empresaRepo.salvarHorariosSemanais(empA.id, [
      {
        diaSemana: 1,
        fechado: false,
        faixas: [
          { horaInicio: "08:00", horaFim: "11:00" },
          { horaInicio: "13:00", horaFim: "18:00" }
        ]
      }
    ]);
    console.log("   -> OK! Algoritmo impediu sobreposição e permitiu faixas válidas.");
  }

  // 22. Criptografia AES-256-GCM com versionamento, IV exclusivo e validação de Auth Tag
  console.log("22. Testando criptografia AES-256-GCM com versionamento e Auth Tag...");
  {
    const segredoOriginal = "SuperSegredoAzureGraph2026";
    const encV1 = cryptoLib.criptografarSegredo(segredoOriginal, 1);
    assert.strictEqual(encV1.keyVersion, 1);
    assert.ok(encV1.ciphertext);
    assert.ok(encV1.iv);
    assert.ok(encV1.authTag);

    const decV1 = cryptoLib.descriptografarSegredo(encV1);
    assert.strictEqual(decV1, segredoOriginal);

    const encV2 = cryptoLib.rotacionarCriptografiaSegredo(encV1, 2);
    assert.strictEqual(encV2.keyVersion, 2);
    assert.notStrictEqual(encV2.iv, encV1.iv);
    const decV2 = cryptoLib.descriptografarSegredo(encV2);
    assert.strictEqual(decV2, segredoOriginal);

    let falhaAuthTag = false;
    try {
      const tagAdulterada = encV1.authTag.substring(0, 10) + "00" + encV1.authTag.substring(12);
      cryptoLib.descriptografarSegredo({
        ciphertext: encV1.ciphertext,
        iv: encV1.iv,
        authTag: tagAdulterada,
        keyVersion: 1
      });
    } catch (e) {
      falhaAuthTag = true;
    }
    assert.strictEqual(falhaAuthTag, true, "Deveria ter rejeitado Auth Tag adulterada!");
    console.log("   -> OK! AES-256-GCM validado com versionamento, rotação e Auth Tag rigorosa.");
  }

  // 23. Sessão administrativa segura: senha forte, bloqueio por força bruta e proteção CSRF
  console.log("23. Testando sessão administrativa, bloqueio por força bruta e proteção CSRF...");
  {
    const checagemSenhaFraca = cryptoLib.validarForcaSenha("12345");
    assert.strictEqual(checagemSenhaFraca.valido, false);
    const checagemSenhaForte = cryptoLib.validarForcaSenha("Admin#Seguro2026!");
    assert.strictEqual(checagemSenhaForte.valido, true);

    await usuarioRepo.criarUsuarioAdmin({
      email: "seguranca@empresa.com",
      nome: "Admin Teste",
      senha: "Admin#Seguro2026!"
    });

    for (let i = 0; i < 5; i++) {
      await usuarioRepo.autenticarUsuario("seguranca@empresa.com", "senha-errada");
    }

    const resBloqueio = await usuarioRepo.autenticarUsuario("seguranca@empresa.com", "Admin#Seguro2026!");
    assert.strictEqual(resBloqueio.sucesso, false);
    assert.strictEqual(resBloqueio.bloqueado, true);
    console.log("   -> OK! Proteção contra força bruta bloqueou a conta após 5 falhas consecutivas.");

    await usuarioRepo.registrarResultadoLogin("seguranca@empresa.com", true);

    const resLogin = await invokeAdmin(adminLoginHandler, {
      method: "POST",
      body: JSON.stringify({ email: "seguranca@empresa.com", senha: "Admin#Seguro2026!" })
    });
    assert.strictEqual(resLogin.status, 200);
    assert.ok(resLogin.body.csrfToken);
    const cookiesSet = resLogin.headers["set-cookie"] || [];
    const cookieHeader = Array.isArray(cookiesSet) ? cookiesSet.join("; ") : cookiesSet;
    assert.ok(cookieHeader.includes("HttpOnly"));
    assert.ok(cookieHeader.includes("SameSite=Strict"));

    const resMutacaoSemCsrf = await invokeAdmin(adminEmpresasHandler, {
      method: "POST",
      headers: { cookie: cookieHeader },
      body: JSON.stringify({ nome: "Tentativa CSRF", slug: "csrf-test" })
    });
    assert.strictEqual(resMutacaoSemCsrf.status, 403);
    assert.ok(resMutacaoSemCsrf.body.error.includes("CSRF"));
    console.log("   -> OK! Requisição mutante sem token CSRF foi bloqueada com HTTP 403.");

    const resMutacaoComCsrf = await invokeAdmin(adminEmpresasHandler, {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "x-csrf-token": resLogin.body.csrfToken
      },
      body: JSON.stringify({ nome: "Empresa Valida", slug: "empresa-valida" })
    });
    assert.strictEqual(resMutacaoComCsrf.status, 201);
    assert.strictEqual(resMutacaoComCsrf.body.success, true);
    console.log("   -> OK! Requisição mutante com token CSRF e cookie HttpOnly aceita com sucesso.");

    // Salva cookie e token para os testes administrativos seguintes
    var cookieAdmin = cookieHeader;
    var csrfAdmin = resLogin.body.csrfToken;
  }

  // 24. Concorrência e atomicidade no rate limiting (Promise.all simultâneo)
  console.log("24. Testando atomicidade e concorrência no rate limiting (Promise.all simultâneo)...");
  {
    rateLimiter.resetarRateLimitMemoria();
    const limiteConcorrencia = 5;
    const promessas = [];
    for (let i = 0; i < 20; i++) {
      promessas.push(rateLimiter.incrementarRateLimit("ratelimit:concorrencia:teste", limiteConcorrencia, 60));
    }
    const resultados = await Promise.all(promessas);
    const permitidos = resultados.filter(r => r.permitido).length;
    const bloqueados = resultados.filter(r => !r.permitido).length;
    assert.strictEqual(permitidos, 5, "Exatamente 5 requisições devem ter sido permitidas");
    assert.strictEqual(bloqueados, 15, "Exatamente 15 requisições devem ter sido bloqueadas com 429");
    console.log("   -> OK! Concorrência estrita comprovada: 5 permitidas e 15 bloqueadas sem race condition.");
  }

  // 25. Matriz dos 4 cenários de fallback legado e isolamento de banco de dados
  console.log("25. Testando matriz completa dos 4 cenários de fallback legado e proteção contra falha de banco...");
  {
    const fnOriginalObter = empresaRepo.obterEmpresaPorApiKey;
    try {
      // Simula indisponibilidade do banco
      empresaRepo.obterEmpresaPorApiKey = async () => {
        throw new Error("PGBOUND: Conexão com banco recusada");
      };

      // Cenário 1: Banco fora + chave legada exata -> 200 (contexto legado ativo)
      const resA = await invokeHandler({
        headers: { "x-api-key": "legacy-secret-key-prod" },
        body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
      });
      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resA.body.success, true);

      // Cenário 2: Banco fora + chave desconhecida -> 503 (técnico, sem vazamento)
      const resB = await invokeHandler({
        headers: { "x-api-key": "chave-totalmente-desconhecida-123" },
        body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
      });
      assert.strictEqual(resB.status, 503);
      assert.strictEqual(resB.body.success, false);

      // Cenário 3: Banco fora + chave multiempresa cadastrada no banco -> 503 (JAMAIS cai no contexto legado!)
      const resC = await invokeHandler({
        headers: { "x-api-key": chaveA.chaveCompleta },
        body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
      });
      assert.strictEqual(resC.status, 503);
      assert.strictEqual(resC.body.success, false);
      assert.ok(resC.body.error.includes("banco de dados indisponível"));
    } finally {
      empresaRepo.obterEmpresaPorApiKey = fnOriginalObter;
    }

    // Cenário 4: Banco ativo + chave desconhecida -> 401 (rejeição de autenticação)
    const resD = await invokeHandler({
      headers: { "x-api-key": "outra-chave-inexistente-xyz" },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resD.status, 401);
    assert.strictEqual(resD.body.error, "API Key inválida");
    console.log("   -> OK! Matriz dos 4 cenários de fallback testada e validada com total isolamento.");
  }

  // 26. Paridade absoluta e consistência temporal entre prévia e endpoint público
  console.log("26. Testando paridade absoluta e consistência temporal entre prévia administrativa e /api/agendamento...");
  {
    const resPrevia = await invokeAdmin(adminPreviaHandler, {
      method: "POST",
      query: { id: empA.id },
      headers: {
        cookie: cookieAdmin,
        "x-csrf-token": csrfAdmin
      },
      body: JSON.stringify({ data: "2026-10-14" })
    });
    assert.strictEqual(resPrevia.status, 200);

    const resPublico = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resPublico.status, 200);

    // Validação estrita: ambos os endpoints devem retornar exatamente os mesmos slots disponíveis
    assert.deepStrictEqual(resPrevia.body.horarios, resPublico.body.horarios);
    console.log("   -> OK! Prévia administrativa e endpoint público geram exatamente os mesmos slots.");
  }

  // 27. Isolamento multiempresa estrito, conexão M365 desativada e rejeição de spoofing
  console.log("27. Testando isolamento multiempresa e rejeição de spoofing no payload...");
  {
    // 1. Rejeição de spoofing: payload não altera o tenant resolvido
    const resSpoof = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: {
        acao: "consultar_disponibilidade",
        data: "2026-10-14",
        empresa_id: empB.id,
        mailbox: "agenda@socorromedicobeta.com.br",
        azureTenantId: "tenant-hacker"
      }
    });
    assert.strictEqual(resSpoof.status, 200);
    // Não adotou o horário 24h da Empresa B
    assert.strictEqual(resSpoof.body.horarios.includes("00:00"), false);

    // 2. Conexão M365 desativada é rejeitada com 503
    db.getMemoryDb().empresas_conexoes_m365.get(empA.id).status_conexao = "desativado";
    const resM365Desativado = await invokeHandler({
      headers: { "x-api-key": chaveA.chaveCompleta },
      body: { acao: "consultar_disponibilidade", data: "2026-10-14" }
    });
    assert.strictEqual(resM365Desativado.status, 503);
    assert.ok(resM365Desativado.body.error.includes("desativada"));
    // Restaura status
    db.getMemoryDb().empresas_conexoes_m365.get(empA.id).status_conexao = "ativo";

    // 3. Isolamento de rate limit entre Empresa A e Empresa B
    rateLimiter.resetarRateLimitMemoria();
    for (let i = 0; i < 60; i++) {
      await rateLimiter.verificarRateLimitEmpresa(empA.id, 60, 60);
    }
    const rlA = await rateLimiter.verificarRateLimitEmpresa(empA.id, 60, 60);
    assert.strictEqual(rlA.permitido, false, "Empresa A deve estar bloqueada pelo rate limit");
    const rlB = await rateLimiter.verificarRateLimitEmpresa(empB.id, 60, 60);
    assert.strictEqual(rlB.permitido, true, "Empresa B NÃO deve ter seu limite consumido pela Empresa A");
    console.log("   -> OK! Rejeição de spoofing, conexão M365 desativada e isolamento de rate limit comprovados.");
  }

  // 28. Três validações separadas do Microsoft 365 (auth, leitura, gravação efêmera)
  console.log("28. Testando 3 validações separadas do Microsoft 365 (auth, leitura, gravação)...");
  {
    // Teste 1: Autenticação exclusiva (obtenção de token app-only sem ler nem gravar)
    const resTesteAuth = await invokeAdmin(adminTestarM365Handler, {
      method: "POST",
      query: { id: empA.id, tipo: "auth" },
      headers: {
        cookie: cookieAdmin,
        "x-csrf-token": csrfAdmin
      }
    });
    assert.strictEqual(resTesteAuth.status, 200);
    assert.strictEqual(resTesteAuth.body.sucesso, true);
    assert.strictEqual(resTesteAuth.body.token, undefined); // Não expõe token na resposta

    // Teste 2: Leitura (calendarView não destrutivo da mailbox configurada)
    const resTesteLeitura = await invokeAdmin(adminTestarM365Handler, {
      method: "POST",
      query: { id: empA.id, tipo: "leitura" },
      headers: {
        cookie: cookieAdmin,
        "x-csrf-token": csrfAdmin
      }
    });
    assert.strictEqual(resTesteLeitura.status, 200);
    assert.strictEqual(resTesteLeitura.body.sucesso, true);

    // Teste 3: Gravação (cria evento efêmero com showAs: free e remove imediatamente)
    const resTesteGravacao = await invokeAdmin(adminTestarM365Handler, {
      method: "POST",
      query: { id: empA.id, tipo: "gravacao" },
      headers: {
        cookie: cookieAdmin,
        "x-csrf-token": csrfAdmin
      }
    });
    assert.strictEqual(resTesteGravacao.status, 200);
    assert.strictEqual(resTesteGravacao.body.sucesso, true);
    assert.strictEqual(resTesteGravacao.body.eventoRemovido, true);
    console.log("   -> OK! 3 testes M365 (auth, leitura, gravação) executados e validados separadamente.");
  }

  // 29. Segurança da chave GoTo (guardrails de prontidão, entropia, armazenamento como hash, irreversibilidade)
  console.log("29. Testando segurança e irreversibilidade da chave GoTo com checklist de prontidão...");
  {
    // 0. Verifica que empresa B (sem testes M365 validados) é bloqueada de gerar chave GoTo
    const resBloqueada = await invokeAdmin(adminChavesGotoHandler, {
      method: "POST",
      query: { id: empB.id },
      headers: {
        cookie: cookieAdmin,
        "x-csrf-token": csrfAdmin
      },
      body: JSON.stringify({ nomeIdentificador: "Chave Empresa B" })
    });
    assert.strictEqual(resBloqueada.status, 400);
    assert.ok(resBloqueada.body.pendencias.length > 0, "Deve indicar pendências para empresa sem testes M365");

    // 1. Gera nova chave para Empresa A (cujos 3 testes foram validados)
    const resNovaChave = await invokeAdmin(adminChavesGotoHandler, {
      method: "POST",
      query: { id: empA.id },
      headers: {
        cookie: cookieAdmin,
        "x-csrf-token": csrfAdmin
      },
      body: JSON.stringify({ nomeIdentificador: "Chave Auditoria Teste" })
    });
    assert.strictEqual(resNovaChave.status, 201);
    const chaveGerada = resNovaChave.body.chave;
    assert.ok(chaveGerada.chaveCompleta);
    assert.ok(chaveGerada.keyPrefix);
    assert.ok(chaveGerada.chaveCompleta.startsWith(chaveGerada.keyPrefix));

    // 2. Consulta via GET na API administrativa: NUNCA retorna chaveCompleta nem hash
    const resListarChaves = await invokeAdmin(adminChavesGotoHandler, {
      method: "GET",
      query: { id: empA.id },
      headers: {
        cookie: cookieAdmin
      }
    });
    assert.strictEqual(resListarChaves.status, 200);
    const chaveNoGet = resListarChaves.body.chaves.find(c => c.id === chaveGerada.id);
    assert.ok(chaveNoGet);
    assert.strictEqual(chaveNoGet.chaveCompleta, undefined);
    assert.strictEqual(chaveNoGet.key_hash, undefined);
    assert.strictEqual(chaveNoGet.key_prefix, chaveGerada.keyPrefix);

    // 3. Consulta direta no banco: NUNCA armazena a chave pura, somente hash SHA-256
    const registroDb = db.getMemoryDb().empresas_chaves_goto.get(chaveGerada.id);
    assert.strictEqual(registroDb.chaveCompleta, undefined);
    assert.strictEqual(registroDb.key_hash.length, 64);
    console.log("   -> OK! Chave GoTo protegida com checklist de prontidão e irreversível.");
  }

  // 30. Teste do Dispatcher Central api/admin.js e Callback OAuth
  {
    console.log("\n--- Cenário 30: Validação do Dispatcher Central api/admin.js e api/m365-callback.js ---");
    
    // Teste 30.1: Dispatcher com rota de sessão não autenticada (deve responder 401 via /api/admin/session)
    const resSessaoAnonima = await invokeAdmin(adminDispatcher, {
      method: "GET",
      url: "/api/admin/session",
      headers: {}
    });
    assert.strictEqual(resSessaoAnonima.status, 401, "Dispatcher /api/admin/session deve retornar 401 sem cookie");
    assert.strictEqual(resSessaoAnonima.body.success, false);

    // Teste 30.2: Dispatcher com rota inexistente (deve responder 404)
    const resRota404 = await invokeAdmin(adminDispatcher, {
      method: "GET",
      url: "/api/admin/rota-inexistente",
      headers: {}
    });
    assert.strictEqual(resRota404.status, 404, "Dispatcher deve retornar 404 para rotas inexistentes");

    // Teste 30.3: Dispatcher com rota de empresas autenticada
    const resEmpresasDispatcher = await invokeAdmin(adminDispatcher, {
      method: "GET",
      url: "/api/admin/empresas",
      headers: {
        cookie: cookieAdmin
      }
    });
    assert.strictEqual(resEmpresasDispatcher.status, 200, "Dispatcher deve responder 200 para /api/admin/empresas");
    assert.ok(Array.isArray(resEmpresasDispatcher.body.empresas));

    // Teste 30.4: Callback M365 sem state (deve redirecionar com erro)
    const resCallbackSemState = await invokeAdmin(m365CallbackHandler, {
      method: "GET",
      url: "/api/admin/m365/callback",
      headers: {}
    });
    assert.strictEqual(resCallbackSemState.status, 302, "Callback sem state deve redirecionar 302");
    assert.ok(resCallbackSemState.headers.location.includes("m365_erro="));

    console.log("   -> OK! Dispatcher central api/admin.js e api/m365-callback.js validados com sucesso.");
  }

  console.log("\n=========================================================");
  console.log("TODOS OS 30 CENÁRIOS MULTIEMPRESA E SEGURANÇA PASSARAM!");
  console.log("=========================================================\n");
}

runMultiempresaTests().catch(err => {
  console.error("FALHA NOS TESTES MULTIEMPRESA:", err);
  process.exit(1);
});
