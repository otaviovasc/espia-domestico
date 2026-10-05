// Adapted from OpenCut classic cf5e79e919144200294fb9fed22a222592a0aeea.
// apps/web/src/commands/base-command.ts and core/managers/commands.ts.
// Copyright 2025-2026 OpenCut. MIT license in ./LICENSE.
// Removed editor/selection/ripple dependencies; bounded history for form states.
export abstract class Command {
  abstract execute(): void
  undo(): void {
    throw new Error('Undo not implemented for this command')
  }
  redo(): void {
    this.execute()
  }
}
export class CommandManager {
  private history: Command[] = []
  private redoStack: Command[] = []
  execute(command: Command): void {
    command.execute()
    this.history.push(command)
    if (this.history.length > 100) this.history.shift()
    this.redoStack = []
  }
  undo(): void {
    if (!this.history.length) return
    const command = this.history.pop()!
    command.undo()
    this.redoStack.push(command)
  }
  redo(): void {
    if (!this.redoStack.length) return
    const command = this.redoStack.pop()!
    command.redo()
    this.history.push(command)
  }
  canUndo(): boolean {
    return this.history.length > 0
  }
  canRedo(): boolean {
    return this.redoStack.length > 0
  }
  clear(): void {
    this.history = []
    this.redoStack = []
  }
}
export class StateCommand<T> extends Command {
  private before: T
  private after: T
  private apply: (value: T) => void
  constructor(before: T, after: T, apply: (value: T) => void) {
    super()
    this.before = before
    this.after = after
    this.apply = apply
  }
  execute() {
    this.apply(this.after)
  }
  undo() {
    this.apply(this.before)
  }
}
