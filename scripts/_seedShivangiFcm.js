/**
 * Add dummy FCM token structure on shivangi@techculture.ai for mobile QA.
 * Run: node scripts/_seedShivangiFcm.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");

const tokens = [
  {
    token: "DUMMY_FCM_ANDROID_SHIVANGI_TEST_REPLACE_WITH_REAL_DEVICE_TOKEN",
    platform: "android",
    deviceId: "seed-android-shivangi",
    updatedAt: new Date(),
  },
  {
    token: "DUMMY_FCM_IOS_SHIVANGI_TEST_REPLACE_WITH_REAL_DEVICE_TOKEN",
    platform: "ios",
    deviceId: "seed-ios-shivangi",
    updatedAt: new Date(),
  },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOneAndUpdate(
    { "official.officialEmail": "shivangi@techculture.ai" },
    { $set: { fcmTokens: tokens } },
    { new: true }
  ).select("name official.officialEmail official.employeeCode fcmTokens");

  if (!user) {
    console.error("User not found: shivangi@techculture.ai — run npm run seed first");
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        name: user.name,
        email: user.official?.officialEmail,
        code: user.official?.employeeCode,
        fcmTokens: user.fcmTokens,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
