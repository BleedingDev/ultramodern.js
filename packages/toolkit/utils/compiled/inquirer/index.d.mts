import { Duplex } from 'node:stream';

/**
 * `InquirerReadline` is a re-implementation of `readline.Interface` from Node.js.
 * We're reimplementing it because of 3 reasons:
 * 1. The `readline.Interface` API is not complete; it's missing for example `clearLine`.
 * 2. The input/output streams are not generics, meaning they're inexact.
 * 3. Since ReadLine isn't built-in Typescript Global NodeJS type, it'd force us to ship `@types/node` as a dependency to all users.
 */
type InquirerReadline = {
    output: Duplex & {
        mute: () => void;
        unmute: () => void;
    };
    input: NodeJS.ReadableStream;
    clearLine: (dir: 0 | 1 | -1) => void;
    getCursorPos: () => {
        rows: number;
        cols: number;
    };
    setPrompt: (prompt: string) => void;
    line: string;
    write: (data: string) => void;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
    pause: () => void;
    resume: () => void;
    close: () => void;
};
type Context = {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    clearPromptOnDone?: boolean;
    signal?: AbortSignal;
};
type Prompt<Value, Config> = (config: Config, context?: Context) => Promise<Value>;

/**
 * Recursively expand intersections and mapped types for better IDE display,
 * while preserving functions, arrays, primitives, and types with a string
 * index signature (e.g. `Record<string, ...>`) as-is.
 */
type Prettify<T> = T extends (...args: never[]) => unknown ? T : T extends ReadonlyArray<unknown> ? T : T extends string | number | boolean | symbol | bigint | null | undefined ? T : T extends object ? string extends keyof T ? T : {
    [K in keyof T]: Prettify<T[K]>;
} & {} : T;
type PartialDeep<T> = T extends object ? {
    [P in keyof T]?: PartialDeep<T[P]>;
} : T;
type DistributiveMerge<A, B> = A extends any ? Prettify<Omit<A, keyof B> & B> : never;

type Keybinding = 'emacs' | 'vim';

/**
 * Union type representing the possible statuses of a prompt.
 *
 * -   `'loading'`: The prompt is currently loading.
 * -   `'idle'`: The prompt is loaded and currently waiting for the user to
 *     submit an answer.
 * -   `'done'`: The user has submitted an answer and the prompt is finished.
 * -   `string`: Any other string: The prompt is in a custom state.
 */
