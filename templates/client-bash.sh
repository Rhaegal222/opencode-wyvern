# ---- OpenCode Wyvern (auto-generato) ----
# Personalizza: OC_SERVER / OC_DIR
export OC_SERVER='__OC_SERVER__'
export OC_DIR='__OC_DIR__'

oc-sync-env() {
    local cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-wyvern/config.json"
    [ -f "$cfg" ] || return 0
    local out k v
    if command -v node >/dev/null 2>&1; then
        out="$(node -e 'const c=require(process.argv[1]).entry||{};for(const k of ["host","user","server","dir"]){if(c[k]!=null)console.log(k+"="+c[k])}' "$cfg" 2>/dev/null)" || return 0
    elif command -v python3 >/dev/null 2>&1; then
        out="$(python3 -c 'import json,sys;e=json.load(open(sys.argv[1]))["entry"];[print(k+"="+str(e[k])) for k in ("host","user","server","dir") if e.get(k)]' "$cfg" 2>/dev/null)" || return 0
    else
        return 0
    fi
    while IFS='=' read -r k v; do
        [ -n "$k" ] || continue
        case "$k" in
            host)   export OC_HOST="$v" ;;
            user)   export OC_USER="$v" ;;
            server) export OC_SERVER="$v" ;;
            dir)    export OC_DIR="$v" ;;
        esac
    done <<< "$out"
}
oc-sync-env

oc-path() {
    oc-sync-env
    # Risolve opencode SUL SERVER al momento dell'esecuzione: funziona anche
    # senza chiave SSH configurata (BatchMode non tenuto) e senza opencode nel
    # PATH del server (cade sulle installazioni nvm `~/.nvm/versions/node/*/bin`).
    printf '%s' '__oc_wyvern(){ OPENCODE_BIN="$(command -v opencode 2>/dev/null || ls -t $HOME/.nvm/versions/node/*/bin/opencode 2>/dev/null | head -n1)"; if [ -z "$OPENCODE_BIN" ]; then echo "[oc] ERRORE: opencode non trovato sul server. Esegui oc-setup scegliendo Client + Server, oppure installa sul server: npm install -g opencode-ai" >&2; return 127; fi; "$OPENCODE_BIN" "$@"; }; __oc_wyvern'
}

oc-connect() {
    oc-sync-env
    local key="$HOME/.ssh/id_ed25519"
    local pub="$key.pub"
    if [ ! -f "$key" ]; then
        echo "[..] Genero SSH key..."
        ssh-keygen -t ed25519 -C "${USER}@client" -f "$key" -N ""
    fi
    echo "[..] Installo chiave sul server (password una volta)..."
    cat "$pub" | ssh "$OC_SERVER" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo CHIAVE_INSTALLATA"
    echo "[..] Verifico autenticazione a chiave..."
    if ssh -o BatchMode=yes "$OC_SERVER" "echo OK" 2>/dev/null; then
        echo -e "${GREEN}[OK]   Autenticazione SSH a chiave attiva!${NC}"
    else
        echo -e "${RED}[FAIL] La chiave non e' stata accettata.${NC}"
    fi
}

oc-update() {
    if ! command -v npm >/dev/null 2>&1; then
        echo -e "${RED}[FAIL] npm non trovato nel PATH.${NC}"
        return 127
    fi
    echo -e "${CYAN}[..] Aggiorno OpenCode Wyvern...${NC}"
    npm install -g opencode-wyvern@latest || return $?
    hash -r
    if ! command -v oc-setup >/dev/null 2>&1; then
        echo -e "${RED}[FAIL] oc-setup non trovato dopo l'aggiornamento.${NC}"
        return 127
    fi
    oc-setup generate || return $?
    source "$HOME/.bashrc"
    echo -e "${GREEN}[OK] OpenCode Wyvern aggiornato e profilo Bash ricaricato.${NC}"
}

oc() {
    oc-sync-env
    local oc; oc="$(oc-path)"
    oc-sessions-all >/dev/null 2>&1
    ssh -t "$OC_SERVER" "cd $OC_DIR && $oc"
}

oc-ssh() {
    oc-sync-env
    ssh "$OC_SERVER"
}

