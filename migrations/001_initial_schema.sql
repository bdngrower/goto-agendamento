-- ============================================================
-- MIGRAÇÃO 001 REVISADA E BLINDADA: SCHEMA ENTERPRISE MULTIEMPRESA
-- Compatível com PostgreSQL / Supabase
-- ============================================================

-- Habilitar extensão pgcrypto para geração criptográfica de UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 0. SCHEMA PRIVADO DEDICADO E ISOLAMENTO DE DATA API (SUPABASE POSTGREST)
-- Cria o schema dedicado 'goto_agendamento', mantendo todas as entidades fora do schema 'public'.
-- Isso impede totalmente a exposição automática na Data API pública do Supabase.
CREATE SCHEMA IF NOT EXISTS goto_agendamento;

-- Revoga explicitamente acesso de roles públicas do Supabase (PostgREST)
REVOKE ALL ON SCHEMA goto_agendamento FROM anon, authenticated, public;

-- Configura permissões para o usuário do backend (postgres / service_role)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT ALL ON SCHEMA goto_agendamento TO postgres;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON SCHEMA goto_agendamento TO service_role;
    END IF;
END
$$;

-- Define o search_path da sessão de execução
SET search_path TO goto_agendamento, public;

-- 1. EMPRESAS (TENANTS)
-- Utiliza soft-delete via deleted_at e flag ativo para jamais perder histórico.
CREATE TABLE IF NOT EXISTS goto_agendamento.empresas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(150) NOT NULL,
    nome_fantasia VARCHAR(150),
    slug VARCHAR(80) UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    fuso_horario VARCHAR(50) NOT NULL DEFAULT 'America/Sao_Paulo',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_empresas_slug ON goto_agendamento.empresas(slug);
CREATE INDEX IF NOT EXISTS idx_empresas_ativo ON goto_agendamento.empresas(ativo) WHERE deleted_at IS NULL;

-- 2. CHAVES DE API GOTO POR EMPRESA
-- Revogação lógica obrigatória via ativo=FALSE e revogado_em.
-- ON DELETE RESTRICT impede exclusão acidental em cascata do histórico de chaves GoTo.
CREATE TABLE IF NOT EXISTS goto_agendamento.empresas_chaves_goto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES goto_agendamento.empresas(id) ON DELETE RESTRICT,
    nome_identificador VARCHAR(80) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash VARCHAR(64) UNIQUE NOT NULL CHECK (length(key_hash) = 64),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso_em TIMESTAMPTZ,
    revogado_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chaves_goto_empresa_id ON goto_agendamento.empresas_chaves_goto(empresa_id);
CREATE INDEX IF NOT EXISTS idx_chaves_goto_lookup ON goto_agendamento.empresas_chaves_goto(key_prefix) WHERE ativo = TRUE;

-- 3. CONEXÃO MICROSOFT 365 POR EMPRESA
-- Segredo criptografado com AES-256-GCM versionado.
CREATE TABLE IF NOT EXISTS goto_agendamento.empresas_conexoes_m365 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL UNIQUE REFERENCES goto_agendamento.empresas(id) ON DELETE RESTRICT,
    nome_conexao VARCHAR(100) NOT NULL DEFAULT 'Conexão Principal M365',
    tipo_autenticacao VARCHAR(30) NOT NULL DEFAULT 'custom_app',
    azure_tenant_id VARCHAR(100) NOT NULL,
    azure_client_id VARCHAR(100),
    client_secret_encrypted TEXT,
    client_secret_iv VARCHAR(32),
    client_secret_tag VARCHAR(32),
    key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
    mailbox_email VARCHAR(200) NOT NULL,
    status_conexao VARCHAR(30) NOT NULL DEFAULT 'pendente',
    ultimo_teste_em TIMESTAMPTZ,
    ultimo_teste_sucesso BOOLEAN NOT NULL DEFAULT FALSE,
    ultimo_erro TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conexoes_m365_empresa_id ON goto_agendamento.empresas_conexoes_m365(empresa_id);

-- 4. POLÍTICAS DE AGENDAMENTO POR EMPRESA
CREATE TABLE IF NOT EXISTS goto_agendamento.empresas_politicas_agendamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL UNIQUE REFERENCES goto_agendamento.empresas(id) ON DELETE CASCADE,
    duracao_minutos INTEGER NOT NULL DEFAULT 60 CHECK (duracao_minutos > 0 AND duracao_minutos <= 1440),
    intervalo_entre_slots INTEGER NOT NULL DEFAULT 60 CHECK (intervalo_entre_slots > 0 AND intervalo_entre_slots <= 1440),
    buffer_antes_minutos INTEGER NOT NULL DEFAULT 0 CHECK (buffer_antes_minutos >= 0 AND buffer_antes_minutos <= 720),
    buffer_depois_minutos INTEGER NOT NULL DEFAULT 0 CHECK (buffer_depois_minutos >= 0 AND buffer_depois_minutos <= 720),
    antecedencia_minima_minutos INTEGER NOT NULL DEFAULT 60 CHECK (antecedencia_minima_minutos >= 0),
    limite_maximo_dias INTEGER NOT NULL DEFAULT 60 CHECK (limite_maximo_dias > 0 AND limite_maximo_dias <= 365),
    max_opcoes_retorno INTEGER NOT NULL DEFAULT 4 CHECK (max_opcoes_retorno > 0 AND max_opcoes_retorno <= 10),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_politicas_empresa_id ON goto_agendamento.empresas_politicas_agendamento(empresa_id);

