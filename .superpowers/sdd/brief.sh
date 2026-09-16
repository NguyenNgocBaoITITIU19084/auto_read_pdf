# usage: sh brief.sh PLAN N OUT
awk -v n="$2" '
  /^```/ { infence = !infence }
  !infence && /^#+[ \t]+Task[ \t]+[0-9]+/ { intask = ($0 ~ ("^#+[ \t]+Task[ \t]+" n "([^0-9]|$)")) }
  intask { print }
' "$1" > "$3"; wc -l < "$3"
