const apiRoutes = require("../api/routes");
const db = require("./db");
const notFound = require("../middleware/notFound");
const error = require("../middleware/error");

module.exports = (app) => {
    app.get("/", (req, res) => {
        res.json({ message: "node apis running fine" });
    });

    // Liveness: the process is up.
    app.get("/health", (req, res) => {
        res.json({ status: "ok", uptime: Math.round(process.uptime()) });
    });

    // Readiness: the process can serve traffic (database reachable).
    app.get("/ready", (req, res) => {
        const ready = db.isConnected();
        res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable" });
    });

    app.use("/api", apiRoutes);

    app.use(notFound);
    app.use(error);
};
