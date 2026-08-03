/**
 * The modules that do the work stay free of vscode so they can be unit tested
 * without a window, so the output channel arrives through this seam rather
 * than being reached for directly.
 */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
};
