#!/bin/sh
# The stage reader for installers. The same questions, the same words and the same exit codes as
# tools/stage.mjs, in POSIX shell: no jq, no Node, no Python, because an installer runs before
# Node is installed and on servers that have none. It runs in the Mac's own /bin/bash 3.2 as well
# as in dash and bash 5.
#
#   sh tools/stage.sh <stage file> check          read it and check it; print nothing
#   sh tools/stage.sh <stage file> fields         every field it can read, one a line
#   sh tools/stage.sh <stage file> get <field>    print one field, for example productCommit,
#                                                 serverEditions.server.image, addons.mc-video
#   sh tools/stage.sh <stage file> json           the whole checked file as JSON
#   sh tools/stage.sh withdrawn <installed stage> <public stage> [version]
#                                                 yes when either file lists the version
#
# Exit: 0 answered, 1 the file is refused (one plain sentence on stderr), 2 the file is sound but
# holds no such field (and for a command line this reader does not understand). An installer goes
# on only when the withdrawn answer is exactly "no", so every failure fails closed.
#
# This reader has no JSON parser. It reads the one layout a stage file is written in - the one
# JSON.stringify(stage, null, 2) writes: two spaces a level, one field a line, no tabs, no
# backslash escapes, Unix line endings - and refuses anything else with a plain sentence rather
# than guess at it. stage.schema.json carries the rules it checks; tools/stage.mjs reads that file
# itself, this one repeats its rules, and tools/test-stage-agree.sh proves the two answer alike.
set -u
LC_ALL=C
export LC_ALL

TAB=$(printf '\t')
CR=$(printf '\r')
NL='
'

USAGE="usage: sh tools/stage.sh <stage file> check|fields|json
       sh tools/stage.sh <stage file> get <field>
       sh tools/stage.sh withdrawn <installed stage> <public stage> [version]"

FILE=''
flat=''
fieldlist=''

refuse()  { printf '%s\n' "$1" >&2; exit 1; }
nofield() { printf '%s\n' "$1" >&2; exit 2; }
usage()   { printf '%s\n' "$USAGE" >&2; exit 2; }

badlayout() { refuse "$FILE is not JSON in the layout a stage file is written in: $1."; }
miss()      { refuse "$FILE names no $1."; }
notwhat()   { refuse "the $1 in $FILE is not $2: $3."; }
notnamed()  { refuse "$FILE holds $1, which a stage file does not name."; }

# ---------------------------------------------------------------- the patterns the schema names
is_hex() { # <string> <length>: lowercase hex, exactly that long
  _s=$1
  _n=$2
  case $_s in '' | *[!0123456789abcdef]*) return 1 ;; esac
  [ "${#_s}" -eq "$_n" ]
}

is_version() { # 2.0.0, or 2.0.0-beta.6
  _v=$1
  case $_v in
    *-*) _core=${_v%%-*}; _pre=${_v#*-} ;;
    *)   _core=$_v;       _pre='' ;;
  esac
  case $_core in *.*.*) ;; *) return 1 ;; esac
  _a=${_core%%.*}
  _rest=${_core#*.}
  _b=${_rest%%.*}
  _c=${_rest#*.}
  for _part in "$_a" "$_b" "$_c"; do
    case $_part in '' | *[!0123456789]*) return 1 ;; esac
  done
  case $_v in
    *-*)
      case $_pre in '' | *[!0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.]*) return 1 ;; esac
      ;;
  esac
  return 0
}

is_digest() { # <image>@sha256:<64 hex>
  _d=$1
  case $_d in *@sha256:*) ;; *) return 1 ;; esac
  _img=${_d%%@sha256:*}
  _hex=${_d#*@sha256:}
  case $_img in '' | *[!0123456789abcdefghijklmnopqrstuvwxyz._/-]*) return 1 ;; esac
  case $_img in [0123456789abcdefghijklmnopqrstuvwxyz]*) ;; *) return 1 ;; esac
  is_hex "$_hex" 64
}

is_name() { # the name of an edition or an add-on: lowercase words joined by one hyphen
  _n=$1
  case $_n in '' | -* | *- | *--* | *[!0123456789abcdefghijklmnopqrstuvwxyz-]*) return 1 ;; esac
  return 0
}

is_plain() { # a file name or a release tag
  _p=$1
  case $_p in '' | *[!0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ._-]*) return 1 ;; esac
  return 0
}

