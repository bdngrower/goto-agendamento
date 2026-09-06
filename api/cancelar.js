// ============================================================
// CONFIGURAÇÕES
// ============================================================

const MAILBOX_ID =
  "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

const GRAPH_TIMEZONE =
  "E. South America Standard Time";


// ============================================================
// TOKEN MICROSOFT GRAPH
// ============================================================

async function obterAccessTokenGraph() {
  const tenantId =
    process.env.AZURE_TENANT_ID;

  const clientId =
    process.env.AZURE_CLIENT_ID;

  const clientSecret =
    process.env.AZURE_CLIENT_SECRET;


  if (
    !tenantId ||
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "AZURE_TENANT_ID, AZURE_CLIENT_ID ou AZURE_CLIENT_SECRET não configurados"
    );
  }


  const response =
    await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            client_id:
              clientId,

            client_secret:
              clientSecret,

            scope:
              "https://graph.microsoft.com/.default",

            grant_type:
              "client_credentials"
          })
      }
    );


  const text =
    await response.text();


  let data;


  try {
    data =
      JSON.parse(text);
  } catch {
    data = text;
  }


  if (!response.ok) {
    throw new Error(
      `Erro ao obter token Graph ${response.status}: ${JSON.stringify(data)}`
    );
  }


  if (!data?.access_token) {
    throw new Error(
      "Microsoft Graph não retornou access_token"
    );
  }


  return data.access_token;
}


// ============================================================
// NORMALIZA TELEFONE
// ============================================================

function normalizarTelefone(
  telefone
) {
  return String(
    telefone || ""
  ).replace(
    /\D/g,
    ""
  );
}


// ============================================================
// DATA ATUAL EM SÃO PAULO
// ============================================================

function agoraISO() {
  return new Date().toISOString();
}


// ============================================================
// DATA LIMITE DE BUSCA
// ============================================================

function limiteBuscaISO() {
  const limite =
    new Date();

  limite.setUTCDate(
    limite.getUTCDate() + 365
  );

  return limite.toISOString();
}


// ============================================================
// BUSCA EVENTOS FUTUROS
// ============================================================

async function buscarEventosFuturos(
  accessToken
) {
  const inicio =
    agoraISO();

  const fim =
    limiteBuscaISO();


  const url =
    `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}` +
    `/calendarView` +
    `?startDateTime=${encodeURIComponent(inicio)}` +
    `&endDateTime=${encodeURIComponent(fim)}` +
    `&$top=100` +
    `&$select=id,subject,start,end,bodyPreview,webLink`;


  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          Prefer:
            `outlook.timezone="${GRAPH_TIMEZONE}"`
        }
      }
    );


  const text =
    await response.text();


  let data;


  try {
    data =
      JSON.parse(text);
  } catch {
    data = text;
  }


  if (!response.ok) {
    throw new Error(
      `Erro ao consultar calendário ${response.status}: ${JSON.stringify(data)}`
    );
  }


  return Array.isArray(
    data?.value
  )
    ? data.value
    : [];
}


// ============================================================
// LOCALIZA EVENTOS PELO TELEFONE
// ============================================================

function localizarEventosTelefone(
  eventos,
  telefone
) {
  const telefoneNormalizado =
    normalizarTelefone(
      telefone
    );


  if (!telefoneNormalizado) {
    return [];
  }


  return eventos.filter(
    (evento) => {
      const subject =
        normalizarTelefone(
          evento?.subject
        );


      const body =
        normalizarTelefone(
          evento?.bodyPreview
        );


      return (
        subject.includes(
          telefoneNormalizado
        ) ||
        body.includes(
          telefoneNormalizado
        )
      );
    }
  );
}


// ============================================================
// CANCELA EVENTO
// ============================================================

