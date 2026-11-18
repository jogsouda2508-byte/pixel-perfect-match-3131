#!/bin/sh
# Replays every migration, in order, on a throwaway Postgres database, then runs the *.assert.sql
# tests next to this file. Any failing statement or ASSERT makes this script exit non-zero.
#
# Uses the standard PG* environment (PGHOST, PGPORT, PGUSER, PGPASSWORD). Default DB name: sz_replay.
#   local:  PGHOST=localhost PGUSER=postgres sh supabase/tests/replay/run.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
MIGRATIONS="$HERE/../../migrations"
DB="${REPLAY_DB:-sz_replay}"

dropdb --if-exists "$DB" >/dev/null 2>&1
createdb "$DB" || { echo "cannot create database $DB"; exit 2; }
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/00_supabase_stub.sql" >/dev/null 2>&1 || { echo "stub failed"; exit 2; }

status=0
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  # pg_net is a Supabase extension; the stub provides a no-op net.http_post instead
  sed 's/create extension if not exists pg_net;/select 1;/' "$f" > "${TMPDIR:-/tmp}/_replay_migration.sql"
  if out=$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "${TMPDIR:-/tmp}/_replay_migration.sql" 2>&1 >/dev/null); then
    echo "ok    $(basename "$f")"
  else
    echo "FAIL  $(basename "$f")"; echo "$out" | head -8 | sed 's/^/        /'; status=1
  fi
done
[ "$status" -eq 0 ] || { echo "migration replay FAILED"; exit 1; }

for t in "$HERE"/*.assert.sql; do
  if out=$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$t" 2>&1 >/dev/null | grep -v -E "^(NOTICE|WARNING|HINT)|^psql:.*(NOTICE|WARNING)"); [ -z "$out" ]; then
    echo "pass  $(basename "$t")"
  else
    echo "FAIL  $(basename "$t")"; echo "$out" | head -10 | sed 's/^/        /'; status=1
  fi
done
dropdb --if-exists "$DB" >/dev/null 2>&1
exit $status
