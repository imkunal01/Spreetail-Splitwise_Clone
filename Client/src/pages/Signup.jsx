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

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");

        // Client-side validation
        if (!name.trim() || !email || !password || !confirmPassword) {
            return setError("All fields are required");
        }
        if (password !== confirmPassword) {
            return setError("Passwords do not match");
        }

        setIsLoading(true);
        try {
            await signup(name.trim(), email, password);
            navigate("/dashboard");
        } catch (err) {
            setError(
                err?.response?.data?.error || "Something went wrong. Please try again."
            );
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-950 via-indigo-950 to-gray-950 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
                {/* Header */}
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold text-gray-900">Create account</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Start splitting expenses with friends
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Error */}
                    {error && (
                        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                            {error}
                        </div>
                    )}

                    {/* Name */}
                    <div>
                        <label
                            htmlFor="signup-name"
                            className="mb-1 block text-sm font-medium text-gray-700"
                        >
                            Full Name
                        </label>
                        <input
                            id="signup-name"
                            type="text"
                            autoComplete="name"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            placeholder="Kunal Sharma"
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <label
                            htmlFor="signup-email"
                            className="mb-1 block text-sm font-medium text-gray-700"
                        >
                            Email
                        </label>
                        <input
                            id="signup-email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            placeholder="you@example.com"
                        />
                    </div>

                    {/* Password */}
                    <div>
                        <label
                            htmlFor="signup-password"
                            className="mb-1 block text-sm font-medium text-gray-700"
                        >
                            Password
                        </label>
                        <input
                            id="signup-password"
                            type="password"
                            autoComplete="new-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            placeholder="Min. 8 characters"
                        />
                    </div>

                    {/* Confirm Password */}
                    <div>
                        <label
                            htmlFor="signup-confirm"
                            className="mb-1 block text-sm font-medium text-gray-700"
                        >
                            Confirm Password
                        </label>
                        <input
                            id="signup-confirm"
                            type="password"
                            autoComplete="new-password"
                            required
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            placeholder="••••••••"
                        />
                    </div>

                    {/* Submit */}
                    <button
                        id="signup-submit"
                        type="submit"
                        disabled={isLoading}
                        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isLoading ? "Creating account…" : "Create account"}
                    </button>
                </form>

                {/* Footer link */}
                <p className="mt-6 text-center text-sm text-gray-500">
                    Already have an account?{" "}
                    <Link
                        to="/login"
                        className="font-medium text-indigo-600 hover:text-indigo-700"
                    >
                        Login
                    </Link>
                </p>
            </div>
        </div>
    );
}
