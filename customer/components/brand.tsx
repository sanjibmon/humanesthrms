import Image from 'next/image';

/* The logo and the tagline are fixed brand assets taken from the live site.
   They are used as supplied and must not be redrawn or reworded. */

export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-2.5 text-center ${className}`}>
      <Image src="/humanest-mark.webp" alt="" width={64} height={66} priority />
      <Image
        src="/humanest-wordmark.webp"
        alt="HumaNest — Your People. Your Process."
        width={172}
        height={44}
        priority
      />
    </div>
  );
}

export function BrandBar({ sub }: { sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Image src="/humanest-mark.webp" alt="" width={32} height={33} priority />
      <div>
        {/* The wordmark is clipped to its top band so the baked-in tagline
            does not render at an illegible size in the 64px top bar. */}
        <span className="block h-[19px] overflow-hidden">
          <Image
            src="/humanest-wordmark.webp"
            alt="HumaNest"
            width={120}
            height={31}
            className="block h-[31px] w-auto max-w-none"
            priority
          />
        </span>
        {sub ? (
          <span className="mt-0.5 block whitespace-nowrap text-[10px] font-semibold tracking-wide text-slate-muted">
            {sub}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function UrlBadge({ host }: { host: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-line2 px-3 text-xs text-slate-muted">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.2"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      https://{host}
    </span>
  );
}

/** Payroll's module glyph is the Indian Rupee sign, deliberately not an icon. */
export function Rupee({ large = false }: { large?: boolean }) {
  return <span className={`rupee${large ? ' rupee-lg' : ''}`} aria-hidden>&#8377;</span>;
}