oc-sessions-today() {
    local list back
    list="$(oc-sessions-all)"
    [ -z "$list" ] && return 0
    back=$(( $(date +%s) - 86400 ))
    printf '%s\n' "$list" | awk -F '\t' -v m="$back" '($1/1000)>=m{print $2"\t"$3"\t"$4}'
}

oc-cache-save() {
    local f="${XDG_CACHE_HOME:-$HOME/.cache}/opencode-wyvern/sessions.tsv"
    if [ -n "$1" ]; then
        mkdir -p "$(dirname "$f")"
        printf '%s' "$1" > "$f"
    fi
}

oc-cache-load() {
    cat "${XDG_CACHE_HOME:-$HOME/.cache}/opencode-wyvern/sessions.tsv" 2>/dev/null
}

oc-sessions-all() {
    oc-sync-env
    local oc b64 out
    py='import json,sys
raw=sys.stdin.read()
i=raw.find("[\n")
if i<0:
    i=raw.find("[")
d=json.loads(raw[i:])
for s in d:
    u=s.get("updated") or 0
    title=(s.get("title") or "").replace("\t"," ").replace("\n"," ")
    print(str(u)+"\t"+s.get("id","")+"\t"+title+"\t"+s.get("directory",""))'
    b64=$(printf '%s' "$py" | base64 -w0)
    oc="$(oc-path)"
    out="$(ssh -n -o BatchMode=yes "$OC_SERVER" "cd ~ && $oc --pure session list --format json 2>/dev/null | python3 -c \"import base64;exec(base64.b64decode('$b64').decode())\"" 2>/dev/null | sort -t $'\t' -k1,1nr)"
    [ -z "$out" ] && return 0
    oc-cache-save "$out"
    printf '%s\n' "$out"
}

oc-find() {
    local search="$1" limit="${2:-30}" i id title dir date
    local list; list="$(oc-sessions-all)"
    if [ -z "$list" ]; then
        echo -e "${YELLOW}[WARN] Nessuna sessione trovata (o SSH a chiave non configurato - esegui oc-connect).${NC}"
        return 1
    fi
    if [ -n "$search" ]; then
        list=$(printf '%s\n' "$list" | grep -iF -- "$search")
    fi
    if [ -z "$list" ]; then
        echo -e "${YELLOW}[WARN] Nessuna sessione corrispondente a: $search${NC}"
        return 1
    fi
    if [ -n "$search" ]; then
        echo -e "${CYAN}Risultati per \"$search\" (max $limit):${NC}"
    else
        echo -e "${CYAN}Sessioni recenti (max $limit):${NC}"
    fi
    printf '%s\n' "$list" | head -n "$limit" | nl -w2 -s'. ' | while read -r _line; do
        idx=$(printf '%s' "$_line" | cut -d. -f1 | tr -d ' ')
        rest=$(printf '%s' "$_line" | cut -d. -f2- | sed 's/^ //')
        id=$(printf '%s' "$rest" | cut -f2)
        title=$(printf '%s' "$rest" | cut -f3)
        dir=$(printf '%s' "$rest" | cut -f4)
        date=$(date -d "@$((id_epoch))" "+%Y-%m-%d %H:%M" 2>/dev/null || echo "?")
        id_epoch=$(( $(printf '%s' "$rest" | cut -f1) / 1000 ))
        printf '  %2d. [%s] %s  (%s)  %s\n' "$idx" "${id:0:12}" "$title" "$date" "$dir"
    done
    echo ""
    read -rp "Numero da aprire (INVIO per annullare): " choice
    if [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "$limit" ]; then
        line=$(printf '%s\n' "$list" | head -n "$choice" | tail -n1)
        id=$(printf '%s' "$line" | cut -f2)
        dir=$(printf '%s' "$line" | cut -f4)
        [ -n "$id" ] && oc-go "$id" "$dir" --no-recap
    fi
}

