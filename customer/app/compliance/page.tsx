import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { ComplianceConsole, type FilingRow, type AuditRow } from '@/components/compliance/compliance-console';

export const dynamic = 'force-dynamic';

export default async function CompliancePage() {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';

  if (!v.can('compliance.read')) {
    return (
      <CustomerShell current="/compliance">
        <PageHead title="Compliance" sub="Statutory returns and the audit log" />
        <EmptyState
          icon="shieldcheck"
          title="Your role cannot see statutory filings"
          body="Filings carry what the organisation owes and what it has paid. Ask an owner to grant compliance access if you need it."
        />
      </CustomerShell>
    );
  }

  const [{ data: filings }, { data: audit }, { data: entities }] = await Promise.all([
    supabase
      .from('statutory_filings')
      .select('id,filing_type,state_code,period,due_date,status,amount,reference_no,filed_on,notes,entity_id')
      .eq('org_id', org)
      .order('due_date', { ascending: false })
      .limit(200),
    v.can('audit.read')
      ? supabase
          .from('audit_logs')
          .select('id,action,entity_type,created_at')
          .eq('org_id', org)
          .order('created_at', { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from('legal_entities').select('id,name').eq('org_id', org).order('name'),
  ]);

  /* The chain check is a read, but it walks the whole log, so it only runs for
     somebody who can actually read the log. */
  /* verify_audit_chain returns a one-row table of (ok, first_bad_seq), so
     PostgREST hands back an array. Anything else — an error, a shape we did not
     expect — stays null rather than claiming the chain is intact. */
  let chainVerified: boolean | null = null;
  if (v.can('audit.read')) {
    const { data, error } = await supabase.schema('api').rpc('verify_audit_chain', { org });
    if (!error) {
      const first = Array.isArray(data) ? (data[0] as any) : (data as any);
      if (typeof first?.ok === 'boolean') chainVerified = first.ok;
    }
  }

  return (
    <CustomerShell current="/compliance">
      <PageHead
        title="Compliance"
        sub="Provident fund, ESI, professional tax and TDS — the calendar, the files and the acknowledgements"
      />
      <ComplianceConsole
        filings={(filings ?? []) as FilingRow[]}
        audit={(audit ?? []) as AuditRow[]}
        entities={((entities ?? []) as any[]).map((e) => ({ value: e.id, label: e.name }))}
        chainVerified={chainVerified}
        caps={{ file: v.can('compliance.file'), audit: v.can('audit.read') }}
      />
    </CustomerShell>
  );
}