type Status = 'loading' | 'idle' | 'done' | (string & {});
type DefaultTheme = {
    /**
     * Prefix to prepend to the message. If a function is provided, it will be
     * called with the current status of the prompt, and the return value will be
     * used as the prefix.
     *
     * @remarks
     * If `status === 'loading'`, this property is ignored and the spinner (styled
     * by the `spinner` property) will be displayed instead.
     *
     * @defaultValue
     * ```ts
     * // import { styleText } from 'node:util';
     * (status) => status === 'done' ? styleText('green', '✔') : styleText('blue', '?')
     * ```
     */
    prefix: string | Prettify<Omit<Record<Status, string>, 'loading'>>;
    /**
     * Configuration for the spinner that is displayed when the prompt is in the
     * `'loading'` state.
     *
     * We recommend the use of {@link https://github.com/sindresorhus/cli-spinners|cli-spinners} for a list of available spinners.
     */
    spinner: {
        /**
         * The time interval between frames, in milliseconds.
         *
         * @defaultValue
         * ```ts
         * 80
         * ```
         */
        interval: number;
        /**
         * A list of frames to show for the spinner.
         *
         * @defaultValue
         * ```ts
         * ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
         * ```
         */
        frames: string[];
    };
    /**
     * Alternative keybindings enabled for prompt navigation.
     *
     * @defaultValue
     * ```ts
     * process.env['INQUIRER_KEYBINDINGS']
     * ```
     */
    keybindings: ReadonlyArray<Keybinding>;
    /**
     * Object containing functions to style different parts of the prompt.
     */
    style: {
        /**
         * Style to apply to the user's answer once it has been submitted.
         *
         * @param text - The user's answer.
         * @returns The styled answer.
         *
         * @defaultValue
         * ```ts
         * // import { styleText } from 'node:util';
         * (text) => styleText('cyan', text)
         * ```
         */
        answer: (text: string) => string;
        /**
         * Style to apply to the message displayed to the user.
         *
         * @param text - The message to style.
         * @param status - The current status of the prompt.
         * @returns The styled message.
         *
         * @defaultValue
         * ```ts
         * // import { styleText } from 'node:util';
         * (text, status) => styleText('bold', text)
         * ```
         */
        message: (text: string, status: Status) => string;
        /**
         * Style to apply to error messages.
         *
         * @param text - The error message.
         * @returns The styled error message.
         *
         * @defaultValue
         * ```ts
         * // import { styleText } from 'node:util';
         * (text) => styleText('red', `> ${text}`)
         * ```
         */
        error: (text: string) => string;
        /**
         * Style to apply to the default answer when one is provided.
         *
         * @param text - The default answer.
         * @returns The styled default answer.
         *
         * @defaultValue
         * ```ts
         * // import { styleText } from 'node:util';
         * (text) => styleText('dim', `(${text})`)
         * ```
         */
        defaultAnswer: (text: string) => string;
        /**
         * Style to apply to help text.
         *
         * @param text - The help text.
         * @returns The styled help text.
         *
         * @defaultValue
         * ```ts
         * // import { styleText } from 'node:util';
         * (text) => styleText('dim', text)
         * ```
         */
        help: (text: string) => string;
        /**
         * Style to apply to highlighted text.
         *
         * @param text - The text to highlight.
         * @returns The highlighted text.
         *
         * @defaultValue
         * ```ts
         * // import { styleText } from 'node:util';
         * (text) => styleText('cyan', text)
         * ```
         */
        highlight: (text: string) => string;
        /**
         * Style to apply to keyboard keys referred to in help texts.
         *
         * @param text - The key to style.
         * @returns The styled key.
         *
         * @defaultValue
         * ```ts
         * // import { styleText } from 'node:util';
         * (text) => styleText('cyan', styleText('bold', `<${text}>`))
         * ```
         */
        key: (text: string) => string;
    };
};
type Theme<Extension extends object = object> = Extension & DefaultTheme;

/**
 * Separator object
 * Used to space/separate choices group
 */
declare class Separator {
    readonly separator: string;
    readonly type: string;
    constructor(separator?: string);
    static isSeparator(choice: unknown): choice is Separator;
}

type CheckboxTheme = {
    icon: {
        checked: string;
        unchecked: string;
        cursor: string;
        disabledChecked: string;
        disabledUnchecked: string;
    };
    style: {
        disabled: (text: string) => string;
        renderSelectedChoices: <T>(selectedChoices: ReadonlyArray<NormalizedChoice<T>>, allChoices: ReadonlyArray<NormalizedChoice<T> | Separator>) => string;
        description: (text: string) => string;
        keysHelpTip: (keys: [key: string, action: string][]) => string | undefined;
    };
    i18n: {
        disabledError: string;
    };
};
type CheckboxShortcuts = {
    all?: string | null;
    invert?: string | null;
};
type Choice$4<Value> = {
    value: Value;
    name?: string;
    checkedName?: string;
    description?: string;
    short?: string;
    disabled?: boolean | string;
    checked?: boolean;
    type?: never;
};
type NormalizedChoice<Value> = {
    value: Value;
    name: string;
    checkedName: string;
    description?: string;
    short: string;
    disabled: boolean | string;
    checked: boolean;
};
type CheckboxConfig<Value = string> = {
    message: string;
    prefix?: string;
    pageSize?: number;
    choices: ReadonlyArray<Value | Choice$4<Value> | Separator>;
    loop?: boolean;
    required?: boolean;
    validate?: (choices: readonly NormalizedChoice<Value>[]) => boolean | string | Promise<string | boolean>;
    theme?: PartialDeep<Theme<CheckboxTheme>>;
    shortcuts?: CheckboxShortcuts;
};
declare const _default$8: <const Value>(config: {
    message: string;
    prefix?: string | undefined;
    pageSize?: number | undefined;
    choices: readonly (Separator | Value | Choice$4<Value>)[];
    loop?: boolean | undefined;
    required?: boolean | undefined;
    validate?: ((choices: readonly NormalizedChoice<Value>[]) => boolean | string | Promise<string | boolean>) | undefined;
    theme?: PartialDeep<Theme<CheckboxTheme>> | undefined;
    shortcuts?: CheckboxShortcuts | undefined;
} & CheckboxConfig<Value>, context?: Context) => Promise<Value[]>;

