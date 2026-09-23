declare module 'react' {
  export type Key = string | number;
  export interface ReactElement { type: any; props: any; key: Key | null }
  export type ReactNode = ReactElement | string | number | bigint | boolean | null | undefined | Iterable<ReactNode>;
  export type FC<P = {}> = (props: P) => ReactElement | null;
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T;
  export function useCallback<T extends (...a: any[]) => any>(cb: T, deps: readonly any[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useRef<T = undefined>(): { current: T | undefined };
  export function useTransition(): [boolean, (cb: () => void) => void];
  export function useId(): string;
  export const Fragment: any;
  export function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  export interface CSSProperties { [k: string]: any }
  export interface FormEvent<T = any> { preventDefault(): void; currentTarget: T; target: any }
  export interface ChangeEvent<T = any> { preventDefault(): void; currentTarget: T; target: T & { value: string; checked: boolean; files: any } }
  export interface MouseEvent<T = any> { preventDefault(): void; stopPropagation(): void; currentTarget: T; target: any }
  export interface KeyboardEvent<T = any> { key: string; preventDefault(): void; currentTarget: T; target: any }
  const React: any; export default React;
}
declare namespace JSX {
  interface Element extends globalThis.ReactElementShim {}
  interface IntrinsicElements { [name: string]: any }
  interface ElementChildrenAttribute { children: {} }
}
interface ReactElementShim { type: any; props: any; key: any }
declare module 'react-dom' { const d: any; export default d; }
