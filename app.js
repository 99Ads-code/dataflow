/* ==========================================================
   DataFlow · lógica da aplicação
   ========================================================== */
"use strict";

const STATUS = STATUS_VALIDOS;            // definidos em api.js (iguais aos da planilha)
const PRIORIDADES = PRIORIDADES_VALIDAS;
const STATUS_COR = { "Pendente": "var(--st-pendente)", "Em processamento": "var(--st-andamento)", "Entregue": "var(--st-concluido)" };
const tituloPedido = p => [p.anunciante, p.campanha].filter(Boolean).join(" · ") || "(sem título)";
const SESSION_KEY = "dataflow_session";
const REFRESH_MS = 60_000;

const state = {
  session: null,
  pedidos: [],
  carregado: false,
  filtros: { busca: "", status: "", prioridade: "", ordem: "recentes" },
  modalId: null,
  timer: null
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtData = iso => {
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/* ---------------- Sessão ---------------- */
function lerSessao() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && s.token && new Date(s.tokenExpira) > new Date()) return s;
  } catch { /* ignora */ }
  localStorage.removeItem(SESSION_KEY);
  return null;
}
function salvarSessao(s) { state.session = s; localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function limparSessao() {
  state.session = null; state.pedidos = []; state.carregado = false;
  localStorage.removeItem(SESSION_KEY);
}

/** Chamada autenticada; trata sessão expirada em um único lugar. */
async function api(action, payload) {
  try {
    return await Api.call(action, payload, state.session?.token || "");
  } catch (err) {
    if (err.code === "AUTH") {
      limparSessao();
      toast("Sua sessão expirou. Entre novamente.", "error");
      location.hash = "#/login";
    }
    throw err;
  }
}

/* ---------------- Utilidades de UI ---------------- */
function toast(msg, tipo = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${tipo === "error" ? "error" : ""}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 300); }, tipo === "error" ? 5500 : 3200);
}

function ocupado(btn, on, textoOcupado) {
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = textoOcupado; }
  else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
  btn.disabled = on;
  btn.classList.toggle("busy", on);
}

function mostrarErro(id, msg) {
  const el = $(id);
  el.textContent = msg || "";
  el.hidden = !msg;
}

/* ---------------- Roteamento ---------------- */
const ROTAS = {
  "/login": { view: "view-login", publica: true },
  "/novo": { view: "view-novo" },
  "/painel": { view: "view-painel" }
};

