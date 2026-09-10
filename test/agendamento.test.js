const assert = require("assert");

// Configurar variáveis de ambiente exigidas
process.env.GOTO_API_KEY = "test-secret-key";
process.env.AZURE_TENANT_ID = "mock-tenant";
process.env.AZURE_CLIENT_ID = "mock-client";
process.env.AZURE_CLIENT_SECRET = "mock-secret";

// Carregar o handler
const handler = require("../api/agendamento.js");

// Mock do fetch global
let mockEvents = [];
let patchCalls = [];
let deleteCalls = [];
let postCalls = [];
let simulateGraphFailure = false;

global.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  // 1. Obter token
  if (urlStr.includes("login.microsoftonline.com")) {
    if (simulateGraphFailure) {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Graph token service down" }),
        json: async () => ({ error: "Graph token service down" })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "mock-token-abc" }),
      json: async () => ({ access_token: "mock-token-abc" })
    };
  }

  // 2. Erro simulado do Graph em chamadas Graph
  if (simulateGraphFailure) {
    return {
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { code: "ServiceUnavailable", message: "Graph indisponível" } }),
      json: async () => ({ error: { code: "ServiceUnavailable", message: "Graph indisponível" } })
    };
  }

  // 3. CalendarView
  if (urlStr.includes("/calendarView")) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: mockEvents }),
      json: async () => ({ value: mockEvents })
    };
  }

  // 4. Obter evento específico GET /events/{id}
  if (urlStr.includes("/events/") && (!options.method || options.method === "GET")) {
    const id = decodeURIComponent(urlStr.split("/events/")[1]);
    const ev = mockEvents.find(e => e.id === id);
    if (!ev) {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: "Not Found" }),
        json: async () => ({ error: "Not Found" })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(ev),
      json: async () => ev
    };
  }

  // 5. Deletar evento DELETE /events/{id}
  if (options.method === "DELETE") {
    const id = decodeURIComponent(urlStr.split("/events/")[1]);
    deleteCalls.push(id);
    const index = mockEvents.findIndex(e => e.id === id);
    if (index !== -1) {
      mockEvents.splice(index, 1);
    }
    return {
      ok: true,
      status: 204,
      data: null,
      text: async () => ""
    };
  }

  // 6. Atualizar evento PATCH /events/{id}
  if (options.method === "PATCH") {
    const id = decodeURIComponent(urlStr.split("/events/")[1]);
    const body = JSON.parse(options.body || "{}");
    patchCalls.push({ id, body });
    const ev = mockEvents.find(e => e.id === id);
    if (ev) {
      if (body.start) ev.start = body.start;
      if (body.end) ev.end = body.end;
      if (body.body) ev.body = body.body;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(ev || body),
      json: async () => (ev || body)
    };
  }

  // 7. Criar evento POST /events
  if (options.method === "POST" && urlStr.includes("/events")) {
    const body = JSON.parse(options.body || "{}");
    const newEvent = {
      id: "event-created-" + (mockEvents.length + 1),
      ...body
    };
    postCalls.push(newEvent);
    mockEvents.push(newEvent);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(newEvent),
      json: async () => newEvent
    };
  }

  throw new Error("Chamada fetch não interceptada no mock: " + urlStr);
};

// Helper para invocar o handler HTTP
async function invokeHandler({ method = "POST", headers = {}, body = {} }) {
  let statusCode = 200;
  let responseBody = null;

  const req = {
    method,
    headers: {
      "x-api-key": "test-secret-key",
      ...headers
    },
    body
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseBody = data;
      return this;
    }
  };

  await handler(req, res);
  return { status: statusCode, body: responseBody };
}

