const express = require("express");
const router = express.Router();
const v1Router = require("./v1/routes");

router.use(express.json());
router.use("/v1", v1Router);

module.exports = router;
