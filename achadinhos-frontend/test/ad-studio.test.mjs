import test from 'node:test'
import assert from 'node:assert/strict'
import { wallTime, wallTimeToUtc } from '../src/lib/adCalendar.ts'
import { CommandManager, StateCommand } from '../src/lib/vendor/opencut/commands.ts'
test('calendar stores the selected timezone instant and rejects nonexistent DST wall times', () => {
  assert.equal(wallTimeToUtc('2026-10-06T15:00', 'America/Sao_Paulo'), '2026-10-06T18:00:00.000Z')
  assert.equal(wallTime('2026-10-06T18:00:00.000Z', 'America/Sao_Paulo'), '2026-10-06T15:00')
  assert.throws(() => wallTimeToUtc('2026-03-08T02:30', 'America/New_York'), /não existe/)
})
test('editor history restores edits, clears redo on new work, and isolates project switches', () => {
  const history = new CommandManager()
  let state = { text: 'A', slides: [1, 2] }
  const apply = (value) => {
    state = value
  }
  history.execute(new StateCommand(state, { text: 'B', slides: [2, 1] }, apply))
  history.undo()
  assert.deepEqual(state, { text: 'A', slides: [1, 2] })
  history.redo()
  assert.deepEqual(state, { text: 'B', slides: [2, 1] })
  history.undo()
  history.execute(new StateCommand(state, { text: 'C', slides: [1, 2, 2] }, apply))
  assert.equal(history.canRedo(), false)
  history.clear()
  assert.equal(history.canUndo(), false)
})
