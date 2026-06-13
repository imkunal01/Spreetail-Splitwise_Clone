import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";

// ─── Skeleton Card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="animate-pulse rounded-2xl bg-gray-800/60 border border-gray-700/40 p-6 space-y-4">
            <div className="h-5 w-2/3 rounded-lg bg-gray-700" />
            <div className="h-4 w-1/3 rounded-lg bg-gray-700" />
            <div className="h-4 w-1/2 rounded-lg bg-gray-700" />
            <div className="h-9 w-full rounded-lg bg-gray-700 mt-4" />
        </div>
    );
}

// ─── Group Card ────────────────────────────────────────────────────────────────

function GroupCard({ group, onOpen }) {
    const isActive = group.userStatus === "active";

    return (
        <div className="group relative flex flex-col rounded-2xl bg-gray-800/60 border border-gray-700/40 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-indigo-500/50 hover:shadow-xl hover:shadow-indigo-500/10">
            {/* Status badge */}
            <div className="mb-4 flex items-center justify-between">
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

                <span className="text-xs text-gray-500">
                    {new Date(group.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                    })}
                </span>
            </div>

            {/* Group name */}
            <h3 className="mb-1 text-lg font-semibold text-white leading-snug group-hover:text-indigo-300 transition-colors">
                {group.name}
            </h3>

            {/* Member count */}
            <p className="mb-5 text-sm text-gray-400">
                <span className="font-medium text-gray-200">{group.memberCount}</span>{" "}
                {group.memberCount === 1 ? "member" : "members"}
            </p>

            {/* CTA */}
            <button
                id={`open-group-${group.id}`}
                onClick={() => onOpen(group.id)}
                className="mt-auto w-full rounded-xl bg-indigo-600/20 border border-indigo-500/30 py-2 text-sm font-medium text-indigo-300 transition-all hover:bg-indigo-600 hover:text-white hover:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
                Open Group →
            </button>
        </div>
    );
}

// ─── Create Group Modal ────────────────────────────────────────────────────────

function CreateGroupModal({ onClose, onCreate }) {
    const [name, setName] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    // Close on Escape key
    useEffect(() => {
        function handleKey(e) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!name.trim()) {
            setError("Group name is required");
            return;
        }
        setError("");
        setIsLoading(true);
        try {
            const res = await api.post("/api/groups", { name: name.trim() });
            toast.success(`"${res.data.group.name}" created!`);
            onCreate(res.data.group);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || "Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        /* Backdrop */
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            {/* Panel */}
            <div
                className="w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700/60 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Create a Group</h2>
                    <button
                        id="create-group-modal-close"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-700 hover:text-white"
                        aria-label="Close modal"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form id="create-group-form" onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    <div>
                        <label htmlFor="group-name-input" className="mb-1.5 block text-sm font-medium text-gray-300">
                            Group Name
                        </label>
                        <input
                            id="group-name-input"
                            type="text"
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Goa Trip 2025"
                            className="w-full rounded-xl border border-gray-600 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                    </div>

                    <button
                        id="create-group-submit"
                        type="submit"
                        disabled={isLoading}
                        className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isLoading ? "Creating…" : "Create Group"}
                    </button>
                </form>
            </div>
        </div>
    );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [groups, setGroups] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        async function fetchGroups() {
            try {
                const res = await api.get("/api/groups");
                setGroups(res.data.groups);
            } catch {
                toast.error("Failed to load groups");
            } finally {
                setIsLoading(false);
            }
        }
        fetchGroups();
    }, []);

    function handleGroupCreated(newGroup) {
        // Append with default fields used by GroupCard
        setGroups((prev) => [
            {
                ...newGroup,
                memberCount: 1,
                userStatus: "active",
            },
            ...prev,
        ]);
    }

    async function handleLogout() {
        await logout();
        navigate("/login");
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 text-white">
            {/* ── Navbar ── */}
            <header className="sticky top-0 z-40 border-b border-gray-700/40 bg-gray-950/80 backdrop-blur-md">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">💸</span>
                        <span className="text-lg font-bold tracking-tight text-white">Splitmate</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="hidden text-sm text-gray-400 sm:block">
                            Hi, <span className="font-medium text-white">{user?.name}</span>
                        </span>
                        <button
                            id="logout-button"
                            onClick={handleLogout}
                            className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-gray-400 hover:text-white"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Hero ── */}
            <div className="mx-auto max-w-7xl px-4 pt-10 pb-6 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                            Your Groups
                        </h1>
                        <p className="mt-1 text-gray-400">
                            Manage shared expenses across all your groups.
                        </p>
                    </div>
                    <button
                        id="create-group-button"
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 self-start rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:self-auto"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New Group
                    </button>
                </div>
            </div>

            {/* ── Group Grid ── */}
            <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
                {isLoading ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <SkeletonCard key={i} />
                        ))}
                    </div>
                ) : groups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 py-24 text-center">
                        <div className="mb-4 text-5xl">🏕️</div>
                        <h2 className="mb-2 text-xl font-semibold text-white">No groups yet</h2>
                        <p className="mb-6 max-w-sm text-sm text-gray-400">
                            Create your first group to start splitting expenses with friends.
                        </p>
                        <button
                            id="create-group-empty-button"
                            onClick={() => setShowModal(true)}
                            className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                        >
                            Create a Group
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {groups.map((group) => (
                            <GroupCard
                                key={group.id}
                                group={group}
                                onOpen={(id) => navigate(`/groups/${id}`)}
                            />
                        ))}
                    </div>
                )}
            </main>

            {/* ── Modal ── */}
            {showModal && (
                <CreateGroupModal
                    onClose={() => setShowModal(false)}
                    onCreate={handleGroupCreated}
                />
            )}
        </div>
    );
}
