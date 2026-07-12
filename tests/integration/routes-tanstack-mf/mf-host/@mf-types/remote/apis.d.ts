
    export type RemoteKeys = 'remote/App' | 'remote/Widget' | 'remote/Mutator';
    type PackageType<T> = T extends 'remote/Mutator' ? typeof import('remote/Mutator') :T extends 'remote/Widget' ? typeof import('remote/Widget') :T extends 'remote/App' ? typeof import('remote/App') :any;