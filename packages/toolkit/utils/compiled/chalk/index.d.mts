type CSPair = { // eslint-disable-line @typescript-eslint/naming-convention
	/**
	The ANSI terminal control sequence for starting this style.
	*/
	readonly open: string;

	/**
	The ANSI terminal control sequence for ending this style.
	*/
	readonly close: string;
};

type Modifier = {
	/**
	Resets the current color chain.
	*/
	readonly reset: CSPair;

	/**
	Make text bold.
	*/
	readonly bold: CSPair;

	/**
	Emitting only a small amount of light.
	*/
	readonly dim: CSPair;

	/**
	Make text italic. (Not widely supported)
	*/
	readonly italic: CSPair;

	/**
	Put a horizontal line below the text. (Not widely supported)
	*/
	readonly underline: CSPair;

	/**
	Put a double horizontal line below the text. (Not widely supported)
	*/
	readonly underlineDouble: CSPair;

	/**
	Put a curly horizontal line below the text. (Not widely supported)
	*/
	readonly underlineCurly: CSPair;

	/**
	Put a dotted horizontal line below the text. (Not widely supported)
	*/
	readonly underlineDotted: CSPair;

	/**
	Put a dashed horizontal line below the text. (Not widely supported)
	*/
	readonly underlineDashed: CSPair;

	/**
	Put a horizontal line above the text.

	Supported on VTE-based terminals, the GNOME terminal, mintty, and Git Bash.
	*/
	readonly overline: CSPair;

	/**
	Inverse background and foreground colors.
	*/
	readonly inverse: CSPair;

	/**
	Prints the text, but makes it invisible.
	*/
	readonly hidden: CSPair;

	/**
	Puts a horizontal line through the center of the text. (Not widely supported)
	*/
	readonly strikethrough: CSPair;
};

type ForegroundColor$1 = {
	readonly black: CSPair;
	readonly red: CSPair;
	readonly green: CSPair;
	readonly yellow: CSPair;
	readonly blue: CSPair;
	readonly cyan: CSPair;
	readonly magenta: CSPair;
	readonly white: CSPair;

	/**
	Alias for `blackBright`.
	*/
	readonly gray: CSPair;

	/**
	Alias for `blackBright`.
	*/
	readonly grey: CSPair;

	readonly blackBright: CSPair;
	readonly redBright: CSPair;
	readonly greenBright: CSPair;
	readonly yellowBright: CSPair;
	readonly blueBright: CSPair;
	readonly cyanBright: CSPair;
	readonly magentaBright: CSPair;
	readonly whiteBright: CSPair;
};

type BackgroundColor$1 = {
	readonly bgBlack: CSPair;
	readonly bgRed: CSPair;
	readonly bgGreen: CSPair;
	readonly bgYellow: CSPair;
	readonly bgBlue: CSPair;
	readonly bgCyan: CSPair;
	readonly bgMagenta: CSPair;
	readonly bgWhite: CSPair;

	/**
	Alias for `bgBlackBright`.
	*/
	readonly bgGray: CSPair;

	/**
	Alias for `bgBlackBright`.
	*/
	readonly bgGrey: CSPair;

	readonly bgBlackBright: CSPair;
	readonly bgRedBright: CSPair;
	readonly bgGreenBright: CSPair;
	readonly bgYellowBright: CSPair;
	readonly bgBlueBright: CSPair;
	readonly bgCyanBright: CSPair;
	readonly bgMagentaBright: CSPair;
	readonly bgWhiteBright: CSPair;
};

type UnderlineColor = {
	readonly underlineBlack: CSPair;
	readonly underlineRed: CSPair;
	readonly underlineGreen: CSPair;
	readonly underlineYellow: CSPair;
	readonly underlineBlue: CSPair;
	readonly underlineCyan: CSPair;
	readonly underlineMagenta: CSPair;
	readonly underlineWhite: CSPair;

	/**
	Alias for `underlineBlackBright`.
	*/
	readonly underlineGray: CSPair;

	/**
	Alias for `underlineBlackBright`.
	*/
	readonly underlineGrey: CSPair;

	readonly underlineBlackBright: CSPair;
	readonly underlineRedBright: CSPair;
	readonly underlineGreenBright: CSPair;
	readonly underlineYellowBright: CSPair;
	readonly underlineBlueBright: CSPair;
	readonly underlineCyanBright: CSPair;
	readonly underlineMagentaBright: CSPair;
	readonly underlineWhiteBright: CSPair;
};

