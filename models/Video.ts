import mongoose, { Document, Model } from 'mongoose';

interface ISubtitle {
  language: string;
  languageCode: string;
  content: string;
  format: 'sub' | 'sbv' | 'srt';
}

interface IVideo extends Document {
  originalUrl: string;
  embedId: string;
  animeTitle: string;
  episodeNumber: string;
  subtitles: ISubtitle[];
  createdAt: Date;
  lastPlayed?: Date;
  playCount: number;
}

const subtitleSchema = new mongoose.Schema({
  language: { type: String, required: true, index: true },
  languageCode: { type: String, required: true, index: true },
  content: { 
    type: String, 
    required: true,
    // Büyük metin alanları için özel ayarlar
    maxlength: 10485760, // 10MB maksimum boyut
  },
  format: { 
    type: String, 
    enum: ['sub', 'sbv', 'srt'], 
    required: true,
    index: true 
  },
});

const videoSchema = new mongoose.Schema<IVideo>({
  originalUrl: { type: String, required: true, unique: true },
  embedId: { type: String, required: true, unique: true },
  animeTitle: { type: String, default: '' },
  episodeNumber: { type: String, default: '' },
  subtitles: { type: [subtitleSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  lastPlayed: { type: Date },
  playCount: { type: Number, default: 0 },
});

// Modeli daha güvenli bir şekilde oluşturuyoruz
const Video: Model<IVideo> = 
  (mongoose.models.Video as Model<IVideo>) || 
  mongoose.model<IVideo>('Video', videoSchema);

export default Video;