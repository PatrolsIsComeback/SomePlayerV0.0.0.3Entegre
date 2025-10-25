import mongoose, { ConnectOptions } from 'mongoose';

// MongoDB connection string
const MONGODB_URI = 'mongodb+srv://SomePlayerIDCreaterLoginSystem:flash429ea@someplayeridcreaterlogi.ipgnz4d.mongodb.net/test?retryWrites=true&w=majority';

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable');
}

// Type for the mongoose cache
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Extend the NodeJS global type
declare global {
  var mongoose: MongooseCache;
}

let cached = global.mongoose || { conn: null, promise: null };

if (!global.mongoose) {
  global.mongoose = { conn: null, promise: null };
}

async function dbConnect(): Promise<typeof mongoose> {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    // Minimal connection options
    const opts: ConnectOptions = {
      serverSelectionTimeoutMS: 5000, // 5 seconds
      socketTimeoutMS: 30000, // 30 seconds
      connectTimeoutMS: 10000, // 10 seconds
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority',
      // Remove all TLS options - let the connection string handle it
    };

    try {
      cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
        console.log('MongoDB connected successfully');
        return mongoose;
      });
    } catch (e) {
      console.error('MongoDB connection error:', e);
      throw e;
    }
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error('MongoDB connection failed:', e);
    throw e;
  }

  return cached.conn;
}

export default dbConnect;
