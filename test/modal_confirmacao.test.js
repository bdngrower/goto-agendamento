const assert = require("assert");
const fs = require("fs");

const html = fs.readFileSync("public/admin/index.html", "utf8");

console.log("=== INICIANDO SUÍTE DE TESTES DO MODAL DE CONFIRMAÇÃO ===");

// 1. Validação estática dos IDs no HTML
console.log("\n1. Verificando existência de IDs no HTML...");
assert.ok(html.includes('id="modal-confirmacao"'), "Elemento modal-confirmacao deve existir");
assert.ok(html.includes('id="modal-confirm-titulo"'), "Elemento modal-confirm-titulo deve existir");
assert.ok(html.includes('id="modal-confirm-msg"'), "Elemento modal-confirm-msg deve existir");
assert.ok(html.includes('id="btn-modal-confirm-sim"'), "Elemento btn-modal-confirm-sim deve existir");
assert.ok(html.includes('id="btn-modal-confirm-nao"'), "Elemento btn-modal-confirm-nao deve existir");
console.log("   -> OK! Todos os 5 elementos essenciais existem no HTML com IDs corretos.");

// 2. Extração da função confirmarAcao do HTML
const fnMatch = html.match(/function confirmarAcao\([\s\S]+?\n    \}/);
assert.ok(fnMatch, "Função confirmarAcao deve estar presente no script");

// Monta ambiente de simulação do DOM
function criarAmbienteDom() {
  const listeners = { keydown: [] };
  const classListSet = new Set(["modal-overlay", "hidden"]);
  const elements = {
    "modal-confirmacao": {
      classList: {
        add(c) { classListSet.add(c); },
        remove(c) { classListSet.delete(c); },
        contains(c) { return classListSet.has(c); },
        has(c) { return classListSet.has(c); }
      },
      onclick: null
    },
    "modal-confirm-titulo": { innerText: "" },
    "modal-confirm-msg": { innerText: "" },
    "btn-modal-confirm-sim": { innerText: "", className: "btn btn-primary", onclick: null },
    "btn-modal-confirm-nao": { innerText: "", className: "btn btn-outline", onclick: null }
  };

  const dom = {
    document: {
      getElementById(id) {
        return elements[id] || null;
      }
    },
    window: {
      confirmCalled: false,
      confirm(msg) {
        this.confirmCalled = true;
        return true;
      },
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter(f => f !== fn);
        }
      },
      triggerKey(key) {
        (listeners.keydown || []).forEach(fn => fn({ key }));
      }
    },
    elements
  };

  // Cria a função no contexto do DOM simulado
  const fnFactory = new Function("document", "window", `return ${fnMatch[0]};`);
  const confirmarAcao = fnFactory(dom.document, dom.window);

  return { dom, confirmarAcao };
}

