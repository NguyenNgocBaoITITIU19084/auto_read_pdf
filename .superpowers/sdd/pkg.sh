# usage: sh pkg.sh BASE HEAD OUT
{ git log --oneline "$1..$2"; echo; git diff --stat "$1..$2"; echo; git diff -U10 "$1..$2"; } > "$3"; wc -l < "$3"
