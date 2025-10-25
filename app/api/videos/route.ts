import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Video from '@/models/Video';
import { v4 as uuidv4 } from 'uuid';

// Altyazı dosyasını parse etme ve doğrulama fonksiyonu
function parseAndValidateSubtitle(
  content: string,
  format: 'sub' | 'sbv' | 'srt'
): { isValid: boolean; error?: string; parsedContent?: string } {
  try {
    // İçerik kontrolü
    if (!content || typeof content !== 'string') {
      return { isValid: false, error: 'Geçersiz altyazı içeriği' };
    }

    // Maksimum boyut kontrolü (10MB)
    if (content.length > 10 * 1024 * 1024) {
      return { isValid: false, error: 'Altyazı boyutu çok büyük (maksimum 10MB)' };
    }

    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
      return { isValid: false, error: 'Boş altyazı içeriği' };
    }

    // Format kontrolü
    if (format === 'sub' || format === 'srt') {
      const lines: string[] = trimmedContent.split('\n').filter((line: string) => line.trim() !== '');
      if (lines.length === 0) {
        return { isValid: false, error: 'Boş altyazı dosyası' };
      }

      // Zaman damgası içeren satır kontrolü (daha esnek)
      const hasTimecode = lines.some((line: string) =>
        /\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*--?\>\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{3}/.test(line) ||
        /\d{1,2}:\d{2}[,\.]\d{3}\s*--?\>\s*\d{1,2}:\d{2}[,\.]\d{3}/.test(line)
      );

      if (!hasTimecode) {
        return {
          isValid: false,
          error: 'Geçersiz SRT/SUB formatı: Zaman damgası bulunamadı',
        };
      }
    } else if (format === 'sbv') {
      // SBV formatı kontrolü
      const lines: string[] = trimmedContent.split('\n');
      const hasValidTimecode = lines.some((line: string) =>
        /^\d+:\d{2}:\d{2}\.\d{3},\d+:\d{2}:\d{2}\.\d{3}/.test(line)
      );

      if (!hasValidTimecode) {
        return {
          isValid: false,
          error: 'Geçersiz SBV formatı: Geçerli zaman damgası bulunamadı',
        };
      }
    } else {
      return { isValid: false, error: 'Desteklenmeyen altyazı formatı' };
    }

    // İçeriği temizle ve normalize et
    const cleanedContent: string = trimmedContent
      .split('\n')
      .map((line: string) => line.trimEnd()) // Sadece satır sonlarındaki boşlukları temizle
      .join('\n');

    return { isValid: true, parsedContent: cleanedContent };
  } catch (error) {
    console.error('Altyazı doğrulama hatası:', error);
    return {
      isValid: false,
      error: `Altyazı doğrulanırken hata oluştu: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();

    const { videoUrl, animeTitle = '', episodeNumber = '', subtitle } = await request.json();

    if (!videoUrl) {
      return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
    }

    // Check if video already exists
    let video = await Video.findOne({ originalUrl: videoUrl });

    if (!video) {
      // Create new video entry
      const embedId = uuidv4().split('-')[0];
      video = new Video({
        originalUrl: videoUrl,
        embedId,
        animeTitle,
        episodeNumber,
        subtitles: [],
      });

      // Altyazı ekle
      if (subtitle && subtitle.content && subtitle.language && subtitle.format) {
        const validationResult = parseAndValidateSubtitle(subtitle.content, subtitle.format);
        if (!validationResult.isValid) {
          console.error('Geçersiz altyazı formatı:', validationResult.error);
          return NextResponse.json(
            {
              success: false,
              error: validationResult.error || 'Geçersiz altyazı formatı',
              details: {
                format: subtitle.format,
                contentLength: subtitle.content.length,
                first100Chars: subtitle.content.substring(0, 100),
              },
            },
            { status: 400 }
          );
        }

        // Temizlenmiş içeriği kullan
        const cleanedContent = validationResult.parsedContent || subtitle.content;

        video.subtitles.push({
          language: subtitle.language,
          languageCode: (subtitle.languageCode || 'tr').toLowerCase(),
          content: cleanedContent,
          format: subtitle.format,
        });

        console.log(
          `✅ Yeni altyazı eklendi: ${subtitle.language} (${subtitle.format}), boyut: ${cleanedContent.length} karakter`
        );
      }

      await video.save();
    } else {
      // Update metadata if provided
      if (animeTitle) video.animeTitle = animeTitle;
      if (episodeNumber) video.episodeNumber = episodeNumber;

      // Altyazı ekle veya güncelle
      if (subtitle && subtitle.content && subtitle.language && subtitle.format) {
        const validationResult = parseAndValidateSubtitle(subtitle.content, subtitle.format);
        if (!validationResult.isValid) {
          console.error('Geçersiz altyazı formatı (güncelleme):', validationResult.error);
          return NextResponse.json(
            {
              success: false,
              error: validationResult.error || 'Geçersiz altyazı formatı',
              details: {
                format: subtitle.format,
                contentLength: subtitle.content.length,
                first100Chars: subtitle.content.substring(0, 100),
              },
            },
            { status: 400 }
          );
        }

        // Temizlenmiş içeriği kullan
        const cleanedContent = validationResult.parsedContent || subtitle.content;

        const languageCode = (subtitle.languageCode || 'tr').toLowerCase();
        const existingSubIndex = video.subtitles.findIndex(
          (sub: any) => sub.languageCode === languageCode
        );

        const newSubtitle = {
          language: subtitle.language,
          languageCode: languageCode,
          content: cleanedContent,
          format: subtitle.format,
          updatedAt: new Date(),
        };

        if (existingSubIndex >= 0) {
          video.subtitles[existingSubIndex] = newSubtitle;
          console.log(`✅ Altyazı güncellendi: ${subtitle.language} (${subtitle.format})`);
        } else {
          video.subtitles.push(newSubtitle);
          console.log(
            `✅ Yeni altyazı eklendi: ${subtitle.language} (${subtitle.format}), boyut: ${cleanedContent.length} karakter`
          );
        }
      }

      await video.save();
    }

    return NextResponse.json({
      success: true,
      embedId: video.embedId,
      embedUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/embed/${video.embedId}`,
      animeTitle: video.animeTitle,
      episodeNumber: video.episodeNumber,
      subtitles: video.subtitles.map((sub: any) => ({
        language: sub.language,
        languageCode: sub.languageCode,
        format: sub.format,
      })),
    });
  } catch (error) {
    console.error('Error saving video:', error);
    return NextResponse.json({ error: 'Failed to process video' }, { status: 500 });
  }
}

// Videoyu ID ile getirme endpoint'i
export async function GET(request: Request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const embedId = searchParams.get('embedId');

    if (!embedId) {
      return NextResponse.json({ error: 'Embed ID is required' }, { status: 400 });
    }

    const video = await Video.findOne({ embedId });

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      video: {
        originalUrl: video.originalUrl,
        embedId: video.embedId,
        animeTitle: video.animeTitle,
        episodeNumber: video.episodeNumber,
        subtitles: video.subtitles,
      },
    });
  } catch (error) {
    console.error('Error fetching video:', error);
    return NextResponse.json({ error: 'Failed to fetch video' }, { status: 500 });
  }
}
