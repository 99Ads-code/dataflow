/**
 * DataFlow · servidor local (Node.js 18+, sem dependências)
 *
 * Serve o front-end (pasta public/) e entrega a configuração do login Google
 * em /config.json. O acesso à planilha é feito pelo navegador, com a conta
 * Google de quem entrou; este servidor não guarda credenciais nem dados.
 *
 * Uso:  node server.js
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('Node.js 18 ou superior é necessário. Versão atual: ' + process.version);
  process.exit(1);
}

const BASE = __dirname;
const PUBLIC = path.join(BASE, 'public');

function carregarEnv(caminho = path.join(BASE, '.env')) {
  if (!fs.existsSync(caminho)) return;
  for (let linha of fs.readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    linha = linha.trim();
    if (!linha || linha.startsWith('#') || !linha.includes('=')) continue;
    const i = linha.indexOf('=');
    const k = linha.slice(0, i).trim();
    const v = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
carregarEnv();

const env = process.env;
const CLIENT_ID = (env.GOOGLE_CLIENT_ID || '').trim();
const SPREADSHEET_ID = (env.SPREADSHEET_ID || '1_fpbcB6q1dRcCvAdjqeLJY1s3rsdBMFTcTvOxvB_j64').trim();
const ABA_PEDIDOS = (env.ABA_PEDIDOS || '99 Ads Tag Request').trim();
const HOST = env.HOST || '127.0.0.1';
const PORT = Number(env.PORT || 3737);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function servirEstatico(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const abs = path.join(PUBLIC, path.normalize(rel));
  if (!abs.startsWith(PUBLIC + path.sep)) { res.writeHead(404); return res.end('Não encontrado'); }
  fs.readFile(abs, (err, dados) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': dados.length,
      'Cache-Control': 'no-cache'
    });
    res.end(req.method === 'HEAD' ? undefined : dados);
  });
}

const servidor = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/config.json') {
    const corpo = JSON.stringify({ clientId: CLIENT_ID, spreadsheetId: SPREADSHEET_ID, abaPedidos: ABA_PEDIDOS });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(corpo);
  }
  servirEstatico(req, res, pathname);
});

servidor.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `A porta ${PORT} já está em uso. Altere PORT no .env.` : e);
  process.exit(1);
});

servidor.listen(PORT, HOST, () => {
  console.log(`DataFlow em http://localhost:${PORT}`);
  if (!CLIENT_ID) console.warn('ATENÇÃO: GOOGLE_CLIENT_ID não está definido no .env; o login com Google não vai funcionar.');
});
