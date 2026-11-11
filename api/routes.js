const express = require("express");
const v1Router = require("./v1/routes");

const router = express.Router();

router.use(express.json({ limit: "10kb" }));
router.use("/v1", v1Router);

module.exports = router;
