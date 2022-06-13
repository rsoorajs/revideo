import {GeneratorHelper} from '../helpers';
import {decorate, threadable} from '../decorators';
import {Thread} from './Thread';
import {isJoinYieldResult, THREAD_JOIN} from './join';
import {isCancelYieldResult, THREAD_CANCEL} from './cancel';
import {isThreadGenerator, ThreadGenerator} from './ThreadGenerator';

/**
 * Check if the given value is a [Promise][promise].
 *
 * @param value A possible [Promise][promise].
 *
 * [promise]: https://developer.mozilla.org/en-US/docs/web/javascript/reference/global_objects/promise
 */
export function isPromise(value: any): value is Promise<any> {
  return typeof value?.then === 'function';
}

/**
 * A generator function or a normal function that returns a generator.
 */
export interface ThreadsFactory {
  (): ThreadGenerator;
}

export interface ThreadsCallback {
  (root: Thread): void;
}

decorate(threads, threadable());
/**
 * Create a context in which generators can be run concurrently.
 *
 * From the perspective of the external generator, `threads` is executed
 * synchronously. By default, each scene generator is wrapped in its own
 * `threads` generator.
 *
 * Example:
 * ```ts
 * // first
 *
 * yield* threads(function* () {
 *   const task = yield generatorFunction();
 *   // second
 * }); // <- `task` will be terminated here because the scope
 *     //    of this `threads` generator has ended
 *
 * // third
 * ```
 *
 * @param factory
 * @param callback Called whenever threads are created, canceled or finished.
 *                 Used for debugging purposes.
 */
export function* threads(
  factory: ThreadsFactory,
  callback?: ThreadsCallback,
): ThreadGenerator {
  let threads: Thread[] = [];
  const find = (runner: Generator) =>
    threads.find(thread => thread.runner === runner);

  decorate(joinInternal, threadable());
  function* joinInternal(
    tasks: ThreadGenerator[],
    all: boolean,
  ): ThreadGenerator {
    if (all) {
      while (tasks.find(runner => find(runner))) {
        yield;
      }
    } else {
      while (!tasks.find(runner => !find(runner))) {
        yield;
      }
    }
  }

  const root = factory();
  GeneratorHelper.makeThreadable(root, 'root');
  const rootThread = new Thread(root);
  callback?.(rootThread);
  threads.push(rootThread);
  while (threads.length > 0) {
    let hasChanged = false;
    const newThreads = [];

    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      if (thread.canceled) {
        continue;
      }

      const result = thread.next();
      if (result.done) {
        hasChanged = true;
        thread.cancel();
        continue;
      }

      let value = result.value;
      if (isJoinYieldResult(value)) {
        value = joinInternal(value[THREAD_JOIN], value.all);
      } else if (isCancelYieldResult(value)) {
        value[THREAD_CANCEL].forEach((runner: Generator) => {
          const cancelThread = find(runner);
          if (cancelThread) {
            cancelThread.cancel();
          }
        });
        threads.push(thread);
        continue;
      }

      if (isThreadGenerator(value)) {
        const child = find(value) ?? new Thread(value);
        thread.value = value;
        if (child.canceled) {
          console.warn('Reusing a canceled thread: ', child);
        }
        thread.add(child);
        hasChanged = true;

        threads.push(thread);
        threads.push(child);
      } else if (value) {
        thread.value = yield value;
        threads.push(thread);
      } else {
        newThreads.push(thread);
      }
    }

    threads = newThreads;
    if (hasChanged) callback?.(rootThread);
    if (threads.length > 0) yield;
  }
}