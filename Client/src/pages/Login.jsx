import { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

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
        <div className="flex min-h-screen bg-base text-primary font-sans selection:bg-indigo-500/30 selection:text-indigo-200 transition-colors duration-300">
            <div className="absolute top-4 right-4 z-50">
                <ThemeToggle />
            </div>
            {/* ── Left panel — branding ── */}
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-panel p-12 relative overflow-hidden border-r border-panel-border">
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-indigo-500/20 blur-[100px] animate-pulse" />
                    <div className="absolute top-1/2 -left-32 h-96 w-96 rounded-full bg-purple-600/10 blur-[120px]" />
                </div>

                <div className="relative flex items-center gap-3 animate-fade-in">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-hover backdrop-blur-md border border-panel-border shadow-lg">
                        <span className="text-xl">💸</span>
                    </div>
                    <span className="text-xl font-bold text-primary tracking-tight font-display">Splitwise</span>
                </div>

                <div className="relative space-y-6 animate-slide-up">
                    <h2 className="text-5xl font-extrabold text-primary leading-tight font-display tracking-tight">
                        Split expenses,<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
                            not friendships.
                        </span>
                    </h2>
                    <p className="text-lg text-secondary leading-relaxed max-w-sm">
                        Track shared costs, settle debts instantly, and always know who owes what — beautifully.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-2">
                        {["Group expenses", "Smart splits", "CSV import", "Instant balances"].map((f) => (
                            <span key={f} className="inline-flex items-center gap-1.5 rounded-full bg-panel border border-panel-border px-3 py-1.5 text-sm font-medium text-secondary backdrop-blur-md shadow-sm transition hover:bg-hover">
                                <svg className="h-3.5 w-3.5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                {f}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="relative rounded-2xl bg-panel backdrop-blur-xl border border-panel-border p-6 animate-fade-in shadow-2xl">
                    <p className="text-sm text-secondary leading-relaxed italic">
                        "Finally stopped using WhatsApp threads to track who paid what. This handles everything automatically, and it looks stunning."
                    </p>
                    <p className="mt-4 text-xs font-semibold text-indigo-500 uppercase tracking-wider">— Kunal, Goa trip 2025</p>
                </div>
            </div>

            {/* ── Right panel — form ── */}
            <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-16 overflow-y-auto">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/5 via-transparent to-transparent pointer-events-none lg:hidden" />
                
                {/* Mobile logo */}
                <div className="mb-10 flex items-center gap-2 lg:hidden relative z-10 animate-fade-in">
                    <span className="text-2xl">💸</span>
                    <span className="text-xl font-bold text-primary font-display tracking-tight">Splitwise</span>
                </div>

                <div className="w-full max-w-sm relative z-10 animate-slide-up">
                    <div className="mb-8">
                        <h1 className="text-3xl font-extrabold text-primary font-display tracking-tight">Welcome back</h1>
                        <p className="mt-2 text-sm text-secondary">Sign in to your account to continue</p>
                    </div>

                    {/* ─── Demo Accounts Panel ────────────────────────────────────── */}
                    <div className="mb-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 backdrop-blur-sm shadow-xl">
                        <div className="mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-sm border border-indigo-500/30">
                                    🚀
                                </div>
                                <span className="text-sm font-semibold text-indigo-200">Try a demo account</span>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                Pre-loaded
                            </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2.5">
                            {DEMO_USERS.map((u) => {
                                const busy = quickLoading === u.email;
                                return (
                                    <button
                                        key={u.email}
                                        id={`demo-login-${u.name.toLowerCase()}`}
                                        onClick={() => handleQuickLogin(u)}
                                        disabled={!!quickLoading}
                                        title={u.email}
                                        className={`relative flex flex-col items-center gap-2 rounded-xl border px-2 py-3.5 text-center transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 hover:-translate-y-1 hover:shadow-lg ${u.highlight
                                            ? "border-indigo-400/40 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-400/60 shadow-[0_0_15px_rgba(99,102,241,0.1)]"
                                            : "border-panel-border bg-panel hover:bg-hover hover:border-panel-border"
                                            }`}
                                    >
                                        {u.highlight && (
                                            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md border border-white/20">
                                                Start here
                                            </span>
                                        )}
                                        {busy ? (
                                            <span className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                                        ) : (
                                            <span className="text-2xl leading-none select-none drop-shadow-sm">{u.emoji}</span>
                                        )}
                                        <span className="text-xs font-semibold leading-none text-primary mt-0.5">{u.name}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <p className="mt-4 text-center text-[10px] text-slate-500 font-medium tracking-wide">
                            One click — no typing needed &nbsp;·&nbsp; pwd:{" "}
                            <span className="font-mono text-slate-400 bg-white/5 px-1 rounded">password123</span>
                        </p>
                    </div>

                    {/* Divider */}
                    <div className="mb-6 flex items-center gap-4 opacity-60">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-700" />
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-widest">or</span>
                        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-700" />
                    </div>

                    <form id="login-form" onSubmit={handleSubmit} className="space-y-5">
                        {/* Error banner */}
                        {error && (
                            <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 shadow-lg animate-scale-in">
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                                <p className="text-sm font-medium text-rose-300">{error}</p>
                            </div>
                        )}

                        {/* Email */}
                        <div className="space-y-1.5">
                            <label htmlFor="login-email" className="block text-xs font-semibold text-muted uppercase tracking-wider ml-1">
                                Email address
                            </label>
                            <input
                                id="login-email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full rounded-xl border border-panel-border bg-panel px-4 py-3.5 text-sm text-primary placeholder-muted transition-all focus:border-indigo-500/50 focus:bg-hover focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
                                placeholder="you@example.com"
                            />
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                            <label htmlFor="login-password" className="block text-xs font-semibold text-muted uppercase tracking-wider ml-1">
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
                                    className="w-full rounded-xl border border-panel-border bg-panel px-4 py-3.5 pr-12 text-sm text-primary placeholder-muted transition-all focus:border-indigo-500/50 focus:bg-hover focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((s) => !s)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted transition hover:text-primary rounded-lg hover:bg-hover"
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
                            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                    Signing in…
                                </span>
                            ) : "Sign in"}
                        </button>
                    </form>

                    <div className="mt-8 flex justify-center">
                        <Link
                            to="/signup"
                            className="group flex items-center gap-2 text-sm font-medium text-secondary transition hover:text-primary"
                        >
                            Don't have an account? 
                            <span className="text-indigo-500 group-hover:text-indigo-600 transition-colors">Create one free &rarr;</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
