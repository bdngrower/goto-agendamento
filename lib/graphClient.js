// ============================================================
// CLIENTE DINÂMICO DO MICROSOFT GRAPH POR EMPRESA
// ============================================================

/**
 * Obtém token OAuth2 client_credentials do Azure Entra ID para a empresa.
 * NUNCA loga o token em texto puro.
 */
async function obterAccessTokenGraph(conexaoM365) {
  if (!conexaoM365) {
    throw new Error("Conexão Microsoft 365 não configurada para a empresa.");
  }

  const tenantId = conexaoM365.tenant_id || conexaoM365.azure_tenant_id || conexaoM365.azureTenantId;
  const clientId = process.env.M365_APP_CLIENT_ID || conexaoM365.azure_client_id || conexaoM365.azureClientId || process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.M365_APP_CLIENT_SECRET || conexaoM365.clientSecret || process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Credenciais do Microsoft 365 incompletas (Tenant ID da empresa ou Credenciais Globais do App Registration ausentes).");
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    }
  );

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!response.ok) {
    const erroDesc = data?.error_description || data?.error || `HTTP ${response.status}`;
    // Erro amigável sem vazar respostas brutas
    throw new Error(`Falha de autenticação Azure Entra ID (${response.status}): ${erroDesc.split("\r\n")[0]}`);
  }

  if (!data?.access_token) {
    throw new Error("Token de acesso OAuth2 não retornado pelo Microsoft Entra ID.");
  }

  return data.access_token;
}

/**
 * Executa uma chamada HTTP genérica ao Microsoft Graph.
 */
