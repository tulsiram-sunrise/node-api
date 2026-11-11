const express = require("express");
const UserController = require("../controllers/userController");
const auth = require("../middlewares/auth");
const validate = require("../../../middleware/validate");
const schemas = require("../validators/user");

const router = express.Router();

router.use(auth);

router.get("/me", UserController.getMe);
router.delete("/me", UserController.deleteMe);
router.patch("/me/level", validate(schemas.level), UserController.updateLevel);
router.put("/me/location", validate(schemas.location), UserController.updateLocation);
router.put("/me/setting", validate(schemas.setting), UserController.updateSetting);
router.get("/nearby", validate(schemas.nearbyQuery, "query"), UserController.nearby);

module.exports = router;
