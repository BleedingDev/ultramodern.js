
    export type RemoteKeys = 'remote2/App' | 'remote2/Panel';
    type PackageType<T> = T extends 'remote2/Panel' ? typeof import('remote2/Panel') :T extends 'remote2/App' ? typeof import('remote2/App') :any;