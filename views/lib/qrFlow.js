const FAILED_STATUSES = new Set(['closed', 'disconnected', 'error', 'failed']);
export const DEFAULT_QR_POLL_TIMEOUT_MS = 75_000;

export function connectionState(response = {}) {
  if (response.status === 'open') {
    return { stage: 'connected', terminal: true, message: '' };
  }

  if (FAILED_STATUSES.has(response.status)) {
    return {
      stage: 'error',
      terminal: true,
      message: response.lastError || response.message || 'Connection closed before creating a QR code.',
    };
  }

  if (response.reconnecting) {
    return {
      stage: 'connecting',
      terminal: false,
      message: 'Link confirmed. Finishing connection…',
    };
  }

  return {
    stage: 'connecting',
    terminal: false,
    message: response.lastError || response.message || (response.qrPending ? 'Waiting for a QR code.' : ''),
  };
}

export function startQrPolling({ load, onResponse, onError, intervalMs = 1500, timeoutMs = DEFAULT_QR_POLL_TIMEOUT_MS }) {
  let stopped = false;
  let timer = null;
  const startedAt = Date.now();

  async function tick() {
    if (stopped) return;
    try {
      const response = await load();
      if (stopped) return;
      const terminal = onResponse(response) === true;
      if (terminal) {
        stopped = true;
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        stopped = true;
        onError(new Error('WhatsApp did not create a QR code in time. Try again.'));
        return;
      }
      timer = setTimeout(tick, intervalMs);
    } catch (error) {
      stopped = true;
      onError(error);
    }
  }

  Promise.resolve().then(tick);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
