declare module 'server-only' {}
declare module 'client-only' {}
declare module 'resend' {
  export class Resend {
    constructor(apiKey: string);
    emails: { send(p: { from: string; to: string | string[]; subject: string; html?: string; text?: string; reply_to?: string }): Promise<{ data: { id: string } | null; error: { message: string } | null }> };
  }
}
