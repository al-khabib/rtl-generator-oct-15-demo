import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GeneratedTest } from '../types'
import { postMessage } from '../vscode'
import type {
  GenerationPhase,
  PanelComponentInfo,
  PanelMessageFromExtension
} from './types'

/* ──────────────────────────────────────────────────────────
 * Small UI helpers
 * ────────────────────────────────────────────────────────── */
const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ')

const Chip: React.FC<{
  children: React.ReactNode
  tone?: 'default' | 'info' | 'success'
}> = ({ children, tone = 'default' }) => {
  const tones: Record<'default' | 'info' | 'success', string> = {
    default:
      'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]',
    info: 'bg-[color-mix(in_srgb,var(--vscode-editorInfo-foreground)_18%,transparent)] text-[var(--vscode-editor-foreground)]',
    success:
      'bg-[color-mix(in_srgb,var(--vscode-testing-iconPassed)_20%,transparent)] text-[var(--vscode-editor-foreground)]'
  }
  return (
    <span
      className={cx(
        'rounded px-2 py-[2px] text-[10px] font-medium',
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className='rounded border border-border bg-[var(--vscode-editor-background)] px-[6px] py-[1px] text-[10px] font-medium text-foreground'>
    {children}
  </kbd>
)

/* ──────────────────────────────────────────────────────────
 * Status + formatting
 * ────────────────────────────────────────────────────────── */
type StatusState = {
  phase: GenerationPhase
  message: string
  startedAt?: number
  durationMs?: number
}

const statusLabelMap: Record<GenerationPhase, string> = {
  idle: 'Ready',
  loading: 'Generating',
  error: 'Error',
  saved: 'Saved'
}

const statusDotMap: Record<GenerationPhase, string> = {
  idle: 'bg-[var(--vscode-testing-iconQueued)]',
  loading: 'bg-[var(--vscode-progressBar-background)]',
  error: 'bg-[var(--vscode-testing-iconFailed)]',
  saved: 'bg-[var(--vscode-testing-iconPassed)]'
}

const formatTimestamp = (iso?: string): string => {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Date(parsed).toLocaleString()
}

const formatDuration = (ms?: number): string => {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const sec = ms / 1000
  return sec >= 10 ? `${Math.round(sec)} s` : `${sec.toFixed(1)} s`
}

const truncatePath = (filePath?: string): string => {
  if (!filePath) return '—'
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts.length <= 3 ? normalized : `…/${parts.slice(-3).join('/')}`
}

const extractComplexity = (
  metadata: GeneratedTest['metadata']
): number | null => {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  const candidates: unknown[] = [
    record.complexity,
    (record.analysis as Record<string, unknown> | undefined)?.complexity,
    (record.component as Record<string, unknown> | undefined)?.complexity
  ]
  for (const c of candidates)
    if (typeof c === 'number' && Number.isFinite(c)) return c
  return null
}

const collectDiagnostics = (metadata: GeneratedTest['metadata']): string[] => {
  if (!metadata || typeof metadata !== 'object') return []
  const record = metadata as Record<string, unknown>
  const keys = ['warnings', 'issues', 'diagnostics', 'notes']
  const out = new Set<string>()
  keys.forEach((k) => {
    const v = record[k]
    if (Array.isArray(v))
      v.forEach((s) => typeof s === 'string' && s.trim() && out.add(s.trim()))
    if (typeof v === 'string' && v.trim()) out.add(v.trim())
  })
  return [...out]
}

const getMetadataDuration = (
  metadata: GeneratedTest['metadata']
): number | undefined => {
  if (!metadata || typeof metadata !== 'object') return
  const record = metadata as Record<string, unknown>
  const v = (record.durationMs ?? record.duration) as unknown
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const isStreamedResponse = (metadata: GeneratedTest['metadata']): boolean => {
  if (!metadata || typeof metadata !== 'object') return false
  return Boolean((metadata as Record<string, unknown>).streamed)
}

/* ──────────────────────────────────────────────────────────
 * Main component
 * ────────────────────────────────────────────────────────── */
const PanelApp: React.FC = () => {
  const [component, setComponent] = useState<PanelComponentInfo | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [generatedTest, setGeneratedTest] = useState<GeneratedTest | null>(null)
  const [editedContent, setEditedContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [status, setStatus] = useState<StatusState>({
    phase: 'loading',
    message: 'Preparing initial test output…'
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const lastGenerationStartRef = useRef<number | undefined>(undefined)

  /* message bridge */
  useEffect(() => {
    const handler = (event: MessageEvent<PanelMessageFromExtension>) => {
      const message = event.data
      switch (message.type) {
        case 'init': {
          const initialInstructions =
            typeof message.payload.generatedTest.metadata?.instructions ===
            'string'
              ? (message.payload.generatedTest.metadata.instructions as string)
              : ''
          setComponent(message.payload.component)
          setDisplayName(message.payload.component.displayName)
          setGeneratedTest(message.payload.generatedTest)
          setInstructions(initialInstructions)
          setEditedContent(message.payload.generatedTest.content)
          setIsEditing(false)
          setShowDiagnostics(false)
          lastGenerationStartRef.current = message.payload.metrics?.startedAt
            ? Date.parse(message.payload.metrics.startedAt)
            : undefined
          setStatus({
            phase: 'idle',
            message: 'Ready.',
            startedAt: lastGenerationStartRef.current,
            durationMs: message.payload.metrics?.durationMs
          })
          setErrorMessage(null)
          break
        }
        case 'generation:started': {
          const startedAt = Date.parse(message.payload.startedAt)
          lastGenerationStartRef.current = Number.isNaN(startedAt)
            ? Date.now()
            : startedAt
          setStatus({
            phase: 'loading',
            message: 'Generating RTL test…',
            startedAt: lastGenerationStartRef.current
          })
          setErrorMessage(null)
          setIsEditing(false)
          break
        }
        case 'generation:success': {
          const explicitStartedAt = message.payload.startedAt
            ? Date.parse(message.payload.startedAt)
            : undefined
          if (explicitStartedAt && !Number.isNaN(explicitStartedAt)) {
            lastGenerationStartRef.current = explicitStartedAt
          }
          const startedAt = lastGenerationStartRef.current
          const computedDuration =
            message.payload.durationMs ??
            (startedAt ? Date.now() - startedAt : undefined)

          setGeneratedTest(message.payload.generatedTest)
          setEditedContent(message.payload.generatedTest.content)
          setStatus({
            phase: 'idle',
            message: 'Generation completed successfully.',
            startedAt,
            durationMs: computedDuration
          })
          setErrorMessage(null)
          setIsEditing(false)
          setShowDiagnostics(false)
          break
        }
        case 'generation:error': {
          setStatus({ phase: 'error', message: message.payload.message })
          setErrorMessage(message.payload.message)
          break
        }
        case 'file:saved': {
          const targetPath =
            message.payload.relativePath ?? message.payload.filePath
          setStatus({ phase: 'saved', message: `Saved to ${targetPath}` })
          setErrorMessage(null)
          break
        }
        case 'file:saveError': {
          setStatus({ phase: 'error', message: message.payload.message })
          setErrorMessage(message.payload.message)
          break
        }
      }
    }

    window.addEventListener('message', handler)
    postMessage('ready')
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    if (generatedTest) setEditedContent(generatedTest.content)
  }, [generatedTest])

  const busy = status.phase === 'loading'
  const hasTest = Boolean(generatedTest)

  /* labels */
  const componentLabel = useMemo(() => {
    if (displayName.trim()) return displayName.trim()
    if (component?.displayName) return component.displayName
    if (component?.name) return component.name
    return 'Component'
  }, [component, displayName])

  const fileNameTag = useMemo(() => {
    if (generatedTest?.fileName) return generatedTest.fileName
    if (componentLabel.trim())
      return `${componentLabel.replace(/\s+/g, '')}.test.tsx`
    return 'Generated.test.tsx'
  }, [generatedTest, componentLabel])

  const diagnostics = useMemo(
    () => collectDiagnostics(generatedTest?.metadata),
    [generatedTest]
  )

  useEffect(() => {
    if (diagnostics.length === 0) setShowDiagnostics(false)
  }, [diagnostics])

  const complexity = useMemo(
    () => extractComplexity(generatedTest?.metadata),
    [generatedTest]
  )

  const durationText = useMemo(() => {
    const metric =
      status.durationMs ?? getMetadataDuration(generatedTest?.metadata)
    return formatDuration(metric)
  }, [status.durationMs, generatedTest])

  const streamed = useMemo(
    () => isStreamedResponse(generatedTest?.metadata),
    [generatedTest]
  )

  const statusLabel = statusLabelMap[status.phase]
  const statusDot = statusDotMap[status.phase] ?? 'bg-border'

  /* actions */
  const handleRegenerate = useCallback(() => {
    if (busy) return
    setStatus({
      phase: 'loading',
      message: 'Generating RTL test…',
      startedAt: Date.now()
    })
    const trimmedInstructions = instructions.trim()
    const trimmedName = displayName.trim()
    postMessage('regenerate', {
      instructions: trimmedInstructions.length
        ? trimmedInstructions
        : undefined,
      displayName: trimmedName.length ? trimmedName : component?.name
    })
    setErrorMessage(null)
    setIsEditing(false)
  }, [busy, instructions, displayName, component])

  const handleRetry = useCallback(() => {
    if (busy) return
    setStatus({
      phase: 'loading',
      message: 'Generating RTL test…',
      startedAt: Date.now()
    })
    const trimmedInstructions = instructions.trim()
    const trimmedName = displayName.trim()
    postMessage('retry', {
      instructions: trimmedInstructions.length
        ? trimmedInstructions
        : undefined,
      displayName: trimmedName.length ? trimmedName : component?.name
    })
    setErrorMessage(null)
    setIsEditing(false)
  }, [busy, instructions, displayName, component])

  const handleApprove = useCallback(() => {
    if (!hasTest || busy) return
    const trimmedName = displayName.trim()
    postMessage('approve', {
      displayName: trimmedName.length ? trimmedName : component?.name,
      content: editedContent
    })
  }, [busy, hasTest, displayName, component, editedContent])

  const handleCopy = useCallback(() => {
    if (!hasTest) return
    postMessage('copy', { content: editedContent })
    setStatus((prev) => ({ ...prev, message: 'Code copied to clipboard.' }))
  }, [hasTest, editedContent])

  const handleClose = useCallback(() => postMessage('close'), [])

  /* shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        handleRegenerate()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleApprove()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleApprove, handleClose, handleRegenerate])

  /* UI */
  return (
    <div className='mx-auto flex h-full w-full max-w-[1200px] flex-col bg-[var(--vscode-editor-background)] text-foreground'>
      {/* Header */}
      <header className='border-b border-border bg-[var(--vscode-sideBar-background)]/70 px-5 py-4 shadow-panel'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='min-w-0'>
            <h1 className='truncate text-[18px] font-semibold leading-6'>
              RTL Test Preview — {componentLabel}
            </h1>
            <p className='mt-1 truncate text-xs text-muted'>
              {truncatePath(component?.filePath)}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            {streamed && <Chip tone='info'>Streamed</Chip>}
            <Chip>{fileNameTag}</Chip>
          </div>
        </div>

        {/* Meta */}
        <dl className='mt-4 grid gap-3 text-xs text-muted sm:grid-cols-2 lg:grid-cols-6'>
          <div className='flex flex-col gap-1'>
            <dt className='uppercase tracking-wide'>Component</dt>
            <dd className='text-foreground'>{componentLabel}</dd>
          </div>
          <div className='flex flex-col gap-1'>
            <dt className='uppercase tracking-wide'>Source</dt>
            <dd className='text-foreground'>
              {component?.source === 'selection'
                ? 'Selection (highlighted region)'
                : 'Entire file'}
            </dd>
          </div>
          <div className='flex flex-col gap-1'>
            <dt className='uppercase tracking-wide'>Model</dt>
            <dd className='text-foreground'>{generatedTest?.model ?? '—'}</dd>
          </div>
          <div className='flex flex-col gap-1'>
            <dt className='uppercase tracking-wide'>Generated</dt>
            <dd className='text-foreground'>
              {formatTimestamp(generatedTest?.generatedAt)}
            </dd>
          </div>
          <div className='flex flex-col gap-1'>
            <dt className='uppercase tracking-wide'>Complexity</dt>
            <dd className='text-foreground'>{complexity ?? '—'}</dd>
          </div>
          <div className='flex flex-col gap-1'>
            <dt className='uppercase tracking-wide'>Duration</dt>
            <dd className='text-foreground'>{durationText}</dd>
          </div>
        </dl>
      </header>

      {/* Main */}
      <main className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-auto p-5'>
          {/* Error banner */}
          {errorMessage && (
            <div
              role='alert'
              className='mb-4 rounded border border-error bg-error/10 p-4 text-xs'
            >
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                  <p className='font-semibold text-error'>Generation failed</p>
                  <p className='mt-1 whitespace-pre-wrap text-muted'>
                    {errorMessage}
                  </p>
                </div>
                <button
                  type='button'
                  className='rounded border border-error px-3 py-1 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-60'
                  onClick={handleRetry}
                  disabled={busy}
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* Editor chrome */}
          <section className='flex h-[58vh] flex-col overflow-hidden rounded-md border border-border bg-[var(--vscode-editor-background)] shadow-panel'>
            <div className='flex items-center justify-between border-b border-border bg-[var(--vscode-editor-background)]/85 px-3 py-2 text-xs'>
              <div className='flex items-center gap-2 text-muted'>
                <span className='inline-flex items-center gap-1'>
                  <span className='inline-block h-2 w-2 rounded-full bg-[var(--vscode-tab-activeBorder)]' />
                  <span>Generated Test</span>
                </span>
                <span className='text-muted'>•</span>
                <span className='text-muted'>{fileNameTag}</span>
              </div>
              <label className='inline-flex cursor-pointer items-center gap-3'>
                <span className='text-[11px] font-medium text-muted'>
                  {isEditing ? 'Preview Unlocked' : 'Preview Locked'}
                </span>
                <span className='relative inline-flex h-5 w-9 items-center'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={isEditing}
                    onChange={() => setIsEditing((p) => !p)}
                    disabled={!hasTest || busy}
                    aria-label='Toggle edit mode for generated test'
                  />
                  <span className='absolute inset-0 rounded-full bg-border transition peer-checked:bg-accent peer-disabled:opacity-50' />
                  <span className='absolute left-1 top-1 h-3 w-3 rounded-full bg-[var(--vscode-editor-background)] transition peer-checked:translate-x-4 peer-checked:bg-white peer-disabled:opacity-70' />
                </span>
              </label>
            </div>

            <div className='relative flex-1 overflow-hidden'>
              {hasTest ? (
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  readOnly={!isEditing}
                  aria-readonly={!isEditing}
                  spellCheck={false}
                  className='h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-sm leading-relaxed text-foreground focus:outline-none'
                  aria-label='Generated test code preview'
                />
              ) : (
                <div className='flex h-full items-center justify-center px-4 text-sm text-muted'>
                  Generated test content will appear here once available.
                </div>
              )}

              {busy && (
                <div className='absolute inset-0 flex items-center justify-center bg-[var(--vscode-editor-background)]/80 backdrop-blur-sm'>
                  <span
                    className='h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent'
                    aria-hidden='true'
                  />
                  <span className='ml-3 text-xs font-medium text-muted'>
                    Generating…
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Diagnostics */}
          {diagnostics.length > 0 && (
            <section className='mt-4 rounded border border-border bg-[var(--vscode-editor-background)]/70 p-3 text-xs'>
              <button
                type='button'
                className='flex w-full items-center justify-between rounded px-2 py-1 text-left font-medium hover:bg-[var(--vscode-editor-background)]'
                onClick={() => setShowDiagnostics((p) => !p)}
                aria-expanded={showDiagnostics}
              >
                <span>Diagnostics ({diagnostics.length})</span>
                <span aria-hidden='true'>{showDiagnostics ? '▾' : '▸'}</span>
              </button>
              {showDiagnostics && (
                <ul className='mt-2 list-disc space-y-2 pl-5 text-muted'>
                  {diagnostics.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Controls (sticky) */}
          <section
            className='sticky bottom-0 z-10 mt-6 grid gap-4 rounded-md border border-border bg-[var(--vscode-sideBar-background)]/60 p-4 backdrop-blur-sm lg:grid-cols-[1fr,minmax(18rem,0.6fr)]'
            aria-label='Generation options'
          >
            <div className='flex flex-col gap-3'>
              <label
                htmlFor='instructions'
                className='text-xs font-semibold uppercase tracking-wide text-muted'
              >
                Additional Instructions
              </label>
              <textarea
                id='instructions'
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                className='w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground shadow-panel focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60'
                placeholder='Add optional guidance for regeneration, e.g. “Add accessibility assertions and edge cases”.'
                disabled={busy}
              />
              <p className='text-[11px] text-muted'>
                Tip: <Kbd>⌘/Ctrl</Kbd> + <Kbd>Enter</Kbd> to regenerate with the
                current instructions.
              </p>
            </div>

            <div className='flex flex-col gap-3'>
              <div>
                <label
                  htmlFor='componentName'
                  className='text-xs font-semibold uppercase tracking-wide text-muted'
                >
                  Component Name
                </label>
                <input
                  id='componentName'
                  type='text'
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className='mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground shadow-panel focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60'
                  placeholder='Component display name used for the test file'
                  disabled={busy}
                />
              </div>

              <div className='flex flex-wrap items-center justify-end gap-2 pt-1'>
                <button
                  type='button'
                  className='rounded border border-border px-4 py-2 text-sm font-medium hover:bg-[var(--vscode-editor-background)] disabled:opacity-60'
                  onClick={handleCopy}
                  disabled={!hasTest}
                >
                  Copy to Clipboard
                </button>
                <button
                  type='button'
                  className='rounded border border-border px-4 py-2 text-sm font-medium hover:bg-[var(--vscode-editor-background)] disabled:opacity-60'
                  onClick={handleClose}
                >
                  Close
                </button>
                <button
                  type='button'
                  className='rounded border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-60'
                  onClick={handleRegenerate}
                  disabled={busy}
                >
                  Regenerate with Prompt
                </button>
                <button
                  type='button'
                  className='rounded bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accentHover disabled:opacity-60'
                  onClick={handleApprove}
                  disabled={!hasTest || busy}
                >
                  Approve &amp; Create File
                </button>
              </div>

              <p className='text-[11px] text-muted'>
                Shortcuts: <Kbd>⌘/Ctrl</Kbd> + <Kbd>S</Kbd> to approve &amp;
                save, <Kbd>Esc</Kbd> to close.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer
        className='border-t border-border bg-[var(--vscode-sideBar-background)]/70 px-5 py-3 text-xs'
        aria-live='polite'
      >
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <span
              className={cx('h-2.5 w-2.5 shrink-0 rounded-full', statusDot)}
              aria-hidden='true'
            />
            <span className='font-semibold'>{statusLabel}</span>
            <span className='truncate text-muted'>{status.message}</span>
          </div>
          <div className='flex flex-wrap items-center gap-3 text-muted'>
            <span>
              Model:{' '}
              <span className='text-foreground'>
                {generatedTest?.model ?? '—'}
              </span>
            </span>
            <span>
              Duration: <span className='text-foreground'>{durationText}</span>
            </span>
            <span>
              Mode:{' '}
              <span className='text-foreground'>
                {component?.source === 'selection' ? 'Selection' : 'Whole file'}
              </span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default PanelApp
