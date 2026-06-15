import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

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
        <div className="animate-pulse rounded-2xl bg-panel border border-panel-border p-5 space-y-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
                <div className="h-4 w-20 rounded-md bg-hover" />
                <div className="h-5 w-12 rounded-full bg-hover" />
            </div>
            <div className="h-5 w-2/3 rounded-md bg-hover" />
            <div className="h-4 w-1/3 rounded-md bg-hover" />
            <div className="h-10 w-full rounded-xl bg-hover" />
        </div>
    );
}

// ─── Group Card ───────────────────────────────────────────────────────────────

function GroupCard({ group, onOpen }) {
    const isActive = group.userStatus === "active";

    return (
        <div className="group relative flex flex-col rounded-2xl bg-panel border border-panel-border p-5 transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-500/40 hover:bg-hover hover:shadow-[0_8px_30px_rgba(99,102,241,0.1)] backdrop-blur-sm overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-transparent to-purple-500/0 group-hover:from-indigo-500/5 group-hover:to-purple-500/5 transition-colors duration-500 pointer-events-none" />
            
            {/* Top row */}
            <div className="relative z-10 mb-4 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                    {new Date(group.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    isActive ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-slate-500/10 text-slate-500 border border-slate-500/20"
                }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-slate-500"}`} />
                    {isActive ? "Active" : "Left"}
                </span>
            </div>

            {/* Name */}
            <h3 className="relative z-10 mb-1.5 text-lg font-bold text-primary leading-snug group-hover:text-indigo-500 transition-colors line-clamp-2 font-display tracking-tight">
                {group.name}
            </h3>

            {/* Member count */}
            <p className="relative z-10 mb-6 text-sm text-muted flex items-center gap-1.5">
                <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>
                    <span className="font-semibold text-secondary">{group.memberCount}</span>{" "}
                    {group.memberCount === 1 ? "member" : "members"}
                </span>
            </p>

            {/* CTA */}
            <button
                id={`open-group-${group.id}`}
                onClick={() => onOpen(group.id)}
                className="relative z-10 mt-auto w-full rounded-xl border border-panel-border bg-panel py-2.5 text-sm font-semibold text-secondary transition-all duration-300 group-hover:border-indigo-500/50 group-hover:bg-indigo-500/10 group-hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
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
            toast.success(`"${res.data.group.name}" created!`, {
                style: { background: '#1e293b', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.1)' }
            });
            onCreate(res.data.group);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || "Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-fade-in" onClick={onClose}>
            <div className="w-full max-w-md rounded-2xl bg-base border border-panel-border shadow-2xl animate-scale-in overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-panel-border px-6 py-5 bg-panel">
                    <div>
                        <h2 className="text-lg font-bold text-primary font-display tracking-tight">Create a new group</h2>
                        <p className="text-xs text-muted mt-1">You'll be added as the first member</p>
                    </div>
                    <button onClick={onClose} className="rounded-xl p-2 text-muted hover:bg-hover hover:text-primary transition-colors" aria-label="Close">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <form id="create-group-form" onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && (
                        <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 shadow-inner">
                            <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                            <p className="text-sm font-medium text-rose-300">{error}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label htmlFor="group-name-input" className="block text-xs font-semibold text-muted uppercase tracking-wider ml-1">
                            Group name
                        </label>
                        <input
                            id="group-name-input"
                            type="text"
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Goa Trip 2025, Flat 4B"
                            className="w-full rounded-xl border border-panel-border bg-panel px-4 py-3.5 text-sm text-primary placeholder-muted transition-all focus:border-indigo-500/50 focus:bg-base focus:outline-none focus:ring-4 focus:ring-indigo-500/10 shadow-inner"
                        />
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-panel-border bg-transparent py-3 text-sm font-semibold text-secondary transition-all hover:bg-hover hover:text-primary focus:outline-none focus:ring-4 focus:ring-panel-border">
                            Cancel
                        </button>
                        <button
                            id="create-group-submit"
                            type="submit"
                            disabled={isLoading || !name.trim()}
                            className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                        >
                            {isLoading ? (
                                <span className="flex justify-center items-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                </span>
                            ) : "Create Group"}
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
        <div className="min-h-screen bg-base text-primary font-sans selection:bg-indigo-500/30 selection:text-indigo-500 relative">
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/10 via-base to-base pointer-events-none" />
            
            {/* ── Top nav ── */}
            <header className="sticky top-0 z-40 border-b border-panel-border bg-base/80 backdrop-blur-xl">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
                    {/* Logo */}
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-panel border border-panel-border shadow-sm">
                            <span className="text-lg leading-none mt-0.5">💸</span>
                        </div>
                        <span className="text-xl font-extrabold tracking-tight text-primary font-display">Splitwise</span>
                    </div>

                    {/* Right side */}
                    <div className="flex items-center gap-3">
                        {/* User pill */}
                        <div className="hidden sm:flex items-center gap-2.5 rounded-full bg-panel border border-panel-border pl-1.5 pr-4 py-1.5 shadow-sm">
                            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-inner ${avatarColor(user?.name)}`}>
                                {getInitials(user?.name)}
                            </div>
                            <span className="text-sm font-medium text-secondary">{user?.name}</span>
                        </div>
                        
                        <ThemeToggle />
                        
                        <button
                            id="logout-button"
                            onClick={handleLogout}
                            className="rounded-xl border border-panel-border px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-muted transition-all hover:bg-hover hover:text-primary focus:outline-none focus:ring-2 focus:ring-panel-border"
                        >
                            Log out
                        </button>
                    </div>
                </div>
            </header>

            <main className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 z-10 animate-fade-in">
                {/* ── Page header ── */}
                <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-extrabold text-primary sm:text-4xl font-display tracking-tight">Your groups</h1>
                        <p className="mt-2 text-sm text-muted">
                            {isLoading ? "Loading…" : (
                                <>
                                    <span className="text-secondary font-semibold">{activeCount}</span> active{" "}
                                    {activeCount !== 1 ? "groups" : "group"}
                                    {groups.length > activeCount && ` · ${groups.length - activeCount} left`}
                                </>
                            )}
                        </p>
                    </div>
                    <button
                        id="create-group-button"
                        onClick={() => setShowModal(true)}
                        className="group flex items-center gap-2 self-start rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-indigo-500/30 sm:self-auto"
                    >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                            </svg>
                        </span>
                        New group
                    </button>
                </div>

                {/* ── Search bar (only shown when groups exist) ── */}
                {!isLoading && groups.length > 3 && (
                    <div className="mb-8 relative animate-slide-up" style={{animationDelay: '100ms'}}>
                        <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="search"
                            placeholder="Search groups…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-2xl border border-panel-border bg-panel py-3 pl-11 pr-4 text-sm text-primary placeholder-muted transition-all focus:border-indigo-500/50 focus:bg-hover focus:outline-none focus:ring-4 focus:ring-indigo-500/10 sm:max-w-xs shadow-inner"
                        />
                    </div>
                )}

                {/* ── Content ── */}
                {isLoading ? (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                    </div>
                ) : filteredGroups.length === 0 && searchQuery ? (
                    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-panel-border bg-panel py-24 text-center backdrop-blur-sm animate-fade-in">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-hover border border-panel-border mb-4 shadow-sm">
                            <p className="text-2xl mt-1">🔍</p>
                        </div>
                        <p className="text-lg font-bold text-primary font-display">No groups match "{searchQuery}"</p>
                        <button onClick={() => setSearchQuery("")} className="mt-3 text-sm font-medium text-indigo-500 hover:text-indigo-600 transition-colors">Clear search</button>
                    </div>
                ) : groups.length === 0 ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-panel-border bg-panel py-28 text-center backdrop-blur-sm animate-fade-in shadow-xl">
                        <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-hover border border-panel-border shadow-lg">
                            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full" />
                            <span className="text-4xl relative z-10 mt-1">👥</span>
                        </div>
                        <h2 className="mb-2 text-2xl font-extrabold text-primary font-display tracking-tight">No groups yet</h2>
                        <p className="mb-8 max-w-sm text-sm text-muted leading-relaxed">
                            Create your first group to start tracking shared expenses with friends, flatmates, or your team.
                        </p>
                        <button
                            id="create-group-empty-button"
                            onClick={() => setShowModal(true)}
                            className="group flex items-center gap-2 rounded-xl bg-hover border border-panel-border px-6 py-3 text-sm font-bold text-primary transition-all hover:bg-panel hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-panel-border active:scale-95"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                            Create your first group
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 animate-slide-up" style={{animationDelay: '50ms'}}>
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
