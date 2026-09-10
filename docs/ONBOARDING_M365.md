# Guia de Onboarding e Restrição Microsoft 365: Application RBAC no Exchange Online

Este documento estabelece o procedimento técnico oficial e corrigido para provisionamento e concessão de acesso seguro e de privilégio mínimo entre o sistema **GoTo Agendamento Multiempresa** e caixas postais do **Microsoft 365 / Exchange Online**.

---

## 1. Princípios Fundamentais de Segurança e Autorização

1. **Autenticação App-Only Desacoplada de Autorização Global:**
   - O Microsoft Entra ID (antigo Azure AD) é utilizado **exclusivamente como provedor de identidade e autenticação** OAuth 2.0 (`client_credentials`).
   - Não se deve conceder permissões de aplicação tenant-wide no Entra ID.
2. **Autorização Granular Exclusiva no Exchange Online:**
   - O controle de acesso a caixas postais e calendários é delegado **inteiramente ao Application RBAC do Exchange Online**.
   - Cada empresa/cliente atendido possui seu próprio App Registration e Service Principal no Exchange Online.
3. **Privilégio Mínimo e Escopo de Recurso Estrito:**
   - A aplicação tem permissão de leitura e gravação **somente e exclusivamente na caixa postal da agenda configurada** (ex: `agenda@clinicaalfa.com.br`).
   - Qualquer tentativa de consultar ou alterar calendários de outras caixas postais do mesmo tenant é sumariamente bloqueada com `HTTP 403 Forbidden`.

---

## 2. Por que NÃO Conceder `Calendars.ReadWrite` Tenant-Wide no Entra ID?

> [!CAUTION]
> **Modelo Aditivo (Union of Permissions):**
> As permissões atribuídas no Microsoft Entra ID e as permissões atribuídas no Application RBAC do Exchange Online operam em modelo **aditivo** (*união de permissões*).
> 
> Se um administrador acessar o portal do Microsoft Entra ID, adicionar a permissão de aplicação Microsoft Graph `Calendars.ReadWrite` e clicar em *"Grant admin consent"*, o token OAuth emitido conterá a claim global `roles: ["Calendars.ReadWrite"]`.
> 
> **Essa concessão global anula na prática a restrição granular do Exchange Online**, permitindo que a aplicação acesse os calendários de **TODOS** os usuários e caixas do tenant (diretoria, financeiro, RH, etc.).
> 
> **Regra Obrigatória:** No Microsoft Entra ID, configure apenas as credenciais da aplicação (Secret/Certificado). **NÃO conceda a permissão de aplicação `Calendars.ReadWrite` no Entra ID**. A autorização de calendário deve emanar unicamente do **Exchange Online Application RBAC com Resource Scope**.

---

## 3. Passo a Passo Técnico de Configuração

### Passo 1: Registro da Aplicação no Microsoft Entra ID

1. Acesse o **Centro de administração do Microsoft Entra** (`https://entra.microsoft.com`).
2. Navegue até: **Identity > Applications > App registrations > New registration**.
3. Nomeie a aplicação para identificação clara:
   - Exemplo: `GoToAgendamento - Clinica Alfa`
4. Tipo de conta:
   - *Accounts in this organizational directory only (Single tenant)*.
5. Clique em **Register**.
6. Guarde os seguintes identificadores:
   - **Application (client) ID** (GUID da aplicação)
   - **Directory (tenant) ID** (GUID do tenant Microsoft 365 da empresa)
7. Vá para **Certificates & secrets > Client secrets > New client secret**:
   - Descrição: `Goto Connect Integration`
   - Expiração: conforme política de segurança da empresa (ex: 12 ou 24 meses).
   - Copie o **Value** imediatamente.
8. Obtenha o **Object ID** do Enterprise Application correspondente:
   - Navegue até: **Identity > Applications > Enterprise applications**.
   - Localize e abra o aplicativo criado (`GoToAgendamento - Clinica Alfa`).
   - Copie o **Object ID** (GUID do Service Principal no diretório).
9. **API Permissions:** Mantenha apenas a permissão padrão delegada `User.Read` (se criada automaticamente) ou remova-a. **NÃO adicione permissões de aplicação para Microsoft Graph**.

---

### Passo 2: Configuração do Application RBAC no Exchange Online PowerShell

Abra o **PowerShell** (versão 5.1 ou 7+) como Administrador:

#### 2.1 Conectar ao Exchange Online
```powershell
# Instale o módulo oficial caso ainda não o possua:
# Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser

Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -UserPrincipalName admin@clinicaalfa.com.br
```

