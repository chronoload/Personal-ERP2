import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Task, TaskState, TaskEvent, SequentialBehaviour, ParallelBehaviour } from '../src/domain/taskStateMachine.js';

test('E2E: SequentialBehaviour 按序执行子任务', async () => {
  const mk = (ev) => ({ execute: async () => ev });
  const seq = new SequentialBehaviour([mk(TaskEvent.COMPLETE), mk(TaskEvent.COMPLETE)]);
  assert.equal(await seq.execute({}), TaskEvent.PROGRESS);
  assert.equal(await seq.execute({}), TaskEvent.COMPLETE);
});

test('E2E: ParallelBehaviour 全部完成才 COMPLETE', async () => {
  const mk = (ev) => ({ execute: async () => ev });
  const par = new ParallelBehaviour([mk(TaskEvent.COMPLETE), mk(TaskEvent.COMPLETE)]);
  assert.equal(await par.execute({}), TaskEvent.COMPLETE);
});

test('E2E: Task 完整生命周期 PENDING->RUNNING->FAILED(穷尽重试)->终态', () => {
  const t = new Task({ maxRetries: 1 });
  t.transit(TaskEvent.SCHEDULE);
  assert.equal(t.acquireLease('w1'), true);
  t.transit(TaskEvent.START);
  t.transit(TaskEvent.FAIL);
  assert.equal(t.state, TaskState.FAILED);
});

test('E2E: Lease 防重入 - 未过期不可重复获取', () => {
  const t = new Task();
  t.transit(TaskEvent.SCHEDULE);
  assert.equal(t.acquireLease('w1', 60000), true);
  assert.equal(t.acquireLease('w2', 60000), false);
});

test('E2E: 超时任务可被接管', async () => {
  const t = new Task();
  t.transit(TaskEvent.SCHEDULE);
  t.acquireLease('w1', 1);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(t.acquireLease('w2'), true);
});
