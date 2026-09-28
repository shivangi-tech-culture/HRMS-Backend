/**
 * DATABASE CONFIG — connect Mongoose to MongoDB (MONGODB_URI)
 */
const mongoose = require("mongoose");
const chalk = require("chalk");

/** Connect Mongoose using MONGODB_URI; exit on failure */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(
      chalk.bgYellow.black.bold("  ✓  MongoDB connected                    ")
    );
  } catch (err) {
    console.error(
      chalk.bgRed.white.bold("  ✗  MongoDB error:"),
      chalk.bgYellow.black(` ${err.message} `)
    );
    process.exit(1);
  }
};

module.exports = connectDB;
