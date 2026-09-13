
# ---- OpenCode Wyvern (auto-generato) ----
# Personalizza i valori qui sotto e rilancia: . $PROFILE

$env:OC_SERVER  = '__OC_SERVER__'          # alias SSH (vedi ~/.ssh/config)
$env:OC_HOST    = '__OC_HOST__'               # IP o hostname del server
$env:OC_USER    = '__OC_USER__'             # utente SSH
$env:OC_DIR     = '__OC_DIR__'                      # cartella remota di default (es. ~/Server)

$global:OC_OPENCODE = $null                # cache path, si azzera a ogni reload

function Sync-OcEnv {
    # riseleziona OC_* dal config (fonte di verità), così anche in un
    # ambiente con variabili stale i comandi usano server/dir corretti.
    $cfg = Join-Path $env:USERPROFILE ".config\opencode-wyvern\config.json"
    if (-not (Test-Path $cfg)) { return }
    try {
        $j = Get-Content $cfg -Raw | ConvertFrom-Json
        if ($j.entry.host)   { $env:OC_HOST   = [string]$j.entry.host }
        if ($j.entry.user)   { $env:OC_USER   = [string]$j.entry.user }
        if ($j.entry.server) { $env:OC_SERVER = [string]$j.entry.server }
        if ($j.entry.dir)    { $env:OC_DIR    = [string]$j.entry.dir }
    } catch { }
}

Sync-OcEnv

function Get-OcPath {
    if (-not $global:OC_OPENCODE) {
        $remotePath = "(command -v opencode || ls -t ~/.nvm/versions/node/*/bin/opencode 2>/dev/null | head -n1)"
        $found = ssh -o BatchMode=yes $env:OC_SERVER $remotePath 2>$null | Select-Object -First 1
        if ($found) { $global:OC_OPENCODE = $found.Trim() }
        else { $global:OC_OPENCODE = 'opencode' }
    }
    return $global:OC_OPENCODE
}

function oc-connect {
    Sync-OcEnv
    $key = "$env:USERPROFILE\.ssh\id_ed25519"
    $pub = "$env:USERPROFILE\.ssh\id_ed25519.pub"

    if (-not (Test-Path $key)) {
        Write-Host "Genero SSH key..." -ForegroundColor Cyan
        ssh-keygen -t ed25519 -C "$env:OC_USER@client" -f $key -N "" | Out-Null
    }

    Write-Host "Installo chiave sul server (inserisci password una volta)..." -ForegroundColor Cyan
    Get-Content $pub | ssh $env:OC_SERVER "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo CHIAVE_INSTALLATA"

    Write-Host "Verifico autenticazione a chiave..." -ForegroundColor Cyan
    $res = ssh -o BatchMode=yes $env:OC_SERVER "echo OK" 2>&1
    if ($res -eq 'OK') {
        Write-Host "Autenticazione SSH a chiave attiva!" -ForegroundColor Green
    } else {
        Write-Host "ERRORE: la chiave non è stata accettata. Riepilogo:" -ForegroundColor Red
        Write-Host "  $res" -ForegroundColor Red
    }
}

function oc {
    Sync-OcEnv
    $null = @(Get-OcAllSessions)
    $oc = Get-OcPath
    ssh -t $env:OC_SERVER "cd $env:OC_DIR && $oc"
}

function oc-ssh {
    Sync-OcEnv
    ssh $env:OC_SERVER
}

function Get-OcAllSessions {
    $py = @'
import json,sys
raw=sys.stdin.read()
i=raw.find("[\n")
if i<0:
    i=raw.find("[")
d=json.loads(raw[i:])
for s in d:
    u=s.get("updated") or 0
    title=(s.get("title") or "").replace("\t"," ").replace("\n"," ")
    print(str(u)+"\t"+s.get("id","")+"\t"+title+"\t"+s.get("directory",""))
'@
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($py))
    $oc = Get-OcPath
    $cmd = "cd ~ && $oc --pure session list --format json 2>/dev/null | python3 -c `"import base64;exec(base64.b64decode('$b64').decode())`""
    $lines = @(ssh -n -o BatchMode=yes $env:OC_SERVER $cmd 2>$null)
    if ($LASTEXITCODE -eq 0 -and $lines.Count -gt 0) { Save-OcCache $lines }
    $lines | ForEach-Object {
        $parts = $_ -split "`t", 4
        [pscustomobject]@{
            Updated = [long]$parts[0]
            Id      = $parts[1]
            Title   = $parts[2]
            Dir     = if ($parts.Count -gt 3) { $parts[3] } else { "~" }
        }
    } | Sort-Object -Property Updated -Descending
}

