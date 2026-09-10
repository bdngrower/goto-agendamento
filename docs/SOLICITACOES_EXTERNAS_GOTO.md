# Definições de Solicitações Externas (GoTo Connect / Dial Plan)

Este documento descreve o contrato definitivo das **Solicitações Externas (External Requests)** no GoTo para integração com o backend de agendamento multiempresa (`/api/agendamento`).

---

## 1. Configuração Global no GoTo

- **Método HTTP:** `POST`
- **URL do Endpoint:** `https://goto-agendamento.vercel.app/api/agendamento`
- **Content-Type:** `application/json`
- **Cabeçalho de Autenticação Obrigatório:**
  - `x-api-key`: `{{ChaveGoToDaEmpresa}}` (obtida no Painel Administrativo `/admin`)

---

## 2. Fluxos do Plano de Discagem

### Fluxo 1: Agendar
`telefone automático` → `CPF` → `dia` → `mês` → **Consultar disponibilidade** → `escolher horário (DTMF)` → **Agendar**

### Fluxo 2: Consultar
`telefone automático` → `CPF` → **Consultar agendamentos** → `falar resultados (TTS)`

### Fluxo 3: Reagendar
`telefone automático` → `CPF` → **Consultar agendamentos** → `escolher evento` → `novo dia` → `novo mês` → **Consultar disponibilidade** → `escolher novo horário` → **Reagendar**

### Fluxo 4: Cancelar
`telefone automático` → `CPF` → **Consultar agendamentos** → `escolher evento` → `confirmar` → **Cancelar**

---

## 3. Contratos das Solicitações Externas

### 3.1. Consultar Disponibilidade

Consulta os horários livres calculados para o dia e mês informados, no ano atual do fuso horário da empresa.

#### Parâmetros de Entrada (Body JSON):
```json
{
  "acao": "consultar_disponibilidade",
  "dia": "15",
  "mes": "10"
}
```
*Observações:*
- `dia`: aceita 1 ou 2 dígitos (ex: `"5"` ou `"15"`).
- `mes`: aceita 1 ou 2 dígitos (ex: `"9"` ou `"10"`).
- O ano é inferido automaticamente como o ano corrente no fuso horário IANA da empresa (sem avanço para o próximo ano).
- Também há suporte de compatibilidade reversa para `data: "YYYY-MM-DD"` ou `"DDMMAAAA"`.

#### Parâmetros de Saída (JSON):
```json
{
  "success": true,
  "acao": "consultar_disponibilidade",
  "data": "2026-10-15",
  "disponivel": true,
  "quantidade": 4,
  "horario1": "09:00",
  "horario2": "10:00",
  "horario3": "11:00",
  "horario4": "14:00",
  "mensagem": "Encontrei 4 horários disponíveis. Para 9 horas, pressione 1. Para 10 horas, pressione 2. Para 11 horas, pressione 3. Para 14 horas, pressione 4."
}
```
*Campos mapeados no plano GoTo:*
- `data`: string no formato `YYYY-MM-DD` resolvida e validada pelo backend.
- `disponivel`: booleano (`true` se houver pelo menos 1 horário livre).
- `quantidade`: número inteiro de horários retornados (0 a 4).
- `horario1` .. `horario4`: horários formatados como `HH:mm`.
- `mensagem`: mensagem amigável com instruções em TTS para o cliente discar.

---

### 3.2. Agendar Horário

Cria o compromisso no calendário Microsoft 365 da empresa após a escolha do horário pelo cliente.