# ------------------------------------------------------------------------------ reading the file
# Everything the file holds ends up in $flat, one line a value:
#   <dotted path><tab><kind><tab><value>      kind: s string, n number, b true/false, z null,
#                                             o object, a list. A list's items are <path>#1, #2...
# and every field a reader may print ends up in $fieldlist, in the file's own order.

look() { # <path>: sets LOOK_FOUND, LOOK_KIND, LOOK_VAL
  LOOK_FOUND=0
  LOOK_KIND=''
  LOOK_VAL=''
  while IFS= read -r _line; do
    case $_line in
      "$1$TAB"*)
        _r=${_line#*"$TAB"}
        LOOK_KIND=${_r%%"$TAB"*}
        LOOK_VAL=${_r#*"$TAB"}
        LOOK_FOUND=1
        break
        ;;
    esac
  done <<STAGE_FLAT
$flat
STAGE_FLAT
}

children() { # <path, or nothing for the whole file>: the names one level under it, one a line
  _pfx=$1
  while IFS= read -r _line; do
    [ -n "$_line" ] || continue
    _p=${_line%%"$TAB"*}
    if [ -z "$_pfx" ]; then
      _c=$_p
    else
      case $_p in "$_pfx".*) _c=${_p#"$_pfx".} ;; *) continue ;; esac
    fi
    case $_c in '' | *.* | *'#'*) continue ;; esac
    printf '%s\n' "$_c"
  done <<STAGE_FLAT
$flat
STAGE_FLAT
}

member_start() { # the field before this one in the same brackets needed a comma
  eval "_seen=\$seen$depth; _need=\$need$depth"
  if [ "$_seen" -eq 1 ] && [ "$_need" -eq 0 ]; then
    badlayout "line $((lineno - 1)) is missing the comma the next field needs"
  fi
}

