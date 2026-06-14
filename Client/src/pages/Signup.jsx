import { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

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

    const inputCls = "w-full rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3 text-sm text-white placeholder-gray-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

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
                    <span className="text-xl font-bold text-white tracking-tight">Splitwise</span>
                </div>

                <div className="relative space-y-8">
                    <div>
                        <h2 className="text-4xl font-bold text-white leading-tight">
                            The smarter way<br />to split costs.
                        </h2>
                        <p className="mt-4 text-lg text-indigo-200 leading-relaxed max-w-sm">
                            Create a group, add members, log expenses — Splitwise does the maths and tells everyone exactly what they owe.
                        </p>
                    </div>

                    {/* Steps */}
                    <div className="space-y-4">
                        {[
                            { icon: "👥", step: "1", title: "Create a group", desc: "Add your friends, flatmates, or travel crew." },
                            { icon: "🧾", step: "2", title: "Log expenses", desc: "Add manually or import a CSV in one click." },
                            { icon: "⚡", step: "3", title: "Settle up", desc: "See exactly who pays whom — then mark it done." },
                        ].map(({ icon, step, title, desc }) => (
                            <div key={step} className="flex items-start gap-4">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg">
                                    {icon}
                                </div>
                                <div>
                                    <p className="font-semibold text-white text-sm">{title}</p>
                                    <p className="text-xs text-indigo-200 mt-0.5">{desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="relative text-xs text-indigo-300">
                    Free forever · No credit card needed
                </div>
            </div>

            {/* ── Right panel — form ── */}
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-16">
                {/* Mobile logo */}
                <div className="mb-8 flex items-center gap-2 lg:hidden">
                    <span className="text-2xl">💸</span>
                    <span className="text-xl font-bold text-white">Splitwise</span>
                </div>

                <div className="w-full max-w-sm">
                    {/* Demo nudge */}
                    <Link
                        to="/login"
                        className="mb-6 flex items-center gap-3 rounded-xl border border-indigo-500/25 bg-indigo-500/8 px-4 py-3 transition hover:border-indigo-400/40 hover:bg-indigo-500/12 group"
                    >
                        <span className="text-xl">🚀</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-indigo-300">Just exploring?</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Use a demo account — 43 expenses already loaded, no signup needed.
                            </p>
                        </div>
                        <svg className="h-4 w-4 flex-shrink-0 text-indigo-400 transition group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </Link>

                    <div className="mb-8">
                        <h1 className="text-2xl font-bold text-white">Create your account</h1>
                        <p className="mt-1 text-sm text-gray-400">Free forever. No credit card needed.</p>
                    </div>

                    <form id="signup-form" onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="flex items-start gap-3 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                                <p className="text-sm text-red-400">{error}</p>
                            </div>
                        )}

                        {/* Name */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-name" className="block text-sm font-medium text-gray-300">Full name</label>
                            <input
                                id="signup-name" type="text" autoComplete="name" required
                                value={name} onChange={(e) => setName(e.target.value)}
                                className={inputCls} placeholder="Kunal Sharma"
                            />
                        </div>

                        {/* Email */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-email" className="block text-sm font-medium text-gray-300">Email address</label>
                            <input
                                id="signup-email" type="email" autoComplete="email" required
                                value={email} onChange={(e) => setEmail(e.target.value)}
                                className={inputCls} placeholder="you@example.com"
                            />
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-password" className="block text-sm font-medium text-gray-300">Password</label>
                            <div className="relative">
                                <input
                                    id="signup-password"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password" required
                                    value={password} onChange={(e) => setPassword(e.target.value)}
                                    className={inputCls + " pr-11"}
                                    placeholder="Min. 8 characters"
                                />
                                <button type="button" tabIndex={-1}
                                    onClick={() => setShowPassword((s) => !s)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition">
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                </button>
                            </div>
                            {/* Strength indicator */}
                            {password.length > 0 && (
                                <div className="flex items-center gap-2 mt-1.5">
                                    <div className="flex gap-1 flex-1">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                                                password.length >= i * 3
                                                    ? password.length >= 8 ? "bg-emerald-500" : "bg-yellow-500"
                                                    : "bg-gray-700"
                                            }`} />
                                        ))}
                                    </div>
                                    <span className={`text-xs ${passwordStrong ? "text-emerald-400" : "text-yellow-400"}`}>
                                        {passwordStrong ? "Strong" : "Too short"}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Confirm password */}
                        <div className="space-y-1.5">
                            <label htmlFor="signup-confirm" className="block text-sm font-medium text-gray-300">Confirm password</label>
                            <input
                                id="signup-confirm" type="password" autoComplete="new-password" required
                                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                                className={inputCls + (!passwordsMatch ? " border-red-500/60 focus:border-red-500" : "")}
                                placeholder="••••••••"
                            />
                            {!passwordsMatch && (
                                <p className="text-xs text-red-400">Passwords don't match</p>
                            )}
                        </div>

                        {/* Submit */}
                        <button
                            id="signup-submit"
                            type="submit"
                            disabled={isLoading || !passwordsMatch}
                            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    Creating account…
                                </span>
                            ) : "Create account →"}
                        </button>
                    </form>

                    <div className="my-6 flex items-center gap-3">
                        <div className="flex-1 h-px bg-gray-800" />
                        <span className="text-xs text-gray-600">Already have an account?</span>
                        <div className="flex-1 h-px bg-gray-800" />
                    </div>

                    <Link
                        to="/login"
                        className="flex w-full items-center justify-center rounded-xl border border-gray-700 bg-gray-800/40 px-4 py-3 text-sm font-medium text-gray-300 transition hover:border-gray-600 hover:text-white"
                    >
                        Sign in instead
                    </Link>
                </div>
            </div>
        </div>
    );
}
