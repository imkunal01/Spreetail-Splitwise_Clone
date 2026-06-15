import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import UnknownUserBanner from "../components/UnknownUserBanner";
import BalancesTab from "../components/BalancesTab";
import ThemeToggle from "../components/ThemeToggle";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function StatusBadge({ status }) {
    const isActive = status === "active";
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isActive
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-gray-600/30 text-gray-400"
                }`}
        >
            <span
                className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-400" : "bg-gray-500"
                    }`}
            />
            {isActive ? "Active" : "Left"}
        </span>
    );
}

// ─── Modal Wrapper ─────────────────────────────────────────────────────────────

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
                className="w-full max-w-md rounded-2xl bg-base border border-panel-border shadow-2xl animate-scale-in overflow-hidden relative"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
                
                <div className="flex items-center justify-between border-b border-panel-border px-6 py-5 bg-panel">
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
                <div className="p-6">
                    {children}
                </div>
            </div>
        </div>
    );
}

// ─── Add Member Modal ──────────────────────────────────────────────────────────

function AddMemberModal({ groupId, onClose, onSuccess }) {
    const today = new Date().toISOString().split("T")[0];
    const [email, setEmail] = useState("");
    const [joinedAt, setJoinedAt] = useState(today);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(e) {
        e.preventDefault();
        if (!email.trim()) {
            setError("Email is required");
            return;
        }
        setError("");
        setIsLoading(true);
        try {
            await api.post(`/api/groups/${groupId}/members`, {
                email: email.trim(),
                joinedAt,
            });
            toast.success("Member added successfully!");
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || "Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Modal title="Add Member" onClose={onClose}>
            <form id="add-member-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                        {error}
                    </div>
                )}

                <div>
                    <label htmlFor="add-member-email" className="mb-1.5 block text-sm font-medium text-secondary">
                        Email Address
                    </label>
                    <input
                        id="add-member-email"
                        type="email"
                        autoFocus
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="member@example.com"
                        className="w-full rounded-xl border border-panel-border bg-panel px-4 py-2.5 text-sm text-primary placeholder-muted transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                </div>

                <div>
                    <label htmlFor="add-member-joined" className="mb-1.5 block text-sm font-medium text-secondary">
                        Joined Date
                    </label>
                    <input
                        id="add-member-joined"
                        type="date"
                        value={joinedAt}
                        onChange={(e) => setJoinedAt(e.target.value)}
                        className="w-full rounded-xl border border-panel-border bg-panel px-4 py-2.5 text-sm text-primary transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                </div>

                <button
                    id="add-member-submit"
                    type="submit"
                    disabled={isLoading}
                    className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isLoading ? "Adding…" : "Add Member"}
                </button>
            </form>
        </Modal>
    );
}

// ─── Mark As Left Modal ────────────────────────────────────────────────────────

function MarkLeftModal({ groupId, member, onClose, onSuccess }) {
    const today = new Date().toISOString().split("T")[0];
    const [leftAt, setLeftAt] = useState(today);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(e) {
        e.preventDefault();

        // Client-side validation: leftAt >= joinedAt
        const leftDate = new Date(leftAt);
        const joinedDate = new Date(member.joinedAt);
        if (leftDate < joinedDate) {
            setError("Left date must be on or after the joined date.");
            return;
        }

        setError("");
        setIsLoading(true);
        try {
            await api.patch(`/api/groups/${groupId}/members/${member.id}/leave`, { leftAt });
            toast.success(`${member.name} marked as left.`);
            onSuccess();
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.error || "Something went wrong.");
            onClose();
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Modal title="Mark as Left" onClose={onClose}>
            <p className="mb-4 text-sm text-secondary">
                Mark{" "}
                <span className="font-medium text-primary">{member.name}</span> as having
                left the group.
            </p>

            <form id="mark-left-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                        {error}
                    </div>
                )}

                <div>
                    <label htmlFor="left-date-input" className="mb-1.5 block text-sm font-medium text-secondary">
                        Left Date
                    </label>
                    <input
                        id="left-date-input"
                        type="date"
                        value={leftAt}
                        onChange={(e) => setLeftAt(e.target.value)}
                        min={
                            member.joinedAt
                                ? new Date(member.joinedAt).toISOString().split("T")[0]
                                : undefined
                        }
                        className="w-full rounded-xl border border-panel-border bg-panel px-4 py-2.5 text-sm text-primary transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                    {member.joinedAt && (
                        <p className="mt-1 text-xs text-muted">
                            Joined: {formatDate(member.joinedAt)}
                        </p>
                    )}
                </div>

                <button
                    id="mark-left-submit"
                    type="submit"
                    disabled={isLoading}
                    className="w-full rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isLoading ? "Saving…" : "Confirm"}
                </button>
            </form>
        </Modal>
    );
}