function Get-OcLastFile {
    return Join-Path (Split-Path (Get-OcCacheFile)) "last.tsv"
}

function Save-OcLastSession {
    param([Parameter(Mandatory)][string]$Id, [string]$Dir = "~")
    $file = Get-OcLastFile
    New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
    Set-Content -Path $file -Value ("{0}`t{1}" -f $Id, $Dir) -Encoding UTF8
}

function Get-OcLastSession {
    $file = Get-OcLastFile
    if (-not (Test-Path $file)) { return $null }
    $line = Get-Content $file | Select-Object -First 1
    if (-not $line) { return $null }
    $parts = $line -split "`t", 2
    if ($parts.Count -lt 1 -or -not $parts[0]) { return $null }
    return [pscustomobject]@{
        Id  = $parts[0]
        Dir = if ($parts.Count -gt 1) { $parts[1] } else { "~" }
    }
}

function Get-OcServerStatus {
    $err = ssh -o BatchMode=yes -o ConnectTimeout=5 $env:OC_SERVER "echo PING_OK" 2>&1
    if ($LASTEXITCODE -eq 0 -and ($err -contains 'PING_OK')) {
        return [pscustomobject]@{ Up = $true; Message = 'OK' }
    }
    $msg = ($err | Where-Object { $_ } | Select-Object -Last 1)
    if (-not $msg) { $msg = "Il server non risponde (timeout)." }
    return [pscustomobject]@{ Up = $false; Message = "$msg" }
}

function Get-OcCacheFile {
    return Join-Path $env:USERPROFILE ".cache\opencode-wyvern\sessions.tsv"
}

function Save-OcCache {
    param([Parameter(Mandatory)][string[]]$Lines)
    $file = Get-OcCacheFile
    New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
    Set-Content -Path $file -Value $Lines -Encoding UTF8
}

