import { useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import api from '../api/axios'
import ThemeToggle from '../components/ThemeToggle'

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
    return 'bg-gray-600/40 text-slate-500 border-slate-300/40'
  return 'bg-gray-600/30 text-slate-600 border-slate-300/30'
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

function UploadStep({ onSubmit, onDirectImport }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isDirectLoading, setIsDirectLoading] = useState(false)
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

  async function handleDirect() {
    if (!selectedFile) return
    setIsDirectLoading(true)
    try {
      await onDirectImport(selectedFile)
    } finally {
      setIsDirectLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base text-primary font-sans selection:bg-indigo-500/30 selection:text-indigo-500 relative transition-colors duration-300">
      {/* Navbar */}
      <header className="border-b border-panel-border bg-panel/70 backdrop-blur-xl relative z-10">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3.5 sm:px-6">
          <button onClick={() => window.history.back()}
            className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-primary transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            Back to group
          </button>
          
          <div className="flex items-center gap-4">
            {/* Step indicator */}
            <div className="hidden sm:flex items-center gap-2">
              {['Upload', 'Review', 'Done'].map((s, i) => (
                <span key={s} className={`text-xs font-bold uppercase tracking-wider ${ i === 0 ? 'text-indigo-500' : 'text-muted' }`}>
                  {i > 0 && <span className="mr-2 text-panel-border">/</span>}{s}
                </span>
              ))}
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="relative z-10 flex items-center justify-center px-4 py-12 animate-fade-in">
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 shadow-inner">
              <svg className="h-7 w-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <h1 className="text-3xl font-extrabold text-primary font-display tracking-tight">Import expenses</h1>
            <p className="mt-3 text-sm text-secondary leading-relaxed">
              Upload your CSV — we'll scan for issues before anything is saved.
            </p>
          </div>

          {/* Card */}
          <div className="rounded-2xl bg-panel border border-panel-border p-6 shadow-2xl backdrop-blur-sm">
            {/* Drop zone */}
            <div
              id="import-drop-zone"
              className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 cursor-pointer transition-all duration-300 ${
                dragging
                  ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02] shadow-[0_0_30px_rgba(99,102,241,0.15)]'
                  : selectedFile
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-panel-border hover:border-indigo-500/40 hover:bg-hover'
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
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner">
                    <svg className="h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="font-bold text-primary text-sm tracking-wide">{selectedFile.name}</p>
                  <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                    {(selectedFile.size / 1024).toFixed(1)} KB <span className="mx-1">·</span> Click to change
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-hover border border-panel-border shadow-sm">
                    <svg className="h-7 w-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>
                  <p className="font-bold text-primary">Drop your CSV here</p>
                  <p className="mt-1 text-xs font-semibold text-muted">or click to browse <span className="mx-1">·</span> .csv only</p>
                </>
              )}
            </div>

            {/* CSV format hint */}
            <div className="mt-5 rounded-xl bg-hover border border-panel-border px-5 py-4">
              <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Expected columns</p>
              <p className="font-mono text-xs text-secondary leading-relaxed break-words">
                date, description, paid_by, amount, currency,
                split_type, split_with, split_details, notes
              </p>
            </div>

            {/* Preview & Import (Highlighted) */}
            <button
              id="import-preview-button"
              disabled={!selectedFile || isLoading || isDirectLoading}
              onClick={handlePreview}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Uploading…
                </span>
              ) : 'Review & Import manually →'}
            </button>
            <p className="mt-2 mb-4 text-center text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
              Recommended: Safely review data before import
            </p>

            <div className="flex items-center gap-3 my-4">
              <div className="h-px flex-1 bg-panel-border" />
              <span className="text-[10px] uppercase font-bold text-muted">or bypass review</span>
              <div className="h-px flex-1 bg-panel-border" />
            </div>

            {/* Direct Import (Unhighlighted) */}
            <button
              id="import-direct-button"
              disabled={!selectedFile || isDirectLoading || isLoading}
              onClick={handleDirect}
              className="w-full rounded-xl border border-panel-border bg-panel py-3 text-sm font-bold text-secondary transition-all hover:bg-hover hover:text-primary focus:outline-none focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isDirectLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-secondary border-t-transparent" />
                  Importing…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Direct Import (Seeder Mode)
                </span>
              )}
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
    <div className="min-h-screen bg-base text-primary flex flex-col items-center justify-center gap-6 relative transition-colors duration-300">
      <div className="relative z-10 flex flex-col items-center animate-fade-in">
        <div className="relative mb-6">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-panel-border border-t-indigo-500" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 rounded-full bg-indigo-500/20 animate-pulse shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-xl font-extrabold text-primary font-display tracking-tight">{message}</p>
          {sub && <p className="mt-2 text-sm font-semibold text-secondary">{sub}</p>}
        </div>
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
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-4 shadow-sm backdrop-blur-sm">
      {/* Type badge + message */}
      <div className="flex flex-wrap items-start gap-3">
        <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${anomalyBadgeClass(anomaly.type)}`}>
          {anomaly.type.replaceAll('_', ' ')}
        </span>
        <p className="text-sm text-slate-300 leading-relaxed flex-1 min-w-0 font-medium">{anomaly.message}</p>
      </div>

      {/* Action selector */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 pl-1 pt-2 border-t border-white/5">
        {anomaly.options.map((option) => {
          const id = `${radioName}-${option}`
          const isSelected = (selectedAction ?? anomaly.defaultAction) === option
          return (
            <label
              key={option}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2.5 group"
            >
              <div className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-white/20 bg-transparent group-hover:border-white/40'}`}>
                {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
              <input
                id={id}
                type="radio"
                name={radioName}
                value={option}
                checked={isSelected}
                onChange={() => onActionChange(option)}
                className="hidden"
              />
              <span className={`text-xs font-bold transition-colors ${isSelected ? 'text-indigo-300' : 'text-slate-400 group-hover:text-slate-200'}`}>
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
    <div className="rounded-2xl border border-white/10 bg-[#020617]/50 overflow-hidden shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-white/5 px-5 py-4">
        <span className="inline-flex items-center rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
          Row {rowNumber}
        </span>
        <span className="text-base font-bold text-slate-200 truncate font-display">
          {rawData.description || <em className="text-slate-500">No description</em>}
        </span>
        <span className={`ml-auto text-[10px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider border ${
          anomalies.length === 1
            ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {anomalies.length} issue{anomalies.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Raw data preview */}
      <div className="px-5 py-4 border-b border-white/5 bg-white/[0.01]">
        <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">CSV data</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(previewFields).filter(([, v]) => v).map(([k, v]) => (
            <span key={k} className="font-mono text-xs bg-white/5 border border-white/10 rounded-md px-2.5 py-1 shadow-sm">
              <span className="text-slate-500">{k}:</span>{' '}
              <span className="text-slate-300 font-medium">{v}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Anomalies */}
      <div className="p-5 space-y-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Issues to resolve</p>
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
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden backdrop-blur-sm">
      <button
        id="clean-rows-toggle"
        className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-emerald-500/10 focus:outline-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
            {cleanRows.length} clean
          </span>
          <span className="text-sm font-bold text-emerald-300/80">
            rows ready to import
          </span>
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 transition-transform duration-300 ${open ? 'rotate-180 bg-emerald-500/20' : ''}`}>
          <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-emerald-500/10 custom-scrollbar pb-2">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-500/5">
              <tr>
                {['Row', 'Date', 'Description', 'Amount', 'Currency', 'Paid By'].map((h) => (
                  <th key={h} className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-wider text-emerald-500/60">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-500/10">
              {cleanRows.map(({ rowNumber, parsedData: pd }) => (
                <tr key={rowNumber} className="hover:bg-emerald-500/5 transition-colors">
                  <td className="px-5 py-3 text-xs font-medium text-slate-500">#{rowNumber}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-slate-400 font-medium">{fmtDate(pd?.date)}</td>
                  <td className="px-5 py-3 text-slate-200 font-medium max-w-xs truncate">{pd?.description || '—'}</td>
                  <td className="px-5 py-3 whitespace-nowrap font-bold text-emerald-400">
                    {pd?.amount != null ? Number(pd.amount).toLocaleString('en-IN') : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs font-bold text-slate-500">{pd?.currency || 'INR'}</td>
                  <td className="px-5 py-3 text-slate-400 font-medium">{pd?.paidById || '—'}</td>
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
    <div className="min-h-screen bg-base text-primary font-sans selection:bg-indigo-500/30 selection:text-indigo-500 pb-28 relative transition-colors duration-300">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b border-panel-border bg-panel/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-5">
            <button
              id="import-back-button"
              onClick={onCancel}
              className="rounded-xl p-2 text-muted transition-colors hover:bg-hover hover:text-primary"
              aria-label="Go back"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-extrabold text-primary font-display tracking-tight">Review Import</h1>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted mt-0.5">
                {totalRows} rows <span className="mx-1">·</span>{' '}
                <span className="text-emerald-500">{cleanRows.length} clean</span> <span className="mx-1">·</span>{' '}
                <span className="text-yellow-500">{flaggedRows.length} need review</span>
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* ── Body ── */}
      <main className="relative z-10 mx-auto max-w-4xl px-4 py-8 sm:px-6 space-y-6 animate-slide-up" style={{animationDelay: '50ms'}}>

        {/* Auto-import banner */}
        {autoDecisions && autoDecisions.length > 0 && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-5 py-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm backdrop-blur-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30">
              <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-emerald-300 font-display tracking-tight">Auto-import with seeder defaults</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500/70 mt-1 leading-relaxed">
                Skips review — applies smart defaults.
                Settlements auto-detected, inactive members removed, bad rows skipped.
              </p>
            </div>
            <button
              id="import-auto-button"
              onClick={handleAutoImport}
              className="shrink-0 rounded-xl bg-emerald-500/20 border border-emerald-500/30 px-5 py-2.5 text-sm font-bold text-emerald-300 transition-all hover:bg-emerald-500/30 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] focus:outline-none focus:ring-4 focus:ring-emerald-500/20 w-full sm:w-auto mt-2 sm:mt-0"
            >
              Auto-import →
            </button>
          </div>
        )}

        {/* Instruction banner */}
        <div className="rounded-2xl bg-indigo-500/5 border border-indigo-500/20 px-5 py-4 flex items-start gap-4 backdrop-blur-sm shadow-inner">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 mt-0.5">
            <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-200">Or review manually</p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-1 leading-relaxed">
              Flagged rows are pre-filled with seeder defaults. Change any you disagree with, then click <span className="font-bold text-indigo-400">Import</span>.
            </p>
          </div>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Rows', value: totalRows, color: 'text-primary' },
            { label: 'Clean', value: cleanRows.length, color: 'text-emerald-500' },
            { label: 'Need Review', value: flaggedRows.length, color: 'text-yellow-500' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-2xl bg-panel border border-panel-border p-5 text-center backdrop-blur-sm shadow-sm">
              <p className={`text-3xl font-extrabold ${color} font-display tracking-tight`}>{value}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mt-1.5">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Flagged rows ── */}
        {flaggedRows.length > 0 && (
          <section className="space-y-5">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-yellow-500/80 flex items-center gap-2">
              <svg className="h-4 w-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
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
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] py-24 text-center backdrop-blur-sm shadow-inner">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 mb-5 shadow-sm">
              <div className="text-3xl mt-1">📭</div>
            </div>
            <p className="text-xl font-bold text-white font-display tracking-tight">No rows found</p>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">The CSV appears to be empty.</p>
          </div>
        )}
      </main>

      {/* ── Sticky action bar ── */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-panel-border bg-panel/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-4 py-4 sm:px-6">
          {/* Stats */}
          <div className="flex items-center gap-5 text-[11px] font-bold uppercase tracking-wider text-muted">
            <span>
              <span className="text-indigo-500 text-sm font-extrabold">{stats.expenses}</span> expenses
            </span>
            <span>
              <span className="text-blue-500 text-sm font-extrabold">{stats.settlements}</span> settlements
            </span>
            <span>
              <span className="text-secondary text-sm font-extrabold">{stats.skipped}</span> skipped
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              id="import-cancel-button"
              onClick={onCancel}
              className="w-full sm:w-auto rounded-xl border border-panel-border bg-hover px-5 py-2.5 text-sm font-bold text-secondary transition-all hover:bg-panel-border hover:text-primary focus:outline-none focus:ring-4 focus:ring-slate-500/20"
            >
              Cancel
            </button>
            <button
              id="import-confirm-button"
              onClick={handleImport}
              className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
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
  const { imported, importedAsSettlements, skipped, errored, errors, sessionId, log } = importResult
  const [errorsOpen, setErrorsOpen] = useState(false)

  function downloadReport() {
    if (sessionId === 'direct' && log) {
      // Build CSV dynamically from the returned log data for direct mode
      const headers = ["Row Number", "Anomaly Type", "Action Taken", "Status", "Raw Data"];
      const rows = log.map(l => [
        l.rowNumber !== null ? l.rowNumber : "",
        l.anomalyType || "",
        l.actionTaken || "",
        l.status || "",
        l.rawData ? JSON.stringify(l.rawData).replace(/"/g, '""') : ""
      ]);
      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(v => `"${v}"`).join(","))
      ].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (!sessionId) {
      toast.error('CSV report is not available for this session.')
      return
    }
    const url = `/api/import/${groupId}/report?sessionId=${sessionId}`
    const a = document.createElement('a')
    a.href = url
    a.download = `import-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="min-h-screen bg-base text-primary flex flex-col items-center justify-center relative p-4 transition-colors duration-300">
      <div className="absolute top-4 right-4 z-50">
         <ThemeToggle />
      </div>
      <div className="w-full max-w-lg text-center relative z-10 animate-scale-in">
        {/* Success icon */}
        <div className="mb-6 inline-flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.15)] backdrop-blur-sm">
          <svg className="h-10 w-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        {/* Big number */}
        <p className="text-7xl font-extrabold text-primary mb-2 font-display tracking-tight">{imported}</p>
        <p className="text-sm font-bold uppercase tracking-wider text-muted mb-10">expenses imported</p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Settlements', value: importedAsSettlements, color: 'text-blue-500', bg: 'bg-blue-500/5 border-blue-500/20' },
            { label: 'Skipped', value: skipped, color: 'text-secondary', bg: 'bg-panel border-panel-border' },
            { label: 'Errors', value: errored, color: errored > 0 ? 'text-red-500' : 'text-secondary', bg: errored > 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-panel border-panel-border' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`rounded-2xl border p-5 backdrop-blur-sm shadow-sm ${bg}`}>
              <p className={`text-3xl font-extrabold font-display ${color}`}>{value}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mt-1.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Errors expandable */}
        {errors?.length > 0 && (
          <div className="mb-8 rounded-2xl border border-red-500/20 bg-red-500/5 overflow-hidden text-left backdrop-blur-sm">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-red-500 hover:bg-red-500/10 transition-colors focus:outline-none"
              onClick={() => setErrorsOpen((o) => !o)}
            >
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {errors.length} row error{errors.length !== 1 ? 's' : ''}
              </span>
              <div className={`flex h-6 w-6 items-center justify-center rounded-full bg-red-500/10 transition-transform duration-300 ${errorsOpen ? 'rotate-180 bg-red-500/20' : ''}`}>
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {errorsOpen && (
              <ul className="border-t border-red-500/10 divide-y divide-red-500/10 bg-red-500/[0.02]">
                {errors.map((e, i) => (
                  <li key={i} className="px-5 py-3 text-xs text-red-500/80">
                    <span className="font-bold text-red-500 uppercase tracking-wider text-[10px]">Row {e.rowNumber}:</span>{' '}
                    <span className="font-medium text-red-500/90 ml-1">{e.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row sm:justify-center gap-4">
          <button
            id="import-view-group-button"
            onClick={() => onNavigate(`/groups/${groupId}`)}
            className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition-all hover:shadow-emerald-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
          >
            View Group Expenses →
          </button>
          <button
            id="import-download-report-button"
            onClick={downloadReport}
            className="w-full sm:w-auto rounded-xl border border-panel-border bg-panel px-8 py-3.5 text-sm font-bold text-secondary transition-all hover:bg-hover hover:text-primary focus:outline-none focus:ring-4 focus:ring-slate-500/20"
          >
            Download Report
          </button>
        </div>

        {/* Session ID */}
        <p className="mt-8 text-[10px] font-bold uppercase tracking-wider text-muted">Session: {sessionId}</p>
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

  // ── Direct import (seeder mode) → bypasses preview/confirm entirely ────────
  const handleDirectImport = useCallback(async (file) => {
    setStep('importing')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post(`/api/import/${groupId}/direct`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImportResult({ ...res.data, sessionId: res.data.sessionId ?? 'direct' })
      setStep('complete')
      toast.success(`Imported ${res.data.imported} expense${res.data.imported !== 1 ? 's' : ''}!`)
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Direct import failed. Please try again.'
      toast.error(msg)
      setStep('upload')
    }
  }, [groupId])

  // ── Render by step ───────────────────────────────────────────────────────────
  if (step === 'upload') {
    return <UploadStep onSubmit={handleUpload} onDirectImport={handleDirectImport} />
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