#### Parâmetros de Entrada (Body JSON):
```json
{
  "acao": "agendar",
  "cpf": "{{CPF_CLIENTE}}",
  "telefone": "{{TELEFONE_CLIENTE}}",
  "nome": "{{NOME_CLIENTE}}",
  "data": "{{DATA_RESOLVIDA}}",
  "horario": "{{HORARIO_ESCOLHIDO}}"
}
```
*Regras:*
- `data`: a data já resolvida em formato `YYYY-MM-DD` obtida da etapa de disponibilidade.
- `nome`: opcional. Se ausente, o backend utiliza o assunto seguro `"Agendamento GoTo"` e `"Nome: Não informado"` no corpo do evento, sem quebrar o agendamento.
- Aceita também os aliases `cpf_cliente` e `telefone_cliente`.

#### Parâmetros de Saída (JSON):
```json
{
  "success": true,
  "acao": "agendar",
  "data": "2026-10-15",
  "horario": "10:00",
  "eventoId": "AAMkAG...",
  "mensagem": "Agendamento realizado para 15 de outubro de 2026 às 10 horas."
}
```

---

### 3.3. Consultar Agendamentos

Recupera os compromissos futuros do cliente cadastrados no calendário corporativo.

#### Parâmetros de Entrada (Body JSON):
```json
{
  "acao": "consultar_agendamentos",
  "cpf_cliente": "{{CPF_CLIENTE}}",
  "telefone_cliente": "{{TELEFONE_CLIENTE}}"
}
```
*Regras:*
- Aceita `cpf_cliente` ou `cpf`, `telefone_cliente` ou `telefone`.
- Pelo menos um identificador válido deve ser informado.

#### Parâmetros de Saída (JSON):
```json
{
  "success": true,
  "acao": "consultar_agendamentos",
  "quantidade": 2,
  "evento1Data": "2026-10-15",
  "evento1Horario": "10:00",
  "evento2Data": "2026-10-22",
  "evento2Horario": "14:00",
  "evento3Data": "",
  "evento3Horario": "",
  "evento4Data": "",
  "evento4Horario": "",
  "mensagem": "Encontrei dois agendamentos. Para o dia 15 de outubro, às 10 horas, pressione 1. Para o dia 22 de outubro, às 14 horas, pressione 2."
}
```

---

### 3.4. Reagendar Horário

Atualiza in-place um agendamento existente para uma nova data e horário.

#### Parâmetros de Entrada (Body JSON):
```json
{
  "acao": "reagendar",
  "cpf_cliente": "{{CPF_CLIENTE}}",
  "telefone_cliente": "{{TELEFONE_CLIENTE}}",
  "data_agendamento_atual": "2026-10-15",
  "horario_agendamento_atual": "10:00",
  "novo_dia": "20",
  "novo_mes": "10",
  "novo_horario": "14:00"
}
```
*Regras de Validação no Backend:*
- `novo_dia` e `novo_mes`: validados com as mesmas regras estritas de calendário da consulta de disponibilidade (mês 1–12, dias reais, ano corrente da empresa).
- Rejeição garantida em caso de:
  - Data passada;
  - Data inexistente no calendário;
  - Data fora do horizonte máximo configurado;
  - Horário fora da jornada semanal ou em exceção/feriado fechado;
  - Conflito de agenda no Microsoft 365.

#### Parâmetros de Saída (JSON):
```json
{
  "success": true,
  "acao": "reagendar",
  "novaData": "2026-10-20",
  "novoHorario": "14:00",
  "mensagem": "Agendamento reagendado com sucesso."
}
```

---

### 3.5. Cancelar Horário

Cancela e exclui um agendamento existente do calendário Microsoft 365.

#### Parâmetros de Entrada (Body JSON):
```json
{
  "acao": "cancelar",
  "cpf_cliente": "{{CPF_CLIENTE}}",
  "telefone_cliente": "{{TELEFONE_CLIENTE}}",
  "data_agendamento_atual": "2026-10-15",
  "horario_agendamento_atual": "10:00"
}
```

#### Parâmetros de Saída (JSON):
```json
{
  "success": true,
  "acao": "cancelar",
  "data": "2026-10-15",
  "horario": "10:00",
  "mensagem": "Agendamento cancelado com sucesso."
}
```
