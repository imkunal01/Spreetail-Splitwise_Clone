import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
  withCredentials: true, // send httpOnly cookies on every request
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── Response Interceptor ─────────────────────────────────────────────────────
// Redirect to /login automatically on 401 Unauthorized responses.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Avoid redirect loops when already on the login page
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;