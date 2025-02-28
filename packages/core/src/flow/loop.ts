import {decorate, threadable} from '../decorators';
import type {ThreadGenerator} from '../threading';
import {useLogger, useThread} from '../utils';

const infiniteLoop = `
Make sure to use \`yield\` or \`spawn()\` to execute the loop concurrently in a
separate thread:

\`\`\`ts wrong
// prettier-ignore
yield* loop(() => rect().opacity(0).opacity(1, 1));
\`\`\`

\`\`\`ts correct
yield loop(() => rect().opacity(0).opacity(1, 1));
// or
spawn(loop(() => rect().opacity(0).opacity(1, 1)));
\`\`\`

If you want to execute the loop a finite number of times, specify the iteration
count as the first argument:

\`\`\`ts
// prettier-ignore
yield* loop(10, () => rect().opacity(0).opacity(1, 1));
//          ^ iteration count
\`\`\`
`;

export interface LoopCallback {
  /**
   * A callback called by {@link loop} during each iteration.
   *
   * @param i - The current iteration index.
   */
  (i: number): ThreadGenerator | void;
}

decorate(loop, threadable());

/**
 * Run the given generator in a loop.
 *
 * @remarks
 * Each iteration waits until the previous one is completed.
 * Because this loop never finishes it cannot be used in the main thread.
 * Instead, use `yield` or {@link threading.spawn} to run the loop concurrently.
 *
 * @example
 * Rotate the `rect` indefinitely:
 * ```ts
 * yield loop(
 *   () => rect.rotation(0).rotation(360, 2, linear),
 * );
 * ```
 *
 * @param factory - A function creating the generator to run. Because generators
 *                  can't be reset, a new generator is created on each
 *                  iteration.
 */
export function loop(factory: LoopCallback): ThreadGenerator;
/**
 * Run the given generator N times.
 *
 * @remarks
 * Each iteration waits until the previous one is completed.
 *
 * @example
 * ```ts
 * const colors = [
 *   '#ff6470',
 *   '#ffc66d',
 *   '#68abdf',
 *   '#99c47a',
 * ];
 *
 * yield* loop(
 *   colors.length,
 *   i => rect.fill(colors[i], 2),
 * );
 * ```
 *
 * @param iterations - The number of iterations.
 * @param factory - A function creating the generator to run. Because generators
 *                  can't be reset, a new generator is created on each
 *                  iteration.
 */
export function loop(
  iterations: number,
  factory: LoopCallback,
): ThreadGenerator;
export function* loop(
  iterations: LoopCallback | number,
  factory?: LoopCallback,
): ThreadGenerator {
  if (typeof iterations !== 'number') {
    factory = iterations;
    iterations = Infinity;
  }

  if (iterations === Infinity && useThread().parent === null) {
    useLogger().error({
      message: 'Tried to execute an infinite loop in the main thread.',
      remarks: infiniteLoop,
      stack: new Error().stack,
    });
    return;
  }

  for (let i = 0; i < iterations; i++) {
    const generator = factory!(i);
    if (generator) {
      yield* generator;
    } else {
      yield;
    }
  }
}