oc-sessions() {
    local list; list="$(oc-sessions-today)"
    if [ -z "$list" ]; then
        echo -e "${YELLOW}[WARN] Nessuna sessione nelle ultime 24 ore (o SSH a chiave non configurato - esegui oc-connect).${NC}"
        return 1
    fi
    echo -e "${CYAN}Sessioni nelle ultime 24 ore:${NC}"
    local i=0
    while IFS=$'\t' read -r id title dir; do
        i=$((i+1))
        printf '  %d. [%s] %s\n' "$i" "${id:0:12}" "$title"
    done <<< "$list"
}

oc-delete() {
    local search="$1" i idx id title dir line choice confirm list
    list="$(oc-sessions-all)"
    if [ -z "$list" ]; then
        echo -e "${YELLOW}[WARN] Nessuna sessione trovata.${NC}"
        return 1
    fi
    if [ -n "$search" ]; then
        list=$(printf '%s\n' "$list" | awk -F $'\t' -v s="$search" 'index($3, s) || index($2, s)')
    fi
    if [ -z "$list" ]; then
        echo -e "${YELLOW}[WARN] Nessuna sessione corrispondente a: $search${NC}"
        return 1
    fi
    echo -e "${CYAN}Sessioni (seleziona da eliminare):${NC}"
    printf '%s\n' "$list" | head -n 30 | nl -w2 -s'. ' | while read -r _line; do
        idx=$(printf '%s' "$_line" | cut -d. -f1 | tr -d ' ')
        rest=$(printf '%s' "$_line" | cut -d. -f2- | sed 's/^ //')
        id=$(printf '%s' "$rest" | cut -f2)
        title=$(printf '%s' "$rest" | cut -f3)
        date=$(date -d "@$(( $(printf '%s' "$rest" | cut -f1) / 1000 ))" "+%Y-%m-%d %H:%M" 2>/dev/null || echo "?")
        printf '  %2d. [%s] %s  (%s)\n' "$idx" "${id:0:12}" "$title" "$date"
    done
    echo ""
    read -rp "Numero da eliminare (INVIO per annullare): " choice
    [ "$choice" -ge 1 ] 2>/dev/null || return 0
    line=$(printf '%s\n' "$list" | head -n "$choice" | tail -n1)
    [ -n "$line" ] || { echo -e "${YELLOW}Indice fuori range.${NC}"; return 1; }
    id=$(printf '%s' "$line" | cut -f2)
    title=$(printf '%s' "$line" | cut -f3)
    read -rp "Eliminare definitivamente la sessione '$title'? (s/N): " confirm
    case "$confirm" in
        s|S|si|SI|sì|SÌ|y|Y|yes|YES) ;;
        *) echo -e "${YELLOW}Annullato.${NC}"; return 0 ;;
    esac
    local oc; oc="$(oc-path)"
    ssh -o BatchMode=yes "$OC_SERVER" "cd ~ && $oc --pure session delete $id </dev/null" 2>&1 | grep -v '^\[claude-mem\]' || true
    echo -e "${GREEN}[OK] Sessione eliminata: $title${NC}"
}

oc-go() {
    oc-sync-env
    local id="$1" dir="${2:-}" norecap=0 oc exit_code session_dir
    [ "$3" = "--no-recap" ] && norecap=1
    if [ -z "$id" ]; then
        echo -e "${RED}[FAIL] Specifica l'ID della sessione.${NC}"
        return 2
    fi
    case "$id" in
        *[![:alnum:]_-]*) echo -e "${RED}[FAIL] ID sessione non valido.${NC}"; return 2 ;;
    esac
    oc="$(oc-path)"
    if [ -z "$dir" ]; then
        session_dir="$(oc-cache-load | awk -F '\t' -v wanted="$id" '$2 == wanted { print $4; exit }')"
        if [ -z "$session_dir" ]; then
            session_dir="$(oc-sessions-all | awk -F '\t' -v wanted="$id" '$2 == wanted { print $4; exit }')"
        fi
        dir="${session_dir:-~}"
    fi
    mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/opencode-wyvern"
    printf '%s\t%s\n' "$id" "${dir:-~}" > "${XDG_CACHE_HOME:-$HOME/.cache}/opencode-wyvern/last.tsv"
    if [ "$dir" = "~" ] || [ -z "$dir" ]; then
        ssh -t -o ConnectTimeout=8 "$OC_SERVER" "cd ~ && $oc -s $id"
    else
        ssh -t -o ConnectTimeout=8 "$OC_SERVER" "mkdir -p '$dir' && cd '$dir' && $oc -s $id"
    fi
    exit_code=$?
    [ "$norecap" = "0" ] && oc-recap "$exit_code"
    return 0
}

