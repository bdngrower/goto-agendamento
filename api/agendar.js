// ============================================================
// CONFIGURAÇÕES
// ============================================================

const MAILBOX_ID =
  "2a2b2ab2-20cc-48b6-8846-2f633bd3cb7c";

const GRAPH_TIMEZONE =
  "E. South America Standard Time";

const DURACAO_MINUTOS =
  30;


// ============================================================
// SOMA MINUTOS EM UMA DATA/HORA LOCAL
// SEM CONVERTER PARA UTC
// ============================================================

function somarMinutosLocal(
  data,
  horario,
  minutosAdicionar
) {
  const [ano, mes, dia] =
    data.split("-").map(Number);

  const [hora, minuto] =
    horario.split(":").map(Number);


  /*
   * Usamos Date.UTC apenas como mecanismo
   * de cálculo de calendário.
   *
   * Não significa que o horário será enviado
   * ao Graph em UTC.
   */

  const calculo =
    new Date(
      Date.UTC(
        ano,
        mes - 1,
        dia,
        hora,
        minuto,
        0
      )
    );


  calculo.setUTCMinutes(
    calculo.getUTCMinutes() +
    minutosAdicionar
  );


  const dataFinal =
    `${calculo.getUTCFullYear()}-` +
    `${String(
      calculo.getUTCMonth() + 1
    ).padStart(2, "0")}-` +
    `${String(
      calculo.getUTCDate()
    ).padStart(2, "0")}`;


  const horarioFinal =
    `${String(
      calculo.getUTCHours()
    ).padStart(2, "0")}:` +
    `${String(
      calculo.getUTCMinutes()
    ).padStart(2, "0")}`;


  return {
    data:
      dataFinal,

    horario:
      horarioFinal,

    dateTime:
      `${dataFinal}T${horarioFinal}:00`
  };
}


// ============================================================
// VALIDA DATA
// ============================================================

function dataValida(data) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(data || "")
  );
}


// ============================================================
// VALIDA HORÁRIO
// ============================================================

