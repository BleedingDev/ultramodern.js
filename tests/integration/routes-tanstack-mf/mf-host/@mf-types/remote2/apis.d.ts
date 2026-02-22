
    export type RemoteKeys = 'remote2/Panel';
    type PackageType<T> = T extends 'remote2/Panel' ? typeof import('remote2/Panel') :any;