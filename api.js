/* ==========================================================
   DataFlow · camada de acesso aos dados
   ----------------------------------------------------------
   Login com a conta Google do navegador (Google Identity
   Services). O navegador usa o token dessa conta para ler e
   gravar na planilha pela Google Sheets API v4: quem pode ver
   ou editar os pedidos é quem tem acesso à planilha no Google.

   O Client ID, o ID da planilha e o nome da aba de pedidos
   vêm de /config.json (.env). Se a página for aberta direto
   do disco (file://), roda em MODO DEMO (localStorage).
   ========================================================== */
const CONFIG = { CLIENT_ID: "", SPREADSHEET_ID: "", ABA_PEDIDOS: "99 Ads Tag Request", SESSION_HOURS: 12 };
const DEMO = location.protocol === "file:";

const configPronta = DEMO ? Promise.resolve() : fetch("/config.json", { cache: "no-store" })
  .then(r => r.json())
  .then(c => {
    CONFIG.CLIENT_ID = c.clientId || "";
    CONFIG.SPREADSHEET_ID = c.spreadsheetId || "";
    if (c.abaPedidos) CONFIG.ABA_PEDIDOS = c.abaPedidos;
  })
  .catch(() => {});

/* ---------------- Estrutura das abas ---------------- */
const ABA_USUARIOS = "Usuarios";
const COLS_USUARIOS = ["id", "nome", "email", "criadoEm", "ultimoAcesso"];

/*
  Aba de pedidos = planilha "99 Ads Tag Request".
  Colunas A:K: exatamente as da planilha. Colunas L:Q: apoio do painel (ID, datas exatas, prioridade...).
  [chave usada no código, cabeçalho na planilha]
*/
const CAMPOS_PEDIDO = [
  ["tipo", "Tipo de solicitação"],
  ["anunciante", "Anunciante"],
  ["campanha", "Campanha"],
  ["app", "App"],
  ["placement", "Placement"],
  ["solicitante", "Solicitante"],
  ["descricao", "Descrição"],
  ["tamanhoMaximo", "Tamanho Máximo (se aplicável)"],
  ["dataSolicitacao", "Data da solicitação"],
  ["dataEntrega", "Data de entrega"],
  ["status", "Status"],
  ["id", "ID"],
  ["createdAt", "Criado em (data e hora)"],
  ["prioridade", "Prioridade"],
  ["atualizadoEm", "Atualizado em"],
  ["atualizadoPor", "Atualizado por"],
  ["solicitanteEmail", "E-mail do solicitante"]
];
const COLS_PEDIDOS = CAMPOS_PEDIDO.map(c => c[0]);
const HEADERS_PEDIDOS = CAMPOS_PEDIDO.map(c => c[1]);
const N_COLS_PLANILHA = 11; // A:K

// Opções das listas suspensas. Estas são as da planilha atual e servem de reserva:
// ao abrir a tela de Nova solicitação, o app lê as listas reais da aba (validação de dados) e as substitui.
const OPCOES = {
  tipo: ["Base Nova", "Update"],
  app: ["Pax", "Driver"],
  placement: ["In-App", "Out-of-App"],
  solicitante: ["Kike", "Gabi", "Gui", "Mari"]
};
// Opções que o app sempre acrescenta à lista da planilha (sem duplicar). Útil para incluir nomes
// no formulário sem depender da validação de dados do Google Sheets.
const OPCOES_EXTRAS = {
  solicitante: ["Vivi", "Henrique", "Eliz"]
};
const juntarOpcoes = (campo, base) => [...new Set([...base, ...(OPCOES_EXTRAS[campo] || [])])];
OPCOES.solicitante = juntarOpcoes("solicitante", OPCOES.solicitante);

const STATUS_VALIDOS = ["Pendente", "Em andamento", "Concluído"];
// Nomes antigos que ainda podem estar na planilha; o painel os mostra com o nome novo (a planilha só muda quando o status é alterado)
const STATUS_ALIASES = { "Entregue": "Concluído", "Em processamento": "Em andamento" };
const PRIORIDADES_VALIDAS = ["Baixa", "Média", "Alta", "Urgente"];

