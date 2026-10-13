# DotPilot · Apache de Laragon
# Arranca el Apache de Laragon con su propia configuración (o reutiliza el que ya está en ejecución), avisa si
# MySQL no responde y muestra en vivo el registro de errores de Apache (incluye los errores y avisos de PHP).
# Al detener DotPilot se cierra este proceso y, con él, el Apache que él mismo inició. No usa permisos de
# administrador ni toca el archivo hosts.
#
# Parámetros por variables de entorno (las pone DotPilot):
#   DOTPILOT_HTTPD, DOTPILOT_HTTPD_ARGS (JSON), DOTPILOT_ERROR_LOG, DOTPILOT_PORT, DOTPILOT_MYSQL_PORT, DOTPILOT_LANG
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function T([string]$es, [string]$en) { if ($env:DOTPILOT_LANG -eq 'en') { $en } else { $es } }

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    return ($pending.AsyncWaitHandle.WaitOne(300) -and $client.Connected)
  } catch { return $false } finally { $client.Close() }
}

# Cierra el Apache que este script inició (y sus hijos). Se llama antes de salir con error: terminar el script
# no cierra a sus procesos hijos, y Apache quedaría huérfano en el puerto.
function Stop-Owned {
  if ($script:owned -and -not $script:owned.HasExited) {
    & taskkill.exe /PID $script:owned.Id /T /F | Out-Null
  }
}

function Show-LogTail([string]$path, [int]$lines) {
  if ($path -and (Test-Path -LiteralPath $path)) { Get-Content -LiteralPath $path -Tail $lines | ForEach-Object { Write-Output $_ } }
}

# Lector que empieza al final del archivo: solo se muestra lo nuevo.
function Open-Tail([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $null }
  $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
  [void]$stream.Seek(0, [System.IO.SeekOrigin]::End)
  return New-Object System.IO.StreamReader($stream)
}

$httpd = $env:DOTPILOT_HTTPD
$httpdArgs = @()
# Windows PowerShell 5.1 no desenrolla el arreglo JSON: se recorre y se citan los argumentos con espacios.
if ($env:DOTPILOT_HTTPD_ARGS) {
  foreach ($item in (ConvertFrom-Json -InputObject $env:DOTPILOT_HTTPD_ARGS)) {
    $text = [string]$item
    if ($text -match '\s') { $text = '"' + $text + '"' }
    $httpdArgs += $text
  }
}
$port = 80
if ($env:DOTPILOT_PORT) { $port = [int]$env:DOTPILOT_PORT }
$log = $env:DOTPILOT_ERROR_LOG
$console = Join-Path ([System.IO.Path]::GetTempPath()) 'dotpilot-apache-console.log'
$script:owned = $null

if (Test-Port $port) {
  Write-Output (T "Apache ya está en ejecución en el puerto $port (Laragon): se reutiliza; al detener no se cierra." "Apache is already running on port ${port} (Laragon): reusing it; Stop will not close it.")
} else {
  if (-not $httpd -or -not (Test-Path -LiteralPath $httpd)) {
    Write-Output (T "No se encontró httpd.exe de Laragon: $httpd" "Laragon's httpd.exe was not found: $httpd")
    exit 2
  }
  Set-Content -LiteralPath $console -Value '' -Encoding ASCII
  # Apache se aísla de las tuberías de DotPilot (entrada nula, salida a un archivo): heredarlas lo deja colgado
  # antes de abrir el puerto. Se lanza como hijo directo de este script (sin ShellExecute) para que «Detener»,
  # que cierra el árbol de procesos, también cierre Apache.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = '/d /s /c ""' + $httpd + '" ' + ($httpdArgs -join ' ') + ' < NUL > "' + $console + '" 2>&1"'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = Split-Path -Parent $httpd
  $script:owned = [System.Diagnostics.Process]::Start($psi)
  $startTimeout = 25
  if ($env:DOTPILOT_START_TIMEOUT) { $startTimeout = [int]$env:DOTPILOT_START_TIMEOUT }
  $deadline = (Get-Date).AddSeconds($startTimeout)
  while (-not (Test-Port $port)) {
    if ($script:owned.HasExited) {
      Write-Output (T "Apache terminó con código $($script:owned.ExitCode) antes de abrir el puerto $port. Últimas líneas del registro:" "Apache exited with code $($script:owned.ExitCode) before opening port ${port}. Last log lines:")
      Show-LogTail $console 15
      Show-LogTail $log 15
      exit 1
    }
    if ((Get-Date) -gt $deadline) {
      Write-Output (T "Apache no abrió el puerto $port en $startTimeout s. Últimas líneas del registro:" "Apache did not open port ${port} within $startTimeout s. Last log lines:")
      Show-LogTail $console 15
      Show-LogTail $log 15
      Stop-Owned
      exit 1
    }
    Start-Sleep -Milliseconds 200
  }
  Write-Output (T "Apache iniciado (PID $($script:owned.Id)) en el puerto $port." "Apache started (PID $($script:owned.Id)) on port ${port}.")
}

if ($env:DOTPILOT_MYSQL_PORT) {
  $mysql = [int]$env:DOTPILOT_MYSQL_PORT
  if ($mysql -gt 0 -and -not (Test-Port $mysql)) {
    Write-Output (T "Aviso: MySQL no responde en el puerto $mysql. Si la aplicación usa base de datos, inícialo desde Laragon." "Warning: MySQL does not answer on port ${mysql}. If the app uses a database, start it from Laragon.")
  }
}

# Marcador de «listo»: DotPilot lo lee como la dirección en la que quedó escuchando.
Write-Output "http://127.0.0.1:$port/"

# Registro de errores y salida de consola de Apache en vivo.
$readers = @()
foreach ($path in @($log, $(if ($script:owned) { $console }))) {
  $reader = Open-Tail $path
  if ($reader) { $readers += $reader }
}
try {
while ($true) {
  foreach ($reader in $readers) {
    while (($line = $reader.ReadLine()) -ne $null) { Write-Output $line }
  }
  if ($script:owned -and $script:owned.HasExited) {
    Write-Output (T "Apache se detuvo (código $($script:owned.ExitCode))." "Apache stopped (code $($script:owned.ExitCode)).")
    exit 1
  }
  Start-Sleep -Milliseconds 250
}
} finally {
  # Salida normal o error inesperado: no deja el Apache propio huérfano.
  Stop-Owned
}