function rotear() {
  state.session = lerSessao();
  let caminho = location.hash.replace(/^#/, "") || "/painel";
  let rota = ROTAS[caminho];
  if (!rota) { location.hash = "#/painel"; return; }

  // Proteção de telas
  if (!rota.publica && !state.session) { location.hash = "#/login"; return; }
  if (rota.publica && state.session) { location.hash = "#/painel"; return; }

  $$(".view").forEach(v => v.hidden = v.id !== rota.view);
  $("#topbar").hidden = !state.session;
  if (state.session) {
    $("#user-name").textContent = state.session.user.nome;
    $$("[data-nav]").forEach(a => {
      if (a.dataset.nav === caminho.slice(1)) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  clearInterval(state.timer);
  if (caminho === "/painel") { iniciarPainel(); state.timer = setInterval(() => carregarPedidos(true), REFRESH_MS); }
  if (caminho === "/novo") iniciarNovo();
  if (caminho === "/login") $("#demo-note").hidden = !Api.demo;
  window.scrollTo(0, 0);
  const foco = $(`#${rota.view} h1, #${rota.view} h2`);
  if (foco) { foco.setAttribute("tabindex", "-1"); foco.focus({ preventScroll: true }); }
}

/* ---------------- Login com Google ---------------- */
$("#btn-google").addEventListener("click", async e => {
  const btn = e.currentTarget;
  const rotulo = $("span", btn);
  const original = rotulo.textContent;
  mostrarErro("#login-error");
  rotulo.textContent = "Aguardando o Google…";
  btn.disabled = true;
  btn.classList.add("busy");
  try {
    const data = await Api.call("login");
    salvarSessao(data);
    toast(`Olá, ${data.user.nome.split(" ")[0]}!`);
    location.hash = "#/painel";
  } catch (err) {
    mostrarErro("#login-error", err.message);
  } finally {
    rotulo.textContent = original;
    btn.disabled = false;
    btn.classList.remove("busy");
  }
});

$("#btn-logout").addEventListener("click", async () => {
  const token = state.session?.token;
  limparSessao();
  location.hash = "#/login";
  try { await Api.call("logout", {}, token); } catch { /* sessão local já encerrada */ }
});

/* ---------------- Nova solicitação ---------------- */
const CAMPOS_FORM = { tipo: "#ped-tipo", app: "#ped-app", placement: "#ped-placement", solicitante: "#ped-solicitante" };

function preencherOpcoes(sel, lista, placeholder) {
  $(sel).innerHTML = (placeholder ? `<option value="">${placeholder}</option>` : "") + lista.map(o => `<option>${esc(o)}</option>`).join("");
}
const semAcento = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function montarListasDoFormulario() {
  const escolhido = Object.fromEntries(Object.values(CAMPOS_FORM).map(sel => [sel, $(sel).value]));
  preencherOpcoes("#ped-tipo", OPCOES.tipo, "Selecione");
  preencherOpcoes("#ped-app", OPCOES.app, "Selecione");
  preencherOpcoes("#ped-placement", OPCOES.placement, "Selecione");
  preencherOpcoes("#ped-solicitante", OPCOES.solicitante, "Selecione");
  // Mantém o que a pessoa já escolheu, se ainda existir na lista
  for (const [sel, valor] of Object.entries(escolhido)) {
    if (valor && [...$(sel).options].some(o => o.value === valor)) $(sel).value = valor;
  }
  // Pré-seleciona o solicitante quando o primeiro nome da conta Google está na lista (e nada foi escolhido)
  if (!$("#ped-solicitante").value) {
    const primeiro = semAcento(state.session.user.nome.split(" ")[0]);
    const achado = OPCOES.solicitante.find(n => semAcento(n) === primeiro);
    if (achado) $("#ped-solicitante").value = achado;
  }
}

function iniciarNovo() {
  montarListasDoFormulario();   // já mostra as listas conhecidas
  preencherOpcoes("#ped-prioridade", PRIORIDADES);
  $("#ped-prioridade").value = "Média";
  $("#ped-data-solicitacao").value = isoParaBr(hojeIso());
  $("#ped-data-entrega").min = hojeIso();
  mostrarErro("#ped-error");

  // Em seguida confere as listas reais da planilha e atualiza, se mudaram
  api("opcoes").then(() => { if (location.hash === "#/novo") montarListasDoFormulario(); }).catch(() => {});
}
$("#ped-descricao").addEventListener("input", e => { $("#desc-count").textContent = e.target.value.length; });

$("#form-pedido").addEventListener("submit", async e => {
  e.preventDefault();
  mostrarErro("#ped-error");
  const dados = {
    tipo: $("#ped-tipo").value,
    anunciante: $("#ped-anunciante").value.trim(),
    campanha: $("#ped-campanha").value.trim(),
    app: $("#ped-app").value,
    placement: $("#ped-placement").value,
    solicitante: $("#ped-solicitante").value,
    descricao: $("#ped-descricao").value.trim(),
    tamanhoMaximo: $("#ped-tamanho").value.trim(),
    dataEntrega: $("#ped-data-entrega").value,
    prioridade: $("#ped-prioridade").value
  };
  const faltando = [
    [!dados.tipo, "o tipo de solicitação", "#ped-tipo"], [!dados.anunciante, "o anunciante", "#ped-anunciante"],
    [!dados.campanha, "a campanha", "#ped-campanha"], [!dados.app, "o app", "#ped-app"],
    [!dados.placement, "o placement", "#ped-placement"], [!dados.solicitante, "o solicitante", "#ped-solicitante"],
    [dados.descricao.length < 10, "a descrição (mínimo de 10 caracteres)", "#ped-descricao"],
    [!dados.dataEntrega, "a data de entrega", "#ped-data-entrega"]
  ].find(([vazio]) => vazio);
  if (faltando) {
    mostrarErro("#ped-error", `Informe ${faltando[1]}.`);
    $(faltando[2]).focus();
    return;
  }
  if (dados.dataEntrega < hojeIso()) {
    mostrarErro("#ped-error", "A data de entrega não pode ser anterior a hoje.");
    $("#ped-data-entrega").focus();
    return;
  }

  const btn = $("button[type=submit]", e.target);
  ocupado(btn, true, "Salvando na planilha…");
  try {
    const ped = await api("createPedido", dados);
    state.pedidos.push(ped);
    e.target.reset();
    $("#desc-count").textContent = "0";
    toast("Solicitação enviada.");
    location.hash = "#/painel";
  } catch (err) {
    if (err.code !== "AUTH") mostrarErro("#ped-error", err.message);
  } finally { ocupado(btn, false); }
});

/* ---------------- Painel ---------------- */
function iniciarPainel() {
  if (!state.carregado) {
    $("#lista").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    $("#painel-sub").textContent = "Carregando pedidos…";
  } else { renderPainel(); }
  carregarPedidos(state.carregado);
}

async function carregarPedidos(silencioso = false) {
  try {
    state.pedidos = await api("listPedidos");
    state.carregado = true;
    if (location.hash === "#/painel") renderPainel();
    refrescarModal();
  } catch (err) {
    if (err.code !== "AUTH") {
      if (!silencioso || !state.carregado) toast(err.message, "error");
      if (!state.carregado) $("#lista").innerHTML = `<div class="empty"><h3>Não foi possível carregar os pedidos</h3><p>${esc(err.message)}</p><button class="btn btn-primary" id="retry" type="button">Tentar de novo</button></div>`;
    }
  }
}
document.addEventListener("click", e => { if (e.target.id === "retry") carregarPedidos(); });

const ordemPrioridade = p => PRIORIDADES.indexOf(p);

function pedidosFiltrados() {
  const { busca, status, prioridade, ordem } = state.filtros;
  const q = busca.trim().toLowerCase();
  const lista = state.pedidos.filter(p =>
    (!status || p.status === status) &&
    (!prioridade || p.prioridade === prioridade) &&
    (!q || `${p.anunciante} ${p.campanha} ${p.descricao} ${p.solicitante} ${p.tipo} ${p.app} ${p.placement}`.toLowerCase().includes(q))
  );
  const porData = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const cmp = {
    recentes: porData,
    antigos: (a, b) => -porData(a, b),
    "prioridade-desc": (a, b) => ordemPrioridade(b.prioridade) - ordemPrioridade(a.prioridade) || porData(a, b),
    "prioridade-asc": (a, b) => ordemPrioridade(a.prioridade) - ordemPrioridade(b.prioridade) || porData(a, b),
    status: (a, b) => STATUS.indexOf(a.status) - STATUS.indexOf(b.status) || porData(a, b)
  }[ordem];
  return lista.sort(cmp);
}

function renderPainel() {
  renderPipeline();
  const lista = pedidosFiltrados();
  const total = state.pedidos.length;
  $("#painel-sub").textContent = total === 0
    ? "Nenhum pedido registrado ainda."
    : `${lista.length} de ${total} ${total === 1 ? "pedido" : "pedidos"} em exibição`;

  const el = $("#lista");
  if (lista.length === 0) {
    el.innerHTML = total === 0
      ? `<div class="empty"><h3>Sem pedidos por aqui</h3><p>Faça a primeira solicitação de base, segmentação ou audiência.</p><a class="btn btn-primary" href="#/novo">Nova solicitação</a></div>`
      : `<div class="empty"><h3>Nada encontrado</h3><p>Nenhum pedido corresponde aos filtros atuais.</p><button class="btn btn-ghost" id="limpar" type="button">Limpar filtros</button></div>`;
    return;
  }
  el.innerHTML = lista.map(cardPedido).join("");
}

function renderPipeline() {
  const cont = Object.fromEntries(STATUS.map(s => [s, 0]));
  state.pedidos.forEach(p => { if (p.status in cont) cont[p.status]++; });
  $("#pipeline").style.setProperty("--n", STATUS.length + 1);
  const total = `
    <button type="button" class="stage stage-total" data-status="" style="--c:#7cc4d1" title="Mostrar todas as solicitações">
      <span class="stage-count">${state.pedidos.length}</span>
      <span class="stage-name">Total de solicitações</span>
    </button>`;
  $("#pipeline").innerHTML = total + STATUS.map(s => `
    <button type="button" class="stage" data-status="${s}" style="--c:${STATUS_COR[s]}" aria-pressed="${state.filtros.status === s}">
      <span class="stage-count">${cont[s]}</span>
      <span class="stage-name">${s}</span>
    </button>`).join("");
}

const selectOpcoes = (lista, atual) => (lista.includes(atual) || !atual ? lista : [...lista, atual]).map(o => `<option${o === atual ? " selected" : ""}>${o}</option>`).join("");

function cardPedido(p) {
  const titulo = tituloPedido(p);
  return `
  <article class="pedido" data-id="${esc(p.id)}" data-status="${esc(p.status)}" data-prioridade="${esc(p.prioridade)}">
    <div class="pedido-main">
      <button class="pedido-title" type="button" data-abrir="${esc(p.id)}">${esc(titulo)}</button>
      <div class="pedido-tags">
        ${[p.tipo, p.app, p.placement].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join("")}
      </div>
      <p class="pedido-desc">${esc(p.descricao)}</p>
      <div class="pedido-meta">
        <span>Solicitado em ${esc(p.dataSolicitacao || fmtData(p.createdAt))}</span>
        <span>Entrega: ${esc(p.dataEntrega || "—")}</span>
        <span>Solicitante: ${esc(p.solicitante)}</span>
      </div>
    </div>
    <div class="pedido-controls">
      <select class="pill" data-kind="status" data-v="${esc(p.status)}" data-campo="status" aria-label="Status de ${esc(titulo)}">${selectOpcoes(STATUS, p.status)}</select>
      <select class="pill" data-kind="prioridade" data-v="${esc(p.prioridade)}" data-campo="prioridade" aria-label="Prioridade de ${esc(titulo)}">${selectOpcoes(PRIORIDADES, p.prioridade)}</select>
    </div>
  </article>`;
}

/** Atualiza status/prioridade com atualização otimista e reversão em caso de falha. */
async function atualizarPedido(id, campo, valor, selectEl) {
  const ped = state.pedidos.find(p => p.id === id);
  if (!ped || ped[campo] === valor) return;
  const anterior = ped[campo];
  ped[campo] = valor;

  const card = $(`.pedido[data-id="${CSS.escape(id)}"]`);
  const aplicar = (v) => {
    if (selectEl) { selectEl.dataset.v = v; selectEl.value = v; }
    if (card) card.dataset[campo] = v;
  };
  aplicar(valor);
  card?.classList.add("saving");
  renderPipelineSomente();

  try {
    const salvo = await api("updatePedido", { id, [campo]: valor });
    Object.assign(ped, salvo);
    toast(`${campo === "status" ? "Status" : "Prioridade"} alterado para ${valor}.`);
  } catch (err) {
    ped[campo] = anterior;
    aplicar(anterior);
    renderPipelineSomente();
    if (err.code !== "AUTH") toast(`Não foi possível salvar na planilha. ${err.message}`, "error");
  } finally {
    card?.classList.remove("saving");
    refrescarModal();
    // Reaplica filtro/ordenação depois que a transição visual termina
    setTimeout(() => { if (location.hash === "#/painel" && !$(".pedido.saving")) renderPainel(); }, 450);
  }
}

function renderPipelineSomente() { renderPipeline(); }

/* O filtro de status usa a mesma lista de status do restante do app */
$("#f-status").innerHTML = '<option value="">Todos os status</option>' + STATUS.map(s => `<option>${esc(s)}</option>`).join("");

/* Eventos do painel */
$("#lista").addEventListener("change", e => {
  const sel = e.target.closest("select.pill");
  if (!sel) return;
  const id = sel.closest(".pedido").dataset.id;
  atualizarPedido(id, sel.dataset.campo, sel.value, sel);
});
$("#lista").addEventListener("click", e => {
  const abrir = e.target.closest("[data-abrir]");
  if (abrir) abrirModal(abrir.dataset.abrir);
  if (e.target.id === "limpar") limparFiltros();
});
$("#pipeline").addEventListener("click", e => {
  const stage = e.target.closest(".stage");
  if (!stage) return;
  const s = stage.dataset.status;
  state.filtros.status = state.filtros.status === s ? "" : s;
  $("#f-status").value = state.filtros.status;
  renderPainel();
});

function limparFiltros() {
  state.filtros = { busca: "", status: "", prioridade: "", ordem: state.filtros.ordem };
  $("#f-busca").value = ""; $("#f-status").value = ""; $("#f-prioridade").value = "";
  renderPainel();
}

let tBusca;
$("#f-busca").addEventListener("input", e => { clearTimeout(tBusca); tBusca = setTimeout(() => { state.filtros.busca = e.target.value; renderPainel(); }, 180); });
$("#f-status").addEventListener("change", e => { state.filtros.status = e.target.value; renderPainel(); });
$("#f-prioridade").addEventListener("change", e => { state.filtros.prioridade = e.target.value; renderPainel(); });
$("#f-ordem").addEventListener("change", e => { state.filtros.ordem = e.target.value; renderPainel(); });

/* ---------------- Modal de detalhe ---------------- */
function abrirModal(id) {
  state.modalId = id;
  refrescarModal();
  const dlg = $("#modal");
  if (!dlg.open) dlg.showModal();
}
function refrescarModal() {
  const dlg = $("#modal");
  if (!state.modalId) return;
  const p = state.pedidos.find(x => x.id === state.modalId);
  if (!p) return;
  if (dlg.open && document.activeElement && dlg.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
  $("#modal-body").innerHTML = `
    <h2 id="modal-title">${esc(tituloPedido(p))}</h2>
    <dl>
      <dt>Tipo</dt><dd>${esc(p.tipo || "—")}</dd>
      <dt>App</dt><dd>${esc(p.app || "—")}</dd>
      <dt>Placement</dt><dd>${esc(p.placement || "—")}</dd>
      <dt>Solicitante</dt><dd>${esc(p.solicitante)}${p.solicitanteEmail ? ` (${esc(p.solicitanteEmail)})` : ""}</dd>
      <dt>Tamanho máximo</dt><dd>${esc(p.tamanhoMaximo || "-")}</dd>
      <dt>Solicitado em</dt><dd>${esc(p.dataSolicitacao || "—")}${p.createdAt ? ` (${fmtData(p.createdAt)})` : ""}</dd>
      <dt>Entrega</dt><dd>${esc(p.dataEntrega || "—")}</dd>
      <dt>Última alteração</dt><dd>${p.atualizadoEm ? fmtData(p.atualizadoEm) : "—"}${p.atualizadoPor ? ` por ${esc(p.atualizadoPor)}` : ""}</dd>
    </dl>
    <div class="modal-controls">
      <div><label for="m-status">Status</label>
        <select id="m-status" class="pill" data-kind="status" data-v="${esc(p.status)}" data-campo="status">${selectOpcoes(STATUS, p.status)}</select></div>
      <div><label for="m-prioridade">Prioridade</label>
        <select id="m-prioridade" class="pill" data-kind="prioridade" data-v="${esc(p.prioridade)}" data-campo="prioridade">${selectOpcoes(PRIORIDADES, p.prioridade)}</select></div>
    </div>
    <div class="modal-desc">${esc(p.descricao)}</div>
    <div class="modal-actions"><button class="btn btn-ghost" type="button" id="m-fechar">Fechar</button></div>`;
}
$("#modal").addEventListener("change", e => {
  const sel = e.target.closest("select.pill");
  if (sel && state.modalId) atualizarPedido(state.modalId, sel.dataset.campo, sel.value, sel);
});
$("#modal").addEventListener("click", e => {
  if (e.target.id === "m-fechar" || e.target === $("#modal")) $("#modal").close();
});
$("#modal").addEventListener("close", () => {
  state.modalId = null;
  if (location.hash === "#/painel") renderPainel();
});

/* ---------------- Inicialização ---------------- */
window.addEventListener("hashchange", rotear);
rotear();