/* ---------------- Datas (a planilha usa dd/mm/aaaa) ---------------- */
const pad2 = n => String(n).padStart(2, "0");
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const isoParaBr = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const brParaIso = br => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(br || "").trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 12).toISOString() : "";
};

/** UUID com alternativa para contextos não seguros (ex.: acesso por IP da rede). */
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code || "ERROR"; }
}

/** Valida e normaliza os campos de um novo pedido. Usado no modo Google e no demo. */
function montarPedido(p, usuario) {
  const txt = (v, max) => String(v ?? "").trim().slice(0, max);
  const ped = {
    tipo: txt(p.tipo, 40), anunciante: txt(p.anunciante, 120), campanha: txt(p.campanha, 120),
    app: txt(p.app, 40), placement: txt(p.placement, 40), solicitante: txt(p.solicitante, 60),
    descricao: txt(p.descricao, 2000), tamanhoMaximo: txt(p.tamanhoMaximo, 80) || "-",
    prioridade: p.prioridade || "Média"
  };
  if (!OPCOES.tipo.includes(ped.tipo)) throw new ApiError("Escolha o tipo de solicitação.");
  if (ped.anunciante.length < 2) throw new ApiError("Informe o anunciante.");
  if (ped.campanha.length < 2) throw new ApiError("Informe a campanha.");
  if (!OPCOES.app.includes(ped.app)) throw new ApiError("Escolha o app.");
  if (!OPCOES.placement.includes(ped.placement)) throw new ApiError("Escolha o placement.");
  if (!OPCOES.solicitante.includes(ped.solicitante)) throw new ApiError("Escolha o solicitante.");
  if (ped.descricao.length < 10) throw new ApiError("Descreva a solicitação com pelo menos 10 caracteres.");
  if (!PRIORIDADES_VALIDAS.includes(ped.prioridade)) throw new ApiError("Prioridade inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dataEntrega || "")) throw new ApiError("Informe a data de entrega.");
  if (p.dataEntrega < hojeIso()) throw new ApiError("A data de entrega não pode ser anterior a hoje.");

  const agora = new Date().toISOString();
  return {
    ...ped,
    dataSolicitacao: isoParaBr(hojeIso()),
    dataEntrega: isoParaBr(p.dataEntrega),
    status: "Pendente",
    id: uuid(),
    createdAt: agora,
    atualizadoEm: agora,
    atualizadoPor: usuario.nome,
    solicitanteEmail: usuario.email
  };
}

/* ---------------- Login Google (OAuth) ---------------- */
const ESCOPOS = "https://www.googleapis.com/auth/spreadsheets openid email profile";

const Google = {
  client: null,

  iniciar() {
    if (this.client) return;
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      throw new ApiError("A biblioteca de login do Google não carregou. Verifique a conexão e bloqueadores de conteúdo.", "NETWORK");
    }
    this.client = google.accounts.oauth2.initTokenClient({ client_id: CONFIG.CLIENT_ID, scope: ESCOPOS, callback: () => {} });
  },

  /** Abre o seletor de contas do Google (contas já logadas no navegador). */
  pedir() {
    return new Promise((resolve, reject) => {
      try { this.iniciar(); } catch (e) { return reject(e); }
      this.client.callback = r => {
        if (r.error) {
          return reject(new ApiError(r.error === "access_denied"
            ? "Você não autorizou o acesso. Tente de novo e aceite as permissões."
            : "O Google recusou o login (" + r.error + ").", "GAUTH"));
        }
        if (!String(r.scope || "").includes("auth/spreadsheets")) {
          return reject(new ApiError("Marque a permissão de planilhas na tela do Google. Sem ela o app não consegue acessar os pedidos.", "GAUTH"));
        }
        resolve({ token: r.access_token, expira: Date.now() + (Number(r.expires_in) - 60) * 1000 });
      };
      this.client.error_callback = e => reject(new ApiError(
        e.type === "popup_closed"
          ? "A janela de login do Google foi fechada antes de concluir."
          : "Não foi possível abrir o login do Google. Permita pop-ups para este site e tente de novo.", "GAUTH"));
      this.client.requestAccessToken({ prompt: "" });
    });
  }
};

/* ---------------- Google Sheets API v4 ---------------- */
const SHEETS_URL = () => "https://sheets.googleapis.com/v4/spreadsheets/" + CONFIG.SPREADSHEET_ID;
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

