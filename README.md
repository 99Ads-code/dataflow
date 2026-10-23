# DataFlow

Controle de pedidos de bases de dados, segmentações e audiências. O login é feito com a **conta Google do navegador** e o app lê e grava na planilha do Google com a permissão dessa conta.

## Arquivos

| Arquivo | Função |
|---|---|
| `server.js` | Servidor local (Node.js, sem dependências): serve o app e entrega o Client ID em `/config.json` |
| `public/index.html`, `styles.css`, `app.js`, `api.js` | Front-end; o `api.js` fala direto com a Google Sheets API usando o token da conta Google |
| `package.json` | Metadados do projeto e `npm start` |
| `.env.example` | Modelo de configuração (copie para `.env`) |
| `index.bat` | Atalho para Windows: confere tudo, inicia o servidor e abre o navegador |

## Como o acesso funciona

- Ao clicar em **Entrar com Google**, o Google mostra as contas já logadas no navegador. Você escolhe uma e autoriza o app a ver e editar planilhas.
- Quem pode ler e editar os pedidos é decidido **pelo compartilhamento da planilha no Google**: a conta precisa ser **Editora**. Quem não for recebe a mensagem "sua conta não tem acesso de edição".
- Na primeira entrada, o app cadastra a pessoa na aba `Usuarios` (nome e e-mail da conta Google). Não há senha própria nem tela de cadastro.
- O token do Google dura cerca de 1 hora. Depois disso o app volta para o login; é só clicar de novo (normalmente sem digitar nada).

## Configuração

### 1. Criar o ID de cliente OAuth
1. Em https://console.cloud.google.com, crie ou escolha um projeto.
2. **APIs e serviços > Biblioteca**: ative a **Google Sheets API**.
3. **APIs e serviços > Tela de consentimento OAuth**:
   - Conta corporativa (Workspace): escolha **Interno**. Assim só pessoas da organização entram e não há verificação do Google.
   - Conta pessoal: **Externo**, em modo de teste, adicionando os e-mails dos usuários como testadores.
   - Adicione o escopo `.../auth/spreadsheets` (e os básicos de e-mail e perfil).
4. **Credenciais > Criar credenciais > ID do cliente OAuth > Aplicativo da Web**.
   Em **Origens JavaScript autorizadas**, adicione `http://localhost:3737` (e, se mudar a porta, a nova). Não precisa de URI de redirecionamento.
5. Copie o ID do cliente (termina em `.apps.googleusercontent.com`).
> Se a sua organização bloquear a criação de clientes OAuth ou o uso do escopo de planilhas, peça liberação ao administrador do Google Workspace.

