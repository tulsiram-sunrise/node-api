const express = require("express");
const winston = require("winston");

const app = express();

require("./startup/logging")();
// only for demo
app.get("/", (req, res) => {
    res.send({"message": "node apis running fine"});
});

require("./startup/libs")();
require("./startup/validation")();
require("./startup/routes")(app);
require("./startup/db")();
require("./startup/config")();

// Running express server
const port = process.env.PORT || 5000;
const server = app.listen(port, () =>
    winston.info(`Server listening on port ${port}`)
);

module.exports = server;
