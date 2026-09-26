import Link from 'next/link';
import { BrandBar, UrlBadge, Rupee } from '@/components/brand';
import { SignOutButton } from '@/components/auth-forms';
import { Icon, type IconName } from '@/components/icon';
import { initial } from '@/lib/format';

export type MenuItem = {
  href: string;
  label: string;
  icon?: IconName;
  /** Payroll renders the Indian Rupee glyph instead of an icon. */
  rupee?: boolean;
  count?: number;
  /**
   * The catalog module this item belongs to. Omitted means always available —
   * the dashboard and settings are not sold separately. Anything else is hidden
   * unless the organisation's licence includes it.
   */
  module?: string;
};

export function Shell({
  host,
  brandSub,
  roleLabel,
  userName,
  userMeta,
  menu,
  current,
  upsell,
  aside,
  children,
}: {
  host: string;
  brandSub: string;
  roleLabel: string;
  userName: string;
  userMeta?: string;
  menu: MenuItem[];
  current: string;
  upsell?: { title: string; body: string; cta: string };
  /** Rendered in the header, between the URL badge and the account block. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-slate-line bg-white px-5">
        <BrandBar sub={brandSub} />
        <span className="hidden h-7 w-px bg-slate-line lg:block" />
        <span className="hidden lg:block">
          <UrlBadge host={host} />
        </span>
        <div className="flex-1" />
        {aside ? <div className="mr-1">{aside}</div> : null}
        <div className="flex items-center gap-2.5">
          <span className="hidden text-right sm:block">
            <b className="block text-[13px] font-semibold leading-tight text-ink">{userName}</b>
            {userMeta ? (
              <span className="block text-[11px] leading-tight text-slate-muted">{userMeta}</span>
            ) : null}
          </span>
          <span className="badge bg-brand-soft text-brand-dark">{roleLabel}</span>
          <span className="badge bg-green-50 text-green-700">MFA</span>
          <SignOutButton />
        </div>
      </header>

      <div className="grid items-start lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Main"
             className="flex gap-1 overflow-x-auto border-b border-slate-line bg-white p-2.5
                        lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:flex-col lg:overflow-y-auto
                        lg:border-b-0 lg:border-r lg:p-3">
          {menu.map((m) => {
            const active = current === m.href;
            return (
              <Link key={m.href} href={m.href} aria-current={active ? 'page' : undefined}
                    className="nav-item w-auto whitespace-nowrap lg:w-full">
                {m.rupee ? <Rupee /> : m.icon ? <Icon name={m.icon} /> : null}
                <span>{m.label}</span>
                {m.count ? (
                  <span className="ml-auto rounded-full bg-red-600 px-[7px] text-[11px] font-bold text-white">
                    {m.count}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {upsell ? (
            <div className="mt-auto hidden flex-col gap-2 rounded-xl bg-brand-deep p-4 text-white lg:flex">
              <b className="text-[13px]">{upsell.title}</b>
              <p className="text-[11px] leading-snug opacity-85">{upsell.body}</p>
              <button className="btn h-[34px] border-white bg-white text-xs text-brand-dark">
                {upsell.cta}
              </button>
            </div>
          ) : null}
        </nav>

        <main className="min-w-0 px-4 pb-16 pt-6 sm:px-7">{children}</main>
      </div>
    </>
  );
}

export function PageHead({ title, sub, action }: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3.5">
      <div className="min-w-[200px] flex-1">
        <h1 className="text-[22px]">{title}</h1>
        {sub ? <p className="mt-0.5 text-sm text-slate-muted">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

const ACCENTS = {
  brand: 'border-t-[3px] border-t-brand',
  amber: 'border-t-[3px] border-t-amber-brand',
  slate: 'border-t-[3px] border-t-slate-faint',
  leaf: 'border-t-[3px] border-t-leaf',
} as const;

export function Kpi({ label, value, foot, icon, rupee, accent = 'brand' }: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  icon?: IconName;
  rupee?: boolean;
  accent?: keyof typeof ACCENTS;
}) {
  return (
    <div className={`card card-hover ${ACCENTS[accent]}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="lbl">{label}</div>
          <div className="mt-1.5 text-[28px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">
            {value}
          </div>
          {foot ? <div className="mt-1.5 text-xs text-slate-muted">{foot}</div> : null}
        </div>
        {rupee ? (
          <Rupee large />
        ) : icon ? (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Icon name={icon} size={20} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: {
  icon: IconName;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="mb-1.5 text-slate-faint">
        <Icon name={icon} size={48} />
      </span>
      <h4 className="text-sm">{title}</h4>
      <p className="max-w-sm text-xs text-slate-muted">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Avatar({ name, slate = false }: { name?: string | null; slate?: boolean }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${
      slate ? 'bg-slate-muted' : 'bg-brand-grad'
    }`}>
      {initial(name)}
    </span>
  );
}