### 2. Configurar e rodar
Requer **Node.js 18 ou superior** (https://nodejs.org, versão LTS). Não há `npm install`.

1. Copie `.env.example` para `.env` e cole o ID do cliente em `GOOGLE_CLIENT_ID=`.
2. No Windows, dê dois cliques em **`index.bat`**. Ele abre http://localhost:3737. Manualmente: `node server.js`.
3. Entre com Google. As abas `Usuarios` e `99 Ads Tag Request` são criadas automaticamente se não existirem.

Planilha usada: `1_fpbcB6q1dRcCvAdjqeLJY1s3rsdBMFTcTvOxvB_j64` (variável `SPREADSHEET_ID`). Os pedidos vão para a aba `99 Ads Tag Request` (variável `ABA_PEDIDOS`).

Abrir o `index.html` direto do disco (`file://`) ativa o **modo demonstração**, com dados só no navegador e sem login do Google.

## Estrutura da planilha

### Aba de pedidos: `99 Ads Tag Request`

É a aba do seu arquivo `_99Ads__estreutura_do_request.xlsx`. O nome pode ser trocado em `ABA_PEDIDOS` no `.env`. Se a aba não existir, o app a cria.

**Colunas A a K: exatamente as da sua planilha** (a linha 1 precisa estar com estes títulos):

| Coluna | Campo | Preenchimento na tela Nova solicitação |
|---|---|---|
| A | Tipo de solicitação | Lista: Base Nova, Update |
| B | Anunciante | Texto |
| C | Campanha | Texto |
| D | App | Lista: Pax, Driver |
| E | Placement | Lista: In-App, Out-of-App |
| F | Solicitante | Lista: Kike, Gabi, Gui, Mari, Vivi, Henrique, Eliz (pré-seleciona pelo primeiro nome da conta Google) |
| G | Descrição | Texto longo |
| H | Tamanho Máximo (se aplicável) | Texto; se vazio, grava `-` |
| I | Data da solicitação | Automática (hoje), no formato dd/mm/aaaa |
| J | Data de entrega | Data escolhida, gravada em dd/mm/aaaa |
| K | Status | Entra como `Pendente`; o painel alterna entre Pendente, Em andamento e Concluído |

**Colunas L a Q: apoio do painel.** O app cria os cabeçalhos na primeira entrada. Não use essas colunas para outra finalidade.

| Coluna | Conteúdo |
|---|---|
| L | ID (UUID) usado para localizar o pedido ao editar |
| M | Criado em (data e hora exatas, ISO 8601, UTC) |
| N | Prioridade (Baixa, Média, Alta ou Urgente; só do painel) |
| O | Atualizado em |
| P | Atualizado por |
| Q | E-mail da conta Google de quem enviou |

Pontos importantes:
- **Linhas digitadas direto na planilha aparecem no painel.** No primeiro carregamento, cada linha sem ID recebe um ID na coluna L (precisa de acesso de Editor). Sem data/hora exata, o painel usa a "Data da solicitação"; sem prioridade, mostra Média.
- Alterar status ou prioridade no painel grava só as células K, N, O e P da linha; as colunas A a J e as demais não são tocadas.
- **As listas da tela Nova solicitação vêm da própria planilha.** Ao abrir a tela, o app lê as listas suspensas (validação de dados) da linha 2 da aba de pedidos, nas colunas A (Tipo), D (App), E (Placement) e F (Solicitante). Para incluir um solicitante ou um placement novo, basta editar a lista na planilha. Se a coluna não tiver lista ou a consulta falhar, o app usa as listas de reserva do `OPCOES` em `public/api.js` (hoje iguais às da planilha). Nomes que devem aparecer sempre, mesmo que a lista da planilha não os tenha, ficam em `OPCOES_EXTRAS` no mesmo arquivo (hoje: Vivi, Henrique e Eliz em Solicitante); eles são somados à lista da planilha, sem duplicar. Os status válidos (Pendente, Em andamento, Concluído) ficam em `STATUS_VALIDOS`; o painel monta os contadores e o filtro a partir dessa lista. Atualize também a validação da coluna K da planilha para essa mesma lista, para o Google Sheets não marcar a célula como inválida. Linhas antigas com `Entregue` ou `Em processamento` aparecem no painel como `Concluído` e `Em andamento` (a planilha só muda quando o status é alterado no painel); troque esses valores na planilha se quiser padronizá-los.
- Se a linha 1 tiver títulos diferentes nas colunas A a K, ou se as colunas L a Q já estiverem em uso, o app avisa em vez de gravar.

### Aba `Usuarios`

| Coluna | Conteúdo |
|---|---|
| id | UUID do usuário |
| nome | Nome da conta Google |
| email | E-mail da conta Google em minúsculas (chave única) |
| criadoEm | Data/hora ISO do primeiro acesso |
| ultimoAcesso | Data/hora ISO do último login |

Se a planilha já tiver uma aba `Usuarios` de versões anteriores (com colunas de senha), o app avisa que as colunas são diferentes. Renomeie ou apague essa aba e entre de novo.

## Segurança

- Não há senhas nem chave privada no projeto. O acesso é o da conta Google de cada pessoa, e o Google aplica as permissões da planilha.
- O token fica no navegador (localStorage) por cerca de 1 hora. Em computador compartilhado, use **Sair** e feche o navegador.
- As validações (listas, datas, status, prioridade, tamanhos) acontecem no navegador. Quem tem acesso de **Editor** à planilha pode alterá-la diretamente, inclusive pelo Google Sheets; trate o compartilhamento da planilha como o controle de acesso real.
- Qualquer editor pode alterar qualquer pedido. Para perfis (solicitante x analista), compartilhe a planilha só com quem deve editar.

## Atualização dos dados

O painel não tem botão de atualizar: ele recarrega a planilha sozinho a cada 60 segundos e sempre que você abre a tela. Para ver uma mudança feita direto na planilha na mesma hora, recarregue a página (F5).

## Problemas comuns

- **"Erro 400: origin_mismatch" no Google:** a origem em uso não está em *Origens JavaScript autorizadas*. Cadastre exatamente `http://localhost:3737` e acesse por esse endereço.
- **"O login do Google ainda não foi configurado":** falta `GOOGLE_CLIENT_ID` no `.env` (ou o servidor não foi reiniciado depois de editar).
- **"Sua conta Google não tem acesso de edição":** peça acesso de Editor à planilha, ou escolha outra conta no seletor.
- **A janela do Google não abre:** permita pop-ups para o endereço do app.
- **Abre uma página de "Windows Communication Foundation service"** (ou outra que não seja o DataFlow): outro programa usa a porta. Troque `PORT` no `.env` (ex.: `PORT=3838`) e atualize a origem autorizada no Google. O `index.bat` avisa quando a porta está ocupada.
- **`.env` já existe com valores antigos:** ele não é sobrescrito. Edite-o e acrescente `GOOGLE_CLIENT_ID=`.
