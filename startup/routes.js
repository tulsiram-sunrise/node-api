const express = require("express");
const apiRoutes = require("../api/routes");
const error = require("../middleware/error");

module.exports = app => {
    // resource path that will be available publically
    app.use(express.static("public/"));

    // Setting routes for the applications, api and web routes
    app.use("/api", apiRoutes);

    // Handling error if any occured in request processign pipeline
    // (In this error handling anything outside the context of express)
    app.use(error);
};
