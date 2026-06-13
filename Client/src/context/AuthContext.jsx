import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/axios";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // On mount — restore session from the httpOnly cookie via /me
    useEffect(() => {
        api
            .get("/api/auth/me")
            .then((res) => setUser(res.data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    async function login(email, password) {
        try {
            const res = await api.post("/api/auth/login", { email, password });
            setUser(res.data.user);
            return res.data.user;
        } catch (err) {
            throw err;
        }
    }

    async function signup(name, email, password) {
        try {
            const res = await api.post("/api/auth/signup", {
                name,
                email,
                password,
            });
            setUser(res.data.user);
            return res.data.user;
        } catch (err) {
            throw err;
        }
    }

    async function logout() {
        try {
            await api.post("/api/auth/logout");
        } finally {
            setUser(null);
        }
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

// Convenience hook
export function useAuth() {
    return useContext(AuthContext);
}
