export declare function isModuleNotFoundError(err: unknown): boolean;
export declare function invariant(condition: unknown, message?: string): asserts condition;
export declare function str2u8(str: string): Uint8Array;
export declare function str2buf(str: string): ArrayBufferLike;
export declare function anyBuf(buf: string | Buffer | ArrayBufferLike): ArrayBufferLike;
export declare function scopedBuf(buf: string | Buffer | ArrayBufferLike): ArrayBuffer | undefined;