type FileOptions = {
    prefix?: string;
    postfix?: string;
    mode?: number;
    template?: string;
    dir?: string;
};

type EditorTheme = {
    validationFailureMode: 'keep' | 'clear';
    style: {
        loadingMessage: () => string;
        waitingMessage: (enterKey: string) => string;
    };
};
type EditorConfig = {
    message: string;
    default?: string | undefined;
    postfix?: string;
    waitForUserInput?: boolean;
    validate?: (value: string) => boolean | string | Promise<string | boolean>;
    file?: FileOptions;
    theme?: PartialDeep<Theme<EditorTheme>>;
};
declare const _default$7: Prompt<string, {
    message: string;
    default?: string | undefined | undefined;
    postfix?: string | undefined;
    waitForUserInput?: boolean | undefined;
    validate?: ((value: string) => boolean | string | Promise<string | boolean>) | undefined;
    file?: FileOptions | undefined;
    theme?: PartialDeep<Theme<EditorTheme>> | undefined;
} & EditorConfig>;

type ConfirmConfig = {
    message: string;
    default?: boolean | undefined;
    transformer?: (value: boolean) => string;
    theme?: PartialDeep<Theme<ConfirmTheme>>;
};
type ConfirmTheme = {
    /**
     * Words accepted as "yes" and "no" answers. Matching is prefix-based and
     * case-insensitive, and the first character of each word is shown in the
     * hint. These words are also displayed once the prompt is answered.
     */
    keywords: {
        yes: string;
        no: string;
    };
    style: {
        /**
         * Style the character representing the default answer in the hint (e.g.
         * "Y/n"). Uppercases it by default; scripts without case (e.g. Chinese)
         * are highlighted with a color instead.
         */
        confirmDefault: (text: string) => string;
    };
};
declare const _default$6: Prompt<boolean, {
    message: string;
    default?: boolean | undefined | undefined;
    transformer?: ((value: boolean) => string) | undefined;
    theme?: PartialDeep<Theme<ConfirmTheme>> | undefined;
} & ConfirmConfig>;

type InputTheme = {
    validationFailureMode: 'keep' | 'clear';
};
type InputConfig = {
    message: string;
    default?: string | undefined;
    prefill?: 'tab' | 'editable';
    required?: boolean;
    transformer?: (value: string, { isFinal }: {
        isFinal: boolean;
    }) => string;
    validate?: (value: string) => boolean | string | Promise<string | boolean>;
    theme?: PartialDeep<Theme<InputTheme>>;
    pattern?: RegExp;
    patternError?: string;
};
declare const _default$5: Prompt<string, {
    message: string;
    default?: string | undefined | undefined;
    prefill?: "tab" | "editable" | undefined;
    required?: boolean | undefined;
    transformer?: ((value: string, { isFinal }: {
        isFinal: boolean;
    }) => string) | undefined;
    validate?: ((value: string) => boolean | string | Promise<string | boolean>) | undefined;
    theme?: PartialDeep<Theme<InputTheme>> | undefined;
    pattern?: RegExp | undefined;
    patternError?: string | undefined;
} & InputConfig>;

type NumberConfig<Required extends boolean = boolean> = {
    message: string;
    default?: number | undefined;
    min?: number;
    max?: number;
    step?: number | 'any';
    required?: Required;
    validate?: (value: Required extends true ? number : number | undefined) => boolean | string | Promise<string | boolean>;
    theme?: PartialDeep<Theme>;
};
declare const _default$4: <Required extends boolean>(config: {
    message: string;
    default?: number | undefined | undefined;
    min?: number | undefined;
    max?: number | undefined;
    step?: number | "any" | undefined;
    required?: Required | undefined;
    validate?: ((value: Required extends true ? number : number | undefined) => boolean | string | Promise<string | boolean>) | undefined;
    theme?: PartialDeep<Theme> | undefined;
} & NumberConfig<Required>, context?: Context) => Promise<Required extends true ? number : number | undefined>;

