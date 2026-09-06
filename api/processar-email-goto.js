// api/processar-email-goto.js
const crypto = require("crypto");

// TODO: trocar para POST antes de produção

const MAILBOX_ID = "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";
const GRAPH_TIMEZONE = "E. South America Standard Time";
const OFFSET = "-03:00";
const DURACAO_MINUTOS = 60;

function formatarCpf(c) {
  const cLimpo = String(c).replace(/\D/g, "");
  if (cLimpo.length === 11) {
    return cLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return c;
}

function somarMinutosLocal(data, horario, minutosAdicionar) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const [hora, minuto] = horario.split(":").map(Number);
  const calculo = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto, 0));
  calculo.setUTCMinutes(calculo.getUTCMinutes() + minutosAdicionar);
  const dataFinal = `${calculo.getUTCFullYear()}-${String(calculo.getUTCMonth() + 1).padStart(2, "0")}-${String(calculo.getUTCDate()).padStart(2, "0")}`;
  const horarioFinal = `${String(calculo.getUTCHours()).padStart(2, "0")}:${String(calculo.getUTCMinutes()).padStart(2, "0")}`;
  return {
    data: dataFinal,
    horario: horarioFinal,
    dateTime: `${dataFinal}T${horarioFinal}:00`
  };
}

async function obterAccessTokenGraph() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("AZURE_TENANT_ID, AZURE_CLIENT_ID ou AZURE_CLIENT_SECRET não configurados");
  }
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || "Erro ao obter token do Graph");
  }
  return data.access_token;
}

