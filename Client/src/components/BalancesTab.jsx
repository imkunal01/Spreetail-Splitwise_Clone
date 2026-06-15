import { useState, useEffect, useCallback } from "react";
import { toast } from "react-hot-toast";
import api from "../api/axios";

// ─────────────────────────────────────────────────────────────────────────────
// Shared formatter
// ─────────────────────────────────────────────────────────────────────────────

function fmtINR(amount) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Math.abs(Number(amount)));
}

function fmtDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal wrapper (self-contained, mirrors GroupDetail's Modal)
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
    useEffect(() => {
        function handleKey(e) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-2xl bg-base border border-panel-border shadow-2xl animate-scale-in overflow-hidden relative"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
                
                <div className="mb-5 flex items-center justify-between border-b border-panel-border px-6 py-5 bg-panel">
                    <h2 className="text-lg font-bold text-primary font-display tracking-tight">{title}</h2>
                    <button
                        onClick={onClose}
                        className="rounded-xl p-2 text-muted hover:bg-hover hover:text-primary transition-colors"
                        aria-label="Close modal"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="p-6 pt-0">
                    {children}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExpenseBreakdownModal
// Shows the per-user expense breakdown when a balance card is clicked.
// ─────────────────────────────────────────────────────────────────────────────

function ExpenseBreakdownModal({ userName, entries = [], onClose }) {
    const total = entries.reduce((sum, e) => sum + Math.abs(Number(e.amountOwed)), 0);

    return (
        <Modal title={`${userName}'s breakdown`} onClose={onClose}>
            {entries.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                    No expense data available for this member.
                </p>
            ) : (
                <div className="max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-panel-border">
                                {["Date", "Description", "Amount Owed"].map((h) => (
                                    <th
                                        key={h}
                                        className="pb-3 pr-4 text-left text-[11px] font-bold uppercase tracking-wider text-muted last:text-right last:pr-0"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-panel-border">
                            {entries.map((e, i) => (
                                <tr key={i} className="hover:bg-hover transition-colors">
                                    <td className="whitespace-nowrap py-3.5 pr-4 text-secondary">
                                        {fmtDate(e.date)}
                                    </td>
                                    <td className="py-3.5 pr-4 text-primary font-medium">
                                        <span>
                                            {e.description.length > 34
                                                ? e.description.slice(0, 34) + "…"
                                                : e.description}
                                        </span>
                                        {e.isRefund && (
                                            <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                                                Refund
                                            </span>
                                        )}
                                    </td>
                                    <td
                                        className={`whitespace-nowrap py-3.5 text-right font-bold ${
                                            e.isRefund ? "text-emerald-500" : "text-primary"
                                        }`}
                                    >
                                        {fmtINR(e.amountOwed)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-panel-border">
                                <td className="pt-4 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                                    Total
                                </td>
                                <td />
                                <td className="pt-4 pb-2 text-right text-lg font-extrabold text-primary font-display">
                                    {fmtINR(total)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </Modal>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// BalanceCard
// Renders a single member's net balance as a clickable card.
// ─────────────────────────────────────────────────────────────────────────────

function BalanceCard({ member, isYou, onClick }) {
    const { name, balance, isGuest } = member;

    // Guest / unknown-user row
    if (isGuest) {
            <div className="flex items-center justify-between rounded-xl border border-panel-border bg-panel px-5 py-4 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-hover border border-panel-border shadow-sm">
                        <span className="text-xl">👤</span>
                    </div>
                    <div>
                        <span className="text-sm font-bold text-muted italic block">
                            Unknown User
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block mt-0.5">
                            unassigned expenses
                        </span>
                    </div>
                </div>
                <span className="text-base font-bold text-muted font-display">
                    {fmtINR(balance)}
                </span>
            </div>
    }

    const isOwed    = balance > 0.01;
    const isOwing   = balance < -0.01;
    const isSettled = !isOwed && !isOwing;

    const borderClass = isOwed
        ? "border-l-4 border-emerald-500"
        : isOwing
        ? "border-l-4 border-rose-500"
        : "border-l-4 border-gray-600";

    const amountClass = isOwed
        ? "text-emerald-400"
        : isOwing
        ? "text-rose-400"
        : "text-gray-400";

    const statusText = isOwed
        ? `is owed ${fmtINR(balance)}`
        : isOwing
        ? `owes ${fmtINR(Math.abs(balance))}`
        : "is settled up ✓";

        <button
            id={`balance-card-${member.userId}`}
            onClick={onClick}
            className={`w-full text-left rounded-xl bg-panel px-5 py-4 transition-all duration-300 hover:bg-hover hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${borderClass} border border-panel-border group backdrop-blur-sm`}
        >
            <div className="flex items-center justify-between">
                <span className="font-bold text-primary text-base font-display tracking-tight">
                    {name}
                    {isYou && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-muted bg-hover px-2 py-0.5 rounded-md border border-panel-border">(you)</span>}
                </span>
                <span className={`text-sm font-bold ${amountClass}`}>
                    {statusText}
                </span>
            </div>
            {!isSettled && (
                <p className="mt-1 text-xs font-medium text-muted opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-1 group-hover:translate-y-0 flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Click to see breakdown
                </p>
            )}
        </button>
}

// ─────────────────────────────────────────────────────────────────────────────
// BalancesTab (default export)
//
// Props:
//   groupId       – string UUID
//   currentUserId – string UUID of the logged-in user
// ─────────────────────────────────────────────────────────────────────────────

export default function BalancesTab({ groupId, currentUserId, onSwitchToExpenses }) {
    const [balanceData, setBalanceData]         = useState(null);
    const [isLoading, setIsLoading]             = useState(true);
    const [breakdownTarget, setBreakdownTarget] = useState(null); // { userId, name }
    const [settlingTx, setSettlingTx]           = useState(null); // tx being processed

    // ── Fetch ─────────────────────────────────────────────────────────────────
    const fetchBalances = useCallback(async () => {
        try {
            const res = await api.get(`/api/groups/${groupId}/balances`);
            setBalanceData(res.data);
        } catch {
            toast.error("Failed to load balances");
        } finally {
            setIsLoading(false);
        }
    }, [groupId]);

    useEffect(() => { fetchBalances(); }, [fetchBalances]);

    // ── Mark Settled ──────────────────────────────────────────────────────────
    async function handleSettle(tx) {
        setSettlingTx(`${tx.fromUserId}-${tx.toUserId}`);
        try {
            await api.post(`/api/groups/${groupId}/settlements`, {
                payerId: tx.fromUserId,
                payeeId: tx.toUserId,
                amount: tx.amount,
                date: new Date().toISOString().split("T")[0],
            });
            toast.success("Settlement recorded");
            await fetchBalances();
        } catch (err) {
            toast.error(err.response?.data?.error || "Failed to record settlement");
        } finally {
            setSettlingTx(null);
        }
    }

    // ── Loading state ──────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
        );
    }

    if (!balanceData) return null;

    const { netBalances = [], transactions = [], breakdown = {}, hasUnknownExpenses = false } = balanceData;

    // Separate guests from real members for display ordering
    const realMembers  = netBalances.filter((m) => !m.isGuest);
    const guestMembers = netBalances.filter((m) => m.isGuest);

    const breakdownEntries = breakdownTarget ? (breakdown[breakdownTarget.userId] || []) : [];

    return (
        <div className="space-y-7">

            {/* ── Section A: Unknown-payer warning ──────────────────────────── */}
            {hasUnknownExpenses && (
                <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-amber-500/30 px-4 py-3.5"
                    style={{ backgroundColor: "rgba(245,158,11,0.06)" }}
                >
                    <span className="mt-0.5 flex-shrink-0 text-lg text-amber-400 leading-none select-none">⚠</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-amber-300">
                            Some expenses have an unknown payer.
                        </p>
                        <p className="mt-0.5 text-xs text-amber-400/70">
                            Balances may be incomplete until those expenses are reassigned.
                        </p>
                        {onSwitchToExpenses && (
                            <button
                                onClick={onSwitchToExpenses}
                                className="mt-2 text-xs font-semibold text-amber-300 underline-offset-2 hover:underline"
                            >
                                Go to Expenses →
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── How balances work explainer ───────────────────────────────── */}
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 px-5 py-4 flex items-start gap-3 backdrop-blur-sm shadow-inner animate-fade-in">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 mt-0.5">
                    <svg className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <p className="text-sm text-secondary leading-relaxed pt-1">
                    <span className="font-bold text-primary uppercase tracking-wider text-xs block mb-0.5">How balances work</span>
                    Positive = the group owes them money. Negative = they owe the group.
                    Click any card to see their expense breakdown.
                </p>
            </div>

            {/* ── Section B: Net Balances ───────────────────────────────────── */}
            <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
                    Who owes what
                </h2>

                <div className="space-y-2">
                    {/* Real members first */}
                    {realMembers.map((m) => (
                        <BalanceCard
                            key={m.userId}
                            member={m}
                            isYou={m.userId === currentUserId}
                            onClick={() => setBreakdownTarget({ userId: m.userId, name: m.name })}
                        />
                    ))}

                    {/* Guest / unknown-user rows below, muted */}
                    {guestMembers.map((m) => (
                        <BalanceCard
                            key={m.userId}
                            member={m}
                            isYou={false}
                            onClick={() => {}} // not clickable — no real breakdown
                        />
                    ))}

                    {netBalances.length === 0 && (
                        <p className="py-8 text-center text-sm text-muted">
                            No balance data yet. Add some expenses first.
                        </p>
                    )}
                </div>
            </div>

            {/* ── Section C: Suggested Payments ────────────────────────────── */}
            <div>
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                        How to settle up
                    </h2>
                    <span className="text-xs text-secondary">Minimised transactions</span>
                </div>

                {transactions.length === 0 && !hasUnknownExpenses ? (
                    /* All settled — show celebration */
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-700/30 bg-emerald-500/5 py-12 text-center">
                        <div className="mb-2 text-4xl">🎉</div>
                        <p className="text-base font-semibold text-white">Everyone is settled up!</p>
                        <p className="mt-1 text-sm text-gray-400">No payments needed right now.</p>
                    </div>
                ) : transactions.length === 0 && hasUnknownExpenses ? (
                    /* Pending unknown reassignment */
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-amber-700/30 bg-amber-500/5 py-10 text-center">
                        <div className="mb-2 text-3xl">⏳</div>
                        <p className="text-sm font-semibold text-amber-500">
                            Settlement suggestions pending
                        </p>
                        <p className="mt-1 text-xs text-muted max-w-xs">
                            Reassign the unknown-payer expenses first,
                            then come back to see who should pay whom.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-2xl border border-panel-border bg-panel shadow-sm backdrop-blur-sm">
                        {transactions.map((tx, i) => {
                            const txKey = `${tx.fromUserId}-${tx.toUserId}`;
                            const isSettling = settlingTx === txKey;
                            return (
                                <div
                                    key={i}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-panel-border px-5 py-4.5 last:border-b-0 hover:bg-hover transition-colors gap-4 sm:gap-0"
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        {/* Payer */}
                                        <div className="flex items-center gap-2">
                                            <div className="h-8 w-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-500">
                                                {tx.fromName.charAt(0)}
                                            </div>
                                            <span className="font-bold text-primary truncate max-w-[100px] sm:max-w-[140px]" title={tx.fromName}>
                                                {tx.fromName}
                                            </span>
                                        </div>
                                        {/* Arrow */}
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-panel border border-panel-border mx-1">
                                            <svg className="h-3 w-3 flex-shrink-0 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                            </svg>
                                        </div>
                                        {/* Payee */}
                                        <div className="flex items-center gap-2">
                                            <div className="h-8 w-8 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-xs font-bold text-purple-500">
                                                {tx.toName.charAt(0)}
                                            </div>
                                            <span className="font-bold text-primary truncate max-w-[100px] sm:max-w-[140px]" title={tx.toName}>
                                                {tx.toName}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between sm:justify-end gap-5">
                                        {/* Amount */}
                                        <span className="font-extrabold text-primary text-lg font-display tracking-tight">
                                            {fmtINR(tx.amount)}
                                        </span>

                                        <button
                                            id={`settle-${txKey}`}
                                            onClick={() => handleSettle(tx)}
                                            disabled={isSettling}
                                            className="flex-shrink-0 inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/40 hover:shadow-[0_0_15px_rgba(16,185,129,0.1)] focus:outline-none focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {isSettling ? (
                                                <>
                                                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                                                    Recording…
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    Settle
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Breakdown modal ────────────────────────────────────────────── */}
            {breakdownTarget && (
                <ExpenseBreakdownModal
                    userName={breakdownTarget.name}
                    entries={breakdownEntries}
                    onClose={() => setBreakdownTarget(null)}
                />
            )}
        </div>
    );
}
