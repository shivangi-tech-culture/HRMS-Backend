/**
 * CHAT CONVERSATION MODEL — one row per direct chat (2 people) or group chat
 * Participants are User _ids as strings. Scoped to one company (companyId).
 */
const mongoose = require("mongoose");

/** Most people a group may hold (creator included) */
const MAX_GROUP_MEMBERS = 50;

/** Group member card (name + designation copied when added) */
const memberSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    name: { type: String, default: "" },
    designation: { type: String, default: "" },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    /** Company _id the chat belongs to (selected in the header switcher) */
    companyId: { type: String, required: true, trim: true, index: true },
    type: { type: String, enum: ["direct", "group"], default: "direct" },
    /** User _ids in the chat. Direct = exactly 2; group = 1..MAX_GROUP_MEMBERS */
    participantIds: {
      type: [String],
      required: true,
      validate: {
        validator(value) {
          if (!Array.isArray(value) || new Set(value).size !== value.length) return false;
          return this.type === "group"
            ? value.length >= 1 && value.length <= MAX_GROUP_MEMBERS
            : value.length === 2;
        },
        message: "Chat members are invalid",
      },
    },
    /**
     * Direct chats only: sorted "idA:idB". A unique index on participantIds would
     * apply per element and allow one chat per person, so the pair is one string.
     */
    pairKey: { type: String },
    /** Group chats only */
    name: { type: String, trim: true, maxlength: 80 },
    createdBy: { type: String },
    adminIds: { type: [String], default: undefined },
    members: { type: [memberSchema], default: undefined },
    /** Inbox preview text + time of the newest message */
    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

conversationSchema.index(
  { companyId: 1, pairKey: 1 },
  { unique: true, partialFilterExpression: { pairKey: { $type: "string" } } }
);
conversationSchema.index({ companyId: 1, participantIds: 1 });

/** Two User _ids in a stable order */
const sortedPair = (a, b) => [String(a), String(b)].sort();

/** pairKey for a direct chat */
const pairKeyOf = (participantIds) => [...participantIds].map(String).sort().join(":");

const ChatConversation = mongoose.model("ChatConversation", conversationSchema);

module.exports = ChatConversation;
module.exports.MAX_GROUP_MEMBERS = MAX_GROUP_MEMBERS;
module.exports.sortedPair = sortedPair;
module.exports.pairKeyOf = pairKeyOf;
