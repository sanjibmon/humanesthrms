import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi, EmptyState } from '@/components/shell';
import { ModuleConsole, type CatalogModule } from '@/components/platform/module-console';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity, can } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function ModulesPage() {
  const supabase = createClient();
  const me = await getPlatformIdentity();

  const [{ data }, { data: usage }] = await Promise.all([
    supabase.from('modules').select('*').order('sort_order'),
    supabase.from('organization_modules').select('module_code').eq('enabled', true),
  ]);

  const counts = new Map<string, number>();
  for (const row of (usage ?? []) as { module_code: string }[]) {
    counts.set(row.module_code, (counts.get(row.module_code) ?? 0) + 1);
  }

  const modules: CatalogModule[] = ((data ?? []) as Omit<CatalogModule, 'in_use'>[]).map((m) => ({
    ...m,
    depends_on: m.depends_on ?? [],
    in_use: counts.get(m.code) ?? 0,
  }));

  return (
    <AdminShell current="/modules">
      <PageHead title="Module Catalog" sub="Every sellable module — edit the catalog, put modules on plans, enable per customer" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Modules" value={modules.length} foot="In the catalog" icon="puzzle" accent="brand" />
        <Kpi label="Enabled by Default" value={modules.filter((m) => m.default_enabled).length} foot="On new customers" icon="checkcircle" accent="leaf" />
        <Kpi label="Beta" value={modules.filter((m) => m.is_beta).length} foot="Shipped with a warning" icon="alert" accent="amber" />
        <Kpi label="Mandatory" value={modules.filter((m) => m.is_core).length} foot="Cannot be disabled" icon="lock" accent="slate" />
      </div>

      {modules.length ? (
        <ModuleConsole modules={modules} canWrite={can(me, 'edit_modules')} />
      ) : (
        <div className="card">
          <EmptyState
            icon="puzzle"
            title="No modules visible"
            body="The catalog is readable by any signed-in user, so an empty list usually means the session has not finished the authenticator step."
          />
        </div>
      )}
    </AdminShell>
  );
}
