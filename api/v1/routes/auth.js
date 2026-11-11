const express = require("express");
const AuthController = require("../controllers/authController");
const validate = require("../../../middleware/validate");
const schemas = require("../validators/auth");
const { authLimiter } = require("../../../startup/security");

const router = express.Router();

// Data-deletion routes are registered before the strict login limiter: Meta
// may call the callback many times in a burst from the same IPs, and the
// status page is opened by users. The global limiter still applies.
router.post(
    "/facebook/data-deletion",
    express.urlencoded({ extended: false, limit: "10kb" }),
    validate(schemas.facebookDataDeletion),
    AuthController.facebookDataDeletion
);
router.get(
    "/facebook/data-deletion/:code",
    validate(schemas.dataDeletionStatus, "params"),
    AuthController.dataDeletionStatus
);

router.use(authLimiter());

router.post("/facebook", validate(schemas.facebook), AuthController.facebook);
router.post("/google", validate(schemas.google), AuthController.google);

module.exports = router;
