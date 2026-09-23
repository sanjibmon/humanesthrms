declare module 'next/link' {
  import { ReactNode } from 'react';
  const Link: (p: { href: string; className?: string; children?: ReactNode; prefetch?: boolean;
    target?: string; rel?: string; scroll?: boolean; replace?: boolean; title?: string;
    'aria-current'?: any; [k: string]: any }) => any;
  export default Link;
}
declare module 'next/navigation' {
  export function useRouter(): { push(h: string): void; replace(h: string): void; refresh(): void; back(): void };
  export function usePathname(): string;
  export function useSearchParams(): { get(k: string): string | null; toString(): string };
  export function redirect(url: string): never;
  export function notFound(): never;
}
declare module 'next/headers' {
  export function cookies(): {
    get(name: string): { name: string; value: string } | undefined;
    getAll(): { name: string; value: string }[];
    set(name: string, value: string, options?: any): void;
    set(opts: { name: string; value: string; [k: string]: any }): void;
    delete(name: string): void;
  };
  export function headers(): { get(name: string): string | null };
}
declare module 'next/cache' {
  export function revalidatePath(path: string, type?: 'page' | 'layout'): void;
  export function revalidateTag(tag: string): void;
}
declare module 'next/server' {
  export interface NextURL extends URL { clone(): NextURL; basePath: string }
  export class NextResponse {
    static next(init?: { request?: { headers: any } }): NextResponse;
    static redirect(url: URL | string, init?: number | any): NextResponse;
    static json(body: any, init?: any): NextResponse;
    cookies: { set(name: string, value: string, options?: any): void;
               set(o: { name: string; value: string; [k: string]: any }): void;
               get(name: string): { name: string; value: string } | undefined;
               getAll(): { name: string; value: string }[];
               delete(name: string): void };
    headers: { set(k: string, v: string): void; get(k: string): string | null };
  }
  export interface NextRequest {
    nextUrl: NextURL;
    url: string;
    method: string;
    cookies: { get(name: string): { name: string; value: string } | undefined;
               getAll(): { name: string; value: string }[];
               set(name: string, value: string, options?: any): void };
    headers: { get(k: string): string | null };
    json(): Promise<any>;
    formData(): Promise<FormData>;
  }
}
declare module 'next' { export interface Metadata { title?: any; description?: string; icons?: any; [k: string]: any } }
declare module 'next/font/google' { export function Inter(o: any): { className: string; variable: string }; }