function horarioValido(
  horario
) {
  const match =
    String(
      horario || ""
    ).match(
      /^([01]\d|2[0-3]):([0-5]\d)$/
    );


  return !!match;
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
      // 1. ACEITAR SOMENTE POST
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
      // 2. VALIDAR API KEY
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
              "GOTO_API_KEY não configurada no servidor"
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
      // 3. DADOS RECEBIDOS
      // ========================================================

      const data =
        req.body?.data;


      const horario =
        req.body?.horario;


      const nome =
        req.body?.nome ||
        "Cliente GoTo";


      const telefone =
        req.body?.telefone ||
        "";


      const conversationSpaceId =
        req.body
          ?.conversationSpaceId ||
        "";


      const callReason =
        req.body
          ?.callReason ||
        "";


      // ========================================================
      // 4. VALIDAÇÃO DOS DADOS
      // ========================================================

      if (!data) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Data não informada"
          });
      }


      if (
        !dataValida(
          data
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Data inválida. Use YYYY-MM-DD."
          });
      }


      if (!horario) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Horário não informado"
          });
      }


      if (
        !horarioValido(
          horario
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Horário inválido. Use HH:mm."
          });
      }


      // ========================================================
      // 5. AZURE / GRAPH
      // ========================================================

      const tenantId =
        process.env
          .AZURE_TENANT_ID;


      const clientId =
        process.env
          .AZURE_CLIENT_ID;


      const clientSecret =
        process.env
          .AZURE_CLIENT_SECRET;


      if (
        !tenantId ||
        !clientId ||
        !clientSecret
      ) {
        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Variáveis do Azure não configuradas"
          });
      }


      // ========================================================
      // 6. TOKEN MICROSOFT GRAPH
      // ========================================================

      const tokenResponse =
        await fetch(
          `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
          {
            method:
              "POST",

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


      const tokenText =
        await tokenResponse.text();


      let tokenData;


      try {
        tokenData =
          JSON.parse(
            tokenText
          );
      } catch {
        tokenData =
          tokenText;
      }


      if (
        !tokenResponse.ok
      ) {
        return res
          .status(
            tokenResponse.status
          )
          .json({
            success:
              false,

            error:
              "Erro ao obter token do Microsoft Graph",

            details:
              tokenData
          });
      }


      const accessToken =
        tokenData
          ?.access_token;


      if (!accessToken) {
        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Microsoft Graph não retornou access_token"
          });
      }


      // ========================================================
      // 7. MONTA INÍCIO E FIM
      // ========================================================

      const inicio =
        `${data}T${horario}:00`;


      const fimCalculado =
        somarMinutosLocal(
          data,
          horario,
          DURACAO_MINUTOS
        );


      const fim =
        fimCalculado
          .dateTime;


      console.log(
        "HORÁRIO DO EVENTO:",
        JSON.stringify(
          {
            inicio,
            fim,
            timezone:
              GRAPH_TIMEZONE,

            duracaoMinutos:
              DURACAO_MINUTOS
          },
          null,
          2
        )
      );


      // ========================================================
      // 8. VERIFICA DISPONIBILIDADE
      // ========================================================

      /*
       * calendarView aceita timezone via offset.
       *
       * Para São Paulo usamos -03:00 no período atual.
       */

      const inicioConsulta =
        `${data}T${horario}:00-03:00`;


      const fimConsulta =
        `${fimCalculado.data}T${fimCalculado.horario}:00-03:00`;


      const calendarUrl =
        `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}` +
        `/calendarView` +
        `?startDateTime=${encodeURIComponent(inicioConsulta)}` +
        `&endDateTime=${encodeURIComponent(fimConsulta)}`;


      const calendarResponse =
        await fetch(
          calendarUrl,
          {
            method:
              "GET",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              Prefer:
                `outlook.timezone="${GRAPH_TIMEZONE}"`
            }
          }
        );


      const calendarText =
        await calendarResponse.text();


      let calendarData;


      try {
        calendarData =
          JSON.parse(
            calendarText
          );
      } catch {
        calendarData =
          calendarText;
      }


      if (
        !calendarResponse.ok
      ) {
        return res
          .status(
            calendarResponse.status
          )
          .json({
            success:
              false,

            error:
              "Erro ao verificar disponibilidade",

            details:
              calendarData
          });
      }


      const conflitos =
        Array.isArray(
          calendarData?.value
        )
          ? calendarData.value
          : [];


      if (
        conflitos.length > 0
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            disponivel:
              false,

            error:
              "Esse horário não está mais disponível",

            mensagem:
              "Desculpe, esse horário acabou de ficar indisponível. Vamos consultar outros horários."
          });
      }


      // ========================================================
      // 9. MONTA DESCRIÇÃO
      // ========================================================

      const descricao = [
        "Agendamento criado automaticamente pela integração GoTo.",

        telefone
          ? `Telefone: ${telefone}`
          : null,

        conversationSpaceId
          ? `ConversationSpaceId: ${conversationSpaceId}`
          : null,

        callReason
          ? `Motivo identificado pela IA: ${callReason}`
          : null
      ]
        .filter(Boolean)
        .join("\n");


      // ========================================================
      // 10. EVENTO
      // ========================================================

      const evento = {
        subject:
          `Agendamento GoTo - ${nome}`,

        body: {
          contentType:
            "Text",

          content:
            descricao
        },

        start: {
          dateTime:
            inicio,

          timeZone:
            GRAPH_TIMEZONE
        },

        end: {
          dateTime:
            fim,

          timeZone:
            GRAPH_TIMEZONE
        },

        showAs:
          "busy"
      };


      console.log(
        "EVENTO ENVIADO AO GRAPH:",
        JSON.stringify(
          evento,
          null,
          2
        )
      );


      // ========================================================
      // 11. CRIA EVENTO
      // ========================================================

      const createResponse =
        await fetch(
          `https://graph.microsoft.com/v1.0/users/${MAILBOX_ID}/events`,
          {
            method:
              "POST",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              "Content-Type":
                "application/json",

              Prefer:
                `outlook.timezone="${GRAPH_TIMEZONE}"`
            },

            body:
              JSON.stringify(
                evento
              )
          }
        );


      const createText =
        await createResponse.text();


      let createdEvent;


      try {
        createdEvent =
          JSON.parse(
            createText
          );
      } catch {
        createdEvent =
          createText;
      }


      if (
        !createResponse.ok
      ) {
        return res
          .status(
            createResponse.status
          )
          .json({
            success:
              false,

            error:
              "Erro ao criar evento",

            details:
              createdEvent
          });
      }


      // ========================================================
      // 12. RESPOSTA
      // ========================================================

      return res
        .status(200)
        .json({
          success:
            true,

          data,

          horario,

          fim:
            fimCalculado
              .horario,

          duracaoMinutos:
            DURACAO_MINUTOS,

          timezone:
            GRAPH_TIMEZONE,

          mensagem:
            `Pronto. Seu agendamento foi realizado para ${data} às ${horario}.`,

          eventoId:
            createdEvent?.id ||
            null,

          webLink:
            createdEvent?.webLink ||
            null
        });

    } catch (error) {
      console.error(
        "Erro /api/agendar:",
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