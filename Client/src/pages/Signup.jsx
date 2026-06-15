import { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

export default function Signup() {
    const { signup } = useContext(AuthContext);
    const navigate = useNavigate();

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const passwordsMatch = confirmPassword === "" || password === confirmPassword;
    const passwordStrong = password.length >= 8;

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");
        if (!name.trim() || !email || !password || !confirmPassword) {
            return setError("All fields are required.");
        }
        if (password !== confirmPassword) {
            return setError("Passwords do not match.");
        }
        if (password.length < 8) {
            return setError("Password must be at least 8 characters.");
        }
        setIsLoading(true);
        try {
            await signup(name.trim(), email, password);
            navigate("/dashboard");
        } catch (err) {
            setError(err?.response?.data?.error || "Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    const inputCls = "w-full rounded-xl border border-panel-border bg-panel px-4 py-3.5 text-sm text-primary placeholder-muted transition-all focus:border-indigo-500/50 focus:bg-hover focus:outline-none focus:ring-4 focus:ring-indigo-500/10";

    return (
        <div className="flex min-h-screen bg-base font-sans selection:bg-indigo-500/30 selection:text-indigo-200 transition-colors duration-300">
            <div className="absolute top-4 right-4 z-50">
                <ThemeToggle />
            </div>
            {/* ── Left panel — branding ── */}
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-panel border-r border-panel-border p-12 relative overflow-hidden">
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-purple-500/10 blur-[100px] animate-pulse" />
                    <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-indigo-500/20 blur-[120px]" />
                </div>

                <div className="relative flex items-center gap-3 animate-fade-in">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-hover backdrop-blur-md border border-panel-border shadow-lg">
                        <span className="text-xl">💸</span>
                    </div>
                    <span className="text-xl font-bold text-primary tracking-tight font-display">Splitwise</span>
                </div>

                <div className="relative space-y-8 animate-slide-up">
                    <div>
                        <h2 className="text-5xl font-extrabold text-primary leading-tight font-display tracking-tight">
                            The smarter way<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
                                to split costs.
                            </span>
                        </h2>
                        <p className="mt-4 text-lg text-secondary leading-relaxed max-w-sm">
                            Create a group, add members, log expenses — Splitwise does the maths and tells everyone exactly what they owe.
                        </p>
                    </div>

                    {/* Steps */}
                    <div className="space-y-5">
                        {[
                            { icon: "👥", step: "1", title: "Create a group", desc: "Add your friends, flatmates, or travel crew." },
                            { icon: "🧾", step: "2", title: "Log expenses", desc: "Add manually or import a CSV in one click." },
                            { icon: "⚡", step: "3", title: "Settle up", desc: "See exactly who pays whom — then mark it done." },
                        ].map(({ icon, step, title, desc }) => (
                            <div key={step} className="flex items-start gap-4 p-3 rounded-2xl transition hover:bg-hover border border-transparent hover:border-panel-border">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hover text-lg border border-panel-border shadow-sm backdrop-blur-sm">
                                    {icon}
                                </div>
                                <div>
                                    <p className="font-semibold text-primary text-sm">{title}</p>
                                    <p className="text-xs text-secondary mt-0.5">{desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="relative text-xs font-medium text-muted uppercase tracking-widest animate-fade-in">
                    Free forever · No credit card needed
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
                    {/* Demo nudge */}
                    <Link
                        to="/login"
                        className="mb-8 flex items-center gap-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 transition-all hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:-translate-y-0.5 shadow-lg group backdrop-blur-sm"
                    >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-xl border border-indigo-500/30">
                            🚀
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-indigo-300">Just exploring?</p>
                            <p className="text-xs text-indigo-200/70 mt-0.5">
                                Use a demo account — 43 expenses loaded.
                            </p>
                        </div>
                        <svg className="h-5 w-5 flex-shrink-0 text-indigo-400 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </Link>

                    <div className="mb-8">
                        <h1 className="text-3xl font-extrabold text-primary font-display tracking-tight">Create account</h1>
                        <p className="mt-2 text-sm text-secondary">Free forever. No credit card needed.</p>
                    </div>

                    <form id="signup-form" onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="flex items-start gap-3 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 shadow-lg animate-scale-in">
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                                <p className="text-sm font-medium text-rose-300">{error}</p>
                            </div>
                        )}

                        {/* Name */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-name" className="block text-xs font-semibold text-muted uppercase tracking-wider ml-1">Full name</label>
                            <input
                                id="signup-name" type="text" autoComplete="name" required
                                value={name} onChange={(e) => setName(e.target.value)}
                                className={inputCls} placeholder="Kunal Sharma"
                            />
                        </div>

                        {/* Email */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-email" className="block text-xs font-semibold text-muted uppercase tracking-wider ml-1">Email address</label>
                            <input
                                id="signup-email" type="email" autoComplete="email" required
                                value={email} onChange={(e) => setEmail(e.target.value)}
                                className={inputCls} placeholder="you@example.com"
                            />
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-password" className="block text-xs font-semibold text-muted uppercase tracking-wider ml-1">Password</label>
                            <div className="relative">
                                <input
                                    id="signup-password"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password" required
                                    value={password} onChange={(e) => setPassword(e.target.value)}
                                    className={inputCls + " pr-12"}
                                    placeholder="Min. 8 characters"
                                />
                                <button type="button" tabIndex={-1}
                                    onClick={() => setShowPassword((s) => !s)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-primary rounded-lg hover:bg-hover transition">
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
                            {/* Strength indicator */}
                            {password.length > 0 && (
                                <div className="flex items-center gap-2 mt-2">
                                    <div className="flex gap-1.5 flex-1">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                                                password.length >= i * 3
                                                    ? password.length >= 8 ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                                                    : "bg-white/10"
                                            }`} />
                                        ))}
                                    </div>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${passwordStrong ? "text-emerald-400" : "text-amber-400"}`}>
                                        {passwordStrong ? "Strong" : "Weak"}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Confirm password */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-confirm" className="block text-xs font-semibold text-muted uppercase tracking-wider ml-1">Confirm password</label>
                            <input
                                id="signup-confirm" type="password" autoComplete="new-password" required
                                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                                className={inputCls + (!passwordsMatch ? " border-rose-500/50 bg-rose-500/5 focus:border-rose-500/50 focus:ring-rose-500/20" : "")}
                                placeholder="••••••••"
                            />
                            {!passwordsMatch && (
                                <p className="text-xs font-medium text-rose-400 animate-fade-in mt-1">Passwords don't match</p>
                            )}
                        </div>

                        {/* Submit */}
                        <button
                            id="signup-submit"
                            type="submit"
                            disabled={isLoading || !passwordsMatch}
                            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 mt-2"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                    Creating account…
                                </span>
                            ) : "Create account"}
                        </button>
                    </form>

                    <div className="mt-8 flex justify-center">
                        <Link
                            to="/login"
                            className="group flex items-center gap-2 text-sm font-medium text-secondary transition hover:text-primary"
                        >
                            Already have an account? 
                            <span className="text-indigo-500 group-hover:text-indigo-600 transition-colors">Sign in &rarr;</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