parse_file() { # <file>: fills $flat and $fieldlist, or refuses
  FILE=$1
  [ -f "$FILE" ] || refuse "$FILE cannot be read: there is no such file."
  flat=''
  fieldlist=''
  depth=0
  started=0
  finished=0
  lineno=0
  line=''
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    [ "$finished" -eq 0 ] || badlayout "line $lineno comes after the closing brace"
    case $line in
      *"$CR"*) badlayout "line $lineno ends in a carriage return" ;;
      *"$TAB"*) badlayout "line $lineno holds a tab" ;;
      *\\*) badlayout "line $lineno holds a backslash" ;;
    esac

    rest=$line
    ind=0
    while :; do
      case $rest in
        "  "*) rest=${rest#"  "}; ind=$((ind + 1)) ;;
        *) break ;;
      esac
    done
    case $rest in
      '') badlayout "line $lineno is blank" ;;
      ' '*) badlayout "line $lineno is not indented by two spaces a level" ;;
    esac

    body=$rest
    comma=0
    case $body in *,) body=${body%,}; comma=1 ;; esac

    case $body in
      '{')         kind=root ;;
      '}')         kind=closeobj ;;
      ']')         kind=closearr ;;
      '"'*'": {}') kind=emptyobj ;;
      '"'*'": []') kind=emptyarr ;;
      '"'*'": {')  kind=openobj ;;
      '"'*'": [')  kind=openarr ;;
      '"'*'": '*)  kind=member ;;
      '"'*'"')     kind=item ;;
      *)           badlayout "line $lineno is not a line a stage file holds" ;;
    esac

    if [ "$kind" = root ]; then
      [ "$started" -eq 0 ] || badlayout "line $lineno opens a second object at the top"
      [ "$ind" -eq 0 ] || badlayout "line $lineno is indented but opens the file"
      [ "$comma" -eq 0 ] || badlayout "line $lineno ends in a comma"
      started=1
      depth=1
      t1=o
      seen1=0
      need1=0
      pre1=''
      continue
    fi
    [ "$started" -eq 1 ] || badlayout "line $lineno is outside the file's object"

    case $kind in
      closeobj | closearr)
        [ "$depth" -ge 1 ] || badlayout "line $lineno closes something that was never opened"
        [ "$ind" -eq $((depth - 1)) ] || badlayout "line $lineno is not indented like the bracket it closes"
        eval "ct=\$t$depth; cseen=\$seen$depth; cneed=\$need$depth"
        if [ "$kind" = closeobj ] && [ "$ct" != o ]; then badlayout "line $lineno closes a list with a brace"; fi
        if [ "$kind" = closearr ] && [ "$ct" != a ]; then badlayout "line $lineno closes an object with a bracket"; fi
        if [ "$cseen" -eq 1 ] && [ "$cneed" -eq 1 ]; then
          badlayout "line $((lineno - 1)) ends in a comma before a closing bracket"
        fi
        depth=$((depth - 1))
        if [ "$depth" -eq 0 ]; then
          [ "$comma" -eq 0 ] || badlayout "line $lineno ends in a comma"
          finished=1
        else
          eval "seen$depth=1; need$depth=$comma"
        fi
        ;;

      item)
        eval "ct=\$t$depth"
        [ "$ct" = a ] || badlayout "line $lineno is not a field a stage file names"
        [ "$ind" -eq "$depth" ] || badlayout "line $lineno is not indented like the list it is in"
        member_start
        s=${body#\"}
        s=${s%\"}
        case $s in *'"'*) badlayout "line $lineno holds a quote inside a value" ;; esac
        eval "cnt$depth=\$((cnt$depth + 1)); n=\$cnt$depth; apath=\$arr$depth"
        flat=$flat$apath'#'$n$TAB's'$TAB$s$NL
        eval "seen$depth=1; need$depth=$comma"
        ;;

      *)
        eval "ct=\$t$depth"
        [ "$ct" = o ] || badlayout "line $lineno names a field inside a list"
        [ "$ind" -eq "$depth" ] || badlayout "line $lineno is not indented like the field it names"
        member_start
        k=${body#\"}
        k=${k%%\"*}
        case $k in '' | *[!A-Za-z0-9_-]*) badlayout "line $lineno names a field this reader will not read" ;; esac
        eval "p=\$pre$depth"
        path=$p$k
        case $kind in
          member)
            v=${body#*\": }
            case $v in
              '"'*'"')
                s=${v#\"}
                s=${s%\"}
                case $s in *'"'*) badlayout "line $lineno holds a quote inside a value" ;; esac
                vkind=s
                vval=$s
                ;;
              null) vkind=z; vval=null ;;
              true | false) vkind=b; vval=$v ;;
              '' | *[!0123456789]*) badlayout "line $lineno holds a value this reader will not read" ;;
              *) vkind=n; vval=$v ;;
            esac
            flat=$flat$path$TAB$vkind$TAB$vval$NL
            fieldlist=$fieldlist$path$NL
            eval "seen$depth=1; need$depth=$comma"
            ;;
          emptyobj)
            flat=$flat$path${TAB}o$TAB$NL
            eval "seen$depth=1; need$depth=$comma"
            ;;
          emptyarr)
            flat=$flat$path${TAB}a$TAB$NL
            fieldlist=$fieldlist$path$NL
            eval "seen$depth=1; need$depth=$comma"
            ;;
          openobj | openarr)
            [ "$comma" -eq 0 ] || badlayout "line $lineno ends in a comma"
            nd=$((depth + 1))
            [ "$nd" -le 6 ] || badlayout "line $lineno nests deeper than a stage file goes"
            if [ "$kind" = openobj ]; then
              flat=$flat$path${TAB}o$TAB$NL
              eval "t$nd=o; pre$nd=\$path."
            else
              flat=$flat$path${TAB}a$TAB$NL
              fieldlist=$fieldlist$path$NL
              eval "t$nd=a; arr$nd=\$path; cnt$nd=0"
            fi
            eval "seen$nd=0; need$nd=0"
            eval "seen$depth=1; need$depth=1"
            depth=$nd
            ;;
        esac
        ;;
    esac
  done < "$FILE"
  [ "$started" -eq 1 ] || refuse "$FILE is not JSON in the layout a stage file is written in: it does not open with a line holding only a brace."
  [ "$finished" -eq 1 ] || badlayout "it ends before its closing brace"
}

# ------------------------------------------------------------ the rules stage.schema.json names
# The same order tools/stage.mjs walks the schema in: the fields that are there, in the order the
# schema names them, then the fields that are missing, then the fields a stage file does not name.

a_commit() { # <path> <plain name>
  look "$1"
  if [ "$LOOK_FOUND" -eq 1 ]; then
    if [ "$LOOK_KIND" != s ] || ! is_hex "$LOOK_VAL" 40; then
      notwhat "$2" "a 40-character commit" "$LOOK_VAL"
    fi
  fi
}

