declare var process: { env: Record<string, string | undefined>; cwd(): string; exit(c?: number): never };
declare module 'next/image' {
  const Image: (p: { src: any; alt: string; width?: number; height?: number; className?: string;
    priority?: boolean; style?: any; sizes?: string; fill?: boolean; quality?: number; unoptimized?: boolean;
    [k: string]: any }) => any;
  export default Image;
}
declare module 'tailwindcss' { export interface Config { [k: string]: any } export type { Config as default } }
declare module 'tailwindcss/colors' { const c: any; export default c }
