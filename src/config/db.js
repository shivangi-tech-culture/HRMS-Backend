/**
 * MongoDB connection
 *
 * Uses MONGODB_URI from .env. Exits the process if connection fails.
 */
const mongoose = require("mongoose");
const chalk = require("chalk");

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
