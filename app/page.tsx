"use client";

import { useState, useEffect } from 'react';
import { VideoPlayer } from '@/components/VideoPlayer';
import { VideoUploader } from '@/components/VideoUploader';
import { AccessCodeModal } from '@/components/AccessCodeModal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Video, Upload, FileText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

// Move all state declarations to the top level
const useAccessControl = () => {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkAccess = () => {
      if (typeof window !== 'undefined') {
        const accessCode = localStorage.getItem('accessCode');
        setHasAccess(!!accessCode);
        setIsChecking(false);
      }
    };
    
    checkAccess();
  }, []);

  return { hasAccess, isChecking };
};

export default function Home() {
  const { hasAccess, isChecking } = useAccessControl();
  
  // Move all state declarations to the top level
  const [videoUrl, setVideoUrl] = useState('');
  const [currentVideo, setCurrentVideo] = useState<{ 
    playbackUrl: string; 
    progressKey: string;
    embedId?: string;
    embedUrl?: string;
    animeTitle?: string;
    episodeNumber?: string;
    subtitles?: Array<{language: string; languageCode: string; content: string; format: string}>;
  } | null>(null);
  const [animeTitle, setAnimeTitle] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // OneSub™ - Altyazı yönetimi
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [subtitleLanguage, setSubtitleLanguage] = useState('Türkçe');
  const [subtitleLanguageCode, setSubtitleLanguageCode] = useState('tr');

  // Show loading state while checking access
  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Show access code modal if no access
  if (!hasAccess) {
    return <AccessCodeModal />;
  }

  const proxyEndpoint = process.env.NEXT_PUBLIC_PROXY_ENDPOINT || '/api/proxy';

  interface SourceInfo {
    provider: string;
    identifier: string;
    original: string;
  }

  const detectSource = (value: string): SourceInfo => {
    const trimmed = value.trim().split('?')[0]; // Remove query parameters for cleaner matching
    
    try {
      // Try to parse as URL first
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase();
      
      // Google Drive
      if (host.includes('drive.google.com')) {
        const idParam = url.searchParams.get('id');
        const match = url.pathname.match(/\/file\/d\/([^/]+)/);
        return { 
          provider: 'google-drive', 
          identifier: idParam ?? match?.[1] ?? trimmed, 
          original: trimmed 
        };
      }
      
      // Vidmoly
      if (host.includes('vidmoly')) {
        const slug = url.pathname.split('/').filter(Boolean).pop() ?? trimmed;
        return { 
          provider: 'vidmoly', 
          identifier: slug, 
          original: trimmed 
        };
      }
      
      // VOE
      if (host.includes('voe.sx') || host.includes('voe-unblock.com')) {
        const slug = url.pathname.split('/').filter(Boolean).pop() ?? trimmed;
        return { 
          provider: 'voe', 
          identifier: slug, 
          original: trimmed 
        };
      }
      
      // Common video file extensions
      const videoExtensions = ['.mp4', '.m3u8', '.webm', '.mov', '.mkv'];
      const hasVideoExtension = videoExtensions.some(ext => path.endsWith(ext));
      
      if (hasVideoExtension) {
        return { 
          provider: 'direct', 
          identifier: trimmed, 
          original: trimmed 
        };
      }
      
      // Streamtape
      if (host.includes('streamtape')) {
        return { 
          provider: 'streamtape', 
          identifier: trimmed, 
          original: trimmed 
        };
      }
      
      // Dood
      if (host.includes('dood')) {
        return { 
          provider: 'dood', 
          identifier: trimmed, 
          original: trimmed 
        };
      }
      
      // M3U8 master playlist (can be any domain)
      if (path.endsWith('.m3u8')) {
        return { 
          provider: 'hls', 
          identifier: trimmed, 
          original: trimmed 
        };
      }
      
    } catch (e) {
      // If URL parsing fails, check for direct file extensions
      const trimmedLower = trimmed.toLowerCase();
      const directExtensions = ['.mp4', '.m3u8', '.webm', '.mov', '.mkv'];
      
      if (directExtensions.some(ext => trimmedLower.endsWith(ext))) {
        return { 
          provider: 'direct', 
          identifier: trimmed, 
          original: trimmed 
        };
      }
      
      // Check for embedded iframe URLs
      const iframeMatch = trimmed.match(/src=["']([^"']+)["']/i);
      if (iframeMatch && iframeMatch[1]) {
        return detectSource(iframeMatch[1]);
      }
    }
    
    // If we get here, try to extract any URL from the text
    const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      return detectSource(urlMatch[1]);
    }
    
    return { 
      provider: 'unknown', 
      identifier: value, 
      original: value 
    };
  };

  const buildProgressKey = (provider: string, identifier: string) => `${provider}:${identifier}`;

  const resolveVideoSource = async (value: string) => {
    const info = detectSource(value);
    
    // Altyazı dosyasını oku
    let subtitleData = null;
    if (subtitleFile) {
      const content = await subtitleFile.text();
      const format = subtitleFile.name.split('.').pop()?.toLowerCase() as 'sub' | 'sbv' | 'srt';
      
      if (!['sub', 'sbv', 'srt'].includes(format || '')) {
        throw new Error('Desteklenmeyen altyazı formatı. Lütfen .sub, .sbv veya .srt dosyası yükleyin.');
      }
      
      subtitleData = {
        language: subtitleLanguage,
        languageCode: subtitleLanguageCode,
        content,
        format,
      };
    }
    
    // For direct MP4 URLs, we'll save them to our database
    if (info.provider === 'direct') {
      // Save to our database and get embed info
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          videoUrl: info.original,
          animeTitle,
          episodeNumber,
          subtitle: subtitleData,
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData?.error || 'Failed to save video');
      }
      
      const { embedId, embedUrl, animeTitle: savedTitle, episodeNumber: savedEpisode, subtitles } = await response.json();
      
      return { 
        playbackUrl: info.original, 
        progressKey: buildProgressKey('embed', embedId),
        embedId,
        embedUrl,
        animeTitle: savedTitle,
        episodeNumber: savedEpisode,
        subtitles: subtitles || [],
      };
    }
    
    // For other sources, use the existing proxy system
    if (info.provider === 'unknown') {
      throw new Error('Desteklenmeyen video bağlantısı.');
    }
    
    if (!proxyEndpoint) {
      throw new Error('Proxy endpoint yapılandırılmamış.');
    }
    
    const response = await fetch(proxyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ provider: info.provider, source: info.original, identifier: info.identifier })
    });
    
    if (!response.ok) {
      let details: string | undefined;
      try {
        const errorData = await response.json();
        details = errorData?.message || errorData?.details;
      } catch (error) {
        // no-op
      }
      throw new Error(details ?? 'Proxy isteği başarısız oldu.');
    }
    
    const data = await response.json();
    if (!data?.playbackUrl || typeof data.playbackUrl !== 'string') {
      throw new Error('Proxy yanıtı geçersiz.');
    }
    
    // For proxy responses, we'll still save the original URL to get an embed
    const saveResponse = await fetch('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        videoUrl: info.original,
        animeTitle,
        episodeNumber,
        subtitle: subtitleData,
      })
    });

    let embedId = '';
    let embedUrl = '';
    let savedTitle = '';
    let savedEpisode = '';
    let subtitles: any[] = [];

    if (saveResponse.ok) {
      const embedData = await saveResponse.json();
      embedId = embedData.embedId;
      embedUrl = embedData.embedUrl;
      savedTitle = embedData.animeTitle;
      savedEpisode = embedData.episodeNumber;
      subtitles = embedData.subtitles || [];
    }

    return { 
      playbackUrl: data.playbackUrl, 
      progressKey: buildProgressKey(info.provider, info.identifier),
      embedId,
      embedUrl,
      animeTitle: savedTitle,
      episodeNumber: savedEpisode,
      subtitles,
    };
  };

  const loadVideoFromInput = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const source = await resolveVideoSource(trimmed);
      setCurrentVideo(source);
    } catch (err) {
      setCurrentVideo(null);
      setError(err instanceof Error ? err.message : 'Video yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadVideo = () => {
    if (!isLoading) {
      void loadVideoFromInput(videoUrl);
    }
  };

  const sampleVideos = [
    {
      title: 'Big Buck Bunny',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      description: 'Open source test video'
    },

    {
      title: 'M3U8 Uzantılı',
      url: 'http://content.jwplatform.com/manifests/vM7nH0Kl.m3u8',
      description: 'Open source test video'
    },

{
      title: 'OneSub altyazı testi (m3u8)',
      url: 'https://makunouchi.asia/file/tau-video/hls_687fb7ae7959f6da22488145_2c54df79-757f-41e3-b912-42b22a351c2a/master.m3u8',
      description: 'Altyazı testi :)'
    },
// https://hinarein.icu/file/tau-video/af675ea7-3e48-45a5-805c-a02ee54d0df7.mp4

{
      title: 'OneSub altyazı testi (mp4)',
      url: 'https://hinarein.icu/file/tau-video/af675ea7-3e48-45a5-805c-a02ee54d0df7.mp4',
      description: 'Altyazı testi :)'
    },


   {
      title: 'Sintel',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      description: 'Open source test video'
    },

    {
      title: 'Elephant Dream',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      description: 'Open source test video'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Video className="h-10 w-10 text-blue-600" />
            <h1 className="text-4xl font-bold tracking-tight">Some Player</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            SomeSubs için geliştirilmeye devam eden SomePlayer V0.0.0.8
          </p> 
        </div>

        <Card className="mb-8 shadow-lg">
          <CardHeader>
            <CardTitle>Video Yükle</CardTitle>
            <CardDescription>
              MP4 video URL'si girin veya örnek videoları deneyin
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <Input
                type="text"
                placeholder="Anime adı (ör. Takopi no Genzei)"
                value={animeTitle}
                onChange={(e) => setAnimeTitle(e.target.value)}
              />
              <Input
                type="text"
                placeholder="Bölüm numarası (ör. 4. Bölüm)"
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(e.target.value)}
              />
              
              {/* OneSub™ - Altyazı Yükleme */}
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <Label className="text-base font-semibold">OneSub™ - Altyazı Ekle</Label>
                  <span className="text-xs bg-gradient-to-r from-blue-500 to-purple-500 text-white px-2 py-0.5 rounded">BETA</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="subtitle-language">Altyazı Dili</Label>
                    <Select value={subtitleLanguageCode} onValueChange={(value) => {
                      setSubtitleLanguageCode(value);
                      const langMap: {[key: string]: string} = {
                        'tr': 'Türkçe',
                        'en': 'İngilizce',
                        'ja': 'Japonca',
                        'de': 'Almanca',
                        'fr': 'Fransızca',
                        'es': 'İspanyolca',
                        'it': 'İtalyanca',
                        'ru': 'Rusça',
                        'ar': 'Arapça',
                        'ko': 'Korece',
                        'zh': 'Çince'
                      };
                      setSubtitleLanguage(langMap[value] || 'Türkçe');
                    }}>
                      <SelectTrigger id="subtitle-language">
                        <SelectValue placeholder="Dil seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tr">🇹🇷 Türkçe</SelectItem>
                        <SelectItem value="en">🇬🇧 İngilizce</SelectItem>
                        <SelectItem value="ja">🇯🇵 Japonca</SelectItem>
                        <SelectItem value="de">🇩🇪 Almanca</SelectItem>
                        <SelectItem value="fr">🇫🇷 Fransızca</SelectItem>
                        <SelectItem value="es">🇪🇸 İspanyolca</SelectItem>
                        <SelectItem value="it">🇮🇹 İtalyanca</SelectItem>
                        <SelectItem value="ru">🇷🇺 Rusça</SelectItem>
                        <SelectItem value="ar">🇸🇦 Arapça</SelectItem>
                        <SelectItem value="ko">🇰🇷 Korece</SelectItem>
                        <SelectItem value="zh">🇨🇳 Çince</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="subtitle-file">Altyazı Dosyası (.sub, .sbv, .srt)</Label>
                    <Input
                      id="subtitle-file"
                      type="file"
                      accept=".sub,.sbv,.srt"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setSubtitleFile(file);
                        }
                      }}
                      className="cursor-pointer"
                    />
                  </div>
                </div>
                
                {subtitleFile && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 p-2 rounded">
                    <FileText className="h-4 w-4" />
                    <span>{subtitleFile.name} - {subtitleLanguage}</span>
                  </div>
                )}
              </div>
              
              <Tabs defaultValue="url" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="url">URL ile Yükle</TabsTrigger>
                  <TabsTrigger value="upload">Dosya Yükle</TabsTrigger>
                </TabsList>
                <TabsContent value="url" className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="https://example.com/video.mp4"
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
                      className="flex-1"
                    />
                    <Button onClick={handleLoadVideo} disabled={isLoading}>
                      {isLoading ? 'Yükleniyor...' : 'Yükle'}
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="upload">
                  <VideoUploader 
                    onUploadComplete={(url) => {
                      setVideoUrl(url);
                      // Small delay to ensure state is updated before loading
                      setTimeout(() => handleLoadVideo(), 100);
                    }} 
                  />
                </TabsContent>
              </Tabs>
            </div>
            {error && (
              <p className="mt-3 text-sm text-red-500">{error}</p>
            )}
          </CardContent>
        </Card>

        {currentVideo && (
          <>
            <Card className="mb-8 shadow-lg overflow-hidden">
              <CardContent className="p-0">
                <VideoPlayer
                  src={currentVideo.playbackUrl}
                  progressKey={currentVideo.progressKey}
                  className="w-full aspect-video"
                  overlayLabel={[currentVideo.animeTitle, currentVideo.episodeNumber].filter(Boolean).join(' ')}
                  subtitles={currentVideo.subtitles || []}
                />
              </CardContent>
            </Card>
            
            {currentVideo.embedUrl && (
              <Card className="mb-8">
                <CardHeader>
                  <CardTitle>Embed This Video</CardTitle>
                  <CardDescription>
                    Use this code to embed this video on other websites
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium mb-1">Embed URL:</p>
                      <div className="flex gap-2">
                        <Input 
                          value={currentVideo.embedUrl} 
                          readOnly 
                          className="font-mono text-sm"
                        />
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(currentVideo.embedUrl || '');
                            // You might want to add a toast notification here
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-1">Embed Code:</p>
                      <div className="relative">
                        <pre className="p-4 bg-gray-100 dark:bg-gray-800 rounded-md overflow-x-auto text-sm">
                          {`<iframe 
  src="${currentVideo.embedUrl}" 
  width="800" 
  height="450" 
  frameborder="0" 
  allowfullscreen>
</iframe>`}
                        </pre>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => {
                            const code = `<iframe src="${currentVideo.embedUrl}" width="800" height="450" frameborder="0" allowfullscreen></iframe>`;
                            navigator.clipboard.writeText(code);
                            // You might want to add a toast notification here
                          }}
                        >
                          Copy Code
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {sampleVideos.map((video, index) => (
            <Card
              key={index}
              className="cursor-pointer hover:shadow-xl transition-all hover:-translate-y-1"
              onClick={() => {
                setVideoUrl(video.url);
                void loadVideoFromInput(video.url);
              }}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5 text-blue-600" />
                  {video.title}
                </CardTitle>
                <CardDescription>{video.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="mt-8 p-6 bg-white dark:bg-slate-800 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Özellikler</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Oynat/Duraklat kontrolü</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>10 saniye ileri/geri atlama</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Tam ekran modu</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Ses kontrolü ve sessiz mod</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Video önizleme thumbnail'leri</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Oynatma hızı ayarı (0.25x - 2x)</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Video kalite seçenekleri</span>
            </div>

        <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>OneCore™ nedir? : OneVision™ ve OneHDR™ ile videolarınızı daha canlı ve kaliteli yapın</span>
            </div>
            
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>OneSub™ - Akıllı altyazı sistemi (.sub, .sbv, .srt desteği)</span>
            </div>

            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Tekrar modları (tek/tümü)</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Mobil dokunmatik destek</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2" />
              <span>Klavye kısayolları</span>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-semibold mb-3">Klavye Kısayolları</h3>
            <div className="grid md:grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Oynat/Duraklat</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">Space / K</code>
              </div>
              <div className="flex justify-between">
                <span>10 sn geri</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">← / J</code>
              </div>
              <div className="flex justify-between">
                <span>10 sn ileri</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">→ / L</code>
              </div>
              <div className="flex justify-between">
                <span>Ses artır/azalt</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">↑ / ↓</code>
              </div>
              <div className="flex justify-between">
                <span>Sessiz</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">M</code>
              </div>
              <div className="flex justify-between">
                <span>Tam ekran</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">F</code>
              </div>
              <div className="flex justify-between">
                <span>Başa dön</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">0 / Home</code>
              </div>
              <div className="flex justify-between">
                <span>Sona git</span>
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">End</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}