type Key = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type Choice$3<Value> = {
    key: Key;
    value: Value;
} | {
    key: Key;
    name: string;
    value: Value;
};
type ExpandConfig<Value = string> = {
    message: string;
    choices: readonly (Separator | {
        key: Key;
        name: Value & string;
        value?: never;
    } | Choice$3<Value>)[];
    default?: Key | 'h';
    expanded?: boolean;
    theme?: PartialDeep<Theme>;
};
declare const expand: <const Value>(config: {
    message: string;
    choices: readonly (Separator | {
        key: Key;
        name: Value & string;
        value?: never;
    } | Choice$3<Value>)[];
    default?: (Key | "h") | undefined;
    expanded?: boolean | undefined;
    theme?: PartialDeep<Theme> | undefined;
} & ExpandConfig<Value>, context?: Context) => Promise<Value>;

type RawlistTheme = {
    style: {
        description: (text: string) => string;
    };
};
type Choice$2<Value> = {
    value: Value;
    name?: string;
    short?: string;
    key?: string;
    description?: string;
};
type RawlistConfig<Value> = {
    message: string;
    choices: ReadonlyArray<Value | Choice$2<Value> | Separator>;
    loop?: boolean;
    theme?: PartialDeep<Theme<RawlistTheme>>;
    default?: NoInfer<Value>;
};
declare const _default$3: <const Value>(config: {
    message: string;
    choices: readonly (Separator | Value | Choice$2<Value>)[];
    loop?: boolean | undefined;
    theme?: PartialDeep<Theme<RawlistTheme>> | undefined;
    default?: NoInfer<Value> | undefined;
} & RawlistConfig<Value>, context?: Context) => Promise<Value>;

type PasswordTheme = {
    style: {
        maskedText: string;
        keysHelpTip: (keys: [key: string, action: string][]) => string | undefined;
    };
};
type PasswordConfig = {
    message: string;
    mask?: boolean | string;
    toggleMask?: boolean;
    validate?: (value: string) => boolean | string | Promise<string | boolean>;
    theme?: PartialDeep<Theme<PasswordTheme>>;
};
declare const _default$2: Prompt<string, {
    message: string;
    mask?: boolean | string | undefined;
    toggleMask?: boolean | undefined;
    validate?: ((value: string) => boolean | string | Promise<string | boolean>) | undefined;
    theme?: PartialDeep<Theme<PasswordTheme>> | undefined;
} & PasswordConfig>;

type SearchTheme = {
    icon: {
        cursor: string;
    };
    style: {
        disabled: (text: string) => string;
        searchTerm: (text: string) => string;
        description: (text: string) => string;
        keysHelpTip: (keys: [key: string, action: string][]) => string | undefined;
    };
};
type Choice$1<Value> = {
    value: Value;
    name?: string;
    description?: string;
    short?: string;
    disabled?: boolean | string;
    type?: never;
};
type SearchConfig<Value = string> = {
    message: string;
    source: (term: string | undefined, opt: {
        signal: AbortSignal;
    }) => ReadonlyArray<Value | Choice$1<Value> | Separator> | Promise<ReadonlyArray<Value | Choice$1<Value> | Separator>>;
    validate?: (value: Value) => boolean | string | Promise<string | boolean>;
    pageSize?: number;
    default?: NoInfer<Value>;
    initialValue?: string;
    theme?: PartialDeep<Theme<SearchTheme>>;
};
declare const _default$1: <const Value>(config: {
    message: string;
    source: (term: string | undefined, opt: {
        signal: AbortSignal;
    }) => readonly (Separator | Value | Choice$1<Value>)[] | Promise<readonly (Separator | Value | Choice$1<Value>)[]>;
    validate?: ((value: Value) => boolean | string | Promise<string | boolean>) | undefined;
    pageSize?: number | undefined;
    default?: NoInfer<Value> | undefined;
    initialValue?: string | undefined;
    theme?: PartialDeep<Theme<SearchTheme>> | undefined;
} & SearchConfig<Value>, context?: Context) => Promise<Value>;

