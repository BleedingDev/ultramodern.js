// TODO: Load the spinner names from the JSON file.
type SpinnerName =
	| 'dots'
	| 'dots2'
	| 'dots3'
	| 'dots4'
	| 'dots5'
	| 'dots6'
	| 'dots7'
	| 'dots8'
	| 'dots9'
	| 'dots10'
	| 'dots11'
	| 'dots12'
	| 'dots13'
	| 'dots14'
	| 'dots8Bit'
	| 'dotsCircle'
	| 'sand'
	| 'line'
	| 'line2'
	| 'rollingLine'
	| 'pipe'
	| 'simpleDots'
	| 'simpleDotsScrolling'
	| 'star'
	| 'star2'
	| 'flip'
	| 'hamburger'
	| 'growVertical'
	| 'growHorizontal'
	| 'balloon'
	| 'balloon2'
	| 'noise'
	| 'bounce'
	| 'boxBounce'
	| 'boxBounce2'
	| 'binary'
	| 'triangle'
	| 'arc'
	| 'circle'
	| 'squareCorners'
	| 'circleQuarters'
	| 'circleHalves'
	| 'squish'
	| 'toggle'
	| 'toggle2'
	| 'toggle3'
	| 'toggle4'
	| 'toggle5'
	| 'toggle6'
	| 'toggle7'
	| 'toggle8'
	| 'toggle9'
	| 'toggle10'
	| 'toggle11'
	| 'toggle12'
	| 'toggle13'
	| 'arrow'
	| 'arrow2'
	| 'arrow3'
	| 'bouncingBar'
	| 'bouncingBall'
	| 'smiley'
	| 'monkey'
	| 'hearts'
	| 'clock'
	| 'earth'
	| 'material'
	| 'moon'
	| 'runner'
	| 'pong'
	| 'shark'
	| 'dqpb'
	| 'weather'
	| 'christmas'
	| 'grenade'
	| 'point'
	| 'layer'
	| 'betaWave'
	| 'fingerDance'
	| 'fistBump'
	| 'soccerHeader'
	| 'mindblown'
	| 'speaker'
	| 'orangePulse'
	| 'bluePulse'
	| 'orangeBluePulse'
	| 'timeTravel'
	| 'aesthetic'
	| 'dwarfFortress';

type Spinner$1 = {
	/**
	The intended time per frame, in milliseconds.
	*/
	readonly interval: number;

	/**
	An array of frames to show for the spinner.
	*/
	readonly frames: string[];
};

/**
70+ spinners for use in the terminal.

@example
```
import cliSpinners from 'cli-spinners';

console.log(cliSpinners.dots);
// {
// 	interval: 80,
// 	frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// }
```
*/
declare const cliSpinners: {
	readonly [spinnerName in SpinnerName]: Spinner$1;
};

type Spinner = {
	readonly interval?: number;
	readonly frames: string[];
};

type Color =
	| 'black'
	| 'red'
	| 'green'
	| 'yellow'
	| 'blue'
	| 'magenta'
	| 'cyan'
	| 'white'
	| 'gray';

type PrefixTextGenerator = () => string;

type SuffixTextGenerator = () => string;

