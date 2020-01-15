const mongoose = require("mongoose");
const winston = require("winston");
const config = require("config");
const Fawn = require("fawn");

module.exports = () => {
    mongoose.set("useCreateIndex", true);
    // mongoose.set('useFindAndModify', false);
    mongoose
        .connect(config.get("db"), { useNewUrlParser: true })
        .then(() => winston.info("Connected to MongoDB..."));

    Fawn.init(mongoose);
};
