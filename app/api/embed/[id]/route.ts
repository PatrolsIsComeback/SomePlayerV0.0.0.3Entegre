import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Video from '@/models/Video';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await dbConnect();
    
    // Sadece gerekli alanları seçerek veritabanından çek
    const video = await Video.findOne(
      { embedId: params.id },
      {
        originalUrl: 1,
        embedId: 1,
        animeTitle: 1,
        episodeNumber: 1,
        subtitles: 1,
        playCount: 1,
        lastPlayed: 1,
        createdAt: 1
      }
    ).lean();
    
    if (!video) {
      console.error(`Video bulunamadı: ${params.id}`);
      return NextResponse.json(
        { 
          success: false,
          error: 'Video not found' 
        },
        { status: 404 }
      );
    }

    // Oynatma sayısını artır
    await Video.updateOne(
      { _id: video._id },
      { 
        $inc: { playCount: 1 },
        $set: { lastPlayed: new Date() }
      }
    );

    // Altyazıları işle
    const processedSubtitles = video.subtitles?.map(sub => ({
      language: sub.language,
      languageCode: sub.languageCode || 'tr',
      content: sub.content,
      format: sub.format
    })) || [];

    return NextResponse.json({
      success: true,
      video: {
        url: video.originalUrl,
        embedId: video.embedId,
        animeTitle: video.animeTitle || '',
        episodeNumber: video.episodeNumber || '',
        subtitles: processedSubtitles,
        playCount: (video.playCount || 0) + 1, // Artırılmış değeri döndür
        createdAt: video.createdAt,
        lastPlayed: video.lastPlayed || new Date()
      }
    });

  } catch (error) {
    console.error('Video yüklenirken hata oluştu:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Video yüklenirken bir hata oluştu',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