// ─── Members Tab ───────────────────────────────────────────────────────────────

function MembersTab({ groupId, members, group, currentUserId, onRefetch }) {
    const [showAddModal, setShowAddModal] = useState(false);
    const [leaveTarget, setLeaveTarget] = useState(null);

    const callerMembership = members.find((m) => m.id === currentUserId);
    const isActiveMember = callerMembership?.status === "active";
    const isCreator = group?.createdById === currentUserId;

    return (
        <div>
            {/* Header row */}
            <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-muted">
                    {members.length} {members.length === 1 ? "member" : "members"}
                </p>
                {isActiveMember && (
                    <button
                        id="add-member-button"
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-600 hover:text-white hover:border-transparent"
                    >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Member
                    </button>
                )}
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-panel-border bg-panel shadow-sm backdrop-blur-sm">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-hover border-b border-panel-border">
                            <tr>
                                {["Name", "Email", "Joined", "Left", "Status", ""].map((h) => (
                                    <th
                                        key={h}
                                        className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-panel-border">
                            {members.map((m) => (
                                <tr key={`${m.id}-${m.joinedAt}`} className="transition hover:bg-hover">
                                    <td className="whitespace-nowrap px-4 py-3 font-medium text-primary">
                                        {m.name}
                                        {m.id === currentUserId && (
                                            <span className="ml-2 text-xs text-muted">(you)</span>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-secondary">{m.email}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-secondary">
                                        {formatDate(m.joinedAt)}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-secondary">
                                        {formatDate(m.leftAt)}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3">
                                        <StatusBadge status={m.status} />
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right">
                                        {m.status === "active" &&
                                            (isCreator || m.id === currentUserId) && (
                                                <button
                                                    id={`mark-left-${m.id}`}
                                                    onClick={() => setLeaveTarget(m)}
                                                    className="rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-400 transition hover:bg-rose-600 hover:text-white hover:border-transparent"
                                                >
                                                    Mark Left
                                                </button>
                                            )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modals */}
            {showAddModal && (
                <AddMemberModal
                    groupId={groupId}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={onRefetch}
                />
            )}
            {leaveTarget && (
                <MarkLeftModal
                    groupId={groupId}
                    member={leaveTarget}
                    onClose={() => setLeaveTarget(null)}
                    onSuccess={onRefetch}
                />
            )}
        </div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CURRENCIES = ["INR", "USD"];
const SPLIT_TYPES = ["EQUAL", "EXACT", "PERCENTAGE", "RATIO"];

const SPLIT_BADGE = {
    EQUAL: "bg-gray-600/40 text-gray-300",
    EXACT: "bg-blue-500/15 text-blue-400",
    PERCENTAGE: "bg-purple-500/15 text-purple-400",
    RATIO: "bg-orange-500/15 text-orange-400",
};

function fmtINR(n) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}
function fmtUSD(n) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}
function fmtExpenseDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Add Expense Modal ─────────────────────────────────────────────────────────

function AddExpenseModal({ groupId, members, onClose, onSuccess }) {
    const { user } = useAuth();
    const today = new Date().toISOString().split("T")[0];
    const activeMembers = members.filter((m) => m.status === "active");

    // ── Core fields ──
    const [description, setDescription] = useState("");
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState("INR");
    const [exchangeRate, setExchangeRate] = useState(1);
    const [liveRateNote, setLiveRateNote] = useState("");
    const [paidById, setPaidById] = useState(user?.id || "");
    const [date, setDate] = useState(today);
    const [splitType, setSplitType] = useState("EQUAL");

    // ── Per-member split values ──
    const initSplitValues = () =>
        Object.fromEntries(activeMembers.map((m) => [m.id, splitType === "RATIO" ? 1 : 0]));
    const [splitValues, setSplitValues] = useState(initSplitValues);
    // For EQUAL: track which members are checked
    const [equalChecked, setEqualChecked] = useState(
        Object.fromEntries(activeMembers.map((m) => [m.id, true]))
    );

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    // Derived
    const amountNum = parseFloat(amount) || 0;
    const rateNum = parseFloat(exchangeRate) || 1;
    const amountINR = Math.round(amountNum * rateNum * 100) / 100;

    // ── Fetch live USD→INR rate when USD selected ──
    useEffect(() => {
        if (currency !== "USD") {
            setExchangeRate(1);
            setLiveRateNote("");
            return;
        }
        setLiveRateNote("Fetching live rate…");
        api.get("/api/currency/convert?amount=1&from=USD")
            .then((res) => {
                const rate = res.data.rate;
                setExchangeRate(rate);
                setLiveRateNote(`Live rate · edit if needed`);
            })
            .catch(() => setLiveRateNote("Could not fetch live rate — enter manually"));
    }, [currency]);

    // Reset split values when splitType or members change
    useEffect(() => {
        setSplitValues(Object.fromEntries(activeMembers.map((m) => [m.id, splitType === "RATIO" ? 1 : 0])));
        setEqualChecked(Object.fromEntries(activeMembers.map((m) => [m.id, true])));
    }, [splitType]); // eslint-disable-line

    function setSplit(userId, val) {
        setSplitValues((prev) => ({ ...prev, [userId]: val }));
    }

    // ── Validation helpers ──
    const exactSum = activeMembers.reduce((s, m) => s + (parseFloat(splitValues[m.id]) || 0), 0);
    const pctSum = activeMembers.reduce((s, m) => s + (parseFloat(splitValues[m.id]) || 0), 0);
    const ratioSum = activeMembers.reduce((s, m) => s + (parseFloat(splitValues[m.id]) || 0), 0);
    const checkedCount = Object.values(equalChecked).filter(Boolean).length;

    const exactValid = Math.abs(exactSum - amountINR) <= 0.01;
    const pctValid = pctSum >= 99.99 && pctSum <= 100.01;
    const ratioValid = activeMembers.every((m) => (parseFloat(splitValues[m.id]) || 0) > 0);

    const submitDisabled =
        isLoading ||
        !description.trim() ||
        amountNum <= 0 ||
        (splitType === "EXACT" && !exactValid) ||
        (splitType === "PERCENTAGE" && !pctValid) ||
        (splitType === "RATIO" && !ratioValid);

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        let splitsArray = [];
        if (splitType === "EQUAL") {
            // server calculates — send empty
            splitsArray = [];
        } else if (splitType === "EXACT") {
            splitsArray = activeMembers.map((m) => ({ userId: m.id, value: parseFloat(splitValues[m.id]) || 0 }));
        } else if (splitType === "PERCENTAGE") {
            splitsArray = activeMembers.map((m) => ({ userId: m.id, value: parseFloat(splitValues[m.id]) || 0 }));
        } else if (splitType === "RATIO") {
            splitsArray = activeMembers.map((m) => ({ userId: m.id, value: parseFloat(splitValues[m.id]) || 1 }));
        }

        try {
            await api.post(`/api/groups/${groupId}/expenses`, {
                description: description.trim(),
                amount: amountNum,
                currency,
                exchangeRate: rateNum,
                paidById,
                date,
                splitType,
                splits: splitsArray,
                notes: "",
            });
            toast.success("Expense added!");
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || "Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    const inputCls = "w-full rounded-xl border border-panel-border bg-panel px-4 py-2.5 text-sm text-primary placeholder-muted transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";
    const labelCls = "mb-1.5 block text-sm font-medium text-secondary";

    return (
        <Modal title="Add Expense" onClose={onClose}>
            {/* Make modal scrollable for the tall split section */}
            <div className="max-h-[80vh] overflow-y-auto pr-1">
                <form id="add-expense-form" onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Description */}
                    <div>
                        <label className={labelCls}>Description</label>
                        <input
                            id="expense-description"
                            type="text"
                            autoFocus
                            required
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="e.g. Dinner at La Piazza"
                            className={inputCls}
                        />
                    </div>

                    {/* Amount + Currency */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>Amount</label>
                            <input
                                id="expense-amount"
                                type="number"
                                min="0.01"
                                step="0.01"
                                required
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0.00"
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Currency</label>
                            <div className="flex gap-2 pt-1">
                                {CURRENCIES.map((c) => (
                                    <label key={c} className="flex cursor-pointer items-center gap-1.5">
                                        <input
                                            type="radio"
                                            name="currency"
                                            value={c}
                                            checked={currency === c}
                                            onChange={() => setCurrency(c)}
                                            className="accent-indigo-500"
                                        />
                                        <span className="text-sm text-secondary">{c}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Exchange rate (USD only) */}
                    {currency === "USD" && (
                        <div>
                            <label className={labelCls}>Exchange Rate (1 USD = ? INR)</label>
                            <input
                                id="expense-rate"
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={exchangeRate}
                                onChange={(e) => setExchangeRate(e.target.value)}
                                className={inputCls}
                            />
                            {liveRateNote && (
                                <p className="mt-1 text-xs text-muted">{liveRateNote}</p>
                            )}
                            {amountNum > 0 && (
                                <p className="mt-1 text-xs text-indigo-400">
                                    ≈ {fmtINR(amountINR)}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Paid by */}
                    <div>
                        <label className={labelCls}>Paid By</label>
                        <select
                            id="expense-paidby"
                            value={paidById}
                            onChange={(e) => setPaidById(e.target.value)}
                            className={inputCls}
                        >
                            {activeMembers.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name}{m.id === user?.id ? " (you)" : ""}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Date */}
                    <div>
                        <label className={labelCls}>Date</label>
                        <input
                            id="expense-date"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className={inputCls}
                        />
                    </div>

                    {/* Split type */}
                    <div>
                        <label className={labelCls}>Split Type</label>
                        <div className="flex flex-wrap gap-2">
                            {SPLIT_TYPES.map((t) => (
                                <label key={t} className="flex cursor-pointer items-center gap-1.5">
                                    <input
                                        type="radio"
                                        name="splitType"
                                        value={t}
                                        checked={splitType === t}
                                        onChange={() => setSplitType(t)}
                                        className="accent-indigo-500"
                                    />
                                    <span className="text-sm text-secondary">{t}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* ── Split section ── */}
                    <div className="rounded-xl border border-panel-border bg-hover p-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Split Among</p>

                        {splitType === "EQUAL" && (
                            <>
                                {activeMembers.map((m) => (
                                    <label key={m.id} className="flex cursor-pointer items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={equalChecked[m.id] ?? true}
                                                disabled={m.id === paidById}
                                                onChange={(e) =>
                                                    setEqualChecked((prev) => ({ ...prev, [m.id]: e.target.checked }))
                                                }
                                                className="accent-indigo-500"
                                            />
                                            <span className="text-sm text-secondary">{m.name}</span>
                                        </div>
                                    </label>
                                ))}
                                <p className="text-xs text-indigo-400">
                                    Each owes {checkedCount > 0 ? fmtINR(amountINR / checkedCount) : "—"}
                                </p>
                            </>
                        )}

                        {splitType === "EXACT" && (
                            <>
                                {activeMembers.map((m) => (
                                    <div key={m.id} className="flex items-center gap-3">
                                        <span className="w-28 truncate text-sm text-secondary">{m.name}</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={splitValues[m.id] ?? 0}
                                            onChange={(e) => setSplit(m.id, e.target.value)}
                                            className="w-full rounded-lg border border-panel-border bg-panel px-3 py-1.5 text-sm text-primary focus:border-indigo-500 focus:outline-none"
                                        />
                                    </div>
                                ))}
                                <p className={`text-xs font-medium ${exactValid ? "text-emerald-400" : "text-red-400"}`}>
                                    {fmtINR(exactSum)} assigned of {fmtINR(amountINR)}
                                </p>
                            </>
                        )}

                        {splitType === "PERCENTAGE" && (
                            <>
                                {activeMembers.map((m) => (
                                    <div key={m.id} className="flex items-center gap-3">
                                        <span className="w-28 truncate text-sm text-secondary">{m.name}</span>
                                        <div className="relative flex-1">
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                step="0.01"
                                                value={splitValues[m.id] ?? 0}
                                                onChange={(e) => setSplit(m.id, e.target.value)}
                                                className="w-full rounded-lg border border-panel-border bg-panel py-1.5 pl-3 pr-8 text-sm text-primary focus:border-indigo-500 focus:outline-none"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                                        </div>
                                    </div>
                                ))}
                                <p className={`text-xs font-medium ${pctValid ? "text-emerald-400" : "text-red-400"}`}>
                                    {pctSum.toFixed(2)}% of 100%
                                </p>
                            </>
                        )}

                        {splitType === "RATIO" && (
                            <>
                                {activeMembers.map((m) => (
                                    <div key={m.id} className="flex items-center gap-3">
                                        <span className="w-28 truncate text-sm text-secondary">{m.name}</span>
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            value={splitValues[m.id] ?? 1}
                                            onChange={(e) => setSplit(m.id, e.target.value)}
                                            className="w-20 rounded-lg border border-panel-border bg-panel px-3 py-1.5 text-sm text-primary focus:border-indigo-500 focus:outline-none"
                                        />
                                        <span className="text-xs text-indigo-400">
                                            = {ratioSum > 0 ? fmtINR(((parseFloat(splitValues[m.id]) || 1) / ratioSum) * amountINR) : "—"}
                                        </span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    <button
                        id="add-expense-submit"
                        type="submit"
                        disabled={submitDisabled}
                        className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isLoading ? "Adding…" : "Add Expense"}
                    </button>
                </form>
            </div>
        </Modal>
    );
}

// ─── Expenses Tab ──────────────────────────────────────────────────────────────

function ExpensesTab({ groupId, members, group, currentUserId }) {
    const [expenses, setExpenses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);

    const fetchExpenses = useCallback(async () => {
        try {
            const res = await api.get(`/api/groups/${groupId}/expenses`);
            setExpenses(res.data.expenses);
        } catch {
            toast.error("Failed to load expenses");
        } finally {
            setIsLoading(false);
        }
    }, [groupId]);

    useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

    async function handleDelete(expenseId) {
        if (!window.confirm("Delete this expense?")) return;
        try {
            await api.delete(`/api/groups/${groupId}/expenses/${expenseId}`);
            toast.success("Expense deleted");
            setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
        } catch (err) {
            toast.error(err.response?.data?.error || "Failed to delete expense");
        }
    }

    function formatAmount(expense) {
        const inr = parseFloat(expense.amountInr);
        if (expense.currency === "INR") return fmtINR(inr);
        const orig = parseFloat(expense.amount);
        return `${fmtUSD(orig)} (${fmtINR(inr)})`;
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="mb-5 flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold text-primary">Expenses</h2>
                    <p className="text-xs text-muted mt-0.5">
                        {expenses.length === 0
                            ? "No expenses yet — add one or import a CSV"
                            : `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"} logged`
                        }
                    </p>
                </div>
                <button
                    id="add-expense-button"
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Expense
                </button>
            </div>

            {expenses.length === 0 ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-panel-border bg-panel py-24 text-center backdrop-blur-sm shadow-inner">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-hover border border-panel-border mb-5 shadow-sm">
                        <div className="text-3xl mt-1">🧾</div>
                    </div>
                    <h2 className="mb-2 text-xl font-bold text-primary font-display tracking-tight">No expenses yet</h2>
                    <p className="mb-8 max-w-sm text-sm text-muted leading-relaxed">
                        Add your first expense to start tracking who owes what.
                    </p>
                    <button
                        id="add-expense-empty-button"
                        onClick={() => setShowAddModal(true)}
                        className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
                    >
                        Add Expense
                    </button>
                </div>
            ) : (
                /* Expense table */
                <div className="overflow-hidden rounded-2xl border border-panel-border bg-panel shadow-sm backdrop-blur-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-hover border-b border-panel-border">
                                <tr>
                                    {["Date", "Description", "Paid By", "Amount", "Split", ""].map((h) => (
                                        <th key={h} className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-panel-border">
                                {expenses.map((exp) => {
                                    const canDelete =
                                        exp.paidBy?.id === currentUserId ||
                                        group?.createdById === currentUserId;
                                    return (
                                        <tr key={exp.id} className="transition hover:bg-hover">
                                            {/* Date */}
                                            <td className="whitespace-nowrap px-4 py-3 text-secondary">
                                                {fmtExpenseDate(exp.date)}
                                            </td>
                                            {/* Description */}
                                            <td className="px-4 py-3 font-medium text-primary">
                                                <span title={exp.description}>
                                                    {exp.description.length > 40
                                                        ? exp.description.slice(0, 40) + "…"
                                                        : exp.description}
                                                </span>
                                                {exp.isRefund && (
                                                    <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-500">
                                                        Refund
                                                    </span>
                                                )}
                                            </td>
                                            {/* Paid By */}
                                            <td className="whitespace-nowrap px-4 py-3">
                                                {exp.paidBy?.isGuest ? (
                                                    <span className="font-medium text-amber-500">
                                                        Unknown User
                                                    </span>
                                                ) : (
                                                    <span className="text-secondary">
                                                        {exp.paidBy?.name}
                                                        {exp.paidBy?.id === currentUserId && (
                                                            <span className="ml-1.5 text-xs text-muted">(you)</span>
                                                        )}
                                                    </span>
                                                )}
                                            </td>
                                            {/* Amount */}
                                            <td className="whitespace-nowrap px-4 py-3 font-medium text-primary">
                                                {formatAmount(exp)}
                                            </td>
                                            {/* Split type */}
                                            <td className="whitespace-nowrap px-4 py-3">
                                                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${SPLIT_BADGE[exp.splitType] || SPLIT_BADGE.EQUAL}`}>
                                                    {exp.splitType}
                                                </span>
                                            </td>
                                            {/* Actions */}
                                            <td className="whitespace-nowrap px-4 py-3 text-right">
                                                {canDelete && (
                                                    <button
                                                        id={`delete-expense-${exp.id}`}
                                                        onClick={() => handleDelete(exp.id)}
                                                        className="rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-400 transition hover:bg-rose-600 hover:text-white hover:border-transparent"
                                                    >
                                                        Delete
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {/* Unknown-payer banner rows — separate pass so each <tr> is a valid tbody sibling */}
                                {expenses.filter((exp) => exp.paidBy?.isGuest).map((exp) => (
                                    <tr key={`${exp.id}-banner`}>
                                        <td colSpan={6} className="px-4 pb-3 pt-0 bg-gray-800/30">
                                            <UnknownUserBanner
                                                expense={exp}
                                                groupId={groupId}
                                                members={members.filter(
                                                    (m) => !m.isGuest && m.status === "active"
                                                )}
                                                onReassigned={fetchExpenses}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {showAddModal && (
                <AddExpenseModal
                    groupId={groupId}
                    members={members}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={fetchExpenses}
                />
            )}
        </div>
    );
}


// ─── Balances Tab ──────────────────────────────────────────────────────────────
// Moved to Client/src/components/BalancesTab.jsx — imported above.

// ─── GroupDetail ───────────────────────────────────────────────────────────────

const TABS = [
    { id: "Expenses",  label: "Expenses",  sub: "All logged costs" },
    { id: "Balances",  label: "Balances",  sub: "Who owes whom" },
    { id: "Members",   label: "Members",   sub: "Manage the group" },
];

export default function GroupDetail() {
    const { groupId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("Expenses");

    const fetchGroup = useCallback(async () => {
        try {
            const res = await api.get(`/api/groups/${groupId}`);
            setData(res.data);
        } catch (err) {
            if (err.response?.status === 403) {
                toast.error("You are not a member of this group.");
                navigate("/dashboard");
            } else {
                toast.error("Failed to load group.");
            }
        } finally {
            setIsLoading(false);
        }
    }, [groupId, navigate]);

    useEffect(() => {
        fetchGroup();
    }, [fetchGroup]);

    async function handleDownloadImportReport() {
        try {
            const res = await api.get(`/api/import/${groupId}/report`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `import_report_${groupId}.csv`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
        } catch (err) {
            toast.error("Failed to download import report or no report available.");
        }
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
                    <p className="text-sm text-gray-400">Loading group…</p>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const { group, members } = data;

    return (
        <div className="min-h-screen bg-base text-primary font-sans selection:bg-indigo-500/30 selection:text-indigo-500 relative">
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/10 via-base to-base pointer-events-none" />
            
            {/* ── Navbar ── */}
            <header className="sticky top-0 z-40 border-b border-panel-border bg-base/80 backdrop-blur-xl">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/dashboard"
                            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-hover hover:text-primary"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                            </svg>
                            Dashboard
                        </Link>
                        <span className="text-panel-border">/</span>
                        <span className="text-sm font-bold text-primary truncate font-display">{group.name}</span>
                    </div>
                    <ThemeToggle />
                </div>
            </header>

            {/* ── Group Header ── */}
            <div className="relative z-10 mx-auto max-w-7xl px-4 pt-8 pb-6 sm:px-6 animate-fade-in">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-3">
                        <h1 className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl font-display">
                            {group.name}
                        </h1>
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-hover border border-panel-border px-3 py-1 text-xs font-bold uppercase tracking-wider text-secondary shadow-sm">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                {members.length} {members.length === 1 ? "member" : "members"}
                            </span>
                            <span className="text-xs font-medium text-muted">·</span>
                            <span className="text-xs font-medium text-muted">Created {formatDate(group.createdAt)}</span>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 self-start mt-2 sm:mt-0">
                        <button
                            id="download-import-report-button"
                            onClick={handleDownloadImportReport}
                            className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-300 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/40 hover:shadow-[0_0_15px_rgba(16,185,129,0.1)] focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Report
                        </button>
                        <button
                            id="import-csv-button"
                            onClick={() => navigate(`/groups/${groupId}/import`)}
                            className="flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5 text-sm font-bold text-indigo-300 transition-all hover:bg-indigo-500/20 hover:border-indigo-500/40 hover:shadow-[0_0_15px_rgba(99,102,241,0.1)] focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            Import CSV
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Tabs ── */}
            <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 animate-slide-up" style={{animationDelay: '50ms'}}>
                <div className="flex border-b border-panel-border overflow-x-auto no-scrollbar">
                    {TABS.map(({ id, label, sub }) => (
                        <button
                            key={id}
                            id={`tab-${id.toLowerCase()}`}
                            onClick={() => setActiveTab(id)}
                            className={`relative flex flex-col items-start px-5 py-4 text-left transition-colors whitespace-nowrap ${
                                activeTab === id
                                    ? "text-primary"
                                    : "text-muted hover:text-secondary"
                            }`}
                        >
                            <span className={`text-sm font-bold ${activeTab === id ? 'font-display tracking-tight' : ''}`}>{label}</span>
                            <span className={`text-[11px] font-semibold mt-1 uppercase tracking-wider ${activeTab === id ? "text-indigo-500" : "text-muted"}`}>{sub}</span>
                            {activeTab === id && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Tab Content ── */}
            <main className="mx-auto max-w-7xl px-4 py-6 pb-16 sm:px-6">
                {activeTab === "Expenses" && (
                    <ExpensesTab
                        groupId={groupId}
                        members={members}
                        group={group}
                        currentUserId={user?.id}
                    />
                )}
                {activeTab === "Balances" && (
                    <BalancesTab
                        groupId={groupId}
                        currentUserId={user?.id}
                        onSwitchToExpenses={() => setActiveTab("Expenses")}
                    />
                )}
                {activeTab === "Members" && (
                    <MembersTab
                        groupId={groupId}
                        members={members}
                        group={group}
                        currentUserId={user?.id}
                        onRefetch={fetchGroup}
                    />
                )}
            </main>
        </div>
    );
}
