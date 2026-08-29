// ============================================================
// domain/taskStateMachine.js
// 形式化任务状态机（解耦：与 Activity/Plan/Output/VF 诸机互不冲突）
// 镜像 Python 规范：显式转移表 + Lease 防重入 + Composite Behaviour
// 适用：复杂工作流/调度任务（如 每日总结 = 拉代码→跑测试→生成报告）
// ============================================================

export const TaskState = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  WAITING_RETRY: 'waiting_retry',
  PAUSED: 'paused',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
});

export const TaskEvent = Object.freeze({
  SCHEDULE: 'schedule',
  START: 'start',
  PROGRESS: 'progress',
  COMPLETE: 'complete',
  FAIL: 'fail',
  RETRY: 'retry',
  PAUSE: 'pause',
  RESUME: 'resume',
  TIMEOUT_TRIGGER: 'timeout_trigger',
  CANCEL: 'cancel',
});

// 单一真源转移表 - 显式规则，无隐藏魔法
export const TRANSITION_TABLE = new Map([
  [`${TaskState.PENDING}->${TaskEvent.SCHEDULE}`, TaskState.SCHEDULED],
  [`${TaskState.PENDING}->${TaskEvent.CANCEL}`, TaskState.FAILED],
  [`${TaskState.SCHEDULED}->${TaskEvent.START}`, TaskState.RUNNING],
  [`${TaskState.SCHEDULED}->${TaskEvent.CANCEL}`, TaskState.FAILED],
  [`${TaskState.RUNNING}->${TaskEvent.COMPLETE}`, TaskState.SUCCEEDED],
  [`${TaskState.RUNNING}->${TaskEvent.FAIL}`, TaskState.WAITING_RETRY],
  [`${TaskState.RUNNING}->${TaskEvent.PAUSE}`, TaskState.PAUSED],
  [`${TaskState.RUNNING}->${TaskEvent.TIMEOUT_TRIGGER}`, TaskState.TIMEOUT],
  [`${TaskState.WAITING_RETRY}->${TaskEvent.RETRY}`, TaskState.SCHEDULED],
  [`${TaskState.WAITING_RETRY}->${TaskEvent.CANCEL}`, TaskState.FAILED],
  [`${TaskState.PAUSED}->${TaskEvent.RESUME}`, TaskState.SCHEDULED],
  [`${TaskState.PAUSED}->${TaskEvent.CANCEL}`, TaskState.FAILED],
]);

export class Lease {
  constructor(workerId, ttlMs = 60000) {
    this.workerId = workerId;
    this.expiresAt = Date.now() + ttlMs;
  }
  isExpired() { return Date.now() > this.expiresAt; }
  renew(ttlMs = 60000) { this.expiresAt = Date.now() + ttlMs; return true; }
}

export class Task {
  constructor({ id = Math.random().toString(36).slice(2), maxRetries = 3 } = {}) {
    this.id = id;
    this.state = TaskState.PENDING;
    this.retryCount = 0;
    this.maxRetries = maxRetries;
    this.lease = null;
    this.errorMessage = null;
    this.updatedAt = Date.now();
  }
  transit(event) {
    const key = `${this.state}->${event}`;
    if (!TRANSITION_TABLE.has(key)) throw new Error(`Invalid transition: ${this.state} -> ${event}`);
    let next = TRANSITION_TABLE.get(key);
    if (event === TaskEvent.FAIL) {
      this.retryCount += 1;
      if (this.retryCount >= this.maxRetries) next = TaskState.FAILED;
    }
    if (event === TaskEvent.START) {
      if (!this.lease || this.lease.isExpired()) throw new Error('Cannot start: Lease missing or expired');
    }
    this.state = next;
    this.updatedAt = Date.now();
    return this;
  }
  acquireLease(workerId, ttlMs = 60000) {
    if (this.lease && !this.lease.isExpired()) return false;
    this.lease = new Lease(workerId, ttlMs);
    return true;
  }
  renewLease(workerId, ttlMs = 60000) {
    if (this.lease && this.lease.workerId === workerId) return this.lease.renew(ttlMs);
    return false;
  }
}

// Composite Pattern - 解耦复杂工作流
export class SequentialBehaviour {
  constructor(subs = []) { this.subs = subs; this.idx = 0; }
  async execute(ctx) {
    if (this.idx >= this.subs.length) return TaskEvent.COMPLETE;
    const res = await this.subs[this.idx].execute(ctx);
    if (res === TaskEvent.COMPLETE) { this.idx += 1; return this.subs.length > this.idx ? TaskEvent.PROGRESS : TaskEvent.COMPLETE; }
    return res;
  }
}

export class ParallelBehaviour {
  constructor(subs = []) { this.subs = subs; this.results = Array(subs.length).fill(null); }
  async execute(ctx) {
    let allOk = true;
    for (let i = 0; i < this.subs.length; i++) {
      if (this.results[i] === null) {
        const r = await this.subs[i].execute(ctx);
        this.results[i] = r;
        if (r === TaskEvent.FAIL) return TaskEvent.FAIL;
      }
      if (this.results[i] !== TaskEvent.COMPLETE) allOk = false;
    }
    return allOk ? TaskEvent.COMPLETE : TaskEvent.PROGRESS;
  }
}
