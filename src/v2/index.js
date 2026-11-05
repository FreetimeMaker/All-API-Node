const express = require("express");
const router = express.Router();
const health = require("./health/health");
const supabaseRoutes = require("./auth/supabase");
const walloraWallpapers = require("./wallora/wallpapers");
const lumaStore = require("./lumastore/store");
const blogRoutes = require("./blog");

// Vercel (Rolldown) liefert gebündelte Module in wechselnden Formen.
const asRouter = (m) => {
  for (let d = 0; d < 5 && m != null; d++) {
    if (typeof m === "function") {
      if (typeof m.use === "function" && typeof m.get === "function") return m;
      m = m();
      continue;
    }
    if (typeof m.default === "function") {
      if (
        typeof m.default.use === "function" &&
        typeof m.default.get === "function"
      )
        return m.default;
      m = m.default();
      continue;
    }
    if (m.default && typeof m.default === "object") {
      m = m.default;
      continue;
    }
    return null;
  }
  return null;
};

router.use("/health", asRouter(health));
router.use("/auth", asRouter(supabaseRoutes));
router.use("/wallora/wallpapers", asRouter(walloraWallpapers));
router.use("/lumastore", asRouter(lumaStore));
router.use("/blog", asRouter(blogRoutes));

router.get("/v2", (req, res) => {
  res.json({
    message: "Welcome to the All API v2!",
    version: "2.8.1",
    endpoints: {
      "cross endpoints": {
        health: "/health",
        login: "/auth/login",
        logout: "/auth/logout",
      },
      "Wallora endpoints": {
        wallpapers: "/wallora/wallpapers",
      },
      "Luma Store endpoints": {
        apps: "/lumastore/apps",
        appDetails: "/lumastore/apps/:id",
        ratings: "/lumastore/apps/:id/ratings",
        myRating: "/lumastore/apps/:id/rating/me",
        setMyRating: "PUT /lumastore/apps/:id/rating/me",
        deleteMyRating: "DELETE /lumastore/apps/:id/rating/me",
        resolveSource:
          "/lumastore/sources/resolve?url=<repository-or-direct-url>&platform=Android",
      },
      "MD-Blog endpoints": {
        posts: "/blog/posts",
        postDetails: "/blog/posts/:slug",
        categories: "/blog/categories",
      },
    },
  });
});

module.exports = router;
