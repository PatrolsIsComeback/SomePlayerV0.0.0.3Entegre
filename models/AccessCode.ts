import mongoose from 'mongoose';

const accessCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  used: {
    type: Boolean,
    default: false,
  },
  usedAt: {
    type: Date,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Add index for faster lookups
accessCodeSchema.index({ code: 1 });
accessCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save hook to update the updatedAt field
accessCodeSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to validate an access code
accessCodeSchema.statics.validateCode = async function(code: string) {
  const accessCode = await this.findOne({
    code,
    used: false,
    expiresAt: { $gt: new Date() }
  });

  if (!accessCode) {
    return { valid: false, message: 'Geçersiz veya süresi dolmuş erişim kodu.' };
  }

  // Mark the code as used
  accessCode.used = true;
  accessCode.usedAt = new Date();
  await accessCode.save();

  return { valid: true, message: 'Erişim kodu doğrulandı.' };
};

const AccessCode = mongoose.models.AccessCode || mongoose.model('AccessCode', accessCodeSchema, 'accesscodes');

export default AccessCode;
