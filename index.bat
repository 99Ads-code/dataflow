@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title DataFlow

rem --- Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e execute de novo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODEMAJOR=%%v"
if %NODEMAJOR% LSS 18 (
  echo [ERRO] E necessario Node.js 18 ou superior. Versao encontrada:
  node -v
  pause
  exit /b 1
)

rem --- Configuracao (.env) ---
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Arquivo .env criado a partir do .env.example.
)

rem --- Client ID do Google ---
findstr /r /b /c:"GOOGLE_CLIENT_ID=." ".env" >nul
if errorlevel 1 (
  echo [ERRO] GOOGLE_CLIENT_ID nao esta preenchido no arquivo .env desta pasta:
  echo        %~dp0.env
  echo.
  echo Crie um ID de cliente OAuth ^(aplicativo da Web^) no Google Cloud, cole o valor
  echo depois de GOOGLE_CLIENT_ID= e execute de novo. Passo a passo no README.md.
  pause
  exit /b 1
)

rem --- Porta (le PORT do .env; padrao 3737) ---
set "PORT=3737"
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" ".env"') do set "PORT=%%b"

rem --- Confere se a porta ja esta em uso por outro programa ---
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERRO] A porta %PORT% ja esta em uso por outro programa.
  echo        Edite o arquivo .env desta pasta e troque PORT por outro numero ^(ex.: PORT=3838^).
  netstat -ano | findstr /r /c:":%PORT% .*LISTENING"
  pause
  exit /b 1
)

rem --- Abre o navegador apos 3 segundos e inicia o servidor ---
rem O app precisa ser aberto por http://localhost, nao pelo arquivo index.html.
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:%PORT%"

echo.
echo DataFlow em http://localhost:%PORT%
echo Para encerrar, feche esta janela ou pressione Ctrl+C.
echo.
node server.js

echo.
echo O servidor foi encerrado.
pause
