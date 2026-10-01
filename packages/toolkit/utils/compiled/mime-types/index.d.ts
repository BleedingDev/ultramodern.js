declare function lookup(filenameOrExt: string): string | false;

declare function contentType(filenameOrExt: string): string | false;

declare function extension(typeString: string): string | false;

declare function charset(typeString: string): string | false;

declare namespace charsets {
    const lookup: typeof charset;
}

declare const types: { [key: string]: string };

declare const extensions: { [key: string]: string[] };

export { charset, charsets, contentType, extension, extensions, lookup, types };