async function graphRequest({ accessToken, url, method = "GET", body = null, headers = {} }) {
  const reqHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Prefer: `outlook.timezone="${GRAPH_TIMEZONE}"`,
    ...headers
  };
  if (body !== null) reqHeaders["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) return { ok: true, status: 204, data: null };
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function consultarCalendarView({ accessToken, inicio, fim, select = "id,subject,start,end,isAllDay,bodyPreview,webLink" }) {
  const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/calendarView?startDateTime=${encodeURIComponent(inicio)}&endDateTime=${encodeURIComponent(fim)}&$top=100&$select=${encodeURIComponent(select)}`;
  const resultado = await graphRequest({ accessToken, url });
  if (!resultado.ok) throw new Error(`Erro ao consultar calendário ${resultado.status}: ${JSON.stringify(resultado.data)}`);
  return Array.isArray(resultado.data?.value) ? resultado.data.value : [];
}

async function verificarIntervaloLivre({ accessToken, data, horario, duracaoMinutos = DURACAO_MINUTOS }) {
  const fimCalculado = somarMinutosLocal(data, horario, duracaoMinutos);
  const inicioConsulta = `${data}T${horario}:00${OFFSET}`;
  const fimConsulta = `${fimCalculado.data}T${fimCalculado.horario}:00${OFFSET}`;
  const eventos = await consultarCalendarView({ accessToken, inicio: inicioConsulta, fim: fimConsulta });
  return { livre: eventos.length === 0, conflitos: eventos, fim: fimCalculado };
}

function decodeHtmlEntities(text) {
  if (!text) return "";
  return text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseEmailHtml(htmlString) {
  const dados = { nome: null, cpf: null, telefone: null, data: null, horario: null };
  if (!htmlString) return dados;
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(htmlString)) !== null) {
    const trContent = trMatch[1];
    const tds = [];
    let tdMatch;
    tdRegex.lastIndex = 0;
    while ((tdMatch = tdRegex.exec(trContent)) !== null) {
      let text = tdMatch[1].replace(/<[^>]+>/g, "");
      text = decodeHtmlEntities(text).trim();
      tds.push(text);
    }
    if (tds.length >= 2) {
      const key = tds[0].toLowerCase();
      let val = tds[1].trim();
      if (key.includes("horario_escolhido")) dados.horario = val;
      else if (key.includes("nome_cliente")) dados.nome = val;
      else if (key.includes("cpf_cliente")) dados.cpf = val;
      else if (key.includes("data_escolhida")) dados.data = val;
      else if (key.includes("numero de telefone") || key.includes("número de telefone")) dados.telefone = val;
    }
  }
  if (dados.telefone) dados.telefone = dados.telefone.replace(/[^\d+]/g, "");
  if (dados.data) {
    const d = dados.data.match(/(\d{4}-\d{2}-\d{2})/);
    if (d) dados.data = d[1];
    else dados.data = null;
  }
  if (dados.horario) {
    const h = dados.horario.match(/(\d{2}:\d{2})/);
    if (h) dados.horario = h[1];
    else dados.horario = null;
  }
  return dados;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido. Use GET temporariamente."
      });
    }

    const accessToken = await obterAccessTokenGraph();
    console.log("TOKEN GRAPH OK");
    console.log("BUSCANDO EMAILS GOTO");

    const endpoint = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/mailFolders/inbox/messages?$top=20&$select=id,subject,receivedDateTime,from,body,bodyPreview&$orderby=receivedDateTime desc`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      let errorData;
      try { errorData = await response.json(); } catch { errorData = await response.text(); }
      return res.status(response.status).json({ success: false, stage: "graph", error: errorData });
    }

    const data = await response.json();
    const gotoMsg = (data.value || []).find(msg => {
      const emailAddress = msg.from?.emailAddress?.address || "";
      return emailAddress.toLowerCase() === "noreply@dwf.goto.com";
    });

    if (!gotoMsg) {
      return res.status(200).json({
        success: false,
        processed: false,
        reason: "email_nao_encontrado"
      });
    }

    console.log("EMAIL GOTO ENCONTRADO");
    const htmlContent = gotoMsg.body?.content || "";
    const dadosExtraidos = parseEmailHtml(htmlContent);

    const camposEncontrados = {
      nome: !!dadosExtraidos.nome,
      cpf: !!dadosExtraidos.cpf,
      telefone: !!dadosExtraidos.telefone,
      data: !!dadosExtraidos.data,
      horario: !!dadosExtraidos.horario
    };

    const todosEncontrados = camposEncontrados.nome && camposEncontrados.cpf && camposEncontrados.telefone && camposEncontrados.data && camposEncontrados.horario;

    if (!todosEncontrados) {
      return res.status(200).json({
        success: false,
        processed: false,
        reason: "campos_incompletos",
        camposEncontrados
      });
    }

    console.log("DADOS DO AGENDAMENTO EXTRAIDOS");
    const gotoCaptureId = crypto.createHash("sha256").update(gotoMsg.id).digest("hex");
    console.log("VERIFICANDO DUPLICIDADE");

    // Usa $search e ConsistencyLevel para encontrar eventos que contenham a hash globalmente
    const searchUrl = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events?$search="GoToCaptureId: ${gotoCaptureId}"`;
    const searchResponse = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "ConsistencyLevel": "eventual",
        "Content-Type": "application/json"
      }
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData.value && searchData.value.length > 0) {
        console.log("CAPTURA JA PROCESSADA");
        return res.status(200).json({
          success: true,
          processed: false,
          alreadyProcessed: true,
          eventoId: searchData.value[0].id,
          message: "Esta captura GoTo já foi processada."
        });
      }
    }
    
    // Fallback síncrono para evitar duplicidade devido a delay de indexação do $search
    const inicioCheck = `${dadosExtraidos.data}T00:00:00${OFFSET}`;
    
    // Calcula dia seguinte
    const [ano, mes, dia] = dadosExtraidos.data.split("-").map(Number);
    const dateObj = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
    dateObj.setUTCDate(dateObj.getUTCDate() + 1);
    const nextDateStr = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, "0")}-${String(dateObj.getUTCDate()).padStart(2, "0")}`;
    const fimCheck = `${nextDateStr}T00:00:00${OFFSET}`;
    
    const fallbackEventos = await consultarCalendarView({ 
      accessToken, 
      inicio: inicioCheck, 
      fim: fimCheck,
      select: "id,subject,body,bodyPreview,start,end,isAllDay,webLink"
    });
    
    const jaExiste = fallbackEventos.find(e => {
      const conteudoCompleto = e.body?.content || "";
      const preview = e.bodyPreview || "";
      return conteudoCompleto.includes(gotoCaptureId) || 
             preview.includes(gotoCaptureId) ||
             conteudoCompleto.includes(gotoMsg.id) || 
             preview.includes(gotoMsg.id);
    });
    
    if (jaExiste) {
      console.log("CAPTURA JA PROCESSADA");
      return res.status(200).json({
        success: true,
        processed: false,
        alreadyProcessed: true,
        eventoId: jaExiste.id,
        message: "Esta captura GoTo já foi processada."
      });
    }

    console.log("CAPTURA AINDA NAO PROCESSADA");
    console.log("VERIFICANDO DISPONIBILIDADE");
    const disponibilidade = await verificarIntervaloLivre({
      accessToken,
      data: dadosExtraidos.data,
      horario: dadosExtraidos.horario
    });

    if (!disponibilidade.livre) {
      return res.status(200).json({
        success: false,
        processed: false,
        reason: "horario_indisponivel",
        data: dadosExtraidos.data,
        horario: dadosExtraidos.horario
      });
    }

    console.log("CRIANDO EVENTO OUTLOOK");
    
    const partesData = dadosExtraidos.data.split("-");
    const dataExibicao = partesData.length === 3 ? `${partesData[2]}/${partesData[1]}/${partesData[0]}` : dadosExtraidos.data;
    const cpfFormatado = formatarCpf(dadosExtraidos.cpf);

    const descricao = [
      "Agendamento criado automaticamente pela integração GoTo.",
      "",
      `Nome: ${dadosExtraidos.nome}`,
      `CPF: ${cpfFormatado}`,
      `Telefone: ${dadosExtraidos.telefone}`,
      "",
      `Data: ${dataExibicao}`,
      `Horário: ${dadosExtraidos.horario}`,
      "Origem: GoTo IA Recepcionista",
      `GoToCaptureId: ${gotoCaptureId}`,
      `GoToMessageId: ${gotoMsg.id}`
    ].join("\n");

    const inicio = `${dadosExtraidos.data}T${dadosExtraidos.horario}:00`;
    const fim = disponibilidade.fim.dateTime;

    const eventoPayload = {
      subject: `Agendamento GoTo - ${dadosExtraidos.nome}`,
      body: {
        contentType: "Text",
        content: descricao
      },
      start: {
        dateTime: inicio,
        timeZone: GRAPH_TIMEZONE
      },
      end: {
        dateTime: fim,
        timeZone: GRAPH_TIMEZONE
      },
      showAs: "busy"
    };

    const createUrl = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events`;
    const createResult = await graphRequest({
      accessToken,
      url: createUrl,
      method: "POST",
      body: eventoPayload
    });

    if (!createResult.ok) {
      throw new Error(`Erro ao criar evento: ${JSON.stringify(createResult.data)}`);
    }

    console.log("EVENTO CRIADO COM SUCESSO");
    
    if (dadosExtraidos.cpf) {
      const cpfLength = dadosExtraidos.cpf.length;
      console.log(`CPF processado: ***${dadosExtraidos.cpf.substring(cpfLength - 2)}`);
    }

    return res.status(200).json({
      success: true,
      processed: true,
      alreadyProcessed: false,
      eventoId: createResult.data.id,
      data: dadosExtraidos.data,
      horario: dadosExtraidos.horario,
      nome: dadosExtraidos.nome
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      processed: false,
      error: error.message
    });
  }
};