oc-recap() {
    oc-sync-env
    local last_exit="${1:--1}" err_time live cached list bar back m i id title dir updated last choice ss cid ctitle cdir
    err_time="$(date '+%Y-%m-%d %H:%M:%S')"
    bar="=============================================="
    echo ""
    echo -e "${CYAN}${bar}${NC}"
    echo -e "${CYAN}Connessione terminata. Riepilogo per riprendere:${NC}"
    echo -e "${CYAN}${bar}${NC}"
    live="$(oc-sessions-today 2>/dev/null)"
    if [ -z "$live" ]; then
        cached="$(oc-cache-load)"
        if [ "$last_exit" = "127" ]; then
            echo -e "${RED}  [!] Comando remoto non trovato (SSH exit 127).${NC}"
            echo -e "${YELLOW}      Probabile causa: opencode non e' installato sul server o non e' nel PATH della shell SSH.${NC}"
            echo -e "${DARKGRAY:-}      Risolvi con: oc-setup scegliendo Client + Server, oppure sul server: npm install -g opencode-ai${NC}"
            return 127
        fi
        if [ -n "$cached" ]; then
            m="$(stat -c %y "${XDG_CACHE_HOME:-$HOME/.cache}/opencode-wyvern/sessions.tsv" 2>/dev/null | cut -d'.' -f1)"
            echo -e "${RED}  [!] Connessione persa alle $err_time (SSH exit $last_exit).${NC}"
            echo -e "${YELLOW}      Errore: il server non risponde / raggiungibile.${NC}"
            echo -e "${DARKGRAY:-}      Riepilogo salvato localmente il $m: riprendi appena torna la connessione.${NC}"
            echo ""
            back=$(( $(date +%s) - 86400 ))
            list="$(printf '%s\n' "$cached" | awk -F '\t' -v m="$back" '($1/1000)>=m{print $2"\t"$3"\t"$4"\t"$1}')"
        else
            echo -e "${RED}  [!] Connessione persa alle $err_time (SSH exit $last_exit).${NC}"
            echo -e "${YELLOW}      Errore: il server non risponde / raggiungibile.${NC}"
            echo -e "${YELLOW}      Nessun riepilogo salvato: il client non si era mai collegato.${NC}"
            echo -e "${DARKGRAY:-}      Quando il server torna su: oc-recap${NC}"
            return 1
        fi
    else
        list="$live"
    fi
    if [ -z "$list" ]; then
        echo -e "${YELLOW}  Nessuna sessione nelle ultime 24 ore nel riepilogo.${NC}"
        return 1
    fi
    i=0
    while IFS=$'\t' read -r id title dir updated; do
        i=$((i+1))
        last="$( [ -n "$updated" ] && date -d "@$(( updated / 1000 ))" '+%H:%M' 2>/dev/null )"
        echo ""
        printf '  %2d) %s  [%s...]\n' "$i" "$title" "${id:0:12}"
        printf '      in:  %s   (ultimo aggiornamento %s)\n' "${dir:-~}" "$last"
        printf '      run: opencode -s %s\n' "$id"
        printf '      oc-go: oc-go -Id %c%s%c -Dir %c%s%c\n' "'" "$id" "'" "'" "${dir:-~}" "'"
    done <<< "$list"
    echo ""
    printf "Scelta (1..%s riprendi, r riprova, n nuova sessione, INVIO esci): " "$i"
    read -r choice || true
    case "$choice" in
        '' ) echo -e "${DARKGRAY:-}  Per riprendere in seguito: oc-recap oppure oc-resume${NC}"
             return 0 ;;
        r|R|riprova )
             echo -e "${CYAN}  Riprovo la connessione...${NC}"
             OC_OPENCODE=""
             oc-recap -1
             return 0 ;;
        n|N )
             echo -e "${CYAN}  Nuova sessione...${NC}"
             oc
             return 0 ;;
        * )
             if [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "$i" ]; then
                 ss="$(printf '%s\n' "$list" | sed -n "${choice}p")"
                 IFS=$'\t' read -r cid ctitle cdir _ <<< "$ss"
                 echo -e "  ${CYAN}Riprendo: $ctitle${NC}"
                 oc-go "$cid" "$cdir"
             else
                 echo -e "${YELLOW}  Scelta non valida.${NC}"
             fi
             return 0 ;;
    esac
}

