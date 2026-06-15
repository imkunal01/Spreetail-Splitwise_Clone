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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-2xl bg-gray-900 border border-gray-700/60 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">{title}</h2>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-700 hover:text-white"
                        aria-label="Close modal"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {children}
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
                <p className="py-8 text-center text-sm text-gray-400">
                    No expense data available for this member.
                </p>
            ) : (
                <div className="max-h-[60vh] overflow-y-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                {["Date", "Description", "Amount Owed"].map((h) => (
                                    <th
                                        key={h}
                                        className="pb-2.5 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 last:text-right last:pr-0"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/40">
                            {entries.map((e, i) => (
                                <tr key={i} className="hover:bg-gray-800/30">
                                    <td className="whitespace-nowrap py-2.5 pr-4 text-gray-400">
                                        {fmtDate(e.date)}
                                    </td>
                                    <td className="py-2.5 pr-4 text-gray-200">
                                        <span>
                                            {e.description.length > 34
                                                ? e.description.slice(0, 34) + "…"
                                                : e.description}
                                        </span>
                                        {e.isRefund && (
                                            <span className="ml-1.5 text-xs font-semibold text-emerald-400">
                                                (refund)
                                            </span>
                                        )}
                                    </td>
                                    <td
                                        className={`whitespace-nowrap py-2.5 text-right font-medium ${
                                            e.isRefund ? "text-emerald-400" : "text-white"
                                        }`}
                                    >
                                        {fmtINR(e.amountOwed)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-gray-600">
                                <td className="pt-3 text-xs font-bold uppercase tracking-wider text-gray-400">
                                    Total
                                </td>
                                <td />
                                <td className="pt-3 text-right text-base font-bold text-white">
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
        return (
            <div className="flex items-center justify-between rounded-xl border border-gray-700/40 bg-gray-800/20 px-4 py-3">
                <div className="flex items-center gap-2.5">
                    <span className="text-base">👤</span>
                    <span className="text-sm font-medium text-gray-500 italic">
                        Unknown User
                    </span>
                    <span className="rounded-full bg-gray-700/60 px-2 py-0.5 text-xs text-gray-500">
                        unassigned expenses
                    </span>
                </div>
                <span className="text-sm font-semibold text-gray-500">
                    {fmtINR(balance)}
                </span>
            </div>
        );
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

    return (
        <button
            id={`balance-card-${member.userId}`}
            onClick={onClick}
            className={`w-full text-left rounded-xl bg-gray-800/50 px-4 py-3 transition hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${borderClass}`}
        >
            <div className="flex items-center justify-between">
                <span className="font-medium text-white">
                    {name}
                    {isYou && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                </span>
                <span className={`text-sm font-semibold ${amountClass}`}>
                    {statusText}
                </span>
            </div>
            {!isSettled && (
                <p className="mt-0.5 text-xs text-gray-500">Click to see breakdown</p>
            )}
        </button>
    );
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
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 flex items-start gap-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-gray-400">
                    <span className="font-medium text-gray-200">How balances work: </span>
                    Positive = the group owes them money. Negative = they owe the group.
                    Click any card to see their expense breakdown.
                </p>
            </div>

            {/* ── Section B: Net Balances ───────────────────────────────────── */}
            <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
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
                        <p className="py-8 text-center text-sm text-gray-500">
                            No balance data yet. Add some expenses first.
                        </p>
                    )}
                </div>
            </div>

            {/* ── Section C: Suggested Payments ────────────────────────────── */}
            <div>
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                        How to settle up
                    </h2>
                    <span className="text-xs text-gray-600">Minimised transactions</span>
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
                        <p className="text-sm font-semibold text-amber-300">
                            Settlement suggestions pending
                        </p>
                        <p className="mt-1 text-xs text-gray-400 max-w-xs">
                            Reassign the unknown-payer expenses first,
                            then come back to see who should pay whom.
                        </p>
                    </div>
                ) : (
                    /* Transaction list */
                    <div className="overflow-hidden rounded-2xl border border-gray-700/40">
                        {transactions.map((tx, i) => {
                            const txKey = `${tx.fromUserId}-${tx.toUserId}`;
                            const isSettling = settlingTx === txKey;
                            return (
                                <div
                                    key={i}
                                    className="flex items-center justify-between border-b border-gray-700/40 px-5 py-4 last:border-b-0 bg-gray-800/30 hover:bg-gray-800/60 transition"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        {/* Payer */}
                                        <span className="font-medium text-white truncate max-w-[120px]" title={tx.fromName}>
                                            {tx.fromName}
                                        </span>
                                        {/* Arrow */}
                                        <svg className="h-4 w-4 flex-shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                        </svg>
                                        {/* Payee */}
                                        <span className="font-medium text-white truncate max-w-[120px]" title={tx.toName}>
                                            {tx.toName}
                                        </span>
                                        {/* Amount */}
                                        <span className="flex-shrink-0 font-semibold text-indigo-300">
                                            {fmtINR(tx.amount)}
                                        </span>
                                    </div>

                                    <button
                                        id={`settle-${txKey}`}
                                        onClick={() => handleSettle(tx)}
                                        disabled={isSettling}
                                        className="ml-4 flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-600 hover:text-white hover:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSettling ? (
                                            <>
                                                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                                </svg>
                                                Recording…
                                            </>
                                        ) : (
                                            "Mark Settled"
                                        )}
                                    </button>
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
