'use client';

import { useState } from 'react';
import { Download, KeyRound, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type {
  GenerationPreset,
  GenerationRequest,
} from '@/lib/generation/types';
import {
  calculateGenerationCost,
  chooseGenerationSize,
  DEFAULT_GENERATION_PRESET,
  formatUsd,
  getPreRequestPricing,
  IMAGE_PRICING_AS_OF,
  IMAGE_PRICING_SOURCES,
  summarizeGenerationCosts,
  SUPPORTED_GENERATION_SIZES,
} from '@/lib/generation/pricing';
import type { OpenAiGenerationController } from './useOpenAiGeneration';
import { Field } from './EditorControls';
import PreviousPanelReferences from './PreviousPanelReferences';
import type { PreviousPanelReference } from '@/lib/storyboard/model';
import type { PreviousPanelCandidate } from '@/lib/storyboard/references';

type Props = {
  controller: OpenAiGenerationController;
  aspectRatio: number;
  referenceNames: string[];
  previousPanelCandidates: PreviousPanelCandidate[];
  previousPanelReferences: PreviousPanelReference[];
  resolvedPreviousPanelReferences: PreviousPanelCandidate[];
  missingPreviousPanelReferences: PreviousPanelReference[];
  onPreviousPanelReferences: (value: PreviousPanelReference[]) => void;
  hasImage: boolean;
  frameDirection: string;
  onFrameDirection: (value: string) => void;
  panelContext: string;
  revision: string;
  onRevision: (value: string) => void;
  onGenerate: (
    mode: GenerationRequest['mode'],
    preset: GenerationPreset,
  ) => void;
  onRecover: (requestId: string) => void;
  preparing: boolean;
  blocked?: boolean;
};

function ConnectionSetup({
  controller,
}: {
  controller: OpenAiGenerationController;
}) {
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const configured = controller.status?.configured;
  return (
    <section className="sb-api-connection" aria-label="OpenAI API connection">
      <div className="sb-api-connection-head">
        <KeyRound size={16} />
        <strong>
          {configured ? 'API key ready' : 'Connect your OpenAI API key'}
        </strong>
        {configured && (
          <Button variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? 'Close' : 'Manage'}
          </Button>
        )}
      </div>
      {configured && (
        <p>
          {controller.status?.keySource === 'environment'
            ? 'Using the key configured in your local server.'
            : 'Key saved for this local server session.'}{' '}
          Connectivity is checked when you generate.
        </p>
      )}
      {(!configured || editing) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = key.trim();
            setKey('');
            void controller.connect(value).then((saved) => {
              if (saved) setEditing(false);
            });
          }}
        >
          <Field label="OpenAI API key">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="Paste your API key here"
            />
          </Field>
          <p>
            Kept in local server memory until restart. It is excluded from
            projects and backups.{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              Create an API key
            </a>
            .
          </p>
          <div className="sb-api-key-actions">
            <Button
              type="submit"
              variant="outline"
              disabled={!key.trim() || controller.connectionBusy}
            >
              {controller.connectionBusy ? 'Saving…' : 'Save key locally'}
            </Button>
            {configured && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setKey('');
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
            {controller.status?.keySource === 'session' && (
              <Button
                type="button"
                variant="ghost"
                disabled={controller.connectionBusy}
                onClick={() => {
                  setKey('');
                  void controller.clearConnection();
                }}
              >
                Remove key
              </Button>
            )}
          </div>
        </form>
      )}
      {controller.connectionError && (
        <p role="alert" className="sb-inline-error">
          {controller.connectionError}
        </p>
      )}
      {!controller.status && (
        <Button variant="ghost" onClick={() => void controller.refresh()}>
          <RefreshCw /> Retry connection
        </Button>
      )}
    </section>
  );
}

