// api/testar-email-goto.js

const MAILBOX_ID = "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

async function obterAccessTokenGraph() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("AZURE_TENANT_ID, AZURE_CLIENT_ID ou AZURE_CLIENT_SECRET não configurados");
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || "Erro ao obter token do Graph");
  }

  return data.access_token;
}

function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseEmailHtml(htmlString) {
  const dados = {
    nome: null,
    cpf: null,
    telefone: null,
    data: null,
    horario: null
  };
  
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

      if (key.includes("horario_escolhido")) {
        dados.horario = val;
      } else if (key.includes("nome_cliente")) {
        dados.nome = val;
      } else if (key.includes("cpf_cliente")) {
        dados.cpf = val;
      } else if (key.includes("data_escolhida")) {
        dados.data = val;
      } else if (key.includes("numero de telefone") || key.includes("número de telefone")) {
        dados.telefone = val;
      }
    }
  }

  if (dados.telefone) {
    dados.telefone = dados.telefone.replace(/[^\d+]/g, "");
  }
  
  if (dados.data) {
    const d = dados.data.match(/(\d{4}-\d{2}-\d{2})/);
    if (d) {
      dados.data = d[1];
    } else {
      dados.data = null;
    }
  }

  if (dados.horario) {
    const h = dados.horario.match(/(\d{2}:\d{2})/);
    if (h) {
      dados.horario = h[1];
    } else {
      dados.horario = null;
    }
  }

  return dados;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido. Use GET."
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
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = await response.text();
      }
      return res.status(response.status).json({
        success: false,
        stage: "graph",
        status: response.status,
        error: errorData
      });
    }

    const data = await response.json();
    const mensagens = data.value || [];

    const gotoMsg = mensagens.find(msg => {
      const emailAddress = msg.from?.emailAddress?.address || "";
      return emailAddress.toLowerCase() === "noreply@dwf.goto.com";
    });

    if (gotoMsg) {
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

      const todosEncontrados = 
        camposEncontrados.nome && 
        camposEncontrados.cpf && 
        camposEncontrados.telefone && 
        camposEncontrados.data && 
        camposEncontrados.horario;

      if (!todosEncontrados) {
        return res.status(200).json({
          success: false,
          message: "E-mail GoTo encontrado, mas existem campos obrigatórios ausentes.",
          camposEncontrados
        });
      }

      return res.status(200).json({
        success: true,
        messageId: gotoMsg.id,
        receivedDateTime: gotoMsg.receivedDateTime,
        dados: dadosExtraidos,
        camposEncontrados
      });
    } else {
      console.log("NENHUM EMAIL GOTO ENCONTRADO");
      return res.status(200).json({
        success: false,
        message: "Nenhum e-mail do GoTo Information Capture encontrado."
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
