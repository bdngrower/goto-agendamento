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

async function verificarIntervaloLivre({ accessToken, data, horario, duracaoMinutos = DURACAO_MINUTOS, ignoreEventId = null }) {
  const fimCalculado = somarMinutosLocal(data, horario, duracaoMinutos);
  const inicioConsulta = `${data}T${horario}:00${OFFSET}`;
  const fimConsulta = `${fimCalculado.data}T${fimCalculado.horario}:00${OFFSET}`;
  let eventos = await consultarCalendarView({ accessToken, inicio: inicioConsulta, fim: fimConsulta });
  if (ignoreEventId) {
    eventos = eventos.filter(e => e.id !== ignoreEventId);
  }
  return { livre: eventos.length === 0, conflitos: eventos, fim: fimCalculado };
}

function decodeHtmlEntities(text) {
  if (!text) return "";
  return text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

const CAMPOS_MAPEAMENTO = {
  cpf: ["cpf_cliente"],
  data: ["data_escolhida", "data_agendamento", "data_agendamento_atual"],
  nome: ["nome_cliente"],
  horario: ["horario_escolhido", "horario_agendamento", "horario_agendamento_atual"],
  telefone: ["número de telefone", "numero de telefone"],
  nova_data: ["nova_data"],
  novo_horario: ["novo_horario"]
};

function parseEmailHtml(htmlString) {
  const dados = { nome: null, cpf: null, telefone: null, data: null, horario: null, nova_data: null, novo_horario: null };
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
      
      if (CAMPOS_MAPEAMENTO.novo_horario.some(k => key.includes(k))) dados.novo_horario = val;
      else if (CAMPOS_MAPEAMENTO.nova_data.some(k => key.includes(k))) dados.nova_data = val;
      else if (CAMPOS_MAPEAMENTO.horario.some(k => key.includes(k))) dados.horario = val;
      else if (CAMPOS_MAPEAMENTO.nome.some(k => key.includes(k))) dados.nome = val;
      else if (CAMPOS_MAPEAMENTO.cpf.some(k => key.includes(k))) dados.cpf = val;
      else if (CAMPOS_MAPEAMENTO.data.some(k => key.includes(k))) dados.data = val;
      else if (CAMPOS_MAPEAMENTO.telefone.some(k => key.includes(k))) dados.telefone = val;
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
  if (dados.nova_data) {
    const nd = dados.nova_data.match(/(\d{4}-\d{2}-\d{2})/);
    if (nd) dados.nova_data = nd[1];
    else dados.nova_data = null;
  }
  if (dados.novo_horario) {
    const nh = dados.novo_horario.match(/(\d{2}:\d{2})/);
    if (nh) dados.novo_horario = nh[1];
    else dados.novo_horario = null;
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

    const endpoint = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/mailFolders/inbox/messages?$top=50&$select=id,subject,receivedDateTime,from,body,bodyPreview&$orderby=receivedDateTime desc`;
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
    
    let operacao = "DESCONHECIDO";
    const gotoMsg = (data.value || []).find(msg => {
      const emailAddress = msg.from?.emailAddress?.address || "";
      if (emailAddress.toLowerCase() !== "noreply@dwf.goto.com") {
         return false;
      }
      
      let subject = String(msg.subject || "").trim();
      // Remover acentos e espaços duplicados, e transformar em lowercase
      subject = subject.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");

      if (subject.includes("cancelamento")) {
        operacao = "CANCELAR";
        return true;
      } else if (subject.includes("reagendamento")) {
        operacao = "REAGENDAR";
        return true;
      } else if (subject.includes("agendamento")) {
        operacao = "AGENDAR";
        return true;
      }
      return false;
    });

    if (!gotoMsg) {
      return res.status(200).json({
        success: false,
        processed: false,
        reason: "nenhum_email_goto_pendente"
      });
    }

    console.log(`TIPO DE OPERACAO: ${operacao}`);

    const htmlContent = gotoMsg.body?.content || "";
    const dadosExtraidos = parseEmailHtml(htmlContent);

    if (operacao === "AGENDAR") {
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

    } else if (operacao === "CANCELAR") {
      console.log("DADOS DE CANCELAMENTO EXTRAIDOS");
      
      if (!dadosExtraidos.cpf || !dadosExtraidos.telefone || !dadosExtraidos.data) {
         return res.status(200).json({
           success: false,
           processed: false,
           reason: "dados_cancelamento_incompletos",
           campos: { 
             cpf: !!dadosExtraidos.cpf, 
             telefone: !!dadosExtraidos.telefone, 
             data: !!dadosExtraidos.data 
           }
         });
      }

      console.log("BUSCANDO AGENDAMENTO PARA CANCELAMENTO");
      
      // nome_cliente não é utilizado como chave forte de identificação,
      // pois a transcrição da IA pode apresentar pequenas variações.
      // CPF + telefone + data (+ horário quando disponível) são os
      // identificadores utilizados para localizar o compromisso.

      const cpfBuscado = String(dadosExtraidos.cpf).replace(/\D/g, "");
      const telBuscado = String(dadosExtraidos.telefone).replace(/\D/g, "");

      const inicioCheck = `${dadosExtraidos.data}T00:00:00${OFFSET}`;
      const [ano, mes, dia] = dadosExtraidos.data.split("-").map(Number);
      const dateObj = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
      dateObj.setUTCDate(dateObj.getUTCDate() + 1);
      const nextDateStr = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, "0")}-${String(dateObj.getUTCDate()).padStart(2, "0")}`;
      const fimCheck = `${nextDateStr}T00:00:00${OFFSET}`;

      const eventosDia = await consultarCalendarView({ 
        accessToken, 
        inicio: inicioCheck, 
        fim: fimCheck,
        select: "id,subject,body,bodyPreview,start,end,isAllDay,webLink"
      });

      const candidatos = [];
      for (const ev of eventosDia) {
         const content = ev.body?.content || "";
         const matchCpf = content.match(/CPF:\s*([^\n<]+)/i);
         const matchTel = content.match(/Telefone:\s*([^\n<]+)/i);
         
         if (matchCpf && matchTel) {
             const evCpf = matchCpf[1].replace(/\D/g, "");
             const evTel = matchTel[1].replace(/\D/g, "");
             if (evCpf === cpfBuscado && evTel === telBuscado) {
                 candidatos.push(ev);
             }
         }
      }

      console.log(`CANDIDATOS ENCONTRADOS: ${candidatos.length}`);

      let eventoAlvo = null;
      if (candidatos.length === 1) {
          if (dadosExtraidos.horario) {
              const startDateTime = candidatos[0].start?.dateTime || "";
              if (startDateTime.includes(`T${dadosExtraidos.horario}:00`)) {
                  eventoAlvo = candidatos[0];
              }
          } else {
              eventoAlvo = candidatos[0];
          }
      } else if (candidatos.length > 1) {
          if (dadosExtraidos.horario) {
              const filtradosPorHorario = candidatos.filter(e => {
                  const startDateTime = e.start?.dateTime || "";
                  return startDateTime.includes(`T${dadosExtraidos.horario}:00`);
              });
              if (filtradosPorHorario.length === 1) {
                  eventoAlvo = filtradosPorHorario[0];
              }
          }
          
          if (!eventoAlvo) {
              console.log("AGENDAMENTO AMBIGUO");
              return res.status(200).json({
                success: false,
                processed: false,
                reason: "agendamento_ambiguo",
                quantidade: candidatos.length
              });
          }
      }

      if (!eventoAlvo) {
          console.log("AGENDAMENTO NAO ENCONTRADO");
          return res.status(200).json({
            success: false,
            processed: false,
            reason: "agendamento_nao_encontrado",
            data: dadosExtraidos.data,
            horario: dadosExtraidos.horario
          });
      }

      console.log("AGENDAMENTO IDENTIFICADO PARA CANCELAMENTO");
      
      const finalContent = eventoAlvo.body?.content || "";
      const finalMatchCpf = finalContent.match(/CPF:\s*([^\n<]+)/i);
      const finalMatchTel = finalContent.match(/Telefone:\s*([^\n<]+)/i);
      if (!finalMatchCpf || !finalMatchTel || finalMatchCpf[1].replace(/\D/g,"") !== cpfBuscado || finalMatchTel[1].replace(/\D/g,"") !== telBuscado) {
          return res.status(500).json({ success: false, reason: "falha_validacao_seguranca" });
      }
      
      if (dadosExtraidos.horario) {
         if (!(eventoAlvo.start?.dateTime || "").includes(`T${dadosExtraidos.horario}:00`)) {
            return res.status(500).json({ success: false, reason: "falha_validacao_seguranca_horario" });
         }
      }

      console.log("CANCELANDO EVENTO OUTLOOK");
      
      const deleteUrl = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${eventoAlvo.id}`;
      const deleteResult = await graphRequest({
         accessToken,
         url: deleteUrl,
         method: "DELETE"
      });
      
      if (!deleteResult.ok) {
          throw new Error(`Erro ao excluir evento: ${JSON.stringify(deleteResult.data)}`);
      }
      
      console.log("EVENTO CANCELADO COM SUCESSO");
      
      const cpfLength = cpfBuscado.length;
      console.log(`Telefone envolvido processado. CPF final ***${cpfBuscado.substring(cpfLength - 2)}`);

      return res.status(200).json({
        success: true,
        processed: true,
        operacao: "cancelar",
        cancelado: true,
        eventoId: eventoAlvo.id,
        data: dadosExtraidos.data,
        horario: dadosExtraidos.horario,
        nomeInformado: dadosExtraidos.nome
      });
    } else if (operacao === "REAGENDAR") {
      console.log("DADOS DE REAGENDAMENTO EXTRAIDOS");
      const gotoCaptureId = crypto.createHash("sha256").update(gotoMsg.id).digest("hex");

      // Idempotência
      const searchUrl = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events?$search="GoToCaptureId: ${gotoCaptureId}"`;
      const searchResponse = await fetch(searchUrl, {
        method: "GET",
        headers: { "Authorization": `Bearer ${accessToken}`, "ConsistencyLevel": "eventual", "Content-Type": "application/json" }
      });
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.value && searchData.value.length > 0) {
          console.log("REAGENDAMENTO JA PROCESSADO");
          return res.status(200).json({ success: true, processed: false, alreadyProcessed: true, operacao: "reagendar", message: "Este reagendamento GoTo já foi processado." });
        }
      }

      if (!dadosExtraidos.cpf || !dadosExtraidos.telefone || !dadosExtraidos.data || !dadosExtraidos.nova_data || !dadosExtraidos.novo_horario) {
         return res.status(200).json({
           success: false, processed: false, reason: "dados_reagendamento_incompletos",
           campos: { cpf: !!dadosExtraidos.cpf, telefone: !!dadosExtraidos.telefone, data: !!dadosExtraidos.data, nova_data: !!dadosExtraidos.nova_data, novo_horario: !!dadosExtraidos.novo_horario }
         });
      }

      console.log("BUSCANDO AGENDAMENTO ORIGINAL PARA REAGENDAMENTO");

      const cpfBuscado = String(dadosExtraidos.cpf).replace(/\D/g, "");
      const telBuscado = String(dadosExtraidos.telefone).replace(/\D/g, "");

      const inicioCheck = `${dadosExtraidos.data}T00:00:00${OFFSET}`;
      const [ano, mes, dia] = dadosExtraidos.data.split("-").map(Number);
      const dateObj = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
      dateObj.setUTCDate(dateObj.getUTCDate() + 1);
      const nextDateStr = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, "0")}-${String(dateObj.getUTCDate()).padStart(2, "0")}`;
      const fimCheck = `${nextDateStr}T00:00:00${OFFSET}`;

      const eventosDia = await consultarCalendarView({ accessToken, inicio: inicioCheck, fim: fimCheck, select: "id,subject,body,bodyPreview,start,end,isAllDay,webLink" });

      const candidatos = [];
      for (const ev of eventosDia) {
         const content = ev.body?.content || "";
         const matchCpf = content.match(/CPF:\s*([^\n<]+)/i);
         const matchTel = content.match(/Telefone:\s*([^\n<]+)/i);
         
         if (matchCpf && matchTel) {
             const evCpf = matchCpf[1].replace(/\D/g, "");
             const evTel = matchTel[1].replace(/\D/g, "");
             if (evCpf === cpfBuscado && evTel === telBuscado) {
                 candidatos.push(ev);
             }
         }
      }

      console.log(`CANDIDATOS ENCONTRADOS: ${candidatos.length}`);

      let eventoAlvo = null;
      if (candidatos.length === 1) {
          if (dadosExtraidos.horario) {
              const startDateTime = candidatos[0].start?.dateTime || "";
              if (startDateTime.includes(`T${dadosExtraidos.horario}:00`)) eventoAlvo = candidatos[0];
          } else {
              eventoAlvo = candidatos[0];
          }
      } else if (candidatos.length > 1) {
          if (dadosExtraidos.horario) {
              const filtradosPorHorario = candidatos.filter(e => (e.start?.dateTime || "").includes(`T${dadosExtraidos.horario}:00`));
              if (filtradosPorHorario.length === 1) eventoAlvo = filtradosPorHorario[0];
          }
          if (!eventoAlvo) {
              console.log("AGENDAMENTO ORIGINAL AMBIGUO");
              return res.status(200).json({ success: false, processed: false, operacao: "reagendar", reason: "agendamento_ambiguo", quantidade: candidatos.length });
          }
      }

      if (!eventoAlvo) {
          console.log("AGENDAMENTO ORIGINAL NAO ENCONTRADO");
          return res.status(200).json({ success: false, processed: false, operacao: "reagendar", reason: "agendamento_nao_encontrado", data: dadosExtraidos.data, horario: dadosExtraidos.horario });
      }

      // Check against fallback idempotency
      const alvoContent = eventoAlvo.body?.content || "";
      if (alvoContent.includes(gotoCaptureId)) {
          console.log("REAGENDAMENTO JA PROCESSADO (FALLBACK)");
          return res.status(200).json({ success: true, processed: false, alreadyProcessed: true, operacao: "reagendar", message: "Este reagendamento GoTo já foi processado." });
      }

      console.log("VERIFICANDO DISPONIBILIDADE DO NOVO HORARIO");
      const disponibilidade = await verificarIntervaloLivre({
        accessToken, data: dadosExtraidos.nova_data, horario: dadosExtraidos.novo_horario, ignoreEventId: eventoAlvo.id
      });

      if (!disponibilidade.livre) {
        return res.status(200).json({ success: false, processed: false, operacao: "reagendar", reason: "novo_horario_indisponivel", data: dadosExtraidos.nova_data, horario: dadosExtraidos.novo_horario });
      }

      console.log("FAZENDO PATCH NO EVENTO OUTLOOK");

      const partesNovaData = dadosExtraidos.nova_data.split("-");
      const novaDataExibicao = partesNovaData.length === 3 ? `${partesNovaData[2]}/${partesNovaData[1]}/${partesNovaData[0]}` : dadosExtraidos.nova_data;

      // Update body content safely
      let newContent = alvoContent;
      // Atualizar data/horario textuais, usando regex robustas para match
      newContent = newContent.replace(/(Data:)\s*[^\n<]+/i, `$1 ${novaDataExibicao}`);
      newContent = newContent.replace(/(Horário:)\s*[^\n<]+/i, `$1 ${dadosExtraidos.novo_horario}`);
      
      // Anexar idempotência no final
      newContent += `\r\nGoToCaptureId: ${gotoCaptureId}\r\nGoToMessageId: ${gotoMsg.id}`;

      const patchPayload = {
        body: { contentType: "Text", content: newContent },
        start: { dateTime: `${dadosExtraidos.nova_data}T${dadosExtraidos.novo_horario}:00`, timeZone: GRAPH_TIMEZONE },
        end: { dateTime: disponibilidade.fim.dateTime, timeZone: GRAPH_TIMEZONE }
      };

      const patchUrl = `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${eventoAlvo.id}`;
      const patchResult = await graphRequest({ accessToken, url: patchUrl, method: "PATCH", body: patchPayload });
      
      if (!patchResult.ok) {
          throw new Error(`Erro ao reagendar evento: ${JSON.stringify(patchResult.data)}`);
      }
      
      console.log("EVENTO REAGENDADO COM SUCESSO");
      
      const cpfLength = cpfBuscado.length;
      console.log(`Telefone envolvido processado. CPF final ***${cpfBuscado.substring(cpfLength - 2)}`);

      return res.status(200).json({
        success: true, processed: true, operacao: "reagendar", reagendado: true,
        eventoId: eventoAlvo.id, dataAnterior: dadosExtraidos.data, horarioAnterior: dadosExtraidos.horario,
        novaData: dadosExtraidos.nova_data, novoHorario: dadosExtraidos.novo_horario, nomeInformado: dadosExtraidos.nome
      });
    }

  } catch (error) {
    return res.status(500).json({
      success: false,
      processed: false,
      error: error.message
    });
  }
};