/**
Basic modifier names.
*/
type ModifierName = keyof Modifier;

/**
Basic foreground color names.

[More colors here.](https://github.com/chalk/chalk/blob/main/readme.md#256-and-truecolor-color-support)
*/
type ForegroundColorName = keyof ForegroundColor$1;

/**
Basic background color names.

[More colors here.](https://github.com/chalk/chalk/blob/main/readme.md#256-and-truecolor-color-support)
*/
type BackgroundColorName = keyof BackgroundColor$1;

/**
Basic underline color names.

[More colors here.](https://github.com/chalk/chalk/blob/main/readme.md#256-and-truecolor-color-support)
*/
type UnderlineColorName = keyof UnderlineColor;

/**
Basic color names. The combination of foreground and background color names.

[More colors here.](https://github.com/chalk/chalk/blob/main/readme.md#256-and-truecolor-color-support)
*/
type ColorName = ForegroundColorName | BackgroundColorName;

/**
Basic modifier names.
*/
declare const modifierNames: readonly ModifierName[];

/**
Basic foreground color names.
*/
declare const foregroundColorNames: readonly ForegroundColorName[];

/**
Basic background color names.
*/
declare const backgroundColorNames: readonly BackgroundColorName[];

/**
Basic underline color names.
*/
declare const underlineColorNames: readonly UnderlineColorName[];

/**
Basic color names. The combination of foreground and background color names.
*/
declare const colorNames: readonly ColorName[];

/**
Levels:
- `0` - All colors disabled.
- `1` - Basic 16 colors support.
- `2` - ANSI 256 colors support.
- `3` - Truecolor 16 million colors support.
*/
type ColorSupportLevel = 0 | 1 | 2 | 3;

/**
Detect whether the terminal supports color.
*/
type ColorSupport = {
	/**
	The color level.
	*/
	level: ColorSupportLevel;

	/**
	Whether basic 16 colors are supported.
	*/
	hasBasic: boolean;

	/**
	Whether ANSI 256 colors are supported.
	*/
	has256: boolean;

	/**
	Whether Truecolor 16 million colors are supported.
	*/
	has16m: boolean;
};

type ColorInfo = ColorSupport | false;

// TODO: Make it this when TS supports that.
// import {ModifierName, ForegroundColor, BackgroundColor, ColorName} from '#ansi-styles';
// import {ColorInfo, ColorSupportLevel} from '#supports-color';


interface Options {
	/**
	Specify the color support for Chalk.

	By default, color support is automatically detected based on the environment.

	Levels:
	- `0` - All colors disabled.
	- `1` - Basic 16 colors support.
	- `2` - ANSI 256 colors support.
	- `3` - Truecolor 16 million colors support.

	Omit this option, or pass `undefined`, to have the level detected instead.

	@throws If the value is neither `undefined` nor an integer from 0 to 3.
	*/
	readonly level?: ColorSupportLevel | undefined;
}

/**
Return a new Chalk instance.
*/
declare const Chalk: new (options?: Options) => ChalkInstance; // eslint-disable-line @typescript-eslint/naming-convention

interface ChalkInstance {
	(...text: unknown[]): string;

	/**
	The color support for Chalk.

	By default, color support is automatically detected based on the environment.

	Levels:
	- `0` - All colors disabled.
	- `1` - Basic 16 colors support.
	- `2` - ANSI 256 colors support.
	- `3` - Truecolor 16 million colors support.

	@throws If the assigned value is not an integer from 0 to 3.
	*/
	level: ColorSupportLevel;

	/**
	Use RGB values to set text color.

	@example
	```
	import chalk from 'chalk';

	chalk.rgb(222, 173, 237);
	```
	*/
	rgb: (red: number, green: number, blue: number) => this;

	/**
	Use HEX value to set text color.

	@param color - Hexadecimal value representing the desired color.

	@example
	```
	import chalk from 'chalk';

	chalk.hex('#DEADED');
	```
	*/
	hex: (color: string) => this;

