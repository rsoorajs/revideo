import {decorate, threadable} from '../decorators';
import {getTaskName, setTaskName} from '../flow';
import {createSignal} from '../signals';
import {endThread, startThread, useLogger} from '../utils';
import type {ThreadGenerator} from './ThreadGenerator';
import {isThreadGenerator} from './ThreadGenerator';

const reusedGenerator = `
This usually happens when you mistakenly reuse a generator that is already
running.

For example, using \`yield\` here will run the opacity generator concurrently and
store it in the \`task\` variable (in case you want to cancel or await it later):

\`\`\`ts
const task = yield rect().opacity(1, 1);
\`\`\`

Trying to \`yield\` this task again will cause the current error:

\`\`\`ts
yield task;
\`\`\`

Passing it to other flow functions will also cause the error:

\`\`\`ts
// prettier-ignore
yield* all(task);
\`\`\`

Try to investigate your code looking for \`yield\` statements whose return value
is reused in this way. Here's an example of a common mistake:

\`\`\`ts wrong
// prettier-ignore
yield* all(
  yield rect().opacity(1, 1), 
  yield rect().x(200, 1),
);
\`\`\`

\`\`\`ts correct
// prettier-ignore
yield* all(
  rect().opacity(1, 1), 
  rect().x(200, 1),
);
\`\`\`
`;

decorate(noop, threadable());
export function* noop(): ThreadGenerator {
  // do nothing
}

/**
 * A class representing an individual thread.
 *
 * @remarks
 * Thread is a wrapper for a generator that can be executed concurrently.
 *
 * Aside from the main thread, all threads need to have a parent.
 * If a parent finishes execution, all of its child threads are terminated.
 */
export class Thread {
  public children: Thread[] = [];
  /**
   * The next value to be passed to the wrapped generator.
   */
  public value: unknown;

  /**
   * The current time of this thread.
   *
   * @remarks
   * Used by {@link flow.waitFor} and other time-based functions to properly
   * support durations shorter than one frame.
   */
  public readonly time = createSignal(0);

  /**
   * The fixed time of this thread.
   *
   * @remarks
   * Fixed time is a multiple of the frame duration. It can be used to account
   * for the difference between this thread's {@link time} and the time of the
   * current animation frame.
   */
  public get fixed() {
    return this.fixedTime;
  }

  /**
   * Check if this thread or any of its ancestors has been canceled.
   */
  public get canceled(): boolean {
    return this.isCanceled || (this.parent?.canceled ?? false);
  }

  public get paused(): boolean {
    return this.isPaused || (this.parent?.paused ?? false);
  }

  public parent: Thread | null = null;
  private isCanceled = false;
  private isPaused = false;
  private fixedTime = 0;
  private queue: ThreadGenerator[] = [];

  public constructor(
    /**
     * The generator wrapped by this thread.
     */
    public readonly runner: ThreadGenerator & {task?: Thread},
  ) {
    if (this.runner.task) {
      useLogger().error({
        message: `The generator "${getTaskName(
          this.runner,
        )}" is already being executed by another thread.`,
        remarks: reusedGenerator,
      });
      this.runner = noop();
    }
    this.runner.task = this;
  }

  /**
   * Progress the wrapped generator once.
   */
  public next() {
    if (this.paused) {
      return {
        value: null,
        done: false,
      };
    }

    startThread(this);
    const result = this.runner.next(this.value);
    endThread(this);
    this.value = null;
    return result;
  }

  /**
   * Prepare the thread for the next update cycle.
   *
   * @param dt - The delta time of the next cycle.
   */
  public update(dt: number) {
    if (!this.paused) {
      this.time(this.time() + dt);
      this.fixedTime += dt;
    }
    this.children = this.children.filter(child => !child.canceled);
  }

  public spawn(
    child: ThreadGenerator | (() => ThreadGenerator),
  ): ThreadGenerator {
    if (!isThreadGenerator(child)) {
      child = child();
    }
    this.queue.push(child);
    return child;
  }

  public add(child: Thread) {
    child.parent = this;
    child.isCanceled = false;
    child.time(this.time());
    child.fixedTime = this.fixedTime;
    this.children.push(child);

    setTaskName(child.runner, `unknown ${this.children.length}`);
  }

  public drain(callback: (task: ThreadGenerator) => void) {
    this.queue.forEach(callback);
    this.queue = [];
  }

  public cancel() {
    this.runner.return();
    this.isCanceled = true;
    this.parent = null;
    this.drain(task => task.return());
  }

  public pause(value: boolean) {
    this.isPaused = value;
  }
}