oc-open-tab() {
    local title="$1"; shift
    local cmd="$1"; shift
    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal --title "$title" -- bash -lc "$cmd"
    elif command -v konsole >/dev/null 2>&1; then
        konsole --new-tab -p tabtitle "$title" -e bash -lc "$cmd"
    elif command -v xfce4-terminal >/dev/null 2>&1; then
        xfce4-terminal --title "$title" -e "bash -lc \"$cmd\""
    elif command -v xterm >/dev/null 2>&1; then
        xterm -T "$title" -e bash -lc "$cmd"
    else
        echo -e "${RED}[FAIL] Nessun terminale grafico trovato per aprire i tab.${NC}"
    fi
}

oc-resume() {
    oc-sync-env
    local list rest first_term=1 mode="$1" term
    if [ "$mode" = "--all-tabs" ] || [ "$mode" = "-a" ]; then
        first_term=0
    fi
list="$(oc-sessions-today)"
    if [ -z "$list" ]; then
        if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$OC_SERVER" "echo PING_OK" 2>/dev/null | grep -q PING_OK; then
            echo ""
            echo -e "${RED}  [!] Errore di connessione al server.${NC}"
            local last_file last_id last_dir
            last_file="${XDG_CACHE_HOME:-$HOME/.cache}/opencode-wyvern/last.tsv"
            if [ -f "$last_file" ]; then
                IFS=$'\t' read -r last_id last_dir < "$last_file"
                if [ -n "$last_id" ]; then
                    echo -e "${CYAN}  Riprendo automaticamente l'ultima sessione terminata...${NC}"
                    echo ""
                    oc-go "$last_id" "${last_dir:-~}"
                    return $?
                fi
            fi
            echo -e "${YELLOW}  Nessuna sessione da riprendere automaticamente.${NC}"
            oc-recap
            return 1
        fi
        echo -e "${YELLOW}[WARN] Nessuna sessione nelle ultime 24 ore (o SSH a chiave non configurato - esegui oc-connect).${NC}"
        return 1
    fi
    term="$(oc-detect-terminal)"
    if [ "$term" = "warp" ]; then
        if [ "$first_term" = "1" ]; then
            rest="$(printf '%s\n' "$list" | tail -n +2)"
            if [ -n "$rest" ]; then
                oc-warp-resume "$rest"
            fi
            local first_id first_dir
            IFS=$'\t' read -r first_id _first_title first_dir <<< "$list"
            echo -e "  ${CYAN}Riprendo qui: $_first_title${NC}"
            oc-go "$first_id" "$first_dir"
        else
            oc-warp-resume "$list"
        fi
        return $?
    fi
    if [ "$first_term" = "1" ]; then
        rest="$(printf '%s\n' "$list" | tail -n +2)"
    else
        rest="$list"
    fi
    if [ -n "$rest" ]; then
        while IFS=$'\t' read -r id title dir; do
            echo -e "  ${CYAN}Apro tab: $title${NC}"
            oc-open-tab "$title" "oc-go '$id' '$dir'"
            sleep 0.8
        done <<< "$rest"
    fi
    if [ "$first_term" = "1" ]; then
        local first_id first_dir
        IFS=$'\t' read -r first_id _first_title first_dir <<< "$list"
        echo -e "  ${CYAN}Riprendo qui: $_first_title${NC}"
        oc-go "$first_id" "$first_dir"
    fi
}

oc-detect-terminal() {
    if [ -n "$TERM_PROGRAM" ] && [ "${TERM_PROGRAM#*warp}" != "$TERM_PROGRAM" ]; then
        echo "warp"; return
    fi
    if [ -n "${WARP_SESSION:-}" ] || [ -n "${WARP_PROJECT:-}" ]; then
        echo "warp"; return
    fi
    if [ -n "$GNOME_TERMINAL_SERVICE" ] || [ -n "$GNOME_TERMINAL_SCREEN" ]; then
        echo "gnome"; return
    fi
    case "$TERM" in
        xterm*|rxvt*) echo "xterm"; return ;;
        screen*) echo "screen"; return ;;
    esac
    echo "other"
}