a_version() { # <path> <plain name>
  look "$1"
  if [ "$LOOK_FOUND" -eq 1 ]; then
    if [ "$LOOK_KIND" != s ] || ! is_version "$LOOK_VAL"; then
      notwhat "$2" "a version like 2.0.0-beta.6" "$LOOK_VAL"
    fi
  fi
}

there() { # <path> <plain name>: the field must be there
  look "$1"
  [ "$LOOK_FOUND" -eq 1 ] || miss "$2"
}

an_object() { # <path> <plain name> <what the schema calls it>
  look "$1"
  if [ "$LOOK_FOUND" -eq 1 ] && [ "$LOOK_KIND" != o ]; then
    notwhat "$2" "$3" "$LOOK_VAL"
  fi
}

check_stage() {
  # stageFormat: the one value the schema fixes, so an older reader stops at a newer file.
  look stageFormat
  if [ "$LOOK_FOUND" -eq 1 ] && { [ "$LOOK_KIND" != n ] || [ "$LOOK_VAL" != 1 ]; }; then
    refuse "$FILE says stage format $LOOK_VAL, which this reader does not understand."
  fi

  a_version version "version"
  a_commit productCommit "product commit"

  # kitBootstrap
  an_object kitBootstrap "kit bootstrap" "an object"
  look kitBootstrap
  if [ "$LOOK_FOUND" -eq 1 ]; then
    a_commit kitBootstrap.unixEngineCommit "shared Unix engine commit"
    a_commit kitBootstrap.windowsBootstrapCommit "Windows bootstrap commit"
    there kitBootstrap.unixEngineCommit "shared Unix engine commit"
    there kitBootstrap.windowsBootstrapCommit "Windows bootstrap commit"
    for c in $(children kitBootstrap); do
      case $c in unixEngineCommit | windowsBootstrapCommit) ;; *) notnamed "kitBootstrap.$c" ;; esac
    done
  fi

  # serverEditions
  an_object serverEditions "server editions" "an object naming at least one edition"
  look serverEditions
  if [ "$LOOK_FOUND" -eq 1 ]; then
    editions=0
    for e in $(children serverEditions); do
      is_name "$e" || notnamed "serverEditions.$e"
      editions=$((editions + 1))
      an_object "serverEditions.$e" "server edition $e" "an object"
      look "serverEditions.$e.image"
      if [ "$LOOK_FOUND" -eq 1 ]; then
        if [ "$LOOK_KIND" != s ] || ! is_digest "$LOOK_VAL"; then
          notwhat "server image of the $e edition" "pinned by digest" "$LOOK_VAL"
        fi
      else
        miss "server image of the $e edition"
      fi
      for c in $(children "serverEditions.$e"); do
        case $c in image) ;; *) notnamed "serverEditions.$e.$c" ;; esac
      done
    done
    [ "$editions" -ge 1 ] || refuse "$FILE names no server editions."
  fi

  # windowsSetup
  an_object windowsSetup "Windows setup" "an object"
  look windowsSetup
  if [ "$LOOK_FOUND" -eq 1 ]; then
    look windowsSetup.file
    if [ "$LOOK_FOUND" -eq 1 ] && { [ "$LOOK_KIND" != s ] || ! is_plain "$LOOK_VAL"; }; then
      notwhat "Windows setup file name" "a file name" "$LOOK_VAL"
    fi
    look windowsSetup.releaseTag
    if [ "$LOOK_FOUND" -eq 1 ] && { [ "$LOOK_KIND" != s ] || ! is_plain "$LOOK_VAL"; }; then
      notwhat "Windows setup release tag" "a GitHub release tag" "$LOOK_VAL"
    fi
    look windowsSetup.sha256
    if [ "$LOOK_FOUND" -eq 1 ] && { [ "$LOOK_KIND" != s ] || ! is_hex "$LOOK_VAL" 64; }; then
      notwhat "Windows setup SHA-256" "a 64-character SHA-256" "$LOOK_VAL"
    fi
    there windowsSetup.file "Windows setup file name"
    there windowsSetup.releaseTag "Windows setup release tag"
    there windowsSetup.sha256 "Windows setup SHA-256"
    for c in $(children windowsSetup); do
      case $c in file | releaseTag | sha256) ;; *) notnamed "windowsSetup.$c" ;; esac
    done
  fi

  # addons
  an_object addons "add-ons" "an object"
  look addons
  if [ "$LOOK_FOUND" -eq 1 ]; then
    for a in $(children addons); do
      is_name "$a" || notnamed "addons.$a"
      a_commit "addons.$a" "pin of the add-on $a"
    done
  fi

  # previous
  look previous
  if [ "$LOOK_FOUND" -eq 1 ] && [ "$LOOK_KIND" != z ] && [ "$LOOK_KIND" != o ]; then
    notwhat "previous stage" "null, or the stage this one replaced" "$LOOK_VAL"
  fi
  if [ "$LOOK_FOUND" -eq 1 ] && [ "$LOOK_KIND" = o ]; then
    a_version previous.version "previous version"
    a_commit previous.stageCommit "previous stage commit"
    there previous.version "previous version"
    there previous.stageCommit "previous stage commit"
    for c in $(children previous); do
      case $c in version | stageCommit) ;; *) notnamed "previous.$c" ;; esac
    done
  fi

  # withdrawn
  look withdrawn
  if [ "$LOOK_FOUND" -eq 1 ]; then
    if [ "$LOOK_KIND" != a ]; then
      notwhat "withdrawn list" "a list of versions" "$LOOK_VAL"
    fi
    i=1
    while :; do
      look "withdrawn#$i"
      [ "$LOOK_FOUND" -eq 1 ] || break
      if ! is_version "$LOOK_VAL"; then
        refuse "the withdrawn list in $FILE holds $LOOK_VAL, which is not a version."
      fi
      i=$((i + 1))
    done
  fi

  # the fields that are missing, then the fields a stage file does not name
  there stageFormat "stage format"
  there version "version"
  there productCommit "product commit"
  there kitBootstrap "kit bootstrap"
  there serverEditions "server editions"
  there windowsSetup "Windows setup"
  there addons "add-ons"
  there previous "previous stage"
  there withdrawn "withdrawn list"
  for c in $(children ''); do
    case $c in
      stageFormat | version | productCommit | kitBootstrap | serverEditions | windowsSetup | addons | previous | withdrawn) ;;
      *) notnamed "$c" ;;
    esac
  done
}

