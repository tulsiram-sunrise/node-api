const mongoose = require("mongoose");

const RETENTION_SECONDS = 365 * 24 * 60 * 60;

/**
 * Record of a provider-initiated data deletion (Facebook data-deletion
 * callback). Holds no personal data: only the confirmation code shown to the
 * user, so the status URL keeps working. Expires after a year.
 */
const deletionRequestSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, unique: true },
        provider: { type: String, enum: ["facebook"], required: true },
        status: { type: String, enum: ["completed"], default: "completed" },
    },
    { timestamps: true }
);

deletionRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const DeletionRequest =
    mongoose.models.DeletionRequest || mongoose.model("DeletionRequest", deletionRequestSchema);

module.exports = { DeletionRequest };