type SelectTheme = {
    icon: {
        cursor: string;
    };
    style: {
        disabled: (text: string) => string;
        description: (text: string) => string;
        keysHelpTip: (keys: [key: string, action: string][]) => string | undefined;
    };
    i18n: {
        disabledError: string;
    };
    indexMode: 'hidden' | 'number';
};
type Choice<Value> = {
    value: Value;
    name?: string;
    description?: string;
    short?: string;
    disabled?: boolean | string;
    type?: never;
};
type SelectConfig<Value> = {
    message: string;
    choices: ReadonlyArray<Value | Choice<Value> | Separator>;
    pageSize?: number;
    loop?: boolean;
    default?: NoInfer<Value>;
    theme?: PartialDeep<Theme<SelectTheme>>;
};
declare const _default: <const Value>(config: {
    message: string;
    choices: readonly (Separator | Value | Choice<Value>)[];
    pageSize?: number | undefined;
    loop?: boolean | undefined;
    default?: NoInfer<Value> | undefined;
    theme?: PartialDeep<Theme<SelectTheme>> | undefined;
} & SelectConfig<Value>, context?: Context) => Promise<Value>;

type NextHandler<T> = (value: T) => void;
type ErrorHandler = (error: unknown) => void;
type CompleteHandler = () => void;
declare global {
    interface SymbolConstructor {
        readonly observable: symbol;
    }
}
type Observer<T> = {
    next?: NextHandler<T>;
    error?: ErrorHandler;
    complete?: CompleteHandler;
};
type SubscriptionLike = {
    closed?: boolean;
    unsubscribe: () => void;
};
type Observable<T> = {
    subscribe: {
        (observer: Observer<T>): SubscriptionLike;
        (next?: NextHandler<T> | null, error?: ErrorHandler | null, complete?: CompleteHandler | null): SubscriptionLike;
    };
};
type InteropObservable<T> = Observable<T> & AsyncIterable<T> & {
    readonly [Symbol.observable]: () => Observable<T>;
    readonly '@@observable': () => Observable<T>;
};

type Answers<Key extends string = string> = Record<Key, any>;
type NoInfer$1<T> = [T][T extends any ? 0 : never];
type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
type EmptyRecord = Record<string, never>;
type DotPathRecord<Path extends string, Value> = Path extends `${infer Head}.${infer Rest}` ? Head extends '' ? EmptyRecord : {
    [K in Head]: DotPathRecord<Rest, Value>;
} : Path extends '' ? EmptyRecord : {
    [K in Path]: Value;
};
type NormalizeAnswers<A extends Answers> = string extends keyof A ? A : Extract<keyof A, string> extends never ? EmptyRecord : Prettify<UnionToIntersection<{
    [Key in Extract<keyof A, string>]: DotPathRecord<Key, [
        A[Key]
    ] extends [never] ? any : A[Key]>;
}[Extract<keyof A, string>]>>;
type Mutable<T> = {
    -readonly [K in keyof T]: T[K];
};
type WidenAnswerLiterals<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T extends bigint ? bigint : T extends symbol ? symbol : T extends ReadonlyArray<infer U> ? ReadonlyArray<WidenAnswerLiterals<U>> : T extends Array<infer U> ? Array<WidenAnswerLiterals<U>> : T extends Record<string, unknown> ? {
    [K in keyof Mutable<T>]: Mutable<T>[K] extends infer V ? V extends undefined ? never : WidenAnswerLiterals<V> : never;
} : T;
type MergeAnswerObjects<Base, Override> = Prettify<Omit<Base, keyof Override> & Override>;
type AsyncGetterFunction<T, A extends Answers> = (this: {
    async: () => (...args: [error: null | undefined, value: T] | [error: Error, value: undefined]) => void;
}, answers: NoInfer$1<Partial<A>>) => void | T | Promise<T>;
type MaybeAsyncValue<T, A extends Answers> = T | AsyncGetterFunction<T, A>;
/**
 * Allows to inject a custom question type into inquirer module.
 *
 * @example
 * ```ts
 * declare module 'inquirer' {
 *   interface QuestionMap {
 *     custom: { message: string };
 *   }
 * }
 * ```
 *
 * Globally defined question types are not correct.
 */
