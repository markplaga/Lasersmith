#!/bin/sh
# Check the migration and its row-level security on a local Postgres (16+), outside Supabase:
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres sh supabase/tests/run.sh
# Creates a throwaway database, loads the Supabase stand-ins, applies the migration and runs rls.sql,
# which fails on the first rule that does not hold.
set -e
here=$(dirname "$0")
db=lasersmith_rls_$$
psql -q -c "create database $db"
trap 'psql -q -c "drop database $db"' EXIT
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/supabase_stub.sql"
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/../migrations/20261118000000_init.sql"
psql -q -o /dev/null -d "$db" -v ON_ERROR_STOP=1 -f "$here/rls.sql"
echo "row-level security checks passed"
