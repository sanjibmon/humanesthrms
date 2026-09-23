#!/usr/bin/env bash
# Rebuilds a scratch database, applies every migration in order, loads fixtures and runs the test files.
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql -h ${PGHOST:-/tmp/pgtest} -p ${PGPORT:-54329} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists hn_test" -c "create database hn_test" 2>&1 | grep -v NOTICE || true
$PSQL -d hn_test -f tests/00_supabase_stub.sql
for f in migrations/*.sql; do $PSQL -d hn_test -f "$f"; done
$PSQL -d hn_test -f tests/01_harness.sql
$PSQL -d hn_test -f tests/02_fixtures.sql
for f in $(ls tests/[3-9]*.sql tests/[3-9]*.sh | sort); do echo "-- $f"; case "$f" in *.sql) $PSQL -d hn_test -f "$f";; *) bash "$f";; esac; done
psql -h ${PGHOST:-/tmp/pgtest} -p ${PGPORT:-54329} -U ${PGUSER:-postgres} -d hn_test -At -F ' | ' -c "select case when ok then 'PASS' else 'FAIL' end, name, coalesce(detail,'') from t.results order by n" | tee /tmp/hn_results.txt | grep FAIL || true
echo "passed: $(grep -c '^PASS' /tmp/hn_results.txt)  failed: $(grep -c '^FAIL' /tmp/hn_results.txt)"
test "$(grep -c '^FAIL' /tmp/hn_results.txt)" = 0
