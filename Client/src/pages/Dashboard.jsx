import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name = "") {
    return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
    "bg-indigo-500", "bg-violet-500", "bg-emerald-500",
    "bg-blue-500", "bg-rose-500", "bg-amber-500",
];
function avatarColor(name = "") {
    const sum = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="animate-pulse rounded-2xl bg-gray-800/50 border border-gray-700/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div className="h-4 w-20 rounded-md bg-gray-700" />
                <div className="h-5 w-12 rounded-full bg-gray-700" />
            </div>
            <div className="h-5 w-2/3 rounded-md bg-gray-700" />
            <div className="h-4 w-1/3 rounded-md bg-gray-700" />
            <div className="h-10 w-full rounded-xl bg-gray-700" />
        </div>
    );
}

// ─── Group Card ───────────────────────────────────────────────────────────────

function GroupCard({ group, onOpen }) {
    const isActive = group.userStatus === "active";

    return (
        <div className="group flex flex-col rounded-2xl bg-gray-800/50 border border-gray-700/30 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-xl hover:shadow-indigo-500/5 hover:bg-gray-800/80">
            {/* Top row */}
            <div className="mb-4 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                    {new Date(group.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-600/30 text-gray-400"
                }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-400" : "bg-gray-500"}`} />
                    {isActive ? "Active" : "Left"}
                </span>
            </div>

            {/* Name */}
            <h3 className="mb-1 text-base font-semibold text-white leading-snug group-hover:text-indigo-300 transition-colors line-clamp-2">
                {group.name}
            </h3>

            {/* Member count */}
            <p className="mb-5 text-sm text-gray-500">
                <span className="font-medium text-gray-300">{group.memberCount}</span>{" "}
                {group.memberCount === 1 ? "member" : "members"}
            </p>

            {/* CTA */}
            <button
                id={`open-group-${group.id}`}
                onClick={() => onOpen(group.id)}
                className="mt-auto w-full rounded-xl border border-gray-700 bg-gray-700/30 py-2.5 text-sm font-medium text-gray-200 transition-all hover:border-indigo-500/50 hover:bg-indigo-600/20 hover:text-indigo-300"
            >
                Open Group
            </button>
        </div>
    );
}

// ─── Create Group Modal ───────────────────────────────────────────────────────

function CreateGroupModal({ onClose, onCreate }) {
    const [name, setName] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        function handleKey(e) { if (e.key === "Escape") onClose(); }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!name.trim()) { setError("Group name is required"); return; }
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700/60 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-white">Create a new group</h2>
                        <p className="text-xs text-gray-500 mt-0.5">You'll be added as the first member</p>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition" aria-label="Close">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <form id="create-group-form" onSubmit={handleSubmit} className="p-5 space-y-4">
                    {error && (
                        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
                    )}

                    <div className="space-y-1.5">
                        <label htmlFor="group-name-input" className="block text-sm font-medium text-gray-300">
                            Group name
                        </label>
                        <input
                            id="group-name-input"
                            type="text"
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Goa Trip 2025, Flat 4B, Office Lunch"
                            className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                        <p className="text-xs text-gray-600">Pick something your group will recognise</p>
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-700 py-2.5 text-sm font-medium text-gray-300 transition hover:border-gray-600 hover:text-white">
                            Cancel
                        </button>
                        <button
                            id="create-group-submit"
                            type="submit"
                            disabled={isLoading || !name.trim()}
                            className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isLoading ? "Creating…" : "Create Group"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [groups, setGroups] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

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
        setGroups((prev) => [{ ...newGroup, memberCount: 1, userStatus: "active" }, ...prev]);
    }

    async function handleLogout() {
        await logout();
        navigate("/login");
    }

    const filteredGroups = groups.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const activeCount = groups.filter((g) => g.userStatus === "active").length;

    return (
        <div className="min-h-screen bg-gray-950 text-white">
            {/* ── Top nav ── */}
            <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/90 backdrop-blur-md">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
                    {/* Logo */}
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/20 border border-indigo-500/30">
                            <span className="text-base">💸</span>
                        </div>
                        <span className="text-base font-bold tracking-tight text-white">Splitwise</span>
                    </div>

                    {/* Right side */}
                    <div className="flex items-center gap-3">
                        {/* User pill */}
                        <div className="hidden sm:flex items-center gap-2.5 rounded-xl bg-gray-800/60 border border-gray-700/40 px-3 py-1.5">
                            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(user?.name)}`}>
                                {getInitials(user?.name)}
                            </div>
                            <span className="text-sm text-gray-300">{user?.name}</span>
                        </div>
                        <button
                            id="logout-button"
                            onClick={handleLogout}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:border-gray-500 hover:text-white"
                        >
                            Log out
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
                {/* ── Page header ── */}
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white sm:text-3xl">Your groups</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            {isLoading ? "Loading…" : (
                                <>
                                    <span className="text-gray-300 font-medium">{activeCount}</span> active{" "}
                                    {activeCount !== 1 ? "groups" : "group"}
                                    {groups.length > activeCount && ` · ${groups.length - activeCount} left`}
                                </>
                            )}
                        </p>
                    </div>
                    <button
                        id="create-group-button"
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 self-start rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:self-auto"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New group
                    </button>
                </div>

                {/* ── Search bar (only shown when groups exist) ── */}
                {!isLoading && groups.length > 3 && (
                    <div className="mb-5 relative">
                        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="search"
                            placeholder="Search groups…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-xl border border-gray-700/60 bg-gray-800/40 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 transition focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:max-w-xs"
                        />
                    </div>
                )}

                {/* ── Content ── */}
                {isLoading ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                    </div>
                ) : filteredGroups.length === 0 && searchQuery ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700/60 py-20 text-center">
                        <p className="text-3xl mb-3">🔍</p>
                        <p className="font-semibold text-white">No groups match "{searchQuery}"</p>
                        <button onClick={() => setSearchQuery("")} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300 transition">Clear search</button>
                    </div>
                ) : groups.length === 0 ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700/60 py-24 text-center">
                        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-800/60 border border-gray-700/40">
                            <span className="text-3xl">👥</span>
                        </div>
                        <h2 className="mb-2 text-xl font-semibold text-white">No groups yet</h2>
                        <p className="mb-6 max-w-xs text-sm text-gray-400 leading-relaxed">
                            Create your first group to start tracking shared expenses with friends, flatmates, or your team.
                        </p>
                        <button
                            id="create-group-empty-button"
                            onClick={() => setShowModal(true)}
                            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Create your first group
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredGroups.map((group) => (
                            <GroupCard
                                key={group.id}
                                group={group}
                                onOpen={(id) => navigate(`/groups/${id}`)}
                            />
                        ))}
                    </div>
                )}
            </main>

            {showModal && (
                <CreateGroupModal
                    onClose={() => setShowModal(false)}
                    onCreate={handleGroupCreated}
                />
            )}
        </div>
    );
}
