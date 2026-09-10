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
let simulateNextLink = false;

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

  // 3. CalendarView com suporte a paginação (@odata.nextLink)
  if (urlStr.includes("/calendarView")) {
    if (simulateNextLink) {
      if (urlStr.includes("page=2")) {
        // Página 2: restante dos eventos
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ value: mockEvents.slice(100) }),
          json: async () => ({ value: mockEvents.slice(100) })
        };
      } else {
        // Página 1: primeiros 100 eventos e @odata.nextLink
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            value: mockEvents.slice(0, 100),
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/mock-user/calendarView?page=2"
          }),
          json: async () => ({
            value: mockEvents.slice(0, 100),
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/mock-user/calendarView?page=2"
          })
        };
      }
    }

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
  console.log("=== INICIANDO SUÍTE COMPLETA DE TESTES DO AGENDAMENTO ===\n");

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

  function resetMockState() {
    mockEvents = [];
    patchCalls = [];
    deleteCalls = [];
    postCalls = [];
    simulateGraphFailure = false;
    simulateNextLink = false;
  }

  // 1. Cliente com zero compromissos
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
    console.log("   -> OK!\n");
  }

  // 2. Cliente com um compromisso
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
    console.log("   -> OK!\n");
  }

  // 3. Cliente com múltiplos compromissos (ordenação e DTMF)
  {
    resetMockState();
    console.log("3. Testando múltiplos compromissos (ordenação cronológica e DTMF)...");
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
    assert.strictEqual(res.body.evento1Data, "2026-09-15");
    assert.strictEqual(res.body.evento1Horario, "09:00");
    assert.strictEqual(res.body.evento2Data, "2026-10-09");
    assert.strictEqual(res.body.evento2Horario, "14:00");
    assert.ok(res.body.mensagem.includes("Encontrei dois agendamentos"));
    assert.ok(res.body.mensagem.includes("pressione 1"));
    assert.ok(res.body.mensagem.includes("pressione 2"));
    console.log("   -> OK!\n");
  }

  // 4. Cancelamento de compromisso específico
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
    console.log("   -> OK!\n");
  }

  // 5. Tentativa de cancelar compromisso inexistente
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
    console.log("   -> OK!\n");
  }

  // 6. Resultado ambíguo sem cancelamento
  {
    resetMockState();
    console.log("6. Testando resultado ambíguo sem cancelamento...");
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
    console.log("   -> OK!\n");
  }

  // 7. Reagendamento para horário livre (atualização in-place)
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
    assert.strictEqual(deleteCalls.length, 0);
    assert.strictEqual(patchCalls.length, 1);
    assert.strictEqual(patchCalls[0].id, "ev-original");
    console.log("   -> OK!\n");
  }

  // 8. Reagendamento para horário ocupado
  {
    resetMockState();
    console.log("8. Testando reagendamento para horário ocupado...");
    mockEvents.push(criarEventoMock({
      id: "ev-original",
      data: "2026-09-15",
      horario: "10:00"
    }));
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
    console.log("   -> OK!\n");
  }

  // 9. Repetição da mesma requisição de reagendamento (idempotência)
  {
    resetMockState();
    console.log("9. Testando repetição de requisição de reagendamento...");
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
    assert.strictEqual(patchCalls.length, 0);
    console.log("   -> OK!\n");
  }

  // 10. Agendamento novo bem-sucedido em horário livre e contrato completo
  {
    resetMockState();
    console.log("10. Testando agendamento novo bem-sucedido em horário livre...");
    const res = await invokeHandler({
      body: {
        acao: "agendar",
        nome: "Maria Silva",
        cpf: "123.456.789-00",
        telefone: "+55 (11) 99999-8888",
        data: "2026-11-20",
        horario: "14:00",
        conversationSpaceId: "conv-12345",
        callReason: "Consulta inicial"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.acao, "agendar");
    assert.strictEqual(res.body.data, "2026-11-20");
    assert.strictEqual(res.body.horario, "14:00");
    assert.ok(res.body.eventoId);
    assert.ok(res.body.mensagem);
    assert.strictEqual(postCalls.length, 1);
    assert.ok(postCalls[0].body.content.includes("ConversationSpaceId: conv-12345"));
    assert.ok(postCalls[0].body.content.includes("Motivo identificado pela IA: Consulta inicial"));
    console.log("   -> OK! Criou evento via POST, sem erro de conversationSpaceId e com contrato obrigatório.\n");
  }

  // 11. Repetição do mesmo agendamento sem duplicação (idempotência do agendar)
  {
    console.log("11. Testando repetição do mesmo agendamento sem duplicação...");
    const postCallsAntes = postCalls.length;
    const res = await invokeHandler({
      body: {
        acao: "agendar",
        nome: "Maria Silva",
        cpf: "12345678900",
        telefone: "11999998888",
        data: "2026-11-20",
        horario: "14:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data, "2026-11-20");
    assert.strictEqual(res.body.horario, "14:00");
    assert.strictEqual(postCalls.length, postCallsAntes); // Não criou outro POST
    console.log("   -> OK! Idempotência em agendar confirmada sem duplicatas.\n");
  }

  // 12. Paginação do Microsoft Graph com mais de 100 eventos
  {
    resetMockState();
    console.log("12. Testando paginação do Microsoft Graph (@odata.nextLink com > 100 eventos)...");
    simulateNextLink = true;

    // Criar 100 eventos genéricos de outros clientes
    for (let i = 1; i <= 100; i++) {
      mockEvents.push(criarEventoMock({
        id: `ev-outro-${i}`,
        data: "2026-10-15",
        horario: "10:00",
        cpf: "99999999999",
        telefone: "11888887777"
      }));
    }

    // Criar o evento do cliente alvo na segunda página (> 100)
    mockEvents.push(criarEventoMock({
      id: "ev-alvo-pagina-2",
      data: "2026-11-05",
      horario: "15:00",
      cpf: "12345678900",
      telefone: "11999998888"
    }));

    const res = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        cpf: "12345678900",
        telefone: "11999998888"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.quantidade, 1);
    assert.strictEqual(res.body.evento1Id, "ev-alvo-pagina-2");
    assert.strictEqual(res.body.evento1Data, "2026-11-05");
    assert.strictEqual(res.body.evento1Horario, "15:00");
    console.log("   -> OK! Paginação recuperou o evento na página 2 após os 100 primeiros.\n");
  }

  // 13. Correspondência segura: CPF correto com telefone de outro cliente
  {
    resetMockState();
    console.log("13. Testando correspondência segura: CPF correto e telefone de outro cliente...");
    mockEvents.push(criarEventoMock({
      id: "ev-cliente-a",
      data: "2026-10-20",
      horario: "10:00",
      cpf: "11111111111",
      telefone: "11999991111"
    }));
    mockEvents.push(criarEventoMock({
      id: "ev-cliente-b",
      data: "2026-10-20",
      horario: "14:00",
      cpf: "22222222222",
      telefone: "11999992222"
    }));

    // Busca fornecendo CPF de A e telefone de B: NÃO deve encontrar nenhum
    const res = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        cpf: "11111111111",
        telefone: "11999992222"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.quantidade, 0);
    console.log("   -> OK! Rejeitou correspondência cruzada de clientes distintos.\n");
  }

  // 14. Correspondência segura: Normalização com código de país (+55) presente e ausente
  {
    resetMockState();
    console.log("14. Testando correspondência com código de país (+55) presente/ausente...");
    mockEvents.push(criarEventoMock({
      id: "ev-tel-55",
      data: "2026-10-20",
      horario: "10:00",
      cpf: "12345678900",
      telefone: "+55 (11) 99999-8888"
    }));

    // Busca sem o 55
    const resSem55 = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        telefone: "11999998888"
      }
    });
    assert.strictEqual(resSem55.body.quantidade, 1);
    assert.strictEqual(resSem55.body.evento1Id, "ev-tel-55");

    // Busca com o 55
    const resCom55 = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        telefone: "5511999998888"
      }
    });
    assert.strictEqual(resCom55.body.quantidade, 1);
    assert.strictEqual(resCom55.body.evento1Id, "ev-tel-55");
    console.log("   -> OK! Tratou variação de código de país 55 com exatidão.\n");
  }

  // 15. Correspondência segura: Identificadores incompletos/curtos
  {
    resetMockState();
    console.log("15. Testando identificadores incompletos ou curtos...");
    mockEvents.push(criarEventoMock({
      id: "ev-tel-1",
      data: "2026-10-20",
      horario: "10:00",
      cpf: "12345678900",
      telefone: "11999998888"
    }));

    // Telefone curto (ex: 4 dígitos)
    const resCurto = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        telefone: "8888"
      }
    });
    assert.strictEqual(resCurto.body.quantidade, 0);

    // CPF curto (menos de 11 dígitos)
    const resCpfCurto = await invokeHandler({
      body: {
        acao: "consultar_agendamentos",
        cpf: "12345"
      }
    });
    assert.strictEqual(resCpfCurto.body.quantidade, 0);
    console.log("   -> OK! Identificadores incompletos foram desconsiderados com segurança.\n");
  }

  // 16. Validação real de datas (30 de fevereiro, mês 13, dia zero, ano bissexto)
  {
    resetMockState();
    console.log("16. Testando validação estrita de datas reais de calendário...");

    // 30 de fevereiro
    const resFeb30 = await invokeHandler({
      body: {
        acao: "consultar_disponibilidade",
        data: "2026-02-30"
      }
    });
    assert.strictEqual(resFeb30.body.success, false);
    assert.ok(resFeb30.body.mensagem.includes("Data inválida"));

    // Mês 13
    const resMes13 = await invokeHandler({
      body: {
        acao: "consultar_disponibilidade",
        data: "2026-13-10"
      }
    });
    assert.strictEqual(resMes13.body.success, false);

    // Dia zero
    const resDia0 = await invokeHandler({
      body: {
        acao: "consultar_disponibilidade",
        data: "2026-10-00"
      }
    });
    assert.strictEqual(resDia0.body.success, false);

    // Ano não bissexto (2026-02-29 deve ser inválido)
    const resFeb29NaoBissexto = await invokeHandler({
      body: {
        acao: "consultar_disponibilidade",
        data: "2026-02-29"
      }
    });
    assert.strictEqual(resFeb29NaoBissexto.body.success, false);

    // Ano bissexto futuro (2028-02-29 deve ser válido)
    const resFeb29Bissexto = await invokeHandler({
      body: {
        acao: "consultar_disponibilidade",
        data: "2028-02-29"
      }
    });
    assert.strictEqual(resFeb29Bissexto.body.success, true);
    console.log("   -> OK! Todas as validações de datas reais de calendário passaram.\n");
  }

  // 17. Falha simulada do Microsoft Graph e sanitização de erros técnicos
  {
    resetMockState();
    console.log("17. Testando falha técnica simulada do Graph e mensagens limpas...");
    simulateGraphFailure = true;

    const res = await invokeHandler({
      body: {
        acao: "agendar",
        nome: "Teste Falha",
        cpf: "12345678900",
        telefone: "11999998888",
        data: "2026-11-20",
        horario: "10:00"
      }
    });

    assert.ok(res.status >= 500);
    assert.strictEqual(res.body.success, false);
    // Não deve conter detalhes brutos nem vazar mensagens internas do Graph
    assert.strictEqual(res.body.details, undefined);
    assert.ok(res.body.error);
    console.log(`   -> OK! Status ${res.status} retornado com mensagem de erro limpa.\n`);
  }

  // 18. Montagem do payload do evento Graph (Assunto, Corpo com Nome, CPF, Telefone, Data pt-BR, Horário)
  {
    resetMockState();
    console.log("18. Testando montagem precisa do payload Graph (Assunto e Corpo com Nome, CPF e Telefone formatados)...");

    const res = await invokeHandler({
      body: {
        acao: "agendar",
        nome: "Carlos Eduardo",
        cpf: "12345678900",
        telefone: "19986008812",
        data: "2026-11-25",
        horario: "15:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(postCalls.length, 1);

    const eventoCriado = postCalls[0];

    // Validação do Assunto
    assert.strictEqual(eventoCriado.subject, "Agendamento GoTo - Carlos Eduardo");
    assert.strictEqual(eventoCriado.subject.includes("12345678900"), false); // Não duplicar dados no assunto
    assert.strictEqual(eventoCriado.subject.includes("19986008812"), false);

    // Validação do Corpo
    const corpo = eventoCriado.body?.content || "";
    assert.ok(corpo.includes("Agendamento realizado via GoTo"), "Deve conter cabeçalho padrão");
    assert.ok(corpo.includes("Nome: Carlos Eduardo"), "Deve conter Nome");
    assert.ok(corpo.includes("CPF: 123.456.789-00"), "CPF deve estar formatado com 11 dígitos");
    assert.ok(corpo.includes("Telefone: (19) 98600-8812"), "Telefone brasileiro deve estar formatado (19) 98600-8812");
    assert.ok(corpo.includes("Data: 25/11/2026"), "Data deve estar formatada em pt-BR");
    assert.ok(corpo.includes("Horário: 15:00"), "Deve conter Horário");

    // Validação de segurança (sem credenciais ou dados técnicos no corpo)
    assert.strictEqual(corpo.includes("mock-secret"), false);
    assert.strictEqual(corpo.includes("mock-tenant"), false);
    assert.strictEqual(corpo.includes("mock-client"), false);
    assert.strictEqual(corpo.includes("test-secret-key"), false);

    // Validação de propriedades preservadas
    assert.strictEqual(eventoCriado.showAs, "busy");
    assert.strictEqual(eventoCriado.start.dateTime, "2026-11-25T15:00:00");
    assert.ok(eventoCriado.end.dateTime);

    console.log("   -> OK! Assunto e corpo formatados rigorosamente conforme especificação.\n");
  }

  // 19. Resiliência: agendamento com CPF e telefone ausentes
  {
    resetMockState();
    console.log("19. Testando agendamento resiliente com CPF e telefone ausentes...");

    const res = await invokeHandler({
      body: {
        acao: "agendar",
        nome: "Ana Beatriz",
        data: "2026-11-26",
        horario: "16:00"
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(postCalls.length, 1);

    const eventoCriado = postCalls[0];
    assert.strictEqual(eventoCriado.subject, "Agendamento GoTo - Ana Beatriz");

    const corpo = eventoCriado.body?.content || "";
    assert.ok(corpo.includes("Agendamento realizado via GoTo"));
    assert.ok(corpo.includes("Nome: Ana Beatriz"));
    assert.ok(corpo.includes("CPF: Não informado"));
    assert.ok(corpo.includes("Telefone: Não informado"));
    assert.ok(corpo.includes("Data: 26/11/2026"));
    assert.ok(corpo.includes("Horário: 16:00"));

    console.log("   -> OK! CPF e telefone ausentes tratados sem quebrar agendamento.\n");
  }

  // 20. Validação direta dos formatadores
  {
    console.log("20. Testando funções auxiliares de formatação diretamente...");
    assert.strictEqual(handler.formatarCpfExibicao("12345678900"), "123.456.789-00");
    assert.strictEqual(handler.formatarCpfExibicao("123.456.789-00"), "123.456.789-00");
    assert.strictEqual(handler.formatarCpfExibicao(""), "Não informado");
    assert.strictEqual(handler.formatarCpfExibicao(null), "Não informado");

    assert.strictEqual(handler.formatarTelefoneExibicao("19986008812"), "(19) 98600-8812");
    assert.strictEqual(handler.formatarTelefoneExibicao("+5519986008812"), "(19) 98600-8812");
    assert.strictEqual(handler.formatarTelefoneExibicao("5519986008812"), "(19) 98600-8812");
    assert.strictEqual(handler.formatarTelefoneExibicao("1938008812"), "(19) 3800-8812");
    assert.strictEqual(handler.formatarTelefoneExibicao(""), "Não informado");
    assert.strictEqual(handler.formatarTelefoneExibicao(null), "Não informado");

    assert.strictEqual(handler.formatarDataPtBr("2026-09-15"), "15/09/2026");
    assert.strictEqual(handler.formatarDataPtBr("15/09/2026"), "15/09/2026");
    assert.strictEqual(handler.formatarDataPtBr(""), "");
    console.log("   -> OK! Todos os formatadores validados unitariamente.\n");
  }

  console.log("=================================================");
  console.log("TODOS OS 20 TESTES FORAM EXECUTADOS COM SUCESSO!");
  console.log("=================================================");
}

runTests().catch(err => {
  console.error("FALHA NOS TESTES:", err);
  process.exit(1);
});