import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DOC_LABEL: Record<string, string> = {
  aadhaar: 'Aadhaar',
  pan: 'PAN',
  offer_letter: 'Offer letter',
  appointment: 'Appointment letter',
  education: 'Education certificate',
  experience: 'Experience letter',
  payslip: 'Payslip',
  form130: 'Form 12BB / investment declaration',
  relieving: 'Relieving letter',
  other: 'Other',
};

export default async function MyDocumentsPage() {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/documents">
        <PageHead title="My Documents" sub="What your employer holds, and what you can see" />
        <EmptyState
          icon="file"
          title="This sign-in is not linked to an employee record"
          body="Documents belong to an employee file. This login administers the organisation instead."
        />
      </CustomerShell>
    );
  }

  /* documents_select gives an employee their own documents only where
     visibility = 'employee'. Anything HR marked hr_only simply does not come
     back — the filter is the database's, not this query's. */
  const { data } = await supabase
    .from('employee_documents')
    .select('id,doc_type,title,mime_type,size_bytes,expires_on,verified_at,created_at')
    .eq('employee_id', me)
    .order('created_at', { ascending: false });

  const docs = (data ?? []) as any[];
  const today = new Date().toISOString().slice(0, 10);
  const expiring = docs.filter((d) => d.expires_on && d.expires_on <= today);

  return (
    <CustomerShell current="/me/documents">
      <PageHead title="My Documents" sub="What your employer holds, and what you can see" />
      <EssBanner />

      {expiring.length ? (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[13px] leading-relaxed text-amber-text">
          <span>
            <b>
              {expiring.length} document{expiring.length > 1 ? 's have' : ' has'} expired.
            </b>{' '}
            Send HR a current copy so your file stays complete.
          </span>
        </div>
      ) : null}

      {docs.length === 0 ? (
        <EmptyState
          icon="file"
          title="Nothing shared with you"
          body="Your offer letter, appointment letter and certificates appear here once HR adds them and marks them visible to you. Documents marked HR-only never appear, by design."
        />
      ) : (
        <div className="card">
          <div className="flex flex-col divide-y divide-slate-line2">
            {docs.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] font-semibold text-ink">
                    {d.title ?? DOC_LABEL[d.doc_type] ?? d.doc_type}
                  </b>
                  <span className="block text-[11px] text-slate-muted">
                    {DOC_LABEL[d.doc_type] ?? d.doc_type} · added {dateLabel(d.created_at)}
                    {d.size_bytes ? ` · ${Math.round(Number(d.size_bytes) / 1024)} KB` : ''}
                  </span>
                </div>
                {d.verified_at ? (
                  <span className="badge bg-leaf-soft text-leaf-text">verified</span>
                ) : (
                  <span className="badge">not verified</span>
                )}
                {d.expires_on ? (
                  <span className={`badge ${d.expires_on <= today ? 'bg-red-50 text-red-700' : ''}`}>
                    expires {dateLabel(d.expires_on)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        Uploading from this page arrives with the document module, which brings secure file storage
        and expiry reminders with it. Until then, send documents to your HR team and they will add
        them to your file.
      </p>
    </CustomerShell>
  );
}