-- 5. HORÁRIOS SEMANAIS E FAIXAS DE ATENDIMENTO
-- ON DELETE CASCADE aceitável apenas entre dia semanal e suas faixas filhas.
CREATE TABLE IF NOT EXISTS goto_agendamento.empresas_horarios_semanais (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES goto_agendamento.empresas(id) ON DELETE CASCADE,
    dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
    fechado BOOLEAN NOT NULL DEFAULT FALSE,
    atendimento_24h BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_empresa_dia_semana UNIQUE(empresa_id, dia_semana)
);
CREATE INDEX IF NOT EXISTS idx_horarios_semanais_empresa_id ON goto_agendamento.empresas_horarios_semanais(empresa_id);

CREATE TABLE IF NOT EXISTS goto_agendamento.empresas_horarios_faixas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    horario_semanal_id UUID NOT NULL REFERENCES goto_agendamento.empresas_horarios_semanais(id) ON DELETE CASCADE,
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    ordem SMALLINT NOT NULL DEFAULT 1,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_faixas_horario_semanal_id ON goto_agendamento.empresas_horarios_faixas(horario_semanal_id);

-- 6. EXCEÇÕES E DATAS ESPECIAIS (FERIADOS, HORÁRIOS REDUZIDOS)
-- ON DELETE CASCADE aceitável entre exceção e suas faixas filhas.
CREATE TABLE IF NOT EXISTS goto_agendamento.empresas_excecoes_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES goto_agendamento.empresas(id) ON DELETE CASCADE,
    data DATE NOT NULL,
    descricao VARCHAR(150) NOT NULL,
    fechado BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_empresa_data_excecao UNIQUE(empresa_id, data)
);
CREATE INDEX IF NOT EXISTS idx_excecoes_empresa_data ON goto_agendamento.empresas_excecoes_data(empresa_id, data);

CREATE TABLE IF NOT EXISTS goto_agendamento.empresas_excecoes_faixas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    excecao_id UUID NOT NULL REFERENCES goto_agendamento.empresas_excecoes_data(id) ON DELETE CASCADE,
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    ordem SMALLINT NOT NULL DEFAULT 1,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_excecoes_faixas_excecao_id ON goto_agendamento.empresas_excecoes_faixas(excecao_id);

-- 7. USUÁRIOS ADMINISTRATIVOS E SESSÕES
CREATE TABLE IF NOT EXISTS goto_agendamento.usuarios_admin (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(150) UNIQUE NOT NULL,
    nome VARCHAR(150) NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(128) NULL,
    tentativas_falhas_login INTEGER NOT NULL DEFAULT 0,
    bloqueado_ate TIMESTAMPTZ NULL,
    ultimo_login_em TIMESTAMPTZ NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON goto_agendamento.usuarios_admin(email);

CREATE TABLE IF NOT EXISTS goto_agendamento.usuarios_sessoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES goto_agendamento.usuarios_admin(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL CHECK (length(token_hash) = 64),
    csrf_token VARCHAR(64) NOT NULL,
    ip_origem VARCHAR(45),
    user_agent TEXT,
    expira_em TIMESTAMPTZ NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario_id ON goto_agendamento.usuarios_sessoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_token_hash ON goto_agendamento.usuarios_sessoes(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira_em ON goto_agendamento.usuarios_sessoes(expira_em);

-- 8. REGISTRO DE AUDITORIA (SEM DADOS PESSOAIS SENSÍVEIS)
-- ON DELETE SET NULL garante que eventos de auditoria JAMAIS sejam expurgados em cascata!
CREATE TABLE IF NOT EXISTS goto_agendamento.registros_auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES goto_agendamento.empresas(id) ON DELETE SET NULL,
    usuario_id UUID REFERENCES goto_agendamento.usuarios_admin(id) ON DELETE SET NULL,
    acao VARCHAR(80) NOT NULL,
    detalhes JSONB,
    ip VARCHAR(45),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_empresa_id ON goto_agendamento.registros_auditoria(empresa_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON goto_agendamento.registros_auditoria(criado_em);

-- 9. TABELA ATÔMICA DE RATE LIMITING SERVERLESS
CREATE TABLE IF NOT EXISTS goto_agendamento.rate_limits (
    key VARCHAR(150) PRIMARY KEY,
    points INTEGER NOT NULL DEFAULT 1,
    expira_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expira ON goto_agendamento.rate_limits(expira_em);

-- 10. DEFESA EM PROFUNDIDADE: REVOGAÇÃO TOTAL DE GRANTS NAS TABELAS
REVOKE ALL ON ALL TABLES IN SCHEMA goto_agendamento FROM anon, authenticated, public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA goto_agendamento FROM anon, authenticated, public;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT ALL ON ALL TABLES IN SCHEMA goto_agendamento TO postgres;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA goto_agendamento TO postgres;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON ALL TABLES IN SCHEMA goto_agendamento TO service_role;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA goto_agendamento TO service_role;
    END IF;
END
$$;