interface QuestionMap {
    __dummy: {
        message: string;
    };
}
type KeyValueOrAsyncGetterFunction<T, k extends string, A extends Answers> = T extends Record<string, any> ? MaybeAsyncValue<T[k], A> : never;
type Question<A extends Answers = Answers, Type extends string = string> = {
    type?: Type;
    name: string;
    message: MaybeAsyncValue<string, A>;
    default?: any;
    choices?: any;
    validate?: (value: any, answers: NoInfer$1<Partial<A>>) => boolean | string | Promise<boolean | string>;
    filter?: (answer: any, answers: NoInfer$1<Partial<A>>) => any;
    askAnswered?: boolean;
    when?: MaybeAsyncValue<boolean, A>;
};
type QuestionWithGetters<Type extends string, Q extends Record<string, any>, A extends Answers> = DistributiveMerge<Q, {
    type: Type;
    askAnswered?: boolean;
    when?: MaybeAsyncValue<boolean, A>;
    filter?(input: any, answers: NoInfer$1<A>): any;
    message: KeyValueOrAsyncGetterFunction<Q, 'message', A>;
    default?: KeyValueOrAsyncGetterFunction<Q, 'default', A>;
    choices?: KeyValueOrAsyncGetterFunction<Q, 'choices', A>;
}>;
type UnnamedDistinctQuestion<A extends Answers = object> = QuestionWithGetters<'checkbox', Parameters<typeof _default$8>[0] & {
    default: unknown[];
}, A> | QuestionWithGetters<'confirm', Parameters<typeof _default$6>[0], A> | QuestionWithGetters<'editor', Parameters<typeof _default$7>[0], A> | QuestionWithGetters<'expand', Parameters<typeof expand>[0], A> | QuestionWithGetters<'input', Parameters<typeof _default$5>[0], A> | QuestionWithGetters<'number', Parameters<typeof _default$4>[0], A> | QuestionWithGetters<'password', Parameters<typeof _default$2>[0], A> | QuestionWithGetters<'rawlist', Parameters<typeof _default$3>[0], A> | QuestionWithGetters<'search', Parameters<typeof _default$1>[0], A> | QuestionWithGetters<'select', Parameters<typeof _default>[0], A>;
type CustomQuestion<A extends Answers, Q extends Record<string, Record<string, any>>> = {
    [key in Extract<keyof Q, string>]: Readonly<QuestionWithGetters<key, Q[key], A>>;
}[Extract<keyof Q, string>];
type PromptModuleSpecificQuestion<A extends Answers, Prompts extends Record<string, Record<string, any>> = never> = UnnamedDistinctQuestion<A> | CustomQuestion<A, Prompts>;
type PromptModuleNamedQuestion<A extends Answers, Prompts extends Record<string, Record<string, any>> = never, Flat extends Answers = A> = PromptModuleSpecificQuestion<A, Prompts> & {
    name: Extract<keyof Flat, string>;
};
type DistinctQuestion<A extends Answers = Answers> = PromptModuleNamedQuestion<A>;
type PromptSession<A extends Answers = Answers, Q extends Question<A> = Question<A>> = readonly Q[] | Record<string, Omit<Q, 'name'>> | Observable<Q> | Q;
type QuestionSequence<Q> = Q | readonly Q[] | Observable<Q>;
type MergedAnswers<A extends Answers, Prefilled extends Answers> = MergeAnswerObjects<NormalizeAnswers<A>, WidenAnswerLiterals<Prefilled>>;
type DictionaryAnswers<A extends Answers, Prefilled extends Answers> = MergeAnswerObjects<NormalizeAnswers<Answers<Extract<keyof A, string>>>, WidenAnswerLiterals<Prefilled>>;
type PromptModulePublicQuestion<A extends Answers, Flat extends Answers = A> = {
    type?: 'input' | 'confirm' | 'editor' | 'password' | 'number' | 'rawlist' | 'expand' | 'checkbox' | 'search' | 'select';
    name: Extract<keyof Flat, string>;
    message: MaybeAsyncValue<string, A>;
    default?: unknown;
    choices?: unknown;
    filter?: (input: any, answers: NoInfer$1<Partial<A>>) => any;
    askAnswered?: boolean;
    when?: MaybeAsyncValue<boolean, A>;
} & Record<string, unknown>;
type StreamOptions = Prettify<Context & {
    skipTTYChecks?: boolean;
}>;