type Options = {
	/**
	The text to display next to the spinner.
	*/
	readonly text?: string;

	/**
	Text or a function that returns text to display before the spinner. No prefix text will be displayed if set to an empty string.
	*/
	readonly prefixText?: string | PrefixTextGenerator;

	/**
	Text or a function that returns text to display after the spinner text. No suffix text will be displayed if set to an empty string.
	*/
	readonly suffixText?: string | SuffixTextGenerator;

	/**
	The name of one of the provided spinners. See `example.js` in this repo if you want to test out different spinners. On Windows (except for Windows Terminal), it will always use the line spinner as the Windows command-line doesn't have proper Unicode support.

	@default 'dots'

	Or an object like:

	@example
	```
	{
		frames: ['-', '+', '-'],
		interval: 80 // Optional
	}
	```
	*/
	readonly spinner?: SpinnerName | Spinner;

	/**
	The color of the spinner.

	Set to `false` to disable the color.

	@default 'cyan'
	*/
	readonly color?: Color | false | undefined;

	/**
	Set to `false` to stop Ora from hiding the cursor.

	@default true
	*/
	readonly hideCursor?: boolean;

	/**
	Indent the spinner with the given number of spaces.

	@default 0
	*/
	readonly indent?: number;

	/**
	Interval between each frame.

	Spinners provide their own recommended interval, so you don't really need to specify this.

	Default: Provided by the spinner or `100`.
	*/
	readonly interval?: number;

	/**
	Stream to write the output.

	You could for example set this to `process.stdout` instead.

	@default process.stderr
	*/
	readonly stream?: NodeJS.WritableStream;

	/**
	Force enable/disable the spinner. If not specified, the spinner will be enabled if the `stream` is being run inside a TTY context (not spawned or piped) and/or not in a CI environment.

	Note that `{isEnabled: false}` doesn't mean it won't output anything. It just means it won't output the spinner, colors, and other ansi escape codes. It will still log text.
	*/
	readonly isEnabled?: boolean;

	/**
	Disable the spinner and all log text. All output is suppressed and `isEnabled` will be considered `false`.

	@default false
	*/
	readonly isSilent?: boolean;

	/**
	Discard stdin input (except Ctrl+C) while running if it's TTY. This prevents the spinner from twitching on input, outputting broken lines on `Enter` key presses, and prevents buffering of input while the spinner is running.

	This has no effect on Windows as there is no good way to implement discarding stdin properly there.

	Note: `discardStdin` puts stdin into raw mode. In raw mode, `Ctrl+C` no longer generates `SIGINT` from the terminal. Ora re-emits `Ctrl+C` from stdin input, but if your code blocks the event loop with synchronous work, `Ctrl+C` handling is delayed until the blocking work ends. Use async APIs, a worker thread, or a child process to keep `Ctrl+C` responsive, or set `discardStdin` to `false`.

	@default true
	*/
	readonly discardStdin?: boolean;
};

type PersistOptions = {
	/**
	Symbol to replace the spinner with.

	@default ' '
	*/
	readonly symbol?: string;

	/**
	Text to be persisted after the symbol.

	Default: Current `text`.
	*/
	readonly text?: string;

	/**
	Text or a function that returns text to be persisted before the symbol. No prefix text will be displayed if set to an empty string.

	Default: Current `prefixText`.
	*/
	readonly prefixText?: string | PrefixTextGenerator;

	/**
	Text or a function that returns text to be persisted after the text after the symbol. No suffix text will be displayed if set to an empty string.

	Default: Current `suffixText`.
	*/
	readonly suffixText?: string | SuffixTextGenerator;
};

