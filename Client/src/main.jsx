import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import GroupDetail from "./pages/GroupDetail";
import ImportPage from "./pages/ImportPage";
import { Toaster } from "react-hot-toast";

// ─── ThemedToaster ─────────────────────────────────────────────────────────────

function ThemedToaster() {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <Toaster
            position="top-right"
            toastOptions={{
                style: {
                    background: isDark ? "#020617" : "#ffffff",
                    color: isDark ? "#f8fafc" : "#0f172a",
                    border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.05)"}`,
                    borderRadius: "12px",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                },
                success: { iconTheme: { primary: "#6366f1", secondary: isDark ? "#f8fafc" : "#ffffff" } },
            }}
        />
    );
}

// ─── App ──────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <ThemeProvider>
            <BrowserRouter>
                <AuthProvider>
                    <ThemedToaster />
                <Routes>
                    {/* Public routes */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />

                    {/* Protected routes */}
                    <Route element={<ProtectedRoute />}>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/groups/:groupId" element={<GroupDetail />} />
                        <Route path="/groups/:groupId/import" element={<ImportPage />} />
                    </Route>

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </AuthProvider>
        </BrowserRouter>
    </ThemeProvider>
</StrictMode>
);
