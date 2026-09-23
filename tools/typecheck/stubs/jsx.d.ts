declare module 'react/jsx-runtime' {
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
}
declare module 'react/jsx-dev-runtime' {
  export const Fragment: any;
  export function jsxDEV(type: any, props: any, key?: any, isStatic?: boolean, source?: any, self?: any): any;
}
declare module '*.css';
declare module '*.svg' { const v: any; export default v }
declare module '*.webp' { const v: any; export default v }
declare module '*.png' { const v: any; export default v }

/* Next 14 server components are async, so a component may return a Promise.
   TS 5.1's JSX.ElementType is what decides "can this be a JSX tag". */
declare namespace JSX {
  type ElementType = any;
  interface Element { type: any; props: any; key: any }
  interface ElementAttributesProperty { props: {} }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicElements { [name: string]: any }
  interface IntrinsicAttributes { key?: string | number | null }
}
declare namespace React {
  type ReactNode = any;
  type ReactElement = any;
  type FC<P = {}> = (props: P) => any;
  type CSSProperties = Record<string, any>;
  type FormEvent<T = any> = { preventDefault(): void; currentTarget: T; target: any };
  type ChangeEvent<T = any> = { preventDefault(): void; currentTarget: T; target: T & { value: string; checked: boolean; files: any } };
  type MouseEvent<T = any> = { preventDefault(): void; stopPropagation(): void; currentTarget: T; target: any };
  type KeyboardEvent<T = any> = { key: string; preventDefault(): void; currentTarget: T; target: any };
  type Dispatch<A> = (v: A) => void;
  type SetStateAction<S> = S | ((p: S) => S);
  type RefObject<T> = { current: T | null };
}
