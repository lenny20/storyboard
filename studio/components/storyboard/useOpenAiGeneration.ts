'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GenerationQuality,
  GenerationRequest,
  GenerationResult,
  OpenAiStatusResponse,
} from '@/lib/generation/types';
import { DEFAULT_GENERATION_PRESET } from '@/lib/generation/types';

async function localRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const value: unknown = await response.json();
  const errorValue =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  if (!response.ok)
    throw new Error(
      typeof errorValue.error === 'string'
        ? errorValue.error
        : typeof errorValue.message === 'string'
          ? errorValue.message
          : `Local service returned ${response.status}.`,
    );
  return value as T;
}

/** API credentials never enter this hook's persistent state or project storage. */
export function useOpenAiGeneration() {
  const [quality, setQuality] = useState<GenerationQuality>(DEFAULT_GENERATION_PRESET.quality);
  const [status, setStatus] = useState<OpenAiStatusResponse | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [warning, setWarning] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [active, setActive] = useState<GenerationRequest | null>(null);
  const [lastRequestId, setLastRequestId] = useState('');
  const activeRef = useRef(false);
  const refresh = useCallback(async () => {
    try {
      setStatus(await localRequest<OpenAiStatusResponse>('/api/openai/status'));
      setConnectionError('');
    } catch {
      setConnectionError(
        'The local image service is unavailable. Start Storyboard with its local launcher, then retry.',
      );
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  const pending = Boolean(
    active || status?.usage.some((entry) => entry.status === 'started'),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [pending, refresh]);

  async function connect(apiKey: string) {
    setConnectionBusy(true);
    setConnectionError('');
    try {
      setStatus(
        await localRequest<OpenAiStatusResponse>('/api/openai/connection', {
          action: 'set',
          apiKey,
        }),
      );
      return true;
    } catch (cause) {
      setConnectionError(
        cause instanceof Error
          ? cause.message
          : 'Could not configure the connection.',
      );
      return false;
    } finally {
      setConnectionBusy(false);
    }
  }
  async function clearConnection() {
    setConnectionBusy(true);
    try {
      setStatus(
        await localRequest<OpenAiStatusResponse>('/api/openai/connection', {
          action: 'clear',
        }),
      );
      setConnectionError('');
    } catch (cause) {
      setConnectionError(
        cause instanceof Error
          ? cause.message
          : 'Could not clear the connection.',
      );
    } finally {
      setConnectionBusy(false);
    }
  }
  async function generate(
    request: GenerationRequest,
    onResult: (result: GenerationResult, request: GenerationRequest) => void,
  ) {
    if (activeRef.current || pending) return;
    activeRef.current = true;
    setActive(request);
    setLastRequestId(request.requestId);
    setRequestError('');
    setWarning('');
    try {
      const result = await localRequest<GenerationResult>(
        '/api/openai/generate',
        request,
      );
      if (result.status === 'succeeded' && result.image) {
        onResult(result, request);
        if (result.message) setWarning(result.message);
      } else
        setRequestError(
          result.message ||
            'The result is uncertain. Check this request’s result before generating again; a repeated request may create another charge.',
        );
    } catch (cause) {
      setRequestError(
        `${cause instanceof Error ? cause.message : 'The generation response was unavailable.'} Check the result below before generating again.`,
      );
    } finally {
      activeRef.current = false;
      setActive(null);
      await refresh();
    }
  }
  async function recover(requestId: string): Promise<GenerationResult | null> {
    try {
      const result = await localRequest<GenerationResult>(
        `/api/openai/results/${encodeURIComponent(requestId)}`,
      );
      if (result.image && result.message) setWarning(result.message);
      if (!result.image)
        setRequestError(
          result.message || 'No completed image is available yet.',
        );
      await refresh();
      return result;
    } catch (cause) {
      setRequestError(
        cause instanceof Error
          ? cause.message
          : 'Could not retrieve the result.',
      );
      await refresh();
      return null;
    }
  }
  return {
    quality,
    setQuality,
    status,
    connectionError,
    requestError,
    warning,
    dismissWarning: () => setWarning(''),
    connectionBusy,
    active,
    pending,
    lastRequestId,
    refresh,
    connect,
    clearConnection,
    generate,
    recover,
  };
}
export type OpenAiGenerationController = ReturnType<typeof useOpenAiGeneration>;