#### 2.2 Registrar o Service Principal no Exchange Online
Cria o apontador do Service Principal dentro do subsistema do Exchange:
```powershell
New-ServicePrincipal `
  -AppId "<APPLICATION_CLIENT_ID_GUID>" `
  -ObjectId "<ENTERPRISE_APP_OBJECT_ID_GUID>" `
  -DisplayName "GoToAgendamento - Clinica Alfa"
```

#### 2.3 Criar o Management Scope (Resource Scope)
Define o escopo restrito exclusivamente ao endereço de e-mail da caixa postal autorizada:
```powershell
New-ManagementScope `
  -Name "Escopo-Agenda-ClinicaAlfa" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'agenda@clinicaalfa.com.br'"
```

#### 2.4 Atribuir a Role Granular com o Escopo Restrito
Concede a role `Application Calendars.ReadWrite` associada ao escopo da caixa da clínica:
```powershell
New-ManagementRoleAssignment `
  -App "<ENTERPRISE_APP_OBJECT_ID_GUID>" `
  -Role "Application Calendars.ReadWrite" `
  -CustomResourceScope "Escopo-Agenda-ClinicaAlfa"
```

---

## 4. Validação Técnica da Restrição

### 4.1 Validação com `Test-ServicePrincipalAuthorization` no PowerShell

Execute a verificação de autorização para comprovar o isolamento:

#### Teste Positivo: Mailbox Autorizada
```powershell
Test-ServicePrincipalAuthorization `
  -Identity "<ENTERPRISE_APP_OBJECT_ID_GUID>" `
  -Role "Application Calendars.ReadWrite" `
  -Resource "agenda@clinicaalfa.com.br"
```
**Resultado Esperado:**
```text
InScope    : True
Authorized : True
Role       : Application Calendars.ReadWrite
Resource   : agenda@clinicaalfa.com.br
```

#### Teste Negativo: Qualquer Outra Mailbox do Tenant
```powershell
Test-ServicePrincipalAuthorization `
  -Identity "<ENTERPRISE_APP_OBJECT_ID_GUID>" `
  -Role "Application Calendars.ReadWrite" `
  -Resource "diretoria@clinicaalfa.com.br"
```
**Resultado Esperado:**
```text
InScope    : False
Authorized : False
Role       : Application Calendars.ReadWrite
Resource   : diretoria@clinicaalfa.com.br
```

---

### 4.2 Validação via Microsoft Graph API

Com as credenciais (`Tenant ID`, `Client ID`, `Client Secret`), efetue os testes de requisição:

1. **Obtenção do Token App-Only:**
   - `POST https://login.microsoftonline.com/<TENANT_ID>/oauth2/v2.0/token`
   - Parâmetros form-urlencoded:
     - `client_id = <CLIENT_ID>`
     - `client_secret = <CLIENT_SECRET>`
     - `grant_type = client_credentials`
     - `scope = https://graph.microsoft.com/.default`
   - **Retorno:** Token emitido com sucesso (`HTTP 200`).

2. **Teste Positivo na Mailbox Autorizada:**
   - `GET https://graph.microsoft.com/v1.0/users/agenda@clinicaalfa.com.br/calendarView?startDateTime=2026-10-14T00:00:00Z&endDateTime=2026-10-14T23:59:59Z`
   - Cabeçalho: `Authorization: Bearer <TOKEN>`
   - **Retorno Esperado:** `HTTP 200 OK` contendo a lista de compromissos da agenda autorizada.

3. **Teste Negativo em Mailbox Fora do Escopo:**
   - `GET https://graph.microsoft.com/v1.0/users/diretoria@clinicaalfa.com.br/calendarView?startDateTime=2026-10-14T00:00:00Z&endDateTime=2026-10-14T23:59:59Z`
   - Cabeçalho: `Authorization: Bearer <TOKEN>`
   - **Retorno Esperado:** `HTTP 403 Forbidden`
   ```json
   {
     "error": {
       "code": "ErrorAccessDenied",
       "message": "Access is denied. Check credentials and try again."
     }
   }
   ```

---

## 5. Nota Histórica: Application Access Policy (Legado)

O cmdlet `New-ApplicationAccessPolicy` foi o primeiro mecanismo introduzido pela Microsoft para limitar aplicações no Exchange Online. Ele exigia a criação de um grupo de distribuição habilitado para email (*Mail-Enabled Security Group*) e apresentava limitações de latência de replicação e governança.

A Microsoft classifica o *Application Access Policy* como **legado** e orienta expressamente a utilização do **Application RBAC for Exchange Online**, que oferece escopos dinâmicos baseados em atributos (`RecipientRestrictionFilter`), auditoria nativa e integração direta com o Microsoft Graph.