async function sheets(caminho, token, opcoes = {}) {
  let resp;
  try {
    resp = await fetch(SHEETS_URL() + caminho, {
      ...opcoes,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
    });
  } catch {
    throw new ApiError("Não foi possível conectar ao Google Sheets. Verifique sua internet.", "NETWORK");
  }
  if (resp.ok) return resp.json();

  const detalhe = await resp.json().catch(() => ({}));
  const msg = (detalhe.error && detalhe.error.message) || "";
  if (resp.status === 401) throw new ApiError("Sua sessão do Google expirou. Entre novamente.", "AUTH");
  if (resp.status === 403) {
    if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) {
      throw new ApiError("A Google Sheets API não está ativada no projeto do Google Cloud deste app.");
    }
    throw new ApiError("Sua conta Google não tem acesso de edição à planilha. Peça acesso de Editor ao dono da planilha.");
  }
  if (resp.status === 404) throw new ApiError("Planilha não encontrada. Confira o SPREADSHEET_ID no .env.");
  if (resp.status === 429) throw new ApiError("Limite de uso da Google Sheets API atingido. Tente de novo em instantes.");
  throw new ApiError(msg || "Erro ao acessar a planilha (" + resp.status + ").");
}

const ultimaColuna = cols => String.fromCharCode(64 + cols.length);
const letraDe = chave => String.fromCharCode(65 + COLS_PEDIDOS.indexOf(chave));
/** Nome de aba entre aspas simples (obrigatório quando há espaços, como em "99 Ads Tag Request"). */
const aba = nome => "'" + nome.replace(/'/g, "''") + "'";
const faixa = (nome, a1) => encodeURIComponent(aba(nome) + "!" + a1);
const fixo = v => String(v ?? "").trim();

let abasPreparadas = false;
/** Cria as abas que faltam, confere os cabeçalhos e completa as colunas de apoio. */
async function prepararAbas(token) {
  if (abasPreparadas) return;
  const meta = await sheets("?fields=sheets.properties.title", token);
  const existentes = meta.sheets.map(s => s.properties.title);
  const abas = [
    [ABA_USUARIOS, COLS_USUARIOS, COLS_USUARIOS, COLS_USUARIOS.length],
    [CONFIG.ABA_PEDIDOS, COLS_PEDIDOS, HEADERS_PEDIDOS, N_COLS_PLANILHA]
  ];

  const faltando = abas.filter(([nome]) => !existentes.includes(nome));
  if (faltando.length) {
    await sheets(":batchUpdate", token, {
      method: "POST",
      body: JSON.stringify({ requests: faltando.map(([nome]) => ({ addSheet: { properties: { title: nome, gridProperties: { frozenRowCount: 1 } } } })) })
    });
  }

  for (const [nome, cols, headers, obrigatorias] of abas) {
    const ult = ultimaColuna(cols);
    const r = await sheets("/values/" + faixa(nome, "A1:" + ult + "1"), token);
    const atual = ((r.values && r.values[0]) || []).map(fixo);

    if (atual.every(v => v === "")) {
      await sheets("/values/" + faixa(nome, "A1:" + ult + "1") + "?valueInputOption=RAW", token, {
        method: "PUT", body: JSON.stringify({ values: [headers] })
      });
      continue;
    }
    // Colunas obrigatórias: precisam ser exatamente as esperadas
    if (!headers.slice(0, obrigatorias).every((h, i) => atual[i] === h)) {
      throw new ApiError(`A aba "${nome}" tem colunas diferentes do esperado (${headers.slice(0, obrigatorias).join(", ")}). Ajuste os cabeçalhos da linha 1 ou renomeie a aba e entre de novo.`);
    }
    // Colunas de apoio: preenche as que estiverem vazias; se houver algo diferente, avisa
    const extras = headers.slice(obrigatorias);
    if (extras.length) {
      const atuaisExtras = extras.map((_, i) => atual[obrigatorias + i] || "");
      if (atuaisExtras.some((v, i) => v !== "" && v !== extras[i])) {
        throw new ApiError(`A aba "${nome}" já usa as colunas ${String.fromCharCode(65 + obrigatorias)} em diante com outros cabeçalhos. Elas são reservadas ao DataFlow (${extras.join(", ")}).`);
      }
      if (atuaisExtras.some(v => v === "")) {
        await sheets("/values/" + faixa(nome, `${String.fromCharCode(65 + obrigatorias)}1:${ult}1`) + "?valueInputOption=RAW", token, {
          method: "PUT", body: JSON.stringify({ values: [extras] })
        });
      }
    }
  }
  abasPreparadas = true;
}

async function lerAba(nome, cols, token, temDados = o => o.id) {
  await prepararAbas(token);
  const r = await sheets("/values/" + faixa(nome, "A2:" + ultimaColuna(cols)), token);
  return (r.values || []).map((linha, i) => {
    const o = { _linha: i + 2 };
    cols.forEach((c, j) => { o[c] = linha[j] === undefined ? "" : String(linha[j]); });
    return o;
  }).filter(temDados);
}

function acrescentarLinha(nome, cols, obj, token) {
  return sheets("/values/" + faixa(nome, "A1") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", token, {
    method: "POST", body: JSON.stringify({ values: [cols.map(c => obj[c])] })
  });
}