function Get-OcCachedSessions {
    param([switch]$TodayOnly)
    $file = Get-OcCacheFile
    if (-not (Test-Path $file)) { return }
    $rows = @(Get-Content $file | ForEach-Object {
        $parts = $_ -split "`t", 4
        if ($parts.Count -lt 3) { return }
        $u = 0L
        [long]::TryParse($parts[0], [ref]$u) | Out-Null
        [pscustomobject]@{
            Updated = $u
            Id      = $parts[1]
            Title   = $parts[2]
            Dir     = if ($parts.Count -gt 3) { $parts[3] } else { "~" }
        }
    })
    $rows = @($rows | Where-Object { $_.Id } | Sort-Object Updated -Descending)
    if ($TodayOnly) {
        $cutoff = [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()
        $rows = @($rows | Where-Object { $_.Updated -ge $cutoff })
    }
    $rows
}

function Get-OcRecentSessions {
    $cutoff = [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()
    @(Get-OcAllSessions) | Where-Object { $_.Updated -ge $cutoff }
}

function oc-sessions {
    Sync-OcEnv
    $sessions = Get-OcRecentSessions
    if (-not $sessions) {
        Write-Host "Nessuna sessione nelle ultime 24 ore (o SSH a chiave non configurato - esegui oc-connect)." -ForegroundColor Yellow
        return
    }
    Write-Host "Sessioni nelle ultime 24 ore:" -ForegroundColor Cyan
    $i = 0
    foreach ($s in $sessions) {
        $i++
        Write-Host ("  {0}. [{1}] {2}" -f $i, $s.Id.Substring(0, [Math]::Min(12, $s.Id.Length)), $s.Title)
    }
}

function oc-help {
    Write-Host ""
    Write-Host "OpenCode Wyvern - comandi" -ForegroundColor Cyan
    Write-Host "============================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host ("  {0,-24} {1}" -f "oc-connect", "Setup SSH key + autorizzazione server")
    Write-Host ("  {0,-24} {1}" -f "oc", "Nuova sessione opencode in $env:OC_DIR")
    Write-Host ("  {0,-24} {1}" -f "oc-ssh", "Apri sessione SSH interattiva")
    Write-Host ("  {0,-24} {1}" -f "oc-sessions", "Lista sessioni opencode (ultime 24h)")
    Write-Host ("  {0,-24} {1}" -f "oc-find [testo]", "Cerca sessioni globali per titolo e riapri")
    Write-Host ("  {0,-24} {1}" -f "oc-delete [testo]", "Cerca ed elimina sessioni")
    Write-Host ("  {0,-24} {1}" -f "oc-resume", "Apre 1 tab per ogni sessione (ultime 24h)")
    Write-Host ("  {0,-24} {1}" -f "oc-go -Id <id> [-Dir <path>]", "Riprende una sessione specifica")
    Write-Host ("  {0,-24} {1}" -f "oc-recap", "Riepilogo sessioni (usa cache se il server è giù)")
    Write-Host ("  {0,-24} {1}" -f "oc-help", "Questo aiuto")
    Write-Host ""
    Write-Host "Nota: oc-ssh, oc-sessions, oc-resume richiedono SSH key configurata" -ForegroundColor DarkGray
    Write-Host ""
}

function oc-find {
    param(
        [string]$Search = '',
        [int]$Limit = 30
    )
    Sync-OcEnv
    $all = Get-OcAllSessions
    if (-not $all) {
        Write-Host "Nessuna sessione trovata (o SSH a chiave non configurato)." -ForegroundColor Yellow
        return
    }
    if ($Search) {
        $all = $all | Where-Object { $_.Title -match [regex]::Escape($Search) }
    }
    if ($Search -and $all.Count -gt 0) {
        Write-Host ("Risultati per `"$Search`" (max {0}):" -f $Limit) -ForegroundColor Cyan
    } elseif (-not $Search) {
        Write-Host "Sessioni recenti (max $Limit):" -ForegroundColor Cyan
    } else {
        Write-Host "Nessuna sessione corrispondente." -ForegroundColor Yellow
        return
    }
    $shown = @()
    $i = 0
    foreach ($s in $all | Select-Object -First $Limit) {
        $i++
        $date = [DateTimeOffset]::FromUnixTimeMilliseconds($s.Updated).DateTime.ToString('yyyy-MM-dd HH:mm')
        $dir  = $s.Dir -replace [regex]::Escape($env:USERPROFILE + '\'), '~/'
        Write-Host ("  {0,2}. [{1}] {2}  ({3})  {4}" -f $i, $s.Id.Substring(0,12), $s.Title, $date, $dir)
        $shown += $s
    }
    Write-Host ""
    $choice = Read-Host "Numero da aprire (INVIO per annullare)"
    if ($choice -match '^\d+$') {
        $idx = [int]$choice - 1
        if ($idx -ge 0 -and $idx -lt $shown.Count) {
            $sel = $shown[$idx]
            oc-go -Id $sel.Id -Dir $sel.Dir -NoRecap
        } else {
            Write-Host "Indice fuori range." -ForegroundColor Yellow
        }
    }
}

function oc-delete {
    param(
        [string]$Search = ''
    )
    Sync-OcEnv
    $all = Get-OcAllSessions
    if (-not $all) {
        Write-Host "Nessuna sessione trovata." -ForegroundColor Yellow
        return
    }
    if ($Search) {
        $all = $all | Where-Object { $_.Title -match [regex]::Escape($Search) -or $_.Id -match [regex]::Escape($Search) }
    }
    if (-not $all) {
        Write-Host ("Nessuna sessione corrispondente a `"$Search`".") -ForegroundColor Yellow
        return
    }
    Write-Host "Sessioni (seleziona da eliminare):" -ForegroundColor Cyan
    $i = 0
    foreach ($s in $all | Select-Object -First 30) {
        $i++
        $date = [DateTimeOffset]::FromUnixTimeMilliseconds($s.Updated).DateTime.ToString('yyyy-MM-dd HH:mm')
        Write-Host ("  {0,2}. [{1}] {2}  ({3})" -f $i, $s.Id.Substring(0,12), $s.Title, $date)
    }
    Write-Host ""
    $choice = Read-Host "Numero da eliminare (INVIO per annullare)"
    if ($choice -notmatch '^\d+$') { return }
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge [Math]::Min($all.Count, 30)) {
        Write-Host "Indice fuori range." -ForegroundColor Yellow
        return
    }
    $sel = ($all | Select-Object -First 30)[$idx]
    $confirm = Read-Host "Eliminare definitivamente la sessione '$($sel.Title)'? (s/N)"
    if ($confirm -notmatch '^(s|si|sì|y|yes)$') {
        Write-Host "Annullato." -ForegroundColor Yellow
        return
    }
    $oc = Get-OcPath
    $remoteCmd = "cd ~ && $oc --pure session delete $($sel.Id) </dev/null"
    ssh -o BatchMode=yes $env:OC_SERVER $remoteCmd 2>&1 | Select-Object -Last 2 | Out-Host
    Write-Host "Sessione eliminata: $($sel.Title)" -ForegroundColor Green
}

function oc-go {
    param(
        [Parameter(Mandatory)]
        [string]$Id,
        [string]$Dir = "~",
        [switch]$NoRecap
    )
    Sync-OcEnv
    $null = @(Get-OcAllSessions)
    $oc = Get-OcPath
    if ($Dir -eq '~' -or [string]::IsNullOrEmpty($Dir)) {
        $remoteCmd = "cd ~ && $oc -s $Id"
    } else {
        $remoteCmd = "mkdir -p '$Dir' && cd '$Dir' && $oc -s $Id"
    }
    Save-OcLastSession -Id $Id -Dir $Dir
    ssh -t -o ConnectTimeout=8 $env:OC_SERVER $remoteCmd
    $exitCode = $LASTEXITCODE
    $errTime  = Get-Date
    if (-not $NoRecap) { Show-OcRecap -LastExit $exitCode -ErrTime $errTime }
}

function Show-OcRecap {
    param(
        [int]$LastExit = -1,
        [datetime]$ErrTime = (Get-Date)
    )
    Sync-OcEnv
    Write-Host ""
    Write-Host ("{0}" -f ('=' * 56)) -ForegroundColor DarkCyan
    Write-Host "Connessione terminata. Riepilogo per riprendere:" -ForegroundColor Cyan
    Write-Host ("{0}" -f ('=' * 56)) -ForegroundColor DarkCyan
    $retry = $true
    while ($retry) {
        $retry = $false
        $sessions = @(Get-OcRecentSessions)
        $fromCache = $false
        if ($sessions.Count -eq 0) {
            $status = Get-OcServerStatus
            if ($status.Up) {
                Write-Host "  Server raggiungibile ma nessuna sessione nelle ultime 24 ore." -ForegroundColor Yellow
                return
            }
            $cached = @(Get-OcCachedSessions -TodayOnly)
            if ($cached.Count -eq 0) {
                Write-Host ("  [!] Connessione persa alle {0} (SSH exit {1})" -f $ErrTime.ToString('yyyy-MM-dd HH:mm:ss'), $LastExit) -ForegroundColor Red
                Write-Host ("      Errore: {0}" -f $status.Message) -ForegroundColor Yellow
                Write-Host "      Nessun riepilogo salvato: il client non si era mai collegato." -ForegroundColor Yellow
                Write-Host "      Quando il server torna su: oc-recap" -ForegroundColor DarkGray
                return
            }
            $sessions = $cached
            $fromCache = $true
        }
        if ($fromCache) {
            $stamp = (Get-Item (Get-OcCacheFile)).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
            Write-Host ("  [!] Connessione persa alle {0} (SSH exit {1})" -f $ErrTime.ToString('yyyy-MM-dd HH:mm:ss'), $LastExit) -ForegroundColor Red
            Write-Host ("      Errore: {0}" -f $status.Message) -ForegroundColor Yellow
            Write-Host ("      Riepilogo salvato localmente il {0}: quando la connessione torna, riprendi da qui." -f $stamp) -ForegroundColor DarkGray
            Write-Host ""
        }
        $i = 0
        foreach ($s in $sessions) {
            $i++
            $last = if ($s.Updated) { [DateTimeOffset]::FromUnixTimeMilliseconds($s.Updated).LocalDateTime.ToString('HH:mm') } else { '' }
            Write-Host ""
            Write-Host ("  {0,2}) {1}  [{2}...]" -f $i, $s.Title, $s.Id.Substring(0, [Math]::Min(12, $s.Id.Length))) -ForegroundColor White
            Write-Host ("      in:  {0}   (ultimo aggiornamento {1})" -f $s.Dir, $last) -ForegroundColor DarkGray
            Write-Host ("      run: opencode -s {0}" -f $s.Id) -ForegroundColor DarkGray
            Write-Host ("      oc-go: oc-go -Id '{0}' -Dir '{1}'" -f $s.Id, $s.Dir) -ForegroundColor DarkGray
        }
        Write-Host ""
        $choice = Read-Host "Scelta (1..$i riprendi, r riprova, n nuova sessione, INVIO esci)"
        if ($choice -match '^\d+$') {
            $idx = [int]$choice - 1
            if ($idx -ge 0 -and $idx -lt $i) {
                $sel = $sessions[$idx]
                Write-Host ("  Riprendo: {0}" -f $sel.Title) -ForegroundColor Cyan
                oc-go -Id $sel.Id -Dir $sel.Dir
            } else {
                Write-Host "  Indice fuori range." -ForegroundColor Yellow
            }
            return
        }
        if ($choice -match '^r$') {
            $retry = $true
            $LastExit = -1
            $ErrTime  = Get-Date
            $global:OC_OPENCODE = $null
            Write-Host "  Riprovo la connessione..." -ForegroundColor Cyan
            continue
        }
        if ($choice -match '^n$') {
            Write-Host "  Nuova sessione..." -ForegroundColor Cyan
            oc
            return
        }
        Write-Host "  Per riprendere in seguito: oc-recap oppure oc-resume" -ForegroundColor DarkGray
        return
    }
}

Set-Alias oc-recap Show-OcRecap

function Get-WarpConfigDir {
    $candidates = @(
        "$env:APPDATA\warp\Warp\data\tab_configs",
        "$env:APPDATA\warp\WarpPreview\data\tab_configs",
        "$env:LOCALAPPDATA\warp\Warp\data\tab_configs",
        "$env:LOCALAPPDATA\warp\WarpPreview\data\tab_configs"
    )
    foreach ($d in $candidates) {
        if (Test-Path $d) { return $d }
    }
    # crea la dir stabile se Warp è installato
    if (Test-Path "$env:APPDATA\warp\Warp\data") {
        New-Item -ItemType Directory -Path "$env:APPDATA\warp\Warp\data\tab_configs" -Force | Out-Null
        return "$env:APPDATA\warp\Warp\data\tab_configs"
    }
    return $null
}

function Get-OcTerminal {
    if ($env:TERM_PROGRAM -match 'warp') { return 'warp' }
    $cur = $PID
    $depth = 0
    while ($cur -gt 0 -and $depth -lt 15) {
        $pr = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
        if (-not $pr) { break }
        $name = $pr.Name
        if ($name -match '^Warp') { return 'warp' }
        if ($name -match 'WindowsTerminal') { return 'wt' }
        $cur = [int]$pr.ParentProcessId
        $depth++
    }
    if ($env:WT_SESSION -and (Get-Command wt -ErrorAction SilentlyContinue)) { return 'wt' }
    return $null
}

function Invoke-OcWarpResume {
    param([Parameter(Mandatory)]$Sessions)
    Sync-OcEnv
    $dir = Get-WarpConfigDir
    if (-not $dir) { return $false }
    $oc = Get-OcPath
    $created = @()
    $i = 0
    foreach ($s in $Sessions) {
        $i++
        $stem = "oc-resume-$i-$(Get-Random -Minimum 1000 -Maximum 9999)"
        $file = Join-Path $dir "$stem.toml"
        $title = ($s.Title -replace '[\\"]', ' ').Trim()
        if ($s.Dir -eq '~' -or [string]::IsNullOrEmpty($s.Dir)) {
            $remoteCmd = "cd ~ && $oc -s $($s.Id)"
        } else {
            $remoteCmd = "mkdir -p '$($s.Dir)' && cd '$($s.Dir)' && $oc -s $($s.Id)"
        }
        $cmd = ('ssh -t {0} "{1}"; oc-recap' -f $env:OC_SERVER, $remoteCmd).Replace('"', '\"')
        $toml = @"
name = "[oc] $title"
title = "$title"
[[panes]]
id = "main"
type = "terminal"
shell = "pwsh"
commands = ["$cmd"]
"@
        Set-Content -Path $file -Value $toml -Encoding UTF8
        $created += @{ File = $file; Stem = $stem }
        Write-Host "  Apro tab Warp: $($s.Title)" -ForegroundColor Cyan
        Start-Process "warp://tab_config/$stem"
        Start-Sleep -Seconds 2
    }
    Write-Host ""
    Write-Host "Se qualche tab non si e' aperta, riavvia lanciando: oc-resume -Warp" -ForegroundColor DarkGray
    Write-Host "Per raggrupparle: Ctrl+click su tutte le tab, poi tasto destro e 'New group with tab'." -ForegroundColor DarkGray
    Start-Job -ScriptBlock {
        param($files)
        Start-Sleep -Seconds 60
        foreach ($f in $files) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
    } -ArgumentList @($created.File) | Out-Null
    return $true
}

function oc-resume {
    param(
        [switch]$Copy,
        [switch]$Tabs,
        [switch]$Warp,
        [switch]$AllTabs
    )
    Sync-OcEnv
    $sessions = @(Get-OcRecentSessions)

    if ($sessions.Count -eq 0) {
        $status = Get-OcServerStatus
        if (-not $status.Up) {
            Write-Host ""
            Write-Host ("  [!] Errore di connessione al server ({0})" -f $status.Message) -ForegroundColor Red
            $last = Get-OcLastSession
            if ($last) {
                Write-Host "  Riprendo automaticamente l'ultima sessione terminata..." -ForegroundColor Cyan
                Write-Host ""
                oc-go -Id $last.Id -Dir $last.Dir
            } else {
                Write-Host "  Nessuna sessione da riprendere automaticamente." -ForegroundColor Yellow
                Show-OcRecap
            }
            return
        }
        Write-Host "Nessuna sessione nelle ultime 24 ore (o SSH a chiave non configurato - esegui oc-connect)." -ForegroundColor Yellow
        return
    }

    $first = $sessions[0]
    $rest  = @($sessions | Select-Object -Skip 1)

    $term  = Get-OcTerminal
    $useWarp = $Warp -or ($term -eq 'warp' -and -not $Copy -and -not $Tabs)
    $useTabs = $Tabs -or ($term -eq 'wt' -and -not $Copy -and -not $Warp)

    if ($useWarp) {
        $toOpen = if ($AllTabs) { $sessions } else { $rest }
        if ($toOpen.Count -gt 0) {
            if (-not (Invoke-OcWarpResume $toOpen) -and -not $AllTabs) {
                Write-Host "Apertura tab Warp fallita, proseguo solo con quella corrente." -ForegroundColor Yellow
            }
        }
        if (-not $AllTabs) {
            Write-Host ("  Riprendo qui: {0}" -f $first.Title) -ForegroundColor Cyan
            oc-go -Id $first.Id -Dir $first.Dir
        }
        return
    }

    if ($useTabs) {
        $toOpen = if ($AllTabs) { $sessions } else { $rest }
        foreach ($s in $toOpen) {
            Write-Host "  Apro tab: $($s.Title)" -ForegroundColor Cyan
            wt -w 0 new-tab --title "$($s.Title)" pwsh -Command "oc-go -Id '$($s.Id)' -Dir '$($s.Dir)'; if (\$LASTEXITCODE -ne 0 -or -not \$?) { Read-Host 'Premi INVIO per chiudere' }"
            Start-Sleep -Milliseconds 800
        }
        if (-not $AllTabs) {
            Write-Host ("  Riprendo qui: {0}" -f $first.Title) -ForegroundColor Cyan
            oc-go -Id $first.Id -Dir $first.Dir
        }
        return
    }

    Write-Host "Terminale corrente non Warp/Windows Terminal (o -Copy): copia e incolla i comandi" -ForegroundColor Yellow
    Write-Host ""
    foreach ($s in $sessions) {
        Write-Host ("  oc-go -Id '{0}' -Dir '{1}'" -f $s.Id, $s.Dir) -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Host "Suggerimenti: -Warp apre i tab in Warp, -Tabs in Windows Terminal, -AllTabs apre tutte le sessioni in tab nuove." -ForegroundColor DarkGray
}