oc-warp-resume() {
    local list="$1" id title dir stem configs_dir i=0 toml created=""
    if command -v xdg-open >/dev/null 2>&1; then
        local open=xdg-open
    else
        local open=xdg-open
    fi
    configs_dir="${XDG_DATA_HOME:-$HOME/.local/share}/warp-terminal/tab_configs"
    if [ ! -d "$configs_dir" ]; then
        configs_dir="${XDG_DATA_HOME:-$HOME/.local/share}/warp-terminal-preview/tab_configs"
    fi
    if [ ! -d "$configs_dir" ]; then
        mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/warp-terminal/tab_configs"
        configs_dir="${XDG_DATA_HOME:-$HOME/.local/share}/warp-terminal/tab_configs"
    fi
    while IFS=$'\t' read -r id title dir; do
        i=$((i+1))
        stem="oc-resume-$i-$(date +%s%N)"
        toml="$configs_dir/$stem.toml"
        if [ "$dir" = "~" ] || [ -z "$dir" ]; then
            dir='/home/'"$USER"
        fi
        local oc; oc="$(oc-path)"
        title="$(printf '%s' "$title" | tr -d '"\\' | tr -s ' ')"
        if [ "$dir" = "/home/$USER" ] || [ -z "$dir" ]; then
            remote_cmd="cd ~ && $oc -s $id"
        else
            remote_cmd="mkdir -p '$dir' && cd '$dir' && $oc -s $id"
        fi
        cmd="ssh -t $OC_SERVER \"$remote_cmd\"; oc-recap"
        printf 'name = "[oc] %s"\ntitle = "%s"\n[[panes]]\nid = "main"\ntype = "terminal"\nshell = "bash"\ncommands = ["%s"]\n' \
            "$title" "$title" "$cmd" > "$toml"
        echo -e "  ${CYAN}Apro tab Warp: $title${NC}"
        "$open" "warp://tab_config/$stem"
        sleep 2
        created="$created $toml"
    done <<< "$list"
    echo ""
    echo -e "${DARKGRAY:-}Suggerimento: Ctrl+click su tutte le tab, tasto destro e 'New group with tab'.${NC}"
    ( sleep 15; for f in $created; do rm -f "$f"; done ) >/dev/null 2>&1 &
    return 0
}

oc-help() {
    echo ""
    echo -e "${CYAN}OpenCode Wyvern - comandi${NC}"
    echo -e "${CYAN}============================${NC}"
    echo ""
    printf '  %-24s %s\n' "oc-connect" "Setup SSH key + autorizzazione server"
    printf '  %-24s %s\n' "oc-update" "Aggiorna il pacchetto e riapplica i comandi oc-*"
    printf '  %-24s %s\n' "oc" "Nuova sessione opencode in $OC_DIR"
    printf '  %-24s %s\n' "oc-ssh" "Apri sessione SSH interattiva"
    printf '  %-24s %s\n' "oc-sessions" "Lista sessioni opencode (ultime 24h)"
    printf '  %-24s %s\n' "oc-find [testo]" "Cerca sessioni globali per titolo e riapri"
    printf '  %-24s %s\n' "oc-delete [testo]" "Cerca ed elimina sessioni"
    printf '  %-24s %s\n' "oc-resume [--all-tabs]" "Riprende 1 sessione qui + 1 tab per le altre (o tutte in tab)"
    printf '  %-24s %s\n' "oc-go <id> [dir]" "Riprende una sessione specifica"
    printf '  %-24s %s\n' "oc-recap" "Riepilogo sessioni (usa cache se il server e'' giu')"
    printf '  %-24s %s\n' "oc-help" "Questo aiuto"
    echo ""
    echo -e "${DARKGRAY:-}Nota: oc-ssh, oc-sessions, oc-resume richiedono SSH key configurata"
    echo ""
}