	/**
	Use an [8-bit unsigned number](https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit) to set text color.

	The value is downsampled to the 16-color palette on terminals that only support basic colors (level 1), so `chalk.ansi256(196)` becomes 91 (ANSI escape for bright red).

	@example
	```
	import chalk from 'chalk';

	chalk.ansi256(201);
	```
	*/
	ansi256: (index: number) => this;

	/**
	Use RGB values to set background color.

	@example
	```
	import chalk from 'chalk';

	chalk.bgRgb(222, 173, 237);
	```
	*/
	bgRgb: (red: number, green: number, blue: number) => this;

	/**
	Use HEX value to set background color.

	@param color - Hexadecimal value representing the desired color.

	@example
	```
	import chalk from 'chalk';

	chalk.bgHex('#DEADED');
	```
	*/
	bgHex: (color: string) => this;

	/**
	Use an [8-bit unsigned number](https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit) to set background color.

	The value is downsampled to the 16-color palette on terminals that only support basic colors (level 1), so `chalk.bgAnsi256(196)` becomes 101 (ANSI escape for bright red background).

	@example
	```
	import chalk from 'chalk';

	chalk.bgAnsi256(201);
	```
	*/
	bgAnsi256: (index: number) => this;

	/**
	Use RGB values to set underline color.

	The underline color is only visible when an underline style is also applied.

	@example
	```
	import chalk from 'chalk';

	chalk.underlineRgb(222, 173, 237).underlineCurly('Hello, world!');
	```
	*/
	underlineRgb: (red: number, green: number, blue: number) => this;

	/**
	Use HEX value to set underline color.

	The underline color is only visible when an underline style is also applied.

	@param color - Hexadecimal value representing the desired color.

	@example
	```
	import chalk from 'chalk';

	chalk.underlineHex('#DEADED').underlineCurly('Hello, world!');
	```
	*/
	underlineHex: (color: string) => this;

	/**
	Use an [8-bit unsigned number](https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit) to set underline color.

	The underline color is only visible when an underline style is also applied.

	The value is downsampled to the first 16 palette entries on terminals that only support basic colors (level 1), so `chalk.underlineAnsi256(196)` becomes 9 (the palette index for bright red).

	@example
	```
	import chalk from 'chalk';

	chalk.underlineAnsi256(201).underlineCurly('Hello, world!');
	```
	*/
	underlineAnsi256: (index: number) => this;

	/**
	Modifier: Reset the current style.
	*/
	readonly reset: this;

	/**
	Modifier: Make the text bold.
	*/
	readonly bold: this;

	/**
	Modifier: Make the text have lower opacity.
	*/
	readonly dim: this;

	/**
	Modifier: Make the text italic. *(Not widely supported)*
	*/
	readonly italic: this;

	/**
	Modifier: Put a horizontal line below the text. *(Not widely supported)*
	*/
	readonly underline: this;

	/**
	Modifier: Put a double horizontal line below the text. *(Not widely supported)*
	*/
	readonly underlineDouble: this;

	/**
	Modifier: Put a curly horizontal line below the text. *(Not widely supported)*
	*/
	readonly underlineCurly: this;

	/**
	Modifier: Put a dotted horizontal line below the text. *(Not widely supported)*
	*/
	readonly underlineDotted: this;

	/**
	Modifier: Put a dashed horizontal line below the text. *(Not widely supported)*
	*/
	readonly underlineDashed: this;

	/**
	Modifier: Put a horizontal line above the text. *(Not widely supported)*
	*/
	readonly overline: this;

	/**
	Modifier: Invert background and foreground colors.
	*/
	readonly inverse: this;

	/**
	Modifier: Print the text but make it invisible.
	*/
	readonly hidden: this;

	/**
	Modifier: Puts a horizontal line through the center of the text. *(Not widely supported)*
	*/
	readonly strikethrough: this;

	/**
	Modifier: Print the text only when Chalk has a color level above zero.

	Can be useful for things that are purely cosmetic.
	*/
	readonly visible: this;

	readonly black: this;
	readonly red: this;
	readonly green: this;
	readonly yellow: this;
	readonly blue: this;
	readonly magenta: this;
	readonly cyan: this;
	readonly white: this;

	/**
	Alias for `blackBright`.
	*/
	readonly gray: this;

	/**
	Alias for `blackBright`.
	*/
	readonly grey: this;

