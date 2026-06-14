import { useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import api from '../api/axios'

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map raw option keys to human-readable labels */
function optionLabel(option, detail) {
  if (option === 'skip')                  return 'Skip this row'
  if (option === 'import_as_refund')      return 'Import as refund'
  if (option === 'import_as_settlement')  return 'Import as settlement'
  if (option === 'import_as_expense')     return 'Import as expense'
  if (option === 'use_suggestion')        return `Use suggested name (${detail?.suggestion?.name ?? '?'})`
  if (option === 'remove_inactive')       return 'Remove inactive members from split'
  if (option === 'normalize_to_100')      return 'Normalize percentages to 100%'
  if (option === 'assume_inr')            return 'Assume INR currency'
  if (option === 'apply_rate')            return `Apply rate: 1 USD = ₹${detail?.suggestedRate ?? '?'}`
  if (option === 'use_dd_mm') {
    const d = detail?.interpretationA?.date
    return `Use DD-MM: ${d ? new Date(d).toLocaleDateString('en-IN') : '?'}`
  }
  if (option === 'use_mm_dd') {
    const d = detail?.interpretationB?.date
    return `Use MM-DD: ${d ? new Date(d).toLocaleDateString('en-IN') : '?'}`
  }
  if (option === 'import_this')           return 'Import this row'
  if (option === 'import_both')           return 'Import both rows'
  if (option === 'import_anyway')         return 'Import anyway'
  if (option === 'create_guest_user')     return 'Create guest account for unknown member'
  if (option === 'remove_from_split')     return 'Remove unknown member from split'
  if (option === 'skip_both')             return 'Skip both rows'
  if (option.startsWith('assign_to_'))   return `Assign to this member`
  return option
}

/** Badge colour for each anomaly type */
function anomalyBadgeClass(type) {
  const t = type?.toUpperCase() ?? ''
  if (['DUPLICATE_EXACT', 'CONFLICTING_DUPLICATE', 'PERCENTAGE_SUM_INVALID', 'AMBIGUOUS_DATE'].includes(t))
    return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
  if (['SETTLEMENT_AS_EXPENSE'].includes(t))
    return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  if (['USD_NO_EXCHANGE_RATE', 'MISSING_CURRENCY'].includes(t))
    return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
  if (['INACTIVE_MEMBER_IN_SPLIT', 'UNKNOWN_MEMBER_IN_SPLIT'].includes(t))
    return 'bg-purple-500/15 text-purple-400 border-purple-500/30'
  if (['NEGATIVE_AMOUNT', 'MISSING_PAYER', 'MISSING_REQUIRED_FIELD', 'UNKNOWN_PAYER', 'UNPARSEABLE_DATE', 'ASSUMED_DATE_YEAR'].includes(t))
    return 'bg-red-500/15 text-red-400 border-red-500/30'
  if (['ZERO_AMOUNT'].includes(t))
    return 'bg-gray-600/40 text-gray-400 border-gray-600/40'
  return 'bg-gray-600/30 text-gray-300 border-gray-600/30'
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

function Spinner({ size = 8 }) {
  return (
    <div
      className={`h-${size} w-${size} animate-spin rounded-full border-4 border-indigo-500 border-t-transparent`}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP: upload
// ─────────────────────────────────────────────────────────────────────────────

function UploadStep({ onSubmit }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef(null)

  function handleFile(file) {
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a .csv file')
      return
    }
    setSelectedFile(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    handleFile(file)
  }

  async function handlePreview() {
    if (!selectedFile) return
    setIsLoading(true)
    try {
      await onSubmit(selectedFile)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Navbar */}
      <header className="border-b border-gray-800 bg-gray-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3 sm:px-6">
          <button onClick={() => window.history.back()}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to group
          </button>
          {/* Step indicator */}
          <div className="flex items-center gap-1.5">
            {['Upload', 'Review', 'Done'].map((s, i) => (
              <span key={s} className={`text-xs font-medium ${ i === 0 ? 'text-indigo-400' : 'text-gray-600' }`}>
                {i > 0 && <span className="mr-1.5 text-gray-700">/</span>}{s}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/30">
              <svg className="h-7 w-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Import expenses from CSV</h1>
            <p className="mt-2 text-sm text-gray-400">
              Upload your CSV — we'll scan for issues before anything is saved.
            </p>
          </div>

          {/* Card */}
          <div className="rounded-2xl bg-gray-800/60 border border-gray-700/40 p-6 shadow-2xl">
            {/* Drop zone */}
            <div
              id="import-drop-zone"
              className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 cursor-pointer transition-all duration-200 ${
                dragging
                  ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]'
                  : selectedFile
                  ? 'border-emerald-500/60 bg-emerald-500/5'
                  : 'border-gray-600 hover:border-indigo-500/60 hover:bg-indigo-500/5'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                id="import-file-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              {selectedFile ? (
                <>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30">
                    <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="font-semibold text-white">{selectedFile.name}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {(selectedFile.size / 1024).toFixed(1)} KB · Click to change
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-700/60 border border-gray-600/40">
                    <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>
                  <p className="font-medium text-gray-200">Drop your CSV here</p>
                  <p className="mt-1 text-xs text-gray-500">or click to browse · .csv files only</p>
                </>
              )}
            </div>

            {/* CSV format hint */}
            <div className="mt-4 rounded-xl bg-gray-900/60 border border-gray-700/40 px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Expected columns</p>
              <p className="font-mono text-xs text-gray-400 leading-relaxed">
                date, description, paid_by, amount, currency,<br/>
                split_type, split_with, split_details, notes
              </p>
            </div>

            {/* Submit */}
            <button
              id="import-preview-button"
              disabled={!selectedFile || isLoading}
              onClick={handlePreview}
              className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Uploading…
                </span>
              ) : 'Analyse CSV →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP: previewing / importing — full-page spinner
// ─────────────────────────────────────────────────────────────────────────────

function LoadingStep({ message, sub }) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-5">
      <div className="relative">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-indigo-500/30 border-t-indigo-400" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 rounded-full bg-indigo-500/20 animate-pulse" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-base font-medium text-gray-200">{message}</p>
        {sub && <p className="mt-1 text-sm text-gray-500">{sub}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AnomalyCard — one anomaly within a flagged row
// ─────────────────────────────────────────────────────────────────────────────

function AnomalyCard({ anomaly, rowNumber, anomalyIndex, selectedAction, onActionChange }) {
  const radioName = `row-${rowNumber}-anomaly-${anomalyIndex}`

  return (
    <div className="rounded-xl border border-gray-700/40 bg-gray-900/60 p-4 space-y-3">
      {/* Type badge + message */}
      <div className="flex flex-wrap items-start gap-2">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${anomalyBadgeClass(anomaly.type)}`}>
          {anomaly.type.replaceAll('_', ' ')}
        </span>
        <p className="text-sm text-gray-300 leading-snug flex-1 min-w-0">{anomaly.message}</p>
      </div>

      {/* Action selector */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 pl-1">
        {anomaly.options.map((option) => {
          const id = `${radioName}-${option}`
          const isSelected = (selectedAction ?? anomaly.defaultAction) === option
          return (
            <label
              key={option}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 group"
            >
              <input
                id={id}
                type="radio"
                name={radioName}
                value={option}
                checked={isSelected}
                onChange={() => onActionChange(option)}
                className="accent-indigo-500 h-3.5 w-3.5"
              />
              <span className={`text-xs transition ${isSelected ? 'text-indigo-300 font-medium' : 'text-gray-400 group-hover:text-gray-200'}`}>
                {optionLabel(option, anomaly.detail)}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FlaggedRowCard
// ─────────────────────────────────────────────────────────────────────────────

function FlaggedRowCard({ flaggedRow, rowDecisions, onRowDecisionChange }) {
  const { rowNumber, rawData, parsedData, anomalies } = flaggedRow

  // Derive a short preview of key raw fields
  const previewFields = {
    date: rawData.date,
    description: rawData.description,
    amount: rawData.amount,
    currency: rawData.currency,
    paid_by: rawData.paid_by,
    split_with: rawData.split_with,
  }

  return (
    <div className="rounded-2xl border border-gray-700/40 bg-gray-800/50 overflow-hidden shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-700/40 bg-gray-800/80 px-4 py-3">
        <span className="inline-flex items-center rounded-lg bg-indigo-600/20 border border-indigo-500/30 px-2.5 py-1 text-xs font-bold text-indigo-300">
          Row {rowNumber}
        </span>
        <span className="text-sm font-medium text-gray-200 truncate">
          {rawData.description || <em className="text-gray-500">No description</em>}
        </span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold ${
          anomalies.length === 1
            ? 'bg-yellow-500/15 text-yellow-400'
            : 'bg-red-500/15 text-red-400'
        }`}>
          {anomalies.length} issue{anomalies.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Raw data preview */}
      <div className="px-4 py-3 border-b border-gray-700/30">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">CSV data</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(previewFields).filter(([, v]) => v).map(([k, v]) => (
            <span key={k} className="font-mono text-xs bg-gray-900/60 border border-gray-700/40 rounded-md px-2 py-0.5">
              <span className="text-gray-500">{k}:</span>{' '}
              <span className="text-gray-200">{v}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Anomalies */}
      <div className="p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Issues to resolve</p>
        {anomalies.map((anomaly, ai) => (
          <AnomalyCard
            key={`${rowNumber}-${ai}`}
            anomaly={anomaly}
            rowNumber={rowNumber}
            anomalyIndex={ai}
            selectedAction={rowDecisions?.[ai]}
            onActionChange={(action) => onRowDecisionChange(rowNumber, ai, action, anomaly)}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Clean rows accordion
// ─────────────────────────────────────────────────────────────────────────────

function CleanRowsAccordion({ cleanRows }) {
  const [open, setOpen] = useState(false)

  if (cleanRows.length === 0) return null

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
      <button
        id="clean-rows-toggle"
        className="w-full flex items-center justify-between px-5 py-4 text-left transition hover:bg-emerald-500/10"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
            {cleanRows.length} clean
          </span>
          <span className="text-sm font-medium text-emerald-300">
            rows ready to import
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-emerald-500/20">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-800/60">
              <tr>
                {['Row', 'Date', 'Description', 'Amount', 'Currency', 'Paid By'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {cleanRows.map(({ rowNumber, parsedData: pd }) => (
                <tr key={rowNumber} className="bg-gray-800/20 hover:bg-gray-800/50 transition">
                  <td className="px-4 py-2.5 text-xs text-gray-500">#{rowNumber}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-300">{fmtDate(pd?.date)}</td>
                  <td className="px-4 py-2.5 text-gray-200 max-w-xs truncate">{pd?.description || '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-300">
                    {pd?.amount != null ? Number(pd.amount).toLocaleString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{pd?.currency || 'INR'}</td>
                  <td className="px-4 py-2.5 text-gray-400">{pd?.paidById || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP: reviewing
// ─────────────────────────────────────────────────────────────────────────────

function ReviewStep({ previewData, onConfirm, onCancel }) {
  const { sessionId, totalRows, cleanRows, flaggedRows, autoDecisions } = previewData

  // decisions: { [rowNumber]: { [anomalyIndex]: action } }
  // Initialise with SEEDER default actions for each anomaly (matching server-side SEEDER_DEFAULT_ACTIONS)
  const SEEDER_DEFAULTS_CLIENT = {
    MISSING_REQUIRED_FIELD:   'skip',
    INVALID_AMOUNT:           'skip',
    MISSING_SPLIT_WITH:       'import',
    ZERO_AMOUNT:              'skip',
    NEGATIVE_AMOUNT:          'import_as_refund',
    UNPARSEABLE_DATE:         'skip',
    ASSUMED_DATE_YEAR:        'import',
    AMBIGUOUS_DATE:           'use_dd_mm',
    MISSING_CURRENCY:         'assume_inr',
    USD_NO_EXCHANGE_RATE:     'apply_rate',
    MISSING_PAYER:            'skip',
    UNKNOWN_PAYER_SUGGESTION: 'use_suggestion',
    UNKNOWN_PAYER:            'skip',
    SETTLEMENT_AS_EXPENSE:    'import_as_settlement',
    INACTIVE_MEMBER_IN_SPLIT: 'remove_inactive',
    UNKNOWN_MEMBER_IN_SPLIT:  'remove_from_split',
    INVALID_SPLIT_TYPE:       'skip',
    PERCENTAGE_SUM_INVALID:   'normalize_to_100',
    DUPLICATE_EXACT:          'skip',
    CONFLICTING_DUPLICATE:    'skip',
  }

  const [decisions, setDecisions] = useState(() => {
    const init = {}
    for (const row of flaggedRows) {
      init[row.rowNumber] = {}
      row.anomalies.forEach((a, ai) => {
        // Pre-select the seeder default if it's a valid option, else fall back to anomaly's own defaultAction
        const seederChoice = SEEDER_DEFAULTS_CLIENT[a.type]
        init[row.rowNumber][ai] = (seederChoice && a.options.includes(seederChoice))
          ? seederChoice
          : a.defaultAction
      })
    }
    return init
  })

  function handleRowDecisionChange(rowNumber, anomalyIndex, action) {
    setDecisions((prev) => ({
      ...prev,
      [rowNumber]: {
        ...(prev[rowNumber] ?? {}),
        [anomalyIndex]: action,
      },
    }))
  }

  // Derive the effective action for a flagged row.
  // Priority order:
  //   1. If the user EXPLICITLY chose 'skip'/'skip_both' for ANY anomaly → skip
  //   2. If any anomaly action is 'import_as_settlement' → import as settlement
  //   3. Otherwise pick the most specific non-skip action
  //
  // Note: we do NOT let a defaultAction of 'skip' block the row — only an
  // explicit user choice (stored in decisions) triggers the skip.
  function effectiveRowAction(flaggedRow) {
    const rowDec = decisions[flaggedRow.rowNumber] ?? {}
    // Resolve each anomaly: user decision if present, else default
    const actions = flaggedRow.anomalies.map((a, ai) => rowDec[ai] ?? a.defaultAction)
    // Only skip if the user explicitly chose skip (rowDec has the key)
    const userExplicitlySkipped = flaggedRow.anomalies.some(
      (_, ai) => ai in rowDec && (rowDec[ai] === 'skip' || rowDec[ai] === 'skip_both')
    )
    if (userExplicitlySkipped) return 'skip'
    if (actions.some((a) => a === 'import_as_settlement')) return 'import_as_settlement'
    // Pick the most specific non-skip action (prefer user choice over default)
    const userChosen = flaggedRow.anomalies.map((_, ai) => rowDec[ai]).find(
      (a) => a && a !== 'skip' && a !== 'skip_both'
    )
    if (userChosen) return userChosen
    const nonSkipDefault = actions.find((a) => a !== 'skip' && a !== 'skip_both')
    return nonSkipDefault ?? 'import'
  }

  // Count stats for bottom bar
  const stats = { expenses: cleanRows.length, settlements: 0, skipped: 0 }
  for (const row of flaggedRows) {
    const eff = effectiveRowAction(row)
    if (eff === 'skip' || eff === 'skip_both') stats.skipped++
    else if (eff === 'import_as_settlement') stats.settlements++
    else stats.expenses++
  }
  const importCount = stats.expenses + stats.settlements

  function buildDecisionsArray() {
    const arr = []

    // Clean rows always imported
    for (const { rowNumber, parsedData } of cleanRows) {
      arr.push({ rowNumber, action: 'import', resolvedData: parsedData })
    }

    // Flagged rows — use resolved action + parsedData (best-guess from server)
    for (const row of flaggedRows) {
      const action = effectiveRowAction(row)
      arr.push({ rowNumber: row.rowNumber, action, resolvedData: row.parsedData })
    }

    return arr
  }

  async function handleImport() {
    const decisionsArray = buildDecisionsArray()
    await onConfirm(sessionId, decisionsArray)
  }

  // ── Auto-import: send server-computed seeder decisions straight to confirm ──
  async function handleAutoImport() {
    if (!autoDecisions || autoDecisions.length === 0) {
      toast?.error('Auto-decisions not available — use manual import.')
      return
    }
    await onConfirm(sessionId, autoDecisions)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 pb-28">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b border-gray-700/40 bg-gray-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 sm:px-6">
          <button
            id="import-back-button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-700 hover:text-white"
            aria-label="Go back"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-base font-semibold text-white">Review Import</h1>
            <p className="text-xs text-gray-400">
              {totalRows} rows found ·{' '}
              <span className="text-emerald-400">{cleanRows.length} clean</span> ·{' '}
              <span className="text-yellow-400">{flaggedRows.length} need review</span>
            </p>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-6">

        {/* Auto-import banner */}
        {autoDecisions && autoDecisions.length > 0 && (
          <div className="rounded-xl bg-emerald-500/8 border border-emerald-500/25 px-4 py-4 flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20">
              <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-300">Auto-import with seeder defaults</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                Skips the review UI — applies the same smart defaults as the seeder script.
                Settlements auto-detected, inactive members removed, bad rows skipped.
              </p>
            </div>
            <button
              id="import-auto-button"
              onClick={handleAutoImport}
              className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              Auto-import →
            </button>
          </div>
        )}

        {/* Instruction banner */}
        <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/20 px-4 py-3.5 flex items-start gap-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-gray-200">Or review manually</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Flagged rows are pre-filled with seeder defaults. Change any you disagree with, then click <span className="font-medium text-white">Import</span>.
            </p>
          </div>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Rows', value: totalRows, color: 'text-white' },
            { label: 'Clean', value: cleanRows.length, color: 'text-emerald-400' },
            { label: 'Need Review', value: flaggedRows.length, color: 'text-yellow-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-2xl bg-gray-800/60 border border-gray-700/40 p-4 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Flagged rows ── */}
        {flaggedRows.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
              <svg className="h-4 w-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Flagged rows — resolve each issue below
            </h2>
            {flaggedRows.map((row) => (
              <FlaggedRowCard
                key={row.rowNumber}
                flaggedRow={row}
                rowDecisions={decisions[row.rowNumber]}
                onRowDecisionChange={handleRowDecisionChange}
              />
            ))}
          </section>
        )}

        {/* ── Clean rows accordion ── */}
        <CleanRowsAccordion cleanRows={cleanRows} />

        {flaggedRows.length === 0 && cleanRows.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 py-20 text-center">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-lg font-semibold text-white">No rows found</p>
            <p className="text-sm text-gray-400 mt-1">The CSV appears to be empty.</p>
          </div>
        )}
      </main>

      {/* ── Sticky action bar ── */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-700/60 bg-gray-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>
              <span className="font-semibold text-indigo-300">{stats.expenses}</span> expenses
            </span>
            <span>
              <span className="font-semibold text-blue-300">{stats.settlements}</span> settlements
            </span>
            <span>
              <span className="font-semibold text-gray-500">{stats.skipped}</span> skipped
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              id="import-cancel-button"
              onClick={onCancel}
              className="rounded-xl border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition hover:border-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              id="import-confirm-button"
              onClick={handleImport}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {importCount === 0
                ? 'Confirm (skip all) →'
                : `Import ${importCount} row${importCount !== 1 ? 's' : ''} →`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP: complete
// ─────────────────────────────────────────────────────────────────────────────

function CompleteStep({ importResult, groupId, onNavigate }) {
  const { imported, importedAsSettlements, skipped, errored, errors, sessionId } = importResult
  const [errorsOpen, setErrorsOpen] = useState(false)

  function downloadReport() {
    const blob = new Blob([JSON.stringify(importResult, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `import-report-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg text-center">
        {/* Success icon */}
        <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 shadow-lg shadow-emerald-500/10">
          <svg className="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        {/* Big number */}
        <p className="text-6xl font-extrabold text-white mb-1">{imported}</p>
        <p className="text-xl text-gray-400 mb-8">expenses imported</p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Settlements', value: importedAsSettlements, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
            { label: 'Skipped', value: skipped, color: 'text-gray-400', bg: 'bg-gray-700/40 border-gray-600/30' },
            { label: 'Errors', value: errored, color: errored > 0 ? 'text-red-400' : 'text-gray-500', bg: errored > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-gray-700/40 border-gray-600/30' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`rounded-2xl border p-4 ${bg}`}>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Errors expandable */}
        {errors?.length > 0 && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/5 overflow-hidden text-left">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-red-300 hover:bg-red-500/10 transition"
              onClick={() => setErrorsOpen((o) => !o)}
            >
              <span>{errors.length} row error{errors.length !== 1 ? 's' : ''}</span>
              <svg className={`h-4 w-4 transition-transform ${errorsOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {errorsOpen && (
              <ul className="border-t border-red-500/20 divide-y divide-red-500/10">
                {errors.map((e, i) => (
                  <li key={i} className="px-4 py-2.5 text-sm text-red-300">
                    <span className="font-semibold text-red-400">Row {e.rowNumber}:</span>{' '}
                    <span className="text-red-300/80">{e.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            id="import-view-group-button"
            onClick={() => onNavigate(`/groups/${groupId}`)}
            className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            View Group Expenses →
          </button>
          <button
            id="import-download-report-button"
            onClick={downloadReport}
            className="rounded-xl border border-gray-600 px-6 py-2.5 text-sm font-medium text-gray-300 transition hover:border-gray-400 hover:text-white"
          >
            Download Report
          </button>
        </div>

        {/* Session ID */}
        <p className="mt-6 text-xs text-gray-600">Session: {sessionId}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Root: ImportPage
// ─────────────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const { groupId } = useParams()
  const navigate = useNavigate()

  const [step, setStep] = useState('upload')           // 'upload' | 'previewing' | 'reviewing' | 'importing' | 'complete'
  const [previewData, setPreviewData] = useState(null)
  const [importResult, setImportResult] = useState(null)

  // ── Upload → preview ────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (file) => {
    setStep('previewing')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post(`/api/import/${groupId}/preview`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreviewData(res.data)
      setStep('reviewing')
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Failed to parse CSV. Please check the file format.'
      toast.error(msg)
      setStep('upload')
    }
  }, [groupId])

  // ── Confirm → import ────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async (sessionId, decisionsArray) => {
    setStep('importing')
    try {
      const res = await api.post(`/api/import/${groupId}/confirm`, {
        sessionId,
        decisions: decisionsArray,
      })
      setImportResult({ ...res.data, sessionId })
      setStep('complete')
      toast.success(`Imported ${res.data.imported} expense${res.data.imported !== 1 ? 's' : ''}!`)
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Import failed. Please try again.'
      toast.error(msg)
      setStep('reviewing')
    }
  }, [groupId])

  // ── Render by step ───────────────────────────────────────────────────────────
  if (step === 'upload') {
    return <UploadStep onSubmit={handleUpload} />
  }

  if (step === 'previewing') {
    return <LoadingStep message="Analysing your CSV…" sub="Running 15 data quality checks on every row" />
  }

  if (step === 'reviewing' && previewData) {
    return (
      <ReviewStep
        previewData={previewData}
        onConfirm={handleConfirm}
        onCancel={() => navigate(`/groups/${groupId}`)}
      />
    )
  }

  if (step === 'importing') {
    return <LoadingStep message="Importing your expenses…" sub="Writing to the database, please wait" />
  }

  if (step === 'complete' && importResult) {
    return (
      <CompleteStep
        importResult={importResult}
        groupId={groupId}
        onNavigate={navigate}
      />
    )
  }

  // Fallback — shouldn't happen
  return <LoadingStep message="Loading…" />
}