interface PromptBase {
    /**
     * Runs the prompt.
     *
     * @returns
     * The result of the prompt.
     */
    run(): Promise<any>;
}
/**
 * Provides the functionality to initialize new prompts.
 */
interface LegacyPromptConstructor {
    /**
     * Initializes a new instance of a prompt.
     *
     * @param question
     * The question to prompt.
     *
     * @param readLine
     * An object for reading from the command-line.
     *
     * @param answers
     * The answers provided by the user.
     */
    new (question: any, readLine: InquirerReadline, answers: Record<string, any>): PromptBase;
}
type PromptFn<Value = any, Config = any> = (config: Config, context: StreamOptions & {
    signal: AbortSignal;
}) => Promise<Value>;
/**
 * Provides a set of prompt-constructors.
 */
type PromptCollection = Record<string, PromptFn | LegacyPromptConstructor>;
type AnswerEvent = {
    name: string;
    answer: unknown;
};
/**
 * Base interface class other can inherits from
 */
declare class PromptsRunner<A extends Answers> {
    private prompts;
    answers: Partial<A>;
    process: InteropObservable<AnswerEvent>;
    private abortController;
    private opt;
    constructor(prompts: PromptCollection, opt?: StreamOptions);
    run(questions: PromptSession<A>, answers?: Partial<A>): Promise<A>;
    private getQuestions;
    private prepareQuestion;
    private fetchAnswer;
    /**
     * Close the interface and cleanup listeners
     */
    close: () => void;
    private shouldRun;
}

/**
 * Inquirer.js
 * A collection of common interactive command line user interfaces.
 */

type PublicQuestions<A extends Answers, Prefilled extends Answers> = QuestionSequence<PromptModulePublicQuestion<MergedAnswers<A, Prefilled>, A>>;
type InternalQuestions<A extends Answers, Prefilled extends Answers, Prompts extends Record<string, Record<string, unknown>>> = QuestionSequence<PromptModuleNamedQuestion<MergedAnswers<A, Prefilled>, Prompts, A>>;
type QuestionsDictionary<A extends Answers, Prefilled extends Answers, Prompts extends Record<string, Record<string, unknown>>> = {
    [name in keyof A]: PromptModuleSpecificQuestion<MergedAnswers<A, Prefilled>, Prompts>;
};
type PromptModuleApi<Prompts extends Record<string, Record<string, unknown>> = never> = {
    <const A extends Answers, const Prefilled extends Answers = object>(questions: PublicQuestions<A, Prefilled> | InternalQuestions<A, Prefilled, Prompts>, answers?: Prefilled): PromptReturnType<MergedAnswers<A, Prefilled>>;
    <const A extends Answers, const Prefilled extends Answers = object>(questions: QuestionsDictionary<A, Prefilled, Prompts>, answers?: Prefilled): PromptReturnType<DictionaryAnswers<A, Prefilled>>;
    <A extends Answers>(questions: PromptSession<A>, answers?: Partial<A>): PromptReturnType<A>;
} & {
    prompts: PromptCollection;
    registerPrompt(name: string, prompt: LegacyPromptConstructor | PromptFn): PromptModuleApi<Prompts>;
    restoreDefaultPrompts(): void;
};

type PromptReturnType<T extends Answers> = Promise<T> & {
    ui: PromptsRunner<T>;
};
/**
 * Create a new self-contained prompt module.
 */
declare function createPromptModule<Prompts extends Record<string, Record<string, unknown>> = never>(opt?: StreamOptions): PromptModuleApi<Prompts>;
declare function registerPrompt(name: string, newPrompt: LegacyPromptConstructor): void;
declare function restoreDefaultPrompts(): void;
declare const inquirer: {
    prompt: PromptModuleApi<Omit<QuestionMap, "__dummy">>;
    ui: {
        Prompt: typeof PromptsRunner;
    };
    createPromptModule: typeof createPromptModule;
    registerPrompt: typeof registerPrompt;
    restoreDefaultPrompts: typeof restoreDefaultPrompts;
    Separator: typeof Separator;
};

export { createPromptModule, inquirer as default };
export type { Answers, DistinctQuestion, PromptSession, Question, QuestionMap };
