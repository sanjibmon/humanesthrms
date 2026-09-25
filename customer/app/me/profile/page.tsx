import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState, Avatar } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

const GENDER: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' };

export default async function MyProfilePage() {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/profile">
        <PageHead title="My Profile" sub="Your personal, contact and statutory details" />
        <EmptyState
          icon="user"
          title="This sign-in is not linked to an employee record"
          body="You can administer the organisation, but there is no personal record behind this account. HR links a login to an employee on the employee's own page."
        />
      </CustomerShell>
    );
  }

  /* Three tables, three different policies. personal_select lets an employee
     read their own row; statutory_select adds an AAL2 requirement on top, so a
     session that has not completed the authenticator step sees nothing here
     rather than a masked value — which is the correct outcome, not a bug. */
  const [{ data: emp }, { data: personal }, { data: statutory }, { data: docs }] = await Promise.all([
    supabase
      .from('employees')
      .select('employee_code,full_name,work_email,work_phone,doj,status,employment_type,department_id,designation_id,location_id,reporting_manager_id')
      .eq('id', me)
      .maybeSingle(),
    supabase
      .from('employee_personal')
      .select('dob,gender,marital_status,blood_group,personal_email,personal_phone,nationality,current_address,permanent_address,emergency_contacts')
      .eq('employee_id', me)
      .maybeSingle(),
    supabase
      .from('employee_statutory')
      .select('pan_last4,bank_last4,bank_name,ifsc,uan,esi_ip_number,aadhaar_last4,tax_regime,pf_applicable,esi_applicable,pt_applicable')
      .eq('employee_id', me)
      .maybeSingle(),
    supabase
      .from('employee_documents')
      .select('id,doc_type,title,expires_on,created_at')
      .eq('employee_id', me)
      .order('created_at', { ascending: false }),
  ]);

  const e = emp as any;
  const p = personal as any;
  const s = statutory as any;

  const lookups = e
    ? await Promise.all([
        e.department_id
          ? supabase.from('departments').select('name').eq('id', e.department_id).maybeSingle()
          : Promise.resolve({ data: null }),
        e.designation_id
          ? supabase.from('designations').select('name').eq('id', e.designation_id).maybeSingle()
          : Promise.resolve({ data: null }),
        e.location_id
          ? supabase.from('locations').select('name,state_code').eq('id', e.location_id).maybeSingle()
          : Promise.resolve({ data: null }),
        e.reporting_manager_id
          ? supabase.from('employees').select('full_name').eq('id', e.reporting_manager_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
    : [];

  const dept = (lookups[0]?.data as any)?.name ?? null;
  const desig = (lookups[1]?.data as any)?.name ?? null;
  const loc = lookups[2]?.data as any;
  const mgr = (lookups[3]?.data as any)?.full_name ?? null;

  const addr = (a: Record<string, string> | null | undefined) =>
    a && a.line1 ? [a.line1, a.line2, a.city, a.state, a.pin].filter(Boolean).join(', ') : null;
  const emg = p?.emergency_contacts?.[0];

  return (
    <CustomerShell current="/me/profile">
      <PageHead title="My Profile" sub="Your personal, contact and statutory details" />
      <EssBanner />

      <div className="card mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={e?.full_name} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink">{e?.full_name ?? '—'}</h2>
            <p className="mt-0.5 text-[13px] text-slate-muted">
              {e?.employee_code}
              {desig ? ` · ${desig}` : ''}
              {dept ? ` · ${dept}` : ''}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <span className="badge">{e?.status?.replace(/_/g, ' ')}</span>
              <span className="badge">{e?.employment_type?.replace(/_/g, ' ')}</span>
              {e?.doj ? <span className="badge">Joined {dateLabel(e.doj)}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Employment"
          rows={[
            ['Work email', e?.work_email],
            ['Work phone', e?.work_phone],
            ['Department', dept],
            ['Designation', desig],
            ['Location', loc ? `${loc.name} · ${loc.state_code}` : null],
            ['Reporting manager', mgr],
          ]}
        />

        <Section
          title="Personal"
          rows={[
            ['Date of birth', p?.dob ? dateLabel(p.dob) : null],
            ['Gender', p?.gender ? (GENDER[p.gender] ?? p.gender) : null],
            ['Marital status', p?.marital_status],
            ['Blood group', p?.blood_group],
            ['Personal email', p?.personal_email],
            ['Personal phone', p?.personal_phone],
            ['Nationality', p?.nationality],
            ['Current address', addr(p?.current_address)],
            ['Permanent address', addr(p?.permanent_address)],
            [
              'Emergency contact',
              emg?.name
                ? `${emg.name}${emg.relationship ? ` (${emg.relationship})` : ''}${emg.phone ? ` · ${emg.phone}` : ''}`
                : null,
            ],
          ]}
        />

        <Section
          title="Statutory and bank"
          note="Shown masked. Only the last few digits are readable, here and to payroll."
          rows={
            s
              ? [
                  ['PAN', s.pan_last4 ? `••••••${s.pan_last4}` : null],
                  ['Aadhaar', s.aadhaar_last4 ? `•••• •••• ${s.aadhaar_last4}` : null],
                  ['UAN', s.uan],
                  ['ESI IP number', s.esi_ip_number],
                  ['Bank account', s.bank_last4 ? `••••${s.bank_last4}` : null],
                  ['Bank', s.bank_name],
                  ['IFSC', s.ifsc],
                  ['Tax regime', s.tax_regime === 'old' ? 'Old regime' : 'New regime'],
                  [
                    'Deductions',
                    [s.pf_applicable ? 'PF' : null, s.esi_applicable ? 'ESI' : null, s.pt_applicable ? 'PT' : null]
                      .filter(Boolean)
                      .join(' · ') || 'None',
                  ],
                ]
              : [['Statutory details', null]]
          }
        />

        <div className="card">
          <h3 className="mb-1 text-sm">My documents</h3>
          <p className="mb-3 text-xs text-slate-muted">
            Only documents HR marked visible to you appear here.
          </p>
          {((docs ?? []) as any[]).length === 0 ? (
            <p className="text-[13px] text-slate-muted">Nothing shared with you yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {((docs ?? []) as any[]).map((d) => (
                <div key={d.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold text-ink">
                      {d.title ?? d.doc_type}
                    </b>
                    <span className="text-[11px] text-slate-muted">
                      {d.doc_type.replace(/_/g, ' ')} · added {dateLabel(d.created_at)}
                      {d.expires_on ? ` · expires ${dateLabel(d.expires_on)}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        Your own record is read-only here on purpose: a change to a name, a bank account or an
        address has payroll and statutory consequences, so it goes through HR rather than
        straight into the database. Ask your HR team to make the change, or raise a helpdesk ticket.
      </p>
    </CustomerShell>
  );
}

function Section({
  title,
  rows,
  note,
}: {
  title: string;
  rows: [string, React.ReactNode][];
  note?: string;
}) {
  return (
    <div className="card">
      <h3 className="text-sm">{title}</h3>
      {note ? <p className="mt-0.5 text-xs text-slate-muted">{note}</p> : null}
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="lbl">{label}</dt>
            <dd className="mt-0.5 text-[13px] text-ink">
              {value ? value : <span className="text-slate-faint">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