async function cancelarEvento(
  accessToken,
  eventId
) {
  const response =
    await fetch(
      `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events/${encodeURIComponent(eventId)}`,
      {
        method:
          "DELETE",

        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );


  /*
   * DELETE de evento normalmente retorna 204.
   */

  if (
    !response.ok &&
    response.status !== 204
  ) {
    const text =
      await response.text();


    let data;


    try {
      data =
        JSON.parse(text);
    } catch {
      data = text;
    }


    throw new Error(
      `Erro ao cancelar evento ${response.status}: ${JSON.stringify(data)}`
    );
  }


  return true;
}


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {
    try {
      // ========================================================
      // SOMENTE POST
      // ========================================================

      if (
        req.method !==
        "POST"
      ) {
        return res
          .status(405)
          .json({
            success:
              false,

            error:
              "Método não permitido. Use POST."
          });
      }


      // ========================================================
      // API KEY
      // ========================================================

      const apiKey =
        req.headers[
          "x-api-key"
        ];


      const expectedKey =
        process.env
          .GOTO_API_KEY;


      if (!expectedKey) {
        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "GOTO_API_KEY não configurada"
          });
      }


      if (
        !apiKey ||
        apiKey !==
          expectedKey
      ) {
        return res
          .status(401)
          .json({
            success:
              false,

            error:
              "API Key inválida"
          });
      }


      // ========================================================
      // TELEFONE
      // ========================================================

      const telefone =
        req.body?.telefone;


      const conversationSpaceId =
        req.body
          ?.conversationSpaceId ||
        null;


      const callReason =
        req.body
          ?.callReason ||
        null;


      if (!telefone) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Telefone não informado"
          });
      }


      console.log(
        "CANCELAMENTO SOLICITADO:",
        JSON.stringify(
          {
            telefone,
            conversationSpaceId,
            callReason
          },
          null,
          2
        )
      );


      // ========================================================
      // GRAPH
      // ========================================================

      const accessToken =
        await obterAccessTokenGraph();


      // ========================================================
      // EVENTOS FUTUROS
      // ========================================================

      const eventos =
        await buscarEventosFuturos(
          accessToken
        );


      const encontrados =
        localizarEventosTelefone(
          eventos,
          telefone
        );


      console.log(
        "EVENTOS ENCONTRADOS PARA O TELEFONE:",
        JSON.stringify(
          encontrados.map(
            (evento) => ({
              id:
                evento.id,

              subject:
                evento.subject,

              start:
                evento.start,

              end:
                evento.end
            })
          ),
          null,
          2
        )
      );


      // ========================================================
      // NENHUM EVENTO
      // ========================================================

      if (
        encontrados.length === 0
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            encontrado:
              false,

            error:
              "Nenhum agendamento futuro encontrado para esse telefone"
          });
      }


      // ========================================================
      // MAIS DE UM EVENTO
      // ========================================================

      if (
        encontrados.length > 1
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            encontrado:
              true,

            ambiguo:
              true,

            error:
              "Existe mais de um agendamento futuro para esse telefone",

            eventos:
              encontrados.map(
                (evento) => ({
                  id:
                    evento.id,

                  subject:
                    evento.subject,

                  inicio:
                    evento
                      ?.start
                      ?.dateTime,

                  fim:
                    evento
                      ?.end
                      ?.dateTime
                })
              )
          });
      }


      // ========================================================
      // EVENTO ÚNICO
      // ========================================================

      const evento =
        encontrados[0];


      await cancelarEvento(
        accessToken,
        evento.id
      );


      console.log(
        "AGENDAMENTO CANCELADO:",
        evento.id
      );


      // ========================================================
      // SUCESSO
      // ========================================================

      return res
        .status(200)
        .json({
          success:
            true,

          cancelado:
            true,

          telefone,

          evento: {
            id:
              evento.id,

            subject:
              evento.subject,

            inicio:
              evento
                ?.start
                ?.dateTime,

            fim:
              evento
                ?.end
                ?.dateTime
          },

          mensagem:
            "Agendamento cancelado com sucesso."
        });

    } catch (error) {
      console.error(
        "Erro /api/cancelar:",
        error
      );


      return res
        .status(500)
        .json({
          success:
            false,

          error:
            error.message
        });
    }
  };