# ------------------------------------------------------------------------------- the answers
cmd_get() { # <path>
  _p=$1
  _missing="$FILE has no readable field $_p; the fields command lists the ones it has."
  look "$_p"
  [ "$LOOK_FOUND" -eq 1 ] || nofield "$_missing"
  case $LOOK_KIND in
    s | n | b | z) printf '%s\n' "$LOOK_VAL" ;;
    a)
      _i=1
      while :; do
        look "$_p#$_i"
        [ "$LOOK_FOUND" -eq 1 ] || break
        printf '%s\n' "$LOOK_VAL"
        _i=$((_i + 1))
      done
      ;;
    *) nofield "$_missing" ;;
  esac
}

lists_version() { # <version>: 0 when the file just parsed lists it as withdrawn
  _i=1
  while :; do
    look "withdrawn#$_i"
    [ "$LOOK_FOUND" -eq 1 ] || return 1
    [ "$LOOK_VAL" != "$1" ] || return 0
    _i=$((_i + 1))
  done
}

cmd_withdrawn() { # <installed stage> <public stage> [version]
  parse_file "$1"
  check_stage
  if [ -n "$3" ]; then
    asked=$3
  else
    look version
    asked=$LOOK_VAL
  fi
  is_version "$asked" || refuse "$asked is not a version like 2.0.0-beta.6."
  answer=no
  lists_version "$asked" && answer=yes
  parse_file "$2"
  check_stage
  lists_version "$asked" && answer=yes
  printf '%s\n' "$answer"
}

[ $# -ge 1 ] || usage
case $1 in
  -h | --help | help) printf '%s\n' "$USAGE"; exit 0 ;;
  withdrawn)
    [ $# -ge 3 ] && [ $# -le 4 ] || usage
    cmd_withdrawn "$2" "$3" "${4:-}"
    exit 0
    ;;
esac

[ $# -ge 2 ] || usage
parse_file "$1"
check_stage
case $2 in
  check) ;;
  fields) printf '%s' "$fieldlist" ;;
  json) cat "$1" ;;
  get)
    [ $# -eq 3 ] || usage
    cmd_get "$3"
    ;;
  *) usage ;;
esac
exit 0
