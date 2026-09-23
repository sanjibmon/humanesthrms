declare module '@supabase/supabase-js' {
  export interface PostgrestResult<T = any> { data: T; error: { message: string; code?: string; details?: string } | null; count: number | null; status: number }
  export interface Filter<T = any> extends PromiseLike<PostgrestResult<T>> {
    eq(col: string, val: any): Filter<T>; neq(col: string, val: any): Filter<T>;
    gt(col: string, val: any): Filter<T>; gte(col: string, val: any): Filter<T>;
    lt(col: string, val: any): Filter<T>; lte(col: string, val: any): Filter<T>;
    like(col: string, pat: string): Filter<T>; ilike(col: string, pat: string): Filter<T>;
    is(col: string, val: any): Filter<T>; in(col: string, vals: readonly any[]): Filter<T>;
    contains(col: string, val: any): Filter<T>; or(f: string): Filter<T>; not(c: string, op: string, v: any): Filter<T>;
    match(q: Record<string, any>): Filter<T>;
    order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string }): Filter<T>;
    limit(n: number, opts?: { referencedTable?: string }): Filter<T>;
    range(from: number, to: number): Filter<T>;
    select(cols?: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): Filter<T>;
    single(): Filter<T>; maybeSingle(): Filter<T>; csv(): Filter<string>;
    throwOnError(): Filter<T>;
  }
  export interface QueryBuilder<T = any> extends Filter<T> {
    insert(values: any, opts?: { count?: 'exact' }): Filter<T>;
    upsert(values: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean; count?: 'exact' }): Filter<T>;
    update(values: any, opts?: { count?: 'exact' }): Filter<T>;
    delete(opts?: { count?: 'exact' }): Filter<T>;
  }
  export interface AuthUser { id: string; email?: string; phone?: string; created_at: string; user_metadata: Record<string, any>; app_metadata: Record<string, any>; factors?: { id: string; status: string; factor_type: string; friendly_name?: string }[] }
  export interface AuthError { message: string; status?: number; code?: string }
  export interface SupabaseClient {
    from(table: string): QueryBuilder;
    rpc(fn: string, args?: Record<string, any>, opts?: { count?: 'exact' }): Filter;
    schema(name: string): { from(table: string): QueryBuilder; rpc(fn: string, args?: Record<string, any>): Filter };
    auth: {
      getUser(jwt?: string): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }>;
      getSession(): Promise<{ data: { session: any | null }; error: AuthError | null }>;
      signInWithPassword(c: { email: string; password: string }): Promise<{ data: { user: AuthUser | null; session: any }; error: AuthError | null }>;
      signInWithOtp(c: { email: string; options?: any }): Promise<{ data: any; error: AuthError | null }>;
      verifyOtp(c: { email?: string; token?: string; token_hash?: string; type: string }): Promise<{ data: any; error: AuthError | null }>;
      exchangeCodeForSession(code: string): Promise<{ data: any; error: AuthError | null }>;
      resetPasswordForEmail(email: string, opts?: { redirectTo?: string }): Promise<{ data: any; error: AuthError | null }>;
      updateUser(a: { email?: string; password?: string; data?: Record<string, any> }): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }>;
      signOut(): Promise<{ error: AuthError | null }>;
      mfa: {
        enroll(p: { factorType: 'totp'; friendlyName?: string; issuer?: string }): Promise<{ data: { id: string; type: string; totp: { qr_code: string; secret: string; uri: string } } | null; error: AuthError | null }>;
        challenge(p: { factorId: string }): Promise<{ data: { id: string } | null; error: AuthError | null }>;
        verify(p: { factorId: string; challengeId: string; code: string }): Promise<{ data: any; error: AuthError | null }>;
        challengeAndVerify(p: { factorId: string; code: string }): Promise<{ data: any; error: AuthError | null }>;
        unenroll(p: { factorId: string }): Promise<{ data: any; error: AuthError | null }>;
        listFactors(): Promise<{ data: { totp: { id: string; status: string; friendly_name?: string }[]; all: any[] } | null; error: AuthError | null }>;
        getAuthenticatorAssuranceLevel(): Promise<{ data: { currentLevel: string | null; nextLevel: string | null; currentAuthenticationMethods: any[] } | null; error: AuthError | null }>;
      };
      admin: {
        createUser(a: { email: string; password?: string; email_confirm?: boolean; user_metadata?: Record<string, any> }): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }>;
        inviteUserByEmail(email: string, opts?: { redirectTo?: string; data?: Record<string, any> }): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }>;
        generateLink(p: { type: string; email: string; password?: string; options?: any }): Promise<{ data: any; error: AuthError | null }>;
        deleteUser(id: string, soft?: boolean): Promise<{ data: any; error: AuthError | null }>;
        listUsers(p?: { page?: number; perPage?: number }): Promise<{ data: { users: AuthUser[] }; error: AuthError | null }>;
        updateUserById(id: string, a: Record<string, any>): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }>;
      };
      onAuthStateChange(cb: (event: string, session: any) => void): { data: { subscription: { unsubscribe(): void } } };
    };
    storage: { from(bucket: string): { upload(path: string, file: any, opts?: any): Promise<{ data: any; error: AuthError | null }>;
      download(path: string): Promise<{ data: any; error: AuthError | null }>;
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: AuthError | null }>;
      remove(paths: string[]): Promise<{ data: any; error: AuthError | null }> } };
  }
  export function createClient(url: string, key: string, opts?: any): SupabaseClient;
}
declare module '@supabase/ssr' {
  import { SupabaseClient } from '@supabase/supabase-js';
  export function createBrowserClient(url: string, key: string, opts?: any): SupabaseClient;
  export function createServerClient(url: string, key: string, opts: {
    cookies: { get?(name: string): string | undefined; set?(name: string, value: string, options?: any): void;
      remove?(name: string, options?: any): void; getAll?(): { name: string; value: string }[];
      setAll?(c: { name: string; value: string; options?: any }[]): void };
  }): SupabaseClient;
  export type CookieOptions = Record<string, any>;
}
