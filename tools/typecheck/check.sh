#!/bin/bash
# Type-checks both apps against ambient stubs for next/react/@supabase.
# The npm registry is blocked in this sandbox, so the real packages cannot be
# installed; these stubs model the APIs we actually use closely enough to catch
# genuine errors before Vercel ever sees the code.
export PATH=/home/claude/.npm-global/bin:$PATH
fail=0
for a in admin customer; do
  out=$(tsc -p /home/claude/tc/tsconfig.$a.json 2>&1)
  if [ -n "$out" ]; then echo "### $a"; echo "$out"; fail=1; fi
done
[ $fail -eq 0 ] && echo "TYPECHECK CLEAN — both apps"
exit $fail
