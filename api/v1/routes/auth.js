const express = require("express");
const AuthController = require("../controllers/authController");
const validate = require("../../../middleware/validate");
const schemas = require("../validators/auth");
const { authLimiter } = require("../../../startup/security");

const router = express.Router();

router.use(authLimiter());

router.post("/facebook", validate(schemas.facebook), AuthController.facebook);
router.post("/google", validate(schemas.google), AuthController.google);

module.exports = router;
