/** 全局 AI 请求协调器：同一时间只允许一个优化请求运行。 */
interface ActiveRequest {
  controller: AbortController;
  token: symbol;
}

export interface AiRequestLease {
  controller: AbortController;
  isCurrent: () => boolean;
  release: () => void;
}

let activeRequest: ActiveRequest | null = null;

export function beginAiRequest(): AiRequestLease {
  activeRequest?.controller.abort();

  const next: ActiveRequest = {
    controller: new AbortController(),
    token: Symbol("ai-request"),
  };
  activeRequest = next;

  return {
    controller: next.controller,
    isCurrent: () => activeRequest?.token === next.token,
    release: () => {
      if (activeRequest?.token === next.token) activeRequest = null;
    },
  };
}

export function cancelActiveAiRequest(): void {
  activeRequest?.controller.abort();
  activeRequest = null;
}