async function runTests() {
  // Teste 2: Confirmação positiva (clique em Confirmar)
  console.log("\n2. Testando clique em Confirmar (deve retornar true e limpar)...");
  {
    const { dom, confirmarAcao } = criarAmbienteDom();
    const promise = confirmarAcao("Título Teste", "Mensagem Teste", "Sim, Prosseguir", true);
    
    // Verifica atributos do modal aberto
    const modal = dom.document.getElementById("modal-confirmacao");
    const titulo = dom.document.getElementById("modal-confirm-titulo");
    const msg = dom.document.getElementById("modal-confirm-msg");
    const btnSim = dom.document.getElementById("btn-modal-confirm-sim");

    assert.strictEqual(modal.classList.has("hidden"), false, "Modal deve estar visível");
    assert.strictEqual(titulo.innerText, "Título Teste");
    assert.strictEqual(msg.innerText, "Mensagem Teste");
    assert.strictEqual(btnSim.innerText, "Sim, Prosseguir");
    assert.strictEqual(btnSim.className, "btn btn-danger");

    // Simula clique em Confirmar
    btnSim.onclick({ preventDefault: () => {} });
    const resultado = await promise;

    assert.strictEqual(resultado, true, "Deve resolver true");
    assert.strictEqual(modal.classList.has("hidden"), true, "Modal deve voltar a ser hidden");
    assert.strictEqual(btnSim.onclick, null, "Listener btnSim deve ser removido");
    assert.strictEqual(dom.document.getElementById("btn-modal-confirm-nao").onclick, null, "Listener btnNao deve ser removido");
    console.log("   -> OK! Confirmação positiva funciona e limpa o modal.");
  }

  // Teste 3: Cancelamento (clique em Cancelar)
  console.log("\n3. Testando clique em Cancelar (deve retornar false)...");
  {
    const { dom, confirmarAcao } = criarAmbienteDom();
    const promise = confirmarAcao("Cancelar Teste", "Deseja cancelar?");
    
    const btnNao = dom.document.getElementById("btn-modal-confirm-nao");
    btnNao.onclick({ preventDefault: () => {} });
    const resultado = await promise;

    assert.strictEqual(resultado, false, "Deve resolver false");
    assert.strictEqual(dom.elements["modal-confirmacao"].classList.has("hidden"), true);
    console.log("   -> OK! Cancelamento via botão funciona.");
  }

  // Teste 4: Cancelamento via tecla Escape
  console.log("\n4. Testando cancelamento via tecla Escape...");
  {
    const { dom, confirmarAcao } = criarAmbienteDom();
    const promise = confirmarAcao("Escape Teste", "Pressione Esc");
    
    dom.window.triggerKey("Escape");
    const resultado = await promise;

    assert.strictEqual(resultado, false, "Escape deve resolver false");
    assert.strictEqual(dom.elements["modal-confirmacao"].classList.has("hidden"), true);
    console.log("   -> OK! Tecla Escape cancela e fecha o modal.");
  }

  // Teste 5: Cancelamento via clique no Backdrop
  console.log("\n5. Testando clique no backdrop do modal...");
  {
    const { dom, confirmarAcao } = criarAmbienteDom();
    const promise = confirmarAcao("Backdrop Teste", "Clique fora");
    const modal = dom.document.getElementById("modal-confirmacao");
    
    modal.onclick({ target: modal });
    const resultado = await promise;

    assert.strictEqual(resultado, false, "Backdrop deve resolver false");
    assert.strictEqual(modal.classList.has("hidden"), true);
    console.log("   -> OK! Clique no backdrop fecha e cancela.");
  }

  // Teste 6: Fallback defensivo caso elementos faltem no DOM
  console.log("\n6. Testando robustez defensiva (quando elementos faltam no DOM)...");
  {
    const brokenDocument = {
      getElementById: () => null
    };
    const mockWindow = {
      confirmCalled: false,
      confirm: (msg) => true
    };
    const fnFactory = new Function("document", "window", `return ${fnMatch[0]};`);
    const confirmarAcaoBroken = fnFactory(brokenDocument, mockWindow);

    const resFallback = await confirmarAcaoBroken("Aviso", "Mensagem");
    assert.strictEqual(resFallback, true, "Fallback window.confirm deve funcionar sem lançar erro");
    console.log("   -> OK! Fallback nativo é acionado sem TypeError e sem travar o painel.");
  }

  // Teste 7: Verificação do prompt exato do teste de gravação
  console.log("\n7. Verificando texto e contratos do teste de gravação...");
  assert.ok(
    html.includes("Este teste criará temporariamente um evento técnico marcado como Livre e o removerá imediatamente. Deseja continuar?"),
    "Texto exato de confirmação de gravação deve estar no HTML"
  );
  assert.ok(html.includes("sucessoTotal = Boolean(res.ok && data.sucesso && data.eventoRemovido)"), "Validação de sucesso estrito deve estar implementada");
  assert.ok(html.includes("ALERTA CRÍTICO: FALHA NA REMOÇÃO DO EVENTO TÉCNICO!"), "Alerta crítico para falha de remoção deve estar implementado");
  assert.ok(html.includes("• <strong>Criação do evento técnico:</strong>"), "Status de criação deve ser mostrado separadamente");
  assert.ok(html.includes("• <strong>Remoção imediata:</strong>"), "Status de remoção deve ser mostrado separadamente");
  console.log("   -> OK! Todos os requisitos de exibição e segurança da gravação estão presentes.");

  console.log("\n=========================================================");
  console.log("TODOS OS TESTES DO MODAL E DO BOTÃO DE GRAVAÇÃO PASSARAM!");
  console.log("=========================================================\n");
}

runTests().catch(err => {
  console.error("FALHA NOS TESTES:", err);
  process.exit(1);
});