async function graphRequest({
  accessToken,
  url,
  method = "GET",
  body = null,
  fusoHorario = "America/Sao_Paulo"
}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Prefer: `outlook.timezone="${fusoHorario}"`
  };

  if (body !== null) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });

  if (response.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

/**
 * Consulta a CalendarView da caixa postal com suporte a paginação (@odata.nextLink).
 */
async function consultarCalendarView({
  accessToken,
  mailboxEmail,
  inicio,
  fim,
  fusoHorario = "America/Sao_Paulo",
  select = "id,subject,start,end,isAllDay,bodyPreview,body,webLink"
}) {
  if (!mailboxEmail) {
    throw new Error("Mailbox do Microsoft 365 não especificado");
  }

  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/calendarView` +
    `?startDateTime=${encodeURIComponent(inicio)}` +
    `&endDateTime=${encodeURIComponent(fim)}` +
    `&$top=100` +
    `&$select=${encodeURIComponent(select)}`;

  const todosEventos = [];
  let iteracoes = 0;
  const MAX_ITERACOES = 20; // Limite de 2000 eventos para segurança

  while (url && iteracoes < MAX_ITERACOES) {
    iteracoes++;

    const resultado = await graphRequest({
      accessToken,
      url,
      fusoHorario
    });

    if (!resultado.ok) {
      const msgErro = resultado.data?.error?.message || `HTTP ${resultado.status}`;
      throw new Error(`Erro ao consultar calendário (${resultado.status}): ${msgErro}`);
    }

    if (Array.isArray(resultado.data?.value)) {
      todosEventos.push(...resultado.data.value);
    }

    url = resultado.data?.["@odata.nextLink"] || null;
  }

  return todosEventos;
}

/**
 * Cria um novo compromisso na caixa postal da empresa.
 */
async function criarEvento({
  accessToken,
  mailboxEmail,
  evento,
  fusoHorario = "America/Sao_Paulo"
}) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/calendar/events`;
  const res = await graphRequest({
    accessToken,
    url,
    method: "POST",
    body: evento,
    fusoHorario
  });

  if (!res.ok) {
    const msgErro = res.data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Erro ao criar evento no Graph (${res.status}): ${msgErro}`);
  }

  return res.data;
}

/**
 * Atualiza um compromisso existente via PATCH no Microsoft Graph.
 */
async function atualizarEvento({
  accessToken,
  mailboxEmail,
  eventoId,
  alteracoes,
  fusoHorario = "America/Sao_Paulo"
}) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventoId}`;
  const res = await graphRequest({
    accessToken,
    url,
    method: "PATCH",
    body: alteracoes,
    fusoHorario
  });

  if (!res.ok) {
    const msgErro = res.data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Erro ao atualizar evento no Graph (${res.status}): ${msgErro}`);
  }

  return res.data;
}

/**
 * Cancela/deleta um compromisso no Microsoft Graph.
 */
async function cancelarEvento({
  accessToken,
  mailboxEmail,
  eventoId
}) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventoId}`;
  const res = await graphRequest({
    accessToken,
    url,
    method: "DELETE"
  });

  if (!res.ok) {
    const msgErro = res.data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Erro ao cancelar evento no Graph (${res.status}): ${msgErro}`);
  }

  return true;
}

// ============================================================
// VALIDAÇÕES SEPARADAS DO MICROSOFT 365 (AUTENTICAÇÃO, LEITURA, GRAVAÇÃO)
// ============================================================

/**
 * 1. TESTE DE AUTENTICAÇÃO:
 * Valida exclusivamente Tenant ID, Client ID, Client Secret e obtenção do token.
 * Totalmente seguro: NUNCA loga o token ou a resposta bruta do OAuth.
 */
async function testarAutenticacaoM365(conexaoM365) {
  const t0 = Date.now();
  try {
    const token = await obterAccessTokenGraph(conexaoM365);
    const tempoMs = Date.now() - t0;
    return {
      sucesso: Boolean(token),
      tempoMs,
      mensagem: `Autenticação app-only no Microsoft Entra ID bem-sucedida (${tempoMs}ms).`
    };
  } catch (err) {
    return {
      sucesso: false,
      tempoMs: Date.now() - t0,
      erro: err.message
    };
  }
}

/**
 * 2. TESTE DE LEITURA (SOMENTE LEITURA):
 * Valida consulta a calendarView da mailbox configurada.
 * Totalmente não destrutivo.
 */
async function testarLeituraM365(conexaoM365) {
  const t0 = Date.now();
  try {
    const accessToken = await obterAccessTokenGraph(conexaoM365);
    const mailbox = conexaoM365.mailbox_email || conexaoM365.mailboxEmail;
    if (!mailbox) {
      throw new Error("Mailbox da empresa não informado.");
    }

    const agora = new Date();
    const fim = new Date(agora.getTime() + 60 * 1000);

    const res = await graphRequest({
      accessToken,
      url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendarView?startDateTime=${encodeURIComponent(agora.toISOString())}&endDateTime=${encodeURIComponent(fim.toISOString())}&$top=1`,
      method: "GET"
    });

    const tempoMs = Date.now() - t0;

    if (!res.ok) {
      const msgErro = res.data?.error?.message || `HTTP ${res.status}`;
      return {
        sucesso: false,
        tempoMs,
        erro: `Falha na permissão de leitura (${res.status}): ${msgErro}`
      };
    }

    return {
      sucesso: true,
      mailbox,
      tempoMs,
      mensagem: `Leitura da agenda de ${mailbox} validada com sucesso via calendarView (${tempoMs}ms).`
    };
  } catch (err) {
    return {
      sucesso: false,
      tempoMs: Date.now() - t0,
      erro: err.message
    };
  }
}

/**
 * 3. TESTE DE GRAVAÇÃO (EXPLÍCITO E EFÊMERO):
 * Cria um evento temporário claramente identificado como teste técnico, com status livre,
 * e remove-o imediatamente, confirmando a exclusão.
 */
async function testarGravacaoM365(conexaoM365) {
  const t0 = Date.now();
  let eventoCriadoId = null;
  const mailbox = conexaoM365.mailbox_email || conexaoM365.mailboxEmail;

  try {
    const accessToken = await obterAccessTokenGraph(conexaoM365);
    if (!mailbox) {
      throw new Error("Mailbox da empresa não informado.");
    }

    const inicio = new Date(Date.now() + 3600 * 1000); // 1h no futuro
    const fim = new Date(inicio.getTime() + 15 * 60 * 1000); // 15 minutos

    // Criação de evento técnico efêmero
    const eventoTeste = {
      subject: "[TESTE-TECNICO-GOTO] Validacao de Permissao de Gravacao",
      body: {
        contentType: "Text",
        content: "Evento temporario gerado pelo painel administrativo para validar a permissao de gravacao. Sera removido imediatamente."
      },
      start: {
        dateTime: inicio.toISOString().substring(0, 19),
        timeZone: "UTC"
      },
      end: {
        dateTime: fim.toISOString().substring(0, 19),
        timeZone: "UTC"
      },
      showAs: "free", // Marca como livre para não ocupar agenda real
      isReminderOn: false
    };

    const criado = await criarEvento({
      accessToken,
      mailboxEmail: mailbox,
      evento: eventoTeste,
      fusoHorario: "UTC"
    });

    eventoCriadoId = criado.id;

    // Remove imediatamente o evento
    await cancelarEvento({
      accessToken,
      mailboxEmail: mailbox,
      eventoId: eventoCriadoId
    });

    const tempoMs = Date.now() - t0;
    return {
      sucesso: true,
      eventoCriadoId,
      eventoRemovido: true,
      tempoMs,
      mensagem: `Gravação e exclusão imediata validadas com sucesso na agenda de ${mailbox} (${tempoMs}ms).`
    };
  } catch (err) {
    // Alerta caso a criação tenha ocorrido mas a remoção tenha falhado
    if (eventoCriadoId) {
      console.error(`ALERTA ADMINISTRATIVO: Evento técnico ${eventoCriadoId} criado na mailbox ${mailbox} não pôde ser removido automaticamente: ${err.message}`);
    }
    return {
      sucesso: false,
      eventoCriadoId,
      eventoRemovido: false,
      tempoMs: Date.now() - t0,
      erro: err.message
    };
  }
}

/**
 * Pesquisa ou valida uma mailbox no Microsoft Graph com princípio de privilégio mínimo.
 * Se houver permissão de diretório (User.Read.All/User.ReadBasic.All), faz busca parcial.
 * Se a permissão for restrita via Application RBAC no Exchange, valida diretamente o acesso ao calendário daquela mailbox.
 */
async function buscarOuValidarMailbox({ conexaoM365, query }) {
  if (!conexaoM365) throw new Error("Conexão Microsoft 365 não configurada.");
  const q = String(query || "").trim();
  if (!q) throw new Error("Informe um e-mail ou termo de busca para a caixa de agenda.");

  const accessToken = await obterAccessTokenGraph(conexaoM365);
  const resultados = [];

  // 1. Tentar busca se o termo não contiver '@'
  if (!q.includes("@")) {
    try {
      const resSearch = await graphRequest({
        accessToken,
        url: `https://graph.microsoft.com/v1.0/users?$filter=startswith(mail,'${encodeURIComponent(q)}') or startswith(userPrincipalName,'${encodeURIComponent(q)}') or startswith(displayName,'${encodeURIComponent(q)}')&$select=id,displayName,mail,userPrincipalName&$top=5`,
        method: "GET"
      });
      if (resSearch.ok && Array.isArray(resSearch.data?.value) && resSearch.data.value.length > 0) {
        for (const u of resSearch.data.value) {
          const email = u.mail || u.userPrincipalName;
          if (email) {
            resultados.push({
              id: u.id,
              email: email.toLowerCase(),
              displayName: u.displayName || email,
              validado: true,
              origem: "diretorio"
            });
          }
        }
        if (resultados.length > 0) return resultados;
      }
    } catch (e) {
      // Ignora 403 Forbidden se o tenant optar por não conceder User.Read.All
    }
  }

  // 2. Validação direta de mailbox (escopo granular Exchange Application RBAC)
  const emailAlvo = q.toLowerCase();
  try {
    const resCal = await graphRequest({
      accessToken,
      url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(emailAlvo)}/calendar`,
      method: "GET"
    });
    if (resCal.ok && resCal.data && (resCal.data.id || resCal.data.name || resCal.data.owner)) {
      return [{
        id: resCal.data.id || emailAlvo,
        email: emailAlvo,
        displayName: resCal.data.name || emailAlvo,
        validado: true,
        origem: "rbac_direto"
      }];
    }
  } catch (err) {
    throw new Error(`Não foi possível acessar a caixa postal ${emailAlvo} no Microsoft 365: ${err.message}`);
  }

  return [];
}

const testarConexaoM365 = testarLeituraM365;

module.exports = {
  obterAccessTokenGraph,
  graphRequest,
  consultarCalendarView,
  criarEvento,
  atualizarEvento,
  cancelarEvento,
  testarAutenticacaoM365,
  testarLeituraM365,
  testarGravacaoM365,
  testarConexaoM365,
  buscarOuValidarMailbox
};
