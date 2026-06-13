import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import GroupDetail from "./pages/GroupDetail";
import ImportPage from "./pages/ImportPage";
import { Toaster } from "react-hot-toast";

// ─── App ──────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <BrowserRouter>
            <AuthProvider>
                <Toaster
                    position="top-right"
                    toastOptions={{
                        style: {
                            background: "#1f2937",
                            color: "#f9fafb",
                            border: "1px solid #374151",
                            borderRadius: "12px",
                        },
                        success: { iconTheme: { primary: "#6366f1", secondary: "#f9fafb" } },
                    }}
                />
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
    </StrictMode>
);
