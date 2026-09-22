import { CodexClient, type RpcMessage } from './client.js';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams.js';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse.js';
import type { ThreadListResponse } from './generated/v2/ThreadListResponse.js';
import type { ThreadReadResponse } from './generated/v2/ThreadReadResponse.js';
import type { ThreadResumeResponse } from './generated/v2/ThreadResumeResponse.js';
import type { TurnStartParams } from './generated/v2/TurnStartParams.js';
import type { TurnStartResponse } from './generated/v2/TurnStartResponse.js';
import type { TurnCompletedNotification } from './generated/v2/TurnCompletedNotification.js';

/** Typed operations are based on generated Codex 0.155.1 bindings. */
export class CodexRuntime {
  constructor(public readonly client: CodexClient) {}
  createSession(params: ThreadStartParams) { return this.client.request<ThreadStartResponse>('thread/start', params); }
  listSessions(cwd?: string) { return this.client.request<ThreadListResponse>('thread/list', { sourceKinds: ['appServer', 'vscode', 'cli'], ...(cwd ? { cwd } : {}) }); }
  readSession(threadId: string) { return this.client.request<ThreadReadResponse>('thread/read', { threadId, includeTurns: true }); }
  resumeSession(threadId: string, model?: string, developerInstructions?: string, cwd?: string) { return this.client.request<ThreadResumeResponse>('thread/resume', { threadId, approvalPolicy: 'on-request', sandbox: 'workspace-write', ...(cwd ? { cwd } : {}), ...(model ? { model } : {}), ...(developerInstructions ? { developerInstructions } : {}) }); }
  startTurn(params: TurnStartParams) { return this.client.request<TurnStartResponse>('turn/start', params); }
  interruptTurn(threadId: string, turnId: string) { return this.client.request('turn/interrupt', { threadId, turnId }); }

  /** Subscribe before turn/start to avoid racing fast completions. Dispose on any startup failure. */
  waitForCompletion(threadId: string, timeoutMs = 30000) {
    let dispose = () => {};
    const result = new Promise<TurnCompletedNotification>((resolve, reject) => {
      const timer = setTimeout(() => { dispose(); reject(new Error('Turn completion timed out')); }, timeoutMs);
      const notify = (message: RpcMessage) => {
        if (message.method !== 'turn/completed') return;
        const notification = message.params as TurnCompletedNotification;
        if (notification.threadId === threadId) { dispose(); resolve(notification); }
      };
      const closed = (error: Error) => { dispose(); reject(error); };
      dispose = () => {
        clearTimeout(timer); this.client.off('notification', notify); this.client.off('closed', closed);
      };
      this.client.on('notification', notify); this.client.on('closed', closed);
    });
    // Attach a rejection observer immediately while the caller awaits turn/start.
    void result.catch(() => {});
    return { result, dispose: () => dispose() };
  }
}
