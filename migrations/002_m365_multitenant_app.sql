-- ============================================================
-- MIGRATION 002: MICROSOFT 365 MULTITENANT GLOBAL APP REGISTRATION
-- Schema: goto_agendamento
-- Transição do modelo de credenciais por empresa para o modelo de
-- App Registration Único da Solução com Admin Consent OAuth2.
-- ============================================================

-- 1. Remoção de colunas legadas de segredos por empresa
ALTER TABLE goto_agendamento.empresas_conexoes_m365 
    DROP COLUMN IF EXISTS client_secret_encrypted,
    DROP COLUMN IF EXISTS client_secret_iv,
    DROP COLUMN IF EXISTS client_secret_tag,
    DROP COLUMN IF EXISTS key_version,
    DROP COLUMN IF EXISTS azure_client_id;

-- 2. Permitir criação e consentimento em etapas (tenant primeiro, mailbox depois)
ALTER TABLE goto_agendamento.empresas_conexoes_m365 
    ALTER COLUMN azure_tenant_id DROP NOT NULL,
    ALTER COLUMN mailbox_email DROP NOT NULL;

-- 3. Adição das colunas específicas da conexão do tenant e status granular
ALTER TABLE goto_agendamento.empresas_conexoes_m365
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tenant_display_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS conectado_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS conectado_por UUID REFERENCES goto_agendamento.usuarios_admin(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS status_consentimento VARCHAR(50) NOT NULL DEFAULT 'pendente',
    ADD COLUMN IF NOT EXISTS mailbox_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS mailbox_display_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS status_autenticacao VARCHAR(50) NOT NULL DEFAULT 'pendente',
    ADD COLUMN IF NOT EXISTS status_leitura VARCHAR(50) NOT NULL DEFAULT 'pendente',
    ADD COLUMN IF NOT EXISTS status_gravacao VARCHAR(50) NOT NULL DEFAULT 'pendente';

-- Migrar dados existentes de azure_tenant_id para tenant_id se aplicável
UPDATE goto_agendamento.empresas_conexoes_m365 
SET tenant_id = azure_tenant_id 
WHERE tenant_id IS NULL AND azure_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conexoes_m365_tenant_id 
    ON goto_agendamento.empresas_conexoes_m365(tenant_id);

-- 4. Tabela de controle de states OAuth2 para proteção CSRF e Replay Attacks
CREATE TABLE IF NOT EXISTS goto_agendamento.m365_oauth_states (
    state VARCHAR(128) PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES goto_agendamento.empresas(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES goto_agendamento.usuarios_admin(id) ON DELETE SET NULL,
    expira_em TIMESTAMPTZ NOT NULL,
    utilizado BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE goto_agendamento.m365_oauth_states 
    ALTER COLUMN usuario_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_m365_oauth_states_lookup 
    ON goto_agendamento.m365_oauth_states(state) 
    WHERE utilizado = FALSE;

CREATE INDEX IF NOT EXISTS idx_m365_oauth_states_empresa 
    ON goto_agendamento.m365_oauth_states(empresa_id);