	readonly blackBright: this;
	readonly redBright: this;
	readonly greenBright: this;
	readonly yellowBright: this;
	readonly blueBright: this;
	readonly magentaBright: this;
	readonly cyanBright: this;
	readonly whiteBright: this;

	readonly bgBlack: this;
	readonly bgRed: this;
	readonly bgGreen: this;
	readonly bgYellow: this;
	readonly bgBlue: this;
	readonly bgMagenta: this;
	readonly bgCyan: this;
	readonly bgWhite: this;

	/**
	Alias for `bgBlackBright`.
	*/
	readonly bgGray: this;

	/**
	Alias for `bgBlackBright`.
	*/
	readonly bgGrey: this;

	readonly bgBlackBright: this;
	readonly bgRedBright: this;
	readonly bgGreenBright: this;
	readonly bgYellowBright: this;
	readonly bgBlueBright: this;
	readonly bgMagentaBright: this;
	readonly bgCyanBright: this;
	readonly bgWhiteBright: this;

	readonly underlineBlack: this;
	readonly underlineRed: this;
	readonly underlineGreen: this;
	readonly underlineYellow: this;
	readonly underlineBlue: this;
	readonly underlineMagenta: this;
	readonly underlineCyan: this;
	readonly underlineWhite: this;

	/**
	Alias for `underlineBlackBright`.
	*/
	readonly underlineGray: this;

	/**
	Alias for `underlineBlackBright`.
	*/
	readonly underlineGrey: this;

	readonly underlineBlackBright: this;
	readonly underlineRedBright: this;
	readonly underlineGreenBright: this;
	readonly underlineYellowBright: this;
	readonly underlineBlueBright: this;
	readonly underlineMagentaBright: this;
	readonly underlineCyanBright: this;
	readonly underlineWhiteBright: this;
}

/**
Main Chalk object that allows to chain styles together.

Call the last one as a method with a string argument.

Order doesn't matter, and later styles take precedent in case of a conflict.

This simply means that `chalk.red.yellow.green` is equivalent to `chalk.green`.
*/
declare const chalk: ChalkInstance;

declare const supportsColor: ColorInfo;

declare const chalkStderr: typeof chalk;
declare const supportsColorStderr: typeof supportsColor;


// TODO: Remove these aliases in the next major version
/**
@deprecated Use `ModifierName` instead.

Basic modifier names.
*/
type Modifiers = ModifierName;

/**
@deprecated Use `ForegroundColorName` instead.

Basic foreground color names.

[More colors here.](https://github.com/chalk/chalk/blob/main/readme.md#256-and-truecolor-color-support)
*/
type ForegroundColor = ForegroundColorName;

/**
@deprecated Use `BackgroundColorName` instead.

Basic background color names.

[More colors here.](https://github.com/chalk/chalk/blob/main/readme.md#256-and-truecolor-color-support)
*/
type BackgroundColor = BackgroundColorName;

/**
@deprecated Use `ColorName` instead.

Basic color names. The combination of foreground and background color names.

[More colors here.](https://github.com/chalk/chalk/blob/main/readme.md#256-and-truecolor-color-support)
*/
type Color = ColorName;

/**
@deprecated Use `modifierNames` instead.

Basic modifier names.
*/
declare const modifiers: readonly ModifierName[];

/**
@deprecated Use `foregroundColorNames` instead.

Basic foreground color names.
*/
declare const foregroundColors: readonly ForegroundColorName[];

/**
@deprecated Use `backgroundColorNames` instead.

Basic background color names.
*/
declare const backgroundColors: readonly BackgroundColorName[];

/**
@deprecated Use `colorNames` instead.

Basic color names. The combination of foreground and background color names.
*/
declare const colors: readonly ColorName[];

export { Chalk, backgroundColorNames, backgroundColors, chalkStderr, colorNames, colors, chalk as default, foregroundColorNames, foregroundColors, modifierNames, modifiers, supportsColor, supportsColorStderr, underlineColorNames };
export type { BackgroundColor, BackgroundColorName, ChalkInstance, Color, ColorInfo, ColorName, ColorSupport, ColorSupportLevel, ForegroundColor, ForegroundColorName, ModifierName, Modifiers, Options, UnderlineColorName };
