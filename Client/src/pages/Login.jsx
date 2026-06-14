import { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

// Seeded demo accounts — mirrors Server/prisma/seed.js
const DEMO_USERS = [
    { name: "Aisha", email: "aisha@splitwise.com", emoji: "👩🏽", role: "Group creator", highlight: true },
    { name: "Rohan", email: "rohan@splitwise.com", emoji: "👨🏽", role: "Flatmate" },
    { name: "Priya", email: "priya@splitwise.com", emoji: "👩🏽‍💼", role: "Flatmate" },
    { name: "Meera", email: "meera@splitwise.com", emoji: "👩🏾", role: "Moved out Mar '26" },
    { name: "Dev", email: "dev@splitwise.com", emoji: "🧑🏽", role: "Goa trip guest" },
    { name: "Sam", email: "sam@splitwise.com", emoji: "👨🏻", role: "New flatmate Apr '26" },
];
const DEMO_PASSWORD = "password123";

export default function Login() {
    const { login } = useContext(AuthContext);
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [quickLoading, setQuickLoading] = useState(null); // email of demo user being signed in

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");
        setIsLoading(true);
        try {
            await login(email, password);
            navigate("/dashboard");
        } catch (err) {
            setError(err?.response?.data?.error || "Invalid email or password. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    async function handleQuickLogin(demoUser) {
        setError("");
        setQuickLoading(demoUser.email);
        setEmail(demoUser.email);
        setPassword(DEMO_PASSWORD);
        try {
            await login(demoUser.email, DEMO_PASSWORD);
            navigate("/dashboard");
        } catch (err) {
            setError(err?.response?.data?.error || "Demo login failed — make sure the server is seeded (npm run seed).");
        } finally {
            setQuickLoading(null);
        }
    }

    return (
        <div className="flex min-h-screen bg-gray-950">
            {/* ── Left panel — branding ── */}
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 p-12 relative overflow-hidden">
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
                    <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-purple-500/20 blur-3xl" />
                </div>

                <div className="relative flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                        <span className="text-xl">💸</span>
                    </div>
                    <span className="text-xl font-bold text-white tracking-tight">splitwise</span>
                </div>

                <div className="relative space-y-6">
                    <h2 className="text-4xl font-bold text-white leading-tight">
                        Split expenses,<br />not friendships.
                    </h2>
                    <p className="text-lg text-indigo-200 leading-relaxed max-w-sm">
                        Track shared costs, settle debts instantly, and always know who owes what — without the awkward conversations.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-2">
                        {["Group expenses", "Smart splits", "CSV import", "Instant balances"].map((f) => (
                            <span key={f} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
                                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                {f}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="relative rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 p-5">
                    <p className="text-sm text-indigo-100 leading-relaxed">
                        "Finally stopped using WhatsApp threads to track who paid what. splitwise handles everything automatically."
                    </p>
                    <p className="mt-3 text-xs font-semibold text-indigo-200">— Kunal, Goa trip 2025</p>
                </div>
            </div>

            {/* ── Right panel — form ── */}
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-16 overflow-y-auto">
                {/* Mobile logo */}
                <div className="mb-8 flex items-center gap-2 lg:hidden">
                    <span className="text-2xl">💸</span>
                    <span className="text-xl font-bold text-white">splitwise</span>
                </div>

                <div className="w-full max-w-sm">
                    <div className="mb-7">
                        <h1 className="text-2xl font-bold text-white">Welcome back</h1>
                        <p className="mt-1 text-sm text-gray-400">Sign in to your account to continue</p>
                    </div>

                    {/* ─── Demo Accounts Panel ────────────────────────────────────── */}
                    <div className="mb-6 rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-base">🚀</span>
                                <span className="text-sm font-semibold text-indigo-300">Try a demo account</span>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                                43 expenses pre-loaded
                            </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            {DEMO_USERS.map((u) => {
                                const busy = quickLoading === u.email;
                                return (
                                    <button
                                        key={u.email}
                                        id={`demo-login-${u.name.toLowerCase()}`}
                                        onClick={() => handleQuickLogin(u)}
                                        disabled={!!quickLoading}
                                        title={u.email}
                                        className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 active:scale-95 ${u.highlight
                                            ? "border-indigo-400/50 bg-indigo-600/20 hover:bg-indigo-600/35"
                                            : "border-gray-700/60 bg-gray-800/40 hover:bg-gray-700/60"
                                            }`}
                                    >
                                        {u.highlight && (
                                            <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-500 px-2 py-px text-[9px] font-bold uppercase tracking-wide text-white shadow">
                                                Start here
                                            </span>
                                        )}
                                        {busy ? (
                                            <span className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                                        ) : (
                                            <span className="text-2xl leading-none select-none">{u.emoji}</span>
                                        )}
                                        <span className="text-xs font-semibold leading-none text-white">{u.name}</span>
                                        <span className="text-[10px] leading-tight text-gray-400">{u.role}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <p className="mt-3 text-center text-[10px] text-gray-600">
                            One click — no typing needed &nbsp;·&nbsp; password:{" "}
                            <span className="font-mono text-gray-500">password123</span>
                        </p>
                    </div>

                    {/* Divider */}
                    <div className="mb-5 flex items-center gap-3">
                        <div className="h-px flex-1 bg-gray-800" />
                        <span className="text-xs text-gray-600">or sign in manually</span>
                        <div className="h-px flex-1 bg-gray-800" />
                    </div>

                    <form id="login-form" onSubmit={handleSubmit} className="space-y-5">
                        {/* Error banner */}
                        {error && (
                            <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                                <p className="text-sm text-red-400">{error}</p>
                            </div>
                        )}

                        {/* Email */}
                        <div className="space-y-1.5">
                            <label htmlFor="login-email" className="block text-sm font-medium text-gray-300">
                                Email address
                            </label>
                            <input
                                id="login-email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3 text-sm text-white placeholder-gray-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                placeholder="you@example.com"
                            />
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                            <label htmlFor="login-password" className="block text-sm font-medium text-gray-300">
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    id="login-password"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3 pr-11 text-sm text-white placeholder-gray-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((s) => !s)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-200"
                                    tabIndex={-1}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? (
                                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                        </svg>
                                    ) : (
                                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Submit */}
                        <button
                            id="login-submit"
                            type="submit"
                            disabled={isLoading}
                            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    Signing in…
                                </span>
                            ) : "Sign in"}
                        </button>
                    </form>

                    {/* Signup link */}
                    <div className="my-6 flex items-center gap-3">
                        <div className="h-px flex-1 bg-gray-800" />
                        <span className="text-xs text-gray-600">New here?</span>
                        <div className="h-px flex-1 bg-gray-800" />
                    </div>

                    <Link
                        to="/signup"
                        className="flex w-full items-center justify-center rounded-xl border border-gray-700 bg-gray-800/40 px-4 py-3 text-sm font-medium text-gray-300 transition hover:border-gray-600 hover:text-white"
                    >
                        Create a free account →
                    </Link>
                </div>
            </div>
        </div>
    );
}
