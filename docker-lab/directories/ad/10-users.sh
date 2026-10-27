#!/bin/sh
# Provisions lab users/groups in the Samba AD domain (runs on every start, idempotent).
set -e
PASS="${LAB_USER_PASSWORD:-Lab-Pass123!}"
BASEDN="$(samba-tool domain info 127.0.0.1 2>/dev/null | awk -F': ' '/^Domain *:/{print $2}' | sed 's/.*/DC=&/; s/\./,DC=/g' || true)"
[ -n "$BASEDN" ] || BASEDN="DC=pingfed,DC=lab"
samba-tool ou list 2>/dev/null | grep -q '^OU=Lab Users' || samba-tool ou create "OU=Lab Users" --description "PingFederate lab users"
mkuser() { # login first last title department employeeNumber [password]
  if ! samba-tool user show "$1" >/dev/null 2>&1; then
    samba-tool user create "$1" "${7:-$PASS}" --userou="OU=Lab Users" --given-name="$2" --surname="$3" \
      --mail-address="$1@pingfed.lab" --job-title="$4" --department="$5" --description="PingFederate lab user"
    samba-tool user setexpiry "$1" --noexpiry
    printf 'dn: CN=%s %s,OU=Lab Users,%s\nchangetype: modify\nreplace: employeeNumber\nemployeeNumber: %s\n-\nreplace: displayName\ndisplayName: %s %s\n' "$2" "$3" "$BASEDN" "$6" "$2" "$3" | ldbmodify -H /var/lib/samba/private/sam.ldb
    echo "created AD user $1"
  fi
}
mkgroup() { samba-tool group show "$1" >/dev/null 2>&1 || samba-tool group add "$1" --description "PingFederate lab group"; }
mkuser karim.hossain Karim Hossain "Network Engineer" "Infrastructure" E2001
mkuser nadia.islam  Nadia Islam  "HR Manager"       "Human Resources" E2002
mkuser rafiq.islam Rafiq Islam "Security Analyst" "Security" E2003 'Rafiq#2026'
mkuser sumaiya.chowdhury Sumaiya Chowdhury "Marketing Lead" "Marketing" E2004 'Sumaiya#2026'
mkuser imran.kabir Imran Kabir "Support Engineer" "Customer Support" E2005 'Imran#2026'
mkuser lamia.haque Lamia Haque "Data Analyst" "Analytics" E2006 'Lamia#2026'
mkgroup lab-users; mkgroup lab-admins
for u in karim.hossain nadia.islam rafiq.islam sumaiya.chowdhury imran.kabir lamia.haque; do samba-tool group listmembers lab-users | grep -qx "$u" || samba-tool group addmembers lab-users "$u"; done
for u in karim.hossain rafiq.islam; do samba-tool group listmembers lab-admins | grep -qx "$u" || samba-tool group addmembers lab-admins "$u"; done
echo "AD lab users ready"
