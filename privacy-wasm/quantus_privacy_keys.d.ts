/* tslint:disable */
/* eslint-disable */

export function privacyAddressId(mnemonic: string, branch: number, index: number): string;

/**
 * Computes a spend identifier without exporting the underlying spend secret.
 */
export function privacyNullifier(mnemonic: string, branch: number, index: number, count: string): string;

export function provePrivacyBatch(mnemonic: string, json: string): Uint8Array;

/**
 * Check exact leaf bytes and the official four-ary Poseidon path against a pinned root.
 */
export function verifyPrivacyMerkle(leaf: Uint8Array, siblings: Uint8Array, root: Uint8Array): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly privacyAddressId: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly privacyNullifier: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly provePrivacyBatch: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly verifyPrivacyMerkle: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly _critical_section_1_0_acquire: () => number;
    readonly _critical_section_1_0_release: (a: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