// Bateria de testes
async function runTests() {
  console.log("=== INICIANDO BATERIA DE TESTES DO AGENDAMENTO ===\n");

  // Helper para criar eventos no mock
  function criarEventoMock({ id, data, horario, nome = "Cliente Teste", cpf = "12345678900", telefone = "11999998888" }) {
    return {
      id,
      subject: `Agendamento GoTo - ${nome}`,
      body: {
        content: `Nome: ${nome}\nCPF: ${cpf}\nTelefone: ${telefone}\nData: ${data}\nHorário: ${horario}`
      },
      bodyPreview: `Nome: ${nome} CPF: ${cpf} Telefone: ${telefone}`,
      start: {
        dateTime: `${data}T${horario}:00`,
        timeZone: "E. South America Standard Time"
      },
      end: {
        dateTime: `${data}T11:00:00`,
        timeZone: "E. South America Standard Time"
      },
      isAllDay: false
    };
  }

  // Reset do estado
  function resetMockState() {
    mockEvents = [];
    patchCalls = [];
    deleteCalls = [];
    postCalls = [];
    simulateGraphFailure = false;
  }

  // TESTE 1: Cliente com zero compromissos
  {
    resetMockState();
    console.log("1. Testando cliente com zero compromissos...");
    const res = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        telefone: "11999998888",
        cpf: "123.456.789-00"
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.quantidade, 0);
    assert.strictEqual(res.body.evento1Data, "");
    assert.strictEqual(res.body.evento1Horario, "");
    assert.strictEqual(res.body.evento4Data, "");
    assert.ok(res.body.mensagem.includes("Não encontrei"));
    console.log("   -> OK! Retornou quantidade 0 e mensagem adequada.\n");
  }

  // TESTE 2: Cliente com um compromisso
  {
    resetMockState();
    console.log("2. Testando cliente com um compromisso...");
    mockEvents.push(criarEventoMock({
      id: "ev-1",
      data: "2026-09-15",
      horario: "10:00",
      cpf: "12345678900",
      telefone: "11999998888"
    }));

    const res = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        telefone: "(11) 99999-8888",
        cpf: "123.456.789-00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.quantidade, 1);
    assert.strictEqual(res.body.evento1Data, "2026-09-15");
    assert.strictEqual(res.body.evento1Horario, "10:00");
    assert.strictEqual(res.body.evento2Data, "");
    assert.strictEqual(res.body.evento3Data, "");
    assert.strictEqual(res.body.evento4Data, "");
    assert.ok(res.body.mensagem.includes("pressione 1"));
    console.log("   -> OK! Retornou 1 evento com posições vazias preenchidas como string vazia e mensagem para DTMF.\n");
  }

  // TESTE 3: Cliente com dois ou mais compromissos (ordenação cronológica e frase de voz)
  {
    resetMockState();
    console.log("3. Testando cliente com múltiplos compromissos...");
    // Adicionar fora de ordem propositalmente
    mockEvents.push(criarEventoMock({
      id: "ev-distante",
      data: "2026-10-09",
      horario: "14:00"
    }));
    mockEvents.push(criarEventoMock({
      id: "ev-proximo",
      data: "2026-09-15",
      horario: "09:00"
    }));

    const res = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        telefone: "11999998888",
        cpf: "12345678900"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.quantidade, 2);
    // Deve vir ordenado do mais próximo para o mais distante
    assert.strictEqual(res.body.evento1Data, "2026-09-15");
    assert.strictEqual(res.body.evento1Horario, "09:00");
    assert.strictEqual(res.body.evento2Data, "2026-10-09");
    assert.strictEqual(res.body.evento2Horario, "14:00");
    assert.strictEqual(res.body.evento3Data, "");
    assert.strictEqual(res.body.evento4Data, "");
    assert.ok(res.body.mensagem.includes("Encontrei dois agendamentos"));
    assert.ok(res.body.mensagem.includes("pressione 1"));
    assert.ok(res.body.mensagem.includes("pressione 2"));
    console.log("   -> OK! Ordenou cronologicamente e formatou mensagem DTMF numerada para GoTo.\n");
  }

  // TESTE 4: Cancelamento de um compromisso específico
  {
    resetMockState();
    console.log("4. Testando cancelamento de compromisso específico...");
    mockEvents.push(criarEventoMock({
      id: "ev-canc",
      data: "2026-09-15",
      horario: "10:00"
    }));
    mockEvents.push(criarEventoMock({
      id: "ev-outro",
      data: "2026-09-16",
      horario: "11:00"
    }));

    const res = await invokeHandler({
      body: {
        acao: "cancelar",
        cpf: "123.456.789-00",
        telefone: "(11) 99999-8888",
        data: "2026-09-15",
        horario: "10:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      success: true,
      acao: "cancelar",
      data: "2026-09-15",
      horario: "10:00",
      mensagem: "Agendamento cancelado com sucesso."
    });
    assert.strictEqual(deleteCalls.length, 1);
    assert.strictEqual(deleteCalls[0], "ev-canc");
    assert.strictEqual(mockEvents.length, 1);
    assert.strictEqual(mockEvents[0].id, "ev-outro");
    console.log("   -> OK! Cancelou apenas o compromisso específico com resposta contratual exata.\n");
  }

  // TESTE 5: Tentativa de cancelar compromisso inexistente
  {
    resetMockState();
    console.log("5. Testando tentativa de cancelar compromisso inexistente...");
    mockEvents.push(criarEventoMock({
      id: "ev-1",
      data: "2026-09-15",
      horario: "10:00"
    }));

    const res = await invokeHandler({
      body: {
        acao: "cancelar",
        cpf: "123.456.789-00",
        telefone: "11999998888",
        data: "2026-09-20",
        horario: "10:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.acao, "cancelar");
    assert.ok(res.body.mensagem);
    assert.strictEqual(deleteCalls.length, 0);
    console.log("   -> OK! Retornou HTTP 200 com success: false sem alterar calendário.\n");
  }

  // TESTE 6: Resultado ambíguo sem cancelamento
  {
    resetMockState();
    console.log("6. Testando resultado ambíguo sem cancelamento...");
    // 2 eventos no mesmo dia e horário para o cliente
    mockEvents.push(criarEventoMock({
      id: "ev-ambiguo-1",
      data: "2026-09-15",
      horario: "10:00"
    }));
    mockEvents.push(criarEventoMock({
      id: "ev-ambiguo-2",
      data: "2026-09-15",
      horario: "10:00"
    }));

    const res = await invokeHandler({
      body: {
        acao: "cancelar",
        cpf: "123.456.789-00",
        telefone: "11999998888",
        data: "2026-09-15",
        horario: "10:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.acao, "cancelar");
    assert.ok(res.body.mensagem.includes("mais de um agendamento"));
    assert.strictEqual(deleteCalls.length, 0);
    console.log("   -> OK! Ambiguidade detectada, nenhum evento cancelado.\n");
  }

  // TESTE 7: Reagendamento para horário livre (atualização in-place sem deletar)
  {
    resetMockState();
    console.log("7. Testando reagendamento para horário livre...");
    mockEvents.push(criarEventoMock({
      id: "ev-original",
      data: "2026-09-15",
      horario: "10:00"
    }));

    const res = await invokeHandler({
      body: {
        acao: "reagendar",
        cpf: "123.456.789-00",
        telefone: "11999998888",
        dataAnterior: "2026-09-15",
        horarioAnterior: "10:00",
        novaData: "2026-10-09",
        novoHorario: "11:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      success: true,
      acao: "reagendar",
      novaData: "2026-10-09",
      novoHorario: "11:00",
      mensagem: "Agendamento reagendado com sucesso."
    });
    assert.strictEqual(deleteCalls.length, 0); // Não deve deletar
    assert.strictEqual(patchCalls.length, 1);   // Deve atualizar via PATCH
    assert.strictEqual(patchCalls[0].id, "ev-original");
    console.log("   -> OK! Atualizou in-place via PATCH com contrato exato.\n");
  }

  // TESTE 8: Reagendamento para horário ocupado
  {
    resetMockState();
    console.log("8. Testando reagendamento para horário ocupado...");
    mockEvents.push(criarEventoMock({
      id: "ev-original",
      data: "2026-09-15",
      horario: "10:00"
    }));
    // Evento de outro cliente ocupando o novo horário
    mockEvents.push(criarEventoMock({
      id: "ev-outro-cliente",
      data: "2026-10-09",
      horario: "11:00",
      cpf: "99999999999",
      telefone: "11888887777"
    }));

    const res = await invokeHandler({
      body: {
        acao: "reagendar",
        cpf: "123.456.789-00",
        telefone: "11999998888",
        dataAnterior: "2026-09-15",
        horarioAnterior: "10:00",
        novaData: "2026-10-09",
        novoHorario: "11:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.acao, "reagendar");
    assert.ok(res.body.mensagem.includes("não está disponível"));
    assert.strictEqual(patchCalls.length, 0);
    assert.strictEqual(deleteCalls.length, 0);
    console.log("   -> OK! Recusou alteração mantendo evento original intacto.\n");
  }

  // TESTE 9: Repetição da mesma requisição (idempotência)
  {
    resetMockState();
    console.log("9. Testando repetição da mesma requisição (idempotência)...");
    mockEvents.push(criarEventoMock({
      id: "ev-ja-reagendado",
      data: "2026-10-09",
      horario: "11:00"
    }));

    const res = await invokeHandler({
      body: {
        acao: "reagendar",
        cpf: "12345678900",
        telefone: "11999998888",
        dataAnterior: "2026-09-15",
        horarioAnterior: "10:00",
        novaData: "2026-10-09",
        novoHorario: "11:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.novaData, "2026-10-09");
    assert.strictEqual(res.body.novoHorario, "11:00");
    assert.strictEqual(patchCalls.length, 0); // Já estava reagendado
    console.log("   -> OK! Idempotente sem erros nem duplicatas.\n");
  }

  // TESTE 10: Data passada e horário decorrido no dia atual
  {
    resetMockState();
    console.log("10. Testando validação de data passada e horário decorrido...");
    // Tentativa com data de ontem
    const resPassada = await invokeHandler({
      body: {
        acao: "agendar",
        cpf: "12345678900",
        telefone: "11999998888",
        data: "2020-01-01",
        horario: "10:00"
      }
    });

    assert.strictEqual(resPassada.status, 200);
    assert.strictEqual(resPassada.body.success, false);
    assert.ok(resPassada.body.mensagem.includes("passada"));

    // Consulta de agendamento que inclui evento no passado
    mockEvents.push(criarEventoMock({
      id: "ev-passado",
      data: "2020-01-01",
      horario: "10:00"
    }));
    mockEvents.push(criarEventoMock({
      id: "ev-futuro",
      data: "2026-12-01",
      horario: "10:00"
    }));

    const resConsulta = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        cpf: "12345678900",
        telefone: "11999998888"
      }
    });

    assert.strictEqual(resConsulta.body.quantidade, 1);
    assert.strictEqual(resConsulta.body.evento1Data, "2026-12-01");
    console.log("   -> OK! Data passada rejeitada e excluída das consultas futuras.\n");
  }

  // TESTE 11: Falha simulada do Microsoft Graph
  {
    resetMockState();
    console.log("11. Testando falha técnica simulada do Microsoft Graph...");
    simulateGraphFailure = true;

    const res = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        cpf: "12345678900",
        telefone: "11999998888"
      }
    });

    // Erros técnicos reais devem retornar 500 ou 502
    assert.ok(res.status >= 500);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error);
    console.log(`   -> OK! Status ${res.status} retornado para falha técnica real do Graph.\n`);
  }

  console.log("=========================================");
  console.log("TODOS OS 11 TESTES PASSARAM COM SUCESSO!");
  console.log("=========================================");
}

runTests().catch(err => {
  console.error("FALHA NOS TESTES:", err);
  process.exit(1);
});