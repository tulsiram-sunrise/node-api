const mongoose = require("mongoose");
const winston = require("winston");
const config = require("config");

module.exports = () => {
    mongoose.set("useCreateIndex", true);
    mongoose.set('useFindAndModify', true);
    mongoose
        .connect(config.get("db"), { useNewUrlParser: true })
        .then(() => winston.info("Connected to MongoDB..."));
};