type PromiseOptions<T> = {
	/**
	The new text of the spinner when the promise is resolved.

	Keeps the existing text if `undefined`.
	*/
	successText?: string | ((result: T) => string) | undefined;

	/**
	The new text of the spinner when the promise is rejected.

	Keeps the existing text if `undefined`.
	*/
	failText?: string | ((error: unknown) => string) | undefined;

	/**
	The symbol to use when the promise is resolved, instead of the default success symbol.

	Useful if you want to customize or disable the symbol.

	Uses the default success symbol if `undefined`.

	@example
	```
	import {oraPromise} from 'ora';

	await oraPromise(somePromise, {successSymbol: '🦄'});
	```
	*/
	successSymbol?: string | undefined;

	/**
	The symbol to use when the promise is rejected, instead of the default failure symbol.

	Useful if you want to customize or disable the symbol.

	Uses the default failure symbol if `undefined`.

	@example
	```
	import {oraPromise} from 'ora';

	await oraPromise(somePromise, {failSymbol: '💥'});
	```
	*/
	failSymbol?: string | undefined;
} & Options;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface Ora {
	/**
	Change the text after the spinner.
	*/
	text: string;

	/**
	Change the text or function that returns text before the spinner.

	No prefix text will be displayed if set to an empty string.
	*/
	prefixText: string | PrefixTextGenerator;

	/**
	Change the text or function that returns text after the spinner text.

	No suffix text will be displayed if set to an empty string.
	*/
	suffixText: string | SuffixTextGenerator;

	/**
	Change the spinner color.

	Set to `false` to disable the color.
	*/
	color: Color | false | undefined;

	/**
	Change the spinner indent.
	*/
	indent: number;

	/**
	Get the spinner.
	*/
	get spinner(): Spinner;

	/**
	Set the spinner.
	*/
	set spinner(spinner: SpinnerName | Spinner);

	/**
	A boolean indicating whether the instance is currently spinning.
	*/
	get isSpinning(): boolean;

	/**
	A boolean indicating whether the spinner and log text are enabled.
	*/
	isEnabled: boolean;

	/**
	A boolean indicating whether all output is suppressed.
	*/
	isSilent: boolean;

	/**
	The interval between each frame.

	The interval is decided by the chosen spinner.
	*/
	get interval(): number;

	/**
	Start the spinner.

	@param text - Set the current text.
	@returns The spinner instance.
	*/
	start(text?: string): this;

	/**
	Stop and clear the spinner.

	@returns The spinner instance.
	*/
	stop(): this;

	/**
	Stop the spinner, change it to a green `✔` and persist the current text, or `text` if provided.

	@param text - Will persist text if provided.
	@returns The spinner instance.
	*/
	succeed(text?: string): this;

	/**
	Stop the spinner, change it to a red `✖` and persist the current text, or `text` if provided.

	@param text - Will persist text if provided.
	@returns The spinner instance.
	*/
	fail(text?: string): this;

	/**
	Stop the spinner, change it to a yellow `⚠` and persist the current text, or `text` if provided.

	@param text - Will persist text if provided.
	@returns The spinner instance.
	*/
	warn(text?: string): this;

	/**
	Stop the spinner, change it to a blue `ℹ` and persist the current text, or `text` if provided.

	@param text - Will persist text if provided.
	@returns The spinner instance.
	*/
	info(text?: string): this;

	/**
	Stop the spinner and change the symbol or text.

	@returns The spinner instance.
	*/
	stopAndPersist(options?: PersistOptions): this;

	/**
	Clear the spinner.

	@returns The spinner instance.
	*/
	clear(): this;

	/**
	Manually render a new frame.

	@returns The spinner instance.
	*/
	render(): this;

	/**
	Get a new frame.

	@returns The rendered frame text.
	*/
	frame(): string;
}

/**
Elegant terminal spinner.

@param options - If a string is provided, it is treated as a shortcut for `options.text`.

@example
```
import ora from 'ora';

const spinner = ora('Loading unicorns').start();

setTimeout(() => {
	spinner.color = 'yellow';
	spinner.text = 'Loading rainbows';
}, 1000);
```
*/
declare function ora(options?: string | Options): Ora;

/**
Starts a spinner for a promise or promise-returning function. The spinner is stopped with `.succeed()` if the promise fulfills or with `.fail()` if it rejects.

@param action - The promise to start the spinner for or a promise-returning function.
@param options - If a string is provided, it is treated as a shortcut for `options.text`.
@returns The given promise.

@example
```
import {oraPromise} from 'ora';

await oraPromise(somePromise);
```
*/
declare function oraPromise<T>(
	action: PromiseLike<T> | ((spinner: Ora) => PromiseLike<T>),
	options?: string | PromiseOptions<T>
): Promise<T>;

export { ora as default, oraPromise, cliSpinners as spinners };
export type { Color, Options, Ora, PersistOptions, PrefixTextGenerator, PromiseOptions, Spinner, SuffixTextGenerator };
