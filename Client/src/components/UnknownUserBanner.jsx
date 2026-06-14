import { useState } from "react";
import { toast } from "react-hot-toast";
import api from "../api/axios";

// ─────────────────────────────────────────────────────────────────────────────
// UnknownUserBanner
//
// Renders a compact amber warning banner when an expense was paid by the
// "Unknown User" guest placeholder (isGuest === true).
// Lets anyone with access to the expense select a real member and reassign.
//
// Props:
//   expense      – full expense object; must include expense.paidBy.isGuest
//   groupId      – string UUID
//   members      – [{ id, name }] — real members only (isGuest === false)
//   onReassigned – callback fired after a successful reassign
// ─────────────────────────────────────────────────────────────────────────────

export default function UnknownUserBanner({ expense, groupId, members, onReassigned }) {
    const [selectedId, setSelectedId] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Only render when the expense payer is a guest / unknown placeholder
    if (!expense?.paidBy?.isGuest) return null;

    const realMembers = (members || []).filter((m) => !m.isGuest);
    const selectedMember = realMembers.find((m) => m.id === selectedId);

    async function handleAssign() {
        if (!selectedId) return;
        setIsLoading(true);
        try {
            await api.patch(
                `/api/groups/${groupId}/expenses/${expense.id}/reassign`,
                { newPayerId: selectedId }
            );
            toast.success(`Expense reassigned to ${selectedMember?.name}`);
            onReassigned?.();
        } catch (err) {
            toast.error(err.response?.data?.error || "Failed to reassign expense.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div
            role="alert"
            className="unknown-user-banner flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 mt-1"
            style={{ backgroundColor: "rgba(245,158,11,0.06)" }}
        >
            {/* Icon */}
            <span className="flex-shrink-0 text-amber-400 text-base leading-none select-none" aria-hidden="true">
                ⚠
            </span>

            {/* Message + controls */}
            <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
                <span className="text-xs font-medium text-amber-300 whitespace-nowrap">
                    Payer unknown for this expense.
                </span>

                {/* Dropdown */}
                <select
                    id={`reassign-select-${expense.id}`}
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    disabled={isLoading}
                    className="
                        rounded-lg border border-amber-500/30 bg-gray-900
                        px-2.5 py-1 text-xs text-gray-200
                        focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/40
                        disabled:cursor-not-allowed disabled:opacity-50
                        [color-scheme:dark]
                        max-w-[160px]
                    "
                    aria-label="Assign expense to member"
                >
                    <option value="" disabled>
                        Assign to…
                    </option>
                    {realMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.name}
                        </option>
                    ))}
                </select>

                {/* Assign button */}
                <button
                    id={`reassign-btn-${expense.id}`}
                    onClick={handleAssign}
                    disabled={!selectedId || isLoading}
                    className="
                        inline-flex items-center gap-1.5 rounded-lg
                        border border-amber-500/40 bg-amber-500/10
                        px-2.5 py-1 text-xs font-semibold text-amber-300
                        transition-all duration-150
                        hover:bg-amber-500 hover:text-gray-900 hover:border-transparent
                        focus:outline-none focus:ring-2 focus:ring-amber-400/50
                        disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent
                        disabled:hover:text-amber-300 disabled:hover:border-amber-500/40
                        whitespace-nowrap
                    "
                    aria-label={selectedMember ? `Assign expense to ${selectedMember.name}` : "Assign expense"}
                >
                    {isLoading ? (
                        <>
                            {/* Spinner */}
                            <svg
                                className="h-3 w-3 animate-spin"
                                fill="none"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                            >
                                <circle
                                    className="opacity-25"
                                    cx="12" cy="12" r="10"
                                    stroke="currentColor" strokeWidth="4"
                                />
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8v8H4z"
                                />
                            </svg>
                            Assigning…
                        </>
                    ) : (
                        "Assign"
                    )}
                </button>
            </div>
        </div>
    );
}