export default function GenerationPanel({
  controller,
  aspectRatio,
  referenceNames,
  previousPanelCandidates,
  previousPanelReferences,
  resolvedPreviousPanelReferences,
  missingPreviousPanelReferences,
  onPreviousPanelReferences,
  hasImage,
  frameDirection,
  onFrameDirection,
  panelContext,
  revision,
  onRevision,
  onGenerate,
  onRecover,
  preparing,
  blocked,
}: Props) {
  const [mode, setMode] = useState<GenerationRequest['mode']>('generate');
  const [size, setSize] = useState(() => chooseGenerationSize(aspectRatio));
  const preset: GenerationPreset = {
    ...DEFAULT_GENERATION_PRESET,
    quality: controller.quality,
    size,
  };
  const price = getPreRequestPricing(preset);
  const entries = controller.status?.usage ?? [];
  const complete = entries.filter((entry) => entry.status !== 'started');
  const costs = summarizeGenerationCosts(
    complete.map((entry) => entry.estimatedCost),
  );
  const sessionTotals = controller.status?.usageTotals;
  const attemptCount = sessionTotals?.attempts ?? entries.length;
  const unknownCount = sessionTotals?.unknownCount ?? costs.unknownCount;
  const knownCount = sessionTotals?.knownCount ?? costs.knownCount;
  const knownUsd = sessionTotals
    ? knownCount
      ? sessionTotals.knownCost
      : attemptCount === 0
        ? 0
        : null
    : complete.length === 0
      ? 0
      : costs.knownUsd;
  const latestAttempt = entries.at(-1);
  const uncertain = Boolean(
    controller.requestError || latestAttempt?.status === 'uncertain',
  );
  const uncertainRequestId = controller.requestError
    ? controller.lastRequestId || latestAttempt?.requestId
    : latestAttempt?.requestId;
  const busy = preparing || controller.pending;
  const dimensions = preset.size.split('x').map(Number);
  const mismatch = Math.abs(dimensions[0] / dimensions[1] - aspectRatio) > 0.02;
  return (
    <div className="sb-generation-panel">
      <div className="sb-inspector-intro">
        <span className="sb-eyebrow">GENERATE ONE FRAME</span>
        <p>
          Your direction and selected references go directly to OpenAI through
          this local app.
        </p>
      </div>
      <ConnectionSetup controller={controller} />
      <Field label="Generation mode">
        <NativeSelect
          value={mode}
          disabled={busy}
          onChange={(event) =>
            setMode(event.target.value as GenerationRequest['mode'])
          }
        >
          <option value="generate">New image for this panel</option>
          <option value="revision">Revise the selected image</option>
        </NativeSelect>
      </Field>
      {mode === 'generate' && (
        <Field
          label="Frame direction"
          hint="Only this panel. A newly added panel starts blank."
        >
          <Textarea
            rows={4}
            value={frameDirection}
            onChange={(event) => onFrameDirection(event.target.value)}
            placeholder="e.g. Matilda centred, waist up, smiling toward camera…"
          />
        </Field>
      )}
      {mode === 'generate' && panelContext.trim() && (
        <div>
          <p className="sb-hint">
            The panel context is also included for continuity; this frame
            direction remains the primary instruction.
          </p>
          {!frameDirection.trim() && (
            <Button
              variant="ghost"
              onClick={() => onFrameDirection(panelContext)}
            >
              Use panel context for this frame
            </Button>
          )}
        </div>
      )}
      {mode === 'revision' && (
        <Field label="Revision direction">
          <Textarea
            rows={3}
            value={revision}
            onChange={(event) => onRevision(event.target.value)}
            placeholder="Describe the changes. Everything else will be preserved in the prompt."
          />
        </Field>
      )}
      <PreviousPanelReferences
        aspectRatio={aspectRatio}
        candidates={previousPanelCandidates}
        selected={previousPanelReferences}
        resolved={resolvedPreviousPanelReferences}
        missing={missingPreviousPanelReferences}
        onChange={onPreviousPanelReferences}
        disabled={busy}
      />
      <div className="sb-generation-presets">
        <Field label="Quality">
          <NativeSelect
            value={preset.quality}
            disabled={busy}
            onChange={(event) =>
              controller.setQuality(
                event.target.value as GenerationPreset['quality'],
              )
            }
          >
            <option value="low">Low · quick draft</option>
            <option value="medium">Medium · balanced default</option>
            <option value="high">High · more detail, higher cost</option>
          </NativeSelect>
        </Field>
        <Field label="Output size">
          <NativeSelect
            value={preset.size}
            disabled={busy}
            onChange={(event) =>
              setSize(event.target.value as GenerationPreset['size'])
            }
          >
            {SUPPORTED_GENERATION_SIZES.map((size) => (
              <option key={size} value={size}>
                {size.replace('x', ' × ')}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <p className="sb-hint">
        GPT Image 2.5 Flare · One image per request.
        {mismatch
          ? ` Output fits inside your ${Number(aspectRatio.toFixed(2))}:1 frame without automatic cropping.`
          : ''}
      </p>
      <details className="sb-generation-inputs">
        <summary>
          {referenceNames.length + resolvedPreviousPanelReferences.length}{' '}
          reference image
          {referenceNames.length + resolvedPreviousPanelReferences.length === 1
            ? ''
            : 's'}{' '}
          attached automatically
          {mode === 'revision' && hasImage ? ' + current image' : ''}
        </summary>
        {referenceNames.length + resolvedPreviousPanelReferences.length ? (
          <ul>
            {referenceNames.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
            {resolvedPreviousPanelReferences.map((item) => (
              <li key={`${item.panelId}:${item.imageVersionId}`}>
                {item.label} · previous panel
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No artwork is selected for this shot. Choose your characters in
            References to use their views.
          </p>
        )}
        <p>
          Only this panel’s prompt and these images are sent. GIF and AVIF
          references are converted to PNG for the request; original artwork
          stays in your library.
        </p>
      </details>
      <div className="sb-generation-pricing">
        <p>
          Cost calculated after generation. API billed separately from ChatGPT.
        </p>
        <details>
          <summary>Pricing details · USD</summary>
          <p>
            A fixed total cannot be estimated before generation. Output:{' '}
            {formatUsd(price.ratesUsdPerMillionTokens.imageOutput)} / million
            tokens; image input:{' '}
            {formatUsd(price.ratesUsdPerMillionTokens.imageInput)} / million;
            text input: {formatUsd(price.ratesUsdPerMillionTokens.textInput)} /
            million.
          </p>
          <p>
            Actual usage is measured after the response.{' '}
            <a href={IMAGE_PRICING_SOURCES[0]} target="_blank" rel="noreferrer">
              Rates checked {IMAGE_PRICING_AS_OF}
            </a>
            .
          </p>
        </details>
      </div>
      {mode === 'revision' && !hasImage && (
        <p className="sb-inline-error">
          Import or generate an image before revising it.
        </p>
      )}
      {blocked && (
        <p className="sb-inline-error">
          Resolve this project’s save conflict or storage capacity issue before
          generating.
        </p>
      )}
      {referenceNames.length +
        resolvedPreviousPanelReferences.length +
        (mode === 'revision' && hasImage ? 1 : 0) >
        10 && (
        <p className="sb-inline-error" role="alert">
          Remove references to stay within the 10-image input limit.
        </p>
      )}
      {uncertain && !busy && (
        <div className="sb-generation-uncertain">
          <p>
            The previous request needs attention. Check its result before
            starting another image; a new request may incur another charge.
          </p>
          {uncertainRequestId && (
            <Button
              variant="outline"
              onClick={() => onRecover(uncertainRequestId)}
            >
              <RefreshCw /> Check last result
            </Button>
          )}
        </div>
      )}
      <Button
        className="sb-primary sb-full-width"
        disabled={
          !controller.status?.configured ||
          busy ||
          blocked ||
          missingPreviousPanelReferences.length > 0 ||
          referenceNames.length +
            resolvedPreviousPanelReferences.length +
            (mode === 'revision' && hasImage ? 1 : 0) >
            10 ||
          (mode === 'generate' && !frameDirection.trim()) ||
          (mode === 'revision' && (!hasImage || !revision.trim()))
        }
        onClick={() => onGenerate(mode, preset)}
      >
        {busy ? <Loader2 className="sb-spin" /> : <Sparkles />}
        {preparing
          ? 'Preparing references…'
          : controller.pending
            ? 'Generating…'
            : uncertain
              ? 'Generate another image (new charge)'
              : mode === 'revision'
                ? 'Generate 1 revision'
                : 'Generate 1 image'}
      </Button>
      {busy && (
        <p className="sb-hint">
          You can keep editing while the request runs. The result belongs to the
          panel where you started it. Leaving this view does not cancel an API
          charge.
        </p>
      )}
      {controller.requestError && (
        <p className="sb-inline-error" role="alert">
          {controller.requestError}
        </p>
      )}
      <section
        className="sb-generation-ledger"
        aria-label="API usage on this Mac"
      >
        <div className="sb-generation-ledger-head">
          <h3>API usage on this Mac</h3>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh API usage"
            onClick={() => void controller.refresh()}
          >
            <RefreshCw size={15} />
          </Button>
        </div>
        <div className="sb-generation-totals">
          <span>
            <strong>{attemptCount}</strong> attempts
          </span>
          <span>
            <strong>{formatUsd(knownUsd)}</strong> measured estimate
          </span>
        </div>
        {unknownCount > 0 && (
          <p>
            {unknownCount} attempt{unknownCount === 1 ? '' : 's'} have unknown
            or partial charges, excluded from the measured total.
          </p>
        )}
        <p className="sb-hint">
          Based on returned token usage, not your invoice. This ledger is
          retained on this Mac across server restarts.
        </p>
        {entries
          .slice(-5)
          .reverse()
          .map((entry) => {
            const cost = calculateGenerationCost(entry.usage ?? {});
            return (
              <div className="sb-generation-attempt" key={entry.requestId}>
                <div>
                  <strong>
                    {entry.mode === 'revision' ? 'Revision' : 'Image'} ·{' '}
                    {entry.preset.quality} · {entry.status}
                  </strong>
                  <span>
                    {entry.status === 'started'
                      ? 'Awaiting usage'
                      : `${formatUsd(entry.estimatedCost)} USD`}
                  </span>
                  {entry.estimatedCost == null && cost.status === 'partial' && (
                    <small>
                      Known portion: {formatUsd(cost.knownSubtotalUsd)}; total
                      unknown
                    </small>
                  )}
                </div>
                {(entry.status === 'succeeded' ||
                  entry.status === 'uncertain') && (
                  <Button
                    variant="ghost"
                    aria-label={`Recover result ${entry.requestId}`}
                    onClick={() => onRecover(entry.requestId)}
                  >
                    <Download /> Result
                  </Button>
                )}
              </div>
            );
          })}
      </section>
    </div>
  );
}
