@echo off
setlocal
rem Starts every service, each in its own window:
rem   FIR Assistant (FastAPI) -> http://localhost:8000
rem   Legal research API      -> http://localhost:8080
rem   Website (React)         -> http://localhost:5173
rem First run also creates the Python venv and installs packages.
rem Stop everything with stop-all.bat (or close the three windows).

set "ROOT=%~dp0ly-project"
set "FIR=%ROOT%\fir-service"
set "SERVER=%ROOT%\server"
set "WEB=%ROOT%\web"

echo.
echo === Checking ports ===
set "BUSY="
for %%P in (8000 8080 5173) do (
  rem A connection that succeeds means something is already serving that port.
  curl.exe -s -m 2 -o nul http://localhost:%%P/ && (
    echo   Port %%P is already in use - another copy may still be running.
    set "BUSY=1"
  )
)
if defined BUSY (
  echo.
  echo   Run stop-all.bat first, or close the old windows, then try again.
  pause
  exit /b 1
)
echo   8000, 8080, 5173 are free.

echo.
echo === Checking .env files ===
if not exist "%SERVER%\.env" (
  echo   MISSING: ly-project\server\.env  ^(copy .env.example and add MONGO_URI and GROQ_API_KEY^)
  pause
  exit /b 1
)
if not exist "%FIR%\.env" (
  copy "%FIR%\.env.example" "%FIR%\.env" >nul
  echo   Created ly-project\fir-service\.env from .env.example.
  echo   Open it and set LLM_PROVIDER, LLM_API_KEY and LLM_MODEL, then run this again.
  echo   ^(LLM_PROVIDER=demo works with no API key.^)
  notepad "%FIR%\.env"
  pause
  exit /b 1
)
echo   Found server\.env and fir-service\.env.

echo.
echo === Checking secrets ===
rem Generates JWT_SECRET and the FIR shared secret when they are missing
rem (a new checkout, or a .env from before user accounts). Never replaces one.
node "%ROOT%\scripts\setup-env.mjs" "%ROOT%" || (echo   Could not set up the secrets - is Node.js installed? & pause & exit /b 1)

echo.
echo === Installing dependencies ===
rem Runs every time, not only on the first run: after a git pull, new packages
rem must be installed even though node_modules already exists. When nothing
rem has changed this takes a few seconds.
if not exist "%FIR%\.venv\Scripts\python.exe" (
  echo   Creating Python 3.11 environment for the FIR service...
  py -3.11 -m venv "%FIR%\.venv" || (echo   Could not create the venv - is Python 3.11 installed? & pause & exit /b 1)
  "%FIR%\.venv\Scripts\python.exe" -m pip install --upgrade pip
)
echo   pip install in fir-service...
"%FIR%\.venv\Scripts\python.exe" -m pip install -q -r "%FIR%\requirements.txt" || (echo   pip install failed. & pause & exit /b 1)
echo   npm install in server...
pushd "%SERVER%"
call npm install --no-audit --no-fund --loglevel=error || (popd & echo   npm install failed in server. & pause & exit /b 1)
popd
echo   npm install in web...
pushd "%WEB%"
call npm install --no-audit --no-fund --loglevel=error || (popd & echo   npm install failed in web. & pause & exit /b 1)
popd
echo   Dependencies ready.

echo.
echo === Starting services ===
start "LY - FIR Assistant (8000)" /D "%FIR%" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
start "LY - Legal API (8080)" /D "%SERVER%" cmd /k "npm run dev"
start "LY - Website (5173)" /D "%WEB%" cmd /k "npm run dev"

echo   Three windows opened. The Legal API takes ~10-20 seconds to load its search model.
echo   Opening the website in your browser...
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
endlocal
