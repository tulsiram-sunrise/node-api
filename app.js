const express = require("express");
const requestContext = require("./middleware/requestContext");

/** Build the Express app without starting a server or a DB connection (test-friendly). */
module.exports = function createApp() {
    const app = express();

    app.use(requestContext);
    require("./startup/security")(app);
    require("./startup/routes")(app);

    return app;
};
