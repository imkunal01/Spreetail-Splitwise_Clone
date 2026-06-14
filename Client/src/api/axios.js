import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
  withCredentials: true, // send httpOnly cookies on every request
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── Request Interceptor ──────────────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Response Interceptor ─────────────────────────────────────────────────────
// Redirect to /login automatically on 401 Unauthorized responses.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Avoid redirect loops when already on login or signup pages.
      // Also prevent redirecting during the initial session check (/api/auth/me).
      const publicPaths = ["/login", "/signup"];
      const isAuthMe = error.config?.url?.endsWith("/api/auth/me");

      if (!publicPaths.includes(window.location.pathname) && !isAuthMe) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;