function gravarLinha(nome, cols, linha, obj, token) {
  return sheets("/values/" + faixa(nome, "A" + linha + ":" + ultimaColuna(cols) + linha) + "?valueInputOption=RAW", token, {
    method: "PUT", body: JSON.stringify({ values: [cols.map(c => obj[c])] })
  });
}

/** Atualiza só algumas células de uma linha de pedido, sem tocar nas demais colunas. */
function atualizarCelulas(linha, campos, token) {
  const data = Object.entries(campos).map(([k, v]) => ({ range: `${aba(CONFIG.ABA_PEDIDOS)}!${letraDe(k)}${linha}`, values: [[v]] }));
  return sheets("/values:batchUpdate", token, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
}

/**
 * Lê as listas suspensas (validação de dados) da linha 2 da aba de pedidos e atualiza OPCOES.
 * Colunas: A = tipo, D = app, E = placement, F = solicitante. Se uma coluna não tiver lista, mantém a reserva.
 * Os nomes de OPCOES_EXTRAS são somados à lista da planilha.
 */
async function carregarOpcoes(token) {
  const faixaLinha2 = encodeURIComponent(`${aba(CONFIG.ABA_PEDIDOS)}!A2:K2`);
  const r = await sheets(`?ranges=${faixaLinha2}&fields=sheets.data.rowData.values.dataValidation`, token);
  const celulas = (((r.sheets || [])[0] || {}).data || [])[0]?.rowData?.[0]?.values || [];
  const listaDaColuna = i => {
    const cond = celulas[i] && celulas[i].dataValidation && celulas[i].dataValidation.condition;
    if (!cond || cond.type !== "ONE_OF_LIST") return null;
    const itens = (cond.values || []).map(v => fixo(v.userEnteredValue)).filter(Boolean);
    return itens.length ? [...new Set(itens)] : null;
  };
  for (const [campo, indice] of Object.entries({ tipo: 0, app: 3, placement: 4, solicitante: 5 })) {
    const lista = listaDaColuna(indice);
    if (lista) OPCOES[campo] = juntarOpcoes(campo, lista);
  }
  return OPCOES;
}

/** Linhas digitadas direto na planilha podem não ter prioridade nem data/hora exata; completa só para exibir. */
function normalizarPedido(o) {
  return {
    ...o,
    status: STATUS_ALIASES[fixo(o.status)] || fixo(o.status),
    prioridade: PRIORIDADES_VALIDAS.includes(o.prioridade) ? o.prioridade : "Média",
    createdAt: o.createdAt || brParaIso(o.dataSolicitacao),
    atualizadoEm: o.atualizadoEm || ""
  };
}
const pedidoPublico = o => Object.fromEntries(COLS_PEDIDOS.map(c => [c, o[c]]));
const linhaTemDados = o => o.id || COLS_PEDIDOS.slice(0, N_COLS_PLANILHA).some(c => fixo(o[c]));

/** Usuário da sessão atual (gravado no navegador após o login). */
function usuarioDaSessao(token) {
  if (!token) throw new ApiError("Sessão expirada. Entre novamente.", "AUTH");
  let u;
  try { u = JSON.parse(localStorage.getItem("dataflow_session") || "{}").user; } catch { /* ignora */ }
  if (!u || !u.email) throw new ApiError("Sessão expirada. Entre novamente.", "AUTH");
  return u;
}

const SheetsApi = {
  async run(action, p, token) {
    await configPronta;
    switch (action) {
      case "login": {
        if (!CONFIG.CLIENT_ID) throw new ApiError("O login do Google ainda não foi configurado. Defina GOOGLE_CLIENT_ID no arquivo .env e reinicie o servidor.");
        const g = await Google.pedir();

        let info;
        try {
          const r = await fetch(USERINFO_URL, { headers: { Authorization: "Bearer " + g.token } });
          info = await r.json();
          if (!r.ok || !info.email) throw new Error();
        } catch { throw new ApiError("Não foi possível identificar sua conta Google. Tente de novo."); }

        abasPreparadas = false;
        const email = info.email.toLowerCase();
        const agora = new Date().toISOString();
        let u = (await lerAba(ABA_USUARIOS, COLS_USUARIOS, g.token)).find(x => x.email === email);
        if (!u) {
          u = { id: uuid(), nome: info.name || email, email, criadoEm: agora, ultimoAcesso: agora };
          await acrescentarLinha(ABA_USUARIOS, COLS_USUARIOS, u, g.token);
        } else {
          u.ultimoAcesso = agora;
          await gravarLinha(ABA_USUARIOS, COLS_USUARIOS, u._linha, u, g.token);
        }
        return { token: g.token, tokenExpira: new Date(g.expira).toISOString(), user: { id: u.id, nome: u.nome, email } };
      }
      case "logout": return true;

      case "opcoes": {
        usuarioDaSessao(token);
        await prepararAbas(token);
        try { await carregarOpcoes(token); } catch (e) { if (e.code === "AUTH") throw e; /* mantém as listas de reserva */ }
        return OPCOES;
      }

      case "listPedidos": {
        usuarioDaSessao(token);
        const linhas = await lerAba(CONFIG.ABA_PEDIDOS, COLS_PEDIDOS, token, linhaTemDados);
        // Linhas que já existiam na planilha (sem ID) são "adotadas": recebem um ID para poderem ser editadas no painel
        const semId = linhas.filter(o => !o.id);
        if (semId.length) {
          semId.forEach(o => { o.id = uuid(); });
          try {
            await sheets("/values:batchUpdate", token, {
              method: "POST",
              body: JSON.stringify({ valueInputOption: "RAW", data: semId.map(o => ({ range: `${aba(CONFIG.ABA_PEDIDOS)}!${letraDe("id")}${o._linha}`, values: [[o.id]] })) })
            });
          } catch (e) { if (e.code === "AUTH") throw e; /* sem permissão de edição: segue só leitura */ }
        }
        return linhas.map(o => pedidoPublico(normalizarPedido(o)));
      }

      case "createPedido": {
        const u = usuarioDaSessao(token);
        const ped = montarPedido(p, u);
        await prepararAbas(token);
        await acrescentarLinha(CONFIG.ABA_PEDIDOS, COLS_PEDIDOS, ped, token);
        return ped;
      }

      case "updatePedido": {
        const u = usuarioDaSessao(token);
        if (p.status && !STATUS_VALIDOS.includes(p.status)) throw new ApiError("Status inválido.");
        if (p.prioridade && !PRIORIDADES_VALIDAS.includes(p.prioridade)) throw new ApiError("Prioridade inválida.");
        const ped = (await lerAba(CONFIG.ABA_PEDIDOS, COLS_PEDIDOS, token, linhaTemDados)).find(x => x.id === p.id);
        if (!ped) throw new ApiError("Pedido não encontrado. Atualize o painel e tente de novo.");
        const agora = new Date().toISOString();
        const campos = { atualizadoEm: agora, atualizadoPor: u.nome };
        if (p.status) campos.status = p.status;
        if (p.prioridade) campos.prioridade = p.prioridade;
        await atualizarCelulas(ped._linha, campos, token);
        return pedidoPublico(normalizarPedido({ ...ped, ...campos }));
      }
    }
    throw new ApiError("Ação desconhecida.");
  }
};

/* ---------------- Modo demonstração (localStorage) ---------------- */
const Demo = {
  KEY: "dataflow_demo_db",
  load() { return JSON.parse(localStorage.getItem(this.KEY) || '{"usuarios":[],"pedidos":[]}'); },
  save(db) { localStorage.setItem(this.KEY, JSON.stringify(db)); },
  delay: () => new Promise(r => setTimeout(r, 350)),
  uid: () => uuid(),
  user(db, token) {
    const u = db.usuarios.find(x => x.token && x.token === token && new Date(x.tokenExpira) > new Date());
    if (!u) throw new ApiError("Sessão expirada. Entre novamente.", "AUTH");
    return u;
  },
  async run(action, p, token) {
    await this.delay();
    const db = this.load();
    switch (action) {
      case "login": {
        let u = db.usuarios.find(x => x.email === "demo@local");
        if (!u) {
          u = { id: this.uid(), nome: "Usuário Demo", email: "demo@local", criadoEm: new Date().toISOString() };
          db.usuarios.push(u);
          if (db.pedidos.length === 0) db.pedidos.push(...this.exemplos(u.nome, u.email));
        }
        u.token = this.uid();
        u.tokenExpira = new Date(Date.now() + CONFIG.SESSION_HOURS * 3600e3).toISOString();
        this.save(db);
        return { token: u.token, tokenExpira: u.tokenExpira, user: { id: u.id, nome: u.nome, email: u.email } };
      }
      case "logout": {
        const u = db.usuarios.find(x => x.token === token);
        if (u) { u.token = ""; this.save(db); }
        return true;
      }
      case "opcoes": this.user(db, token); return OPCOES;
      case "listPedidos": this.user(db, token); return db.pedidos.map(normalizarPedido);
      case "createPedido": {
        const u = this.user(db, token);
        const ped = montarPedido(p, u);
        db.pedidos.push(ped); this.save(db); return ped;
      }
      case "updatePedido": {
        const u = this.user(db, token);
        const ped = db.pedidos.find(x => x.id === p.id);
        if (!ped) throw new ApiError("Pedido não encontrado.");
        if (p.status) ped.status = p.status;
        if (p.prioridade) ped.prioridade = p.prioridade;
        ped.atualizadoEm = new Date().toISOString(); ped.atualizadoPor = u.nome;
        this.save(db); return normalizarPedido(ped);
      }
    }
    throw new ApiError("Ação desconhecida.");
  },
  exemplos(nome, email) {
    const h = n => new Date(Date.now() - n * 3600e3);
    const br = d => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
    const mk = (horas, diasEntrega, o) => {
      const criado = h(horas), entrega = new Date(criado.getTime() + diasEntrega * 864e5);
      return {
        tamanhoMaximo: "-", solicitanteEmail: email, atualizadoPor: nome, prioridade: "Média", status: "Pendente",
        ...o, id: this.uid(), dataSolicitacao: br(criado), dataEntrega: br(entrega),
        createdAt: criado.toISOString(), atualizadoEm: criado.toISOString()
      };
    };
    return [
      mk(70, 1, { tipo: "Base Nova", anunciante: "Unilever", campanha: "Cadastra", app: "Pax", placement: "In-App", solicitante: "Gabi", descricao: "Usuários de 99 Compras", status: "Concluído" }),
      mk(30, 3, { tipo: "Update", anunciante: "Estapar", campanha: "IPVA", app: "Driver", placement: "In-App", solicitante: "Kike", descricao: "Atualizar a base de motoristas de Curitiba que abriram o app nos últimos 30 dias.", prioridade: "Alta", status: "Em andamento" }),
      mk(5, 2, { tipo: "Base Nova", anunciante: "GOV", campanha: "IPVA Moto", app: "Driver", placement: "Out-of-App", solicitante: "Mari", descricao: "Motociclistas de 18+ na cidade de São Paulo, com e-mail válido.", tamanhoMaximo: "500 mil", prioridade: "Urgente" })
    ];
  }
};

/* ---------------- Interface pública ---------------- */
const Api = {
  demo: DEMO,
  call(action, payload = {}, token = "") {
    return DEMO ? Demo.run(action, payload, token) : SheetsApi.run(action, payload, token);
  }
};
