"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, 
  SkipBack, SkipForward, Settings, Repeat, Repeat1, ChevronLeft,
  FastForward, Rewind, Check, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import Hls from 'hls.js';

// OneVision™ and OneHDR™ CSS
const oneVisionStyles = `
  .onevision-video {
    transition: filter 0.3s ease, transform 0.3s ease;
    will-change: filter, transform;
  }
  
  .onevision-enabled {
    filter: brightness(var(--onevision-brightness, 1)) 
            contrast(var(--onevision-contrast, 1)) 
            saturate(var(--onevision-saturation, 1))
            sepia(0) 
            hue-rotate(0deg);
  }
  
  /* OneHDR™ Styles */
  .onehdr-enabled {
    --hdr-brightness: 1.1;
    --hdr-contrast: 1.2;
    --hdr-saturation: 1.25;
    --hdr-highlight: 1.15;
    --hdr-shadow: 0.95;
    --hdr-vibrance: 1.1;
    
    filter: brightness(calc(var(--onevision-brightness, 1) * var(--hdr-brightness)))
            contrast(calc(var(--onevision-contrast, 1) * var(--hdr-contrast)))
            saturate(calc(var(--onevision-saturation, 1) * var(--hdr-saturation)))
            drop-shadow(0 0 1px rgba(255, 255, 255, 0.1));
  }
  
  /* Dynamic Tone Mapping */
  .onehdr-tone-mapping {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    background: 
      /* Vignette efekti */
      radial-gradient(
        circle at 50% 50%,
        transparent 0%,
        rgba(0, 0, 0, 0.3) 100%
      ),
      /* Üstten gölge */
      linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.15) 0%,
        transparent 30%,
        transparent 70%,
        rgba(0, 0, 0, 0.1) 100%
      );
    mix-blend-mode: multiply;
    pointer-events: none;
    opacity: 0.6;
    transition: opacity 0.3s ease;
  }
  
  /* Sıcak/Soğuk ton ayarı için filtreler */
  .onehdr-warm {
    filter: sepia(0.1) hue-rotate(calc(var(--hdr-warmth, 1) * 5deg)) saturate(1.1);
  }
  
  .onehdr-cool {
    filter: sepia(0.1) hue-rotate(calc(var(--hdr-coolness, 1) * -5deg)) saturate(1.1);
  }
  
  .onevision-profile-natural {
    --onevision-brightness: 1.05;
    --onevision-contrast: 1.05;
    --onevision-saturation: 1.1;
  }
  
  .onevision-profile-vivid {
    --onevision-brightness: 1.1;
    --onevision-contrast: 1.1;
    --onevision-saturation: 1.3;
  }
  
  .onevision-profile-cinematic {
    --onevision-brightness: 1.08;
    --onevision-contrast: 1.15;
    --onevision-saturation: 1;
    filter: sepia(0.1) hue-rotate(-5deg);
  }
  
  .onevision-profile-cool {
    --onevision-brightness: 1.05;
    --onevision-contrast: 1.05;
    --onevision-saturation: 1.1;
    filter: hue-rotate(190deg) saturate(1.2);
  }

  .onevision-profile-ozel {
  --onevision-brightness: 1.3;    /* Videoyu biraz daha parlak yap */
  --onevision-contrast: 1.2;      /* Kontrastı artır, detaylar patlasın */
  --onevision-saturation: 1.25;   /* Renkleri daha canlı yap */
  --onevision-hue-rotate: -5deg;  /* Hafif renk tonu değişimi, daha sinema havası */
  --onevision-gamma: 1.05;        /* Gölge ve ışığı dengeleyip gözü yormasın */
  --onevision-vignette: 0.85;     /* Kenarlara hafif kararma efekti */
}
  
  .onevision-profile-warm {
    --onevision-brightness: 1.05;
    --onevision-contrast: 1.1;
    --onevision-saturation: 1.2;
    filter: sepia(0.1) hue-rotate(10deg) saturate(1.1);
  }
`;

// Add OneVision styles to the document head
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = oneVisionStyles;
  document.head.appendChild(styleElement);
}

// Sabitler güncellendi
const SEEK_SECONDS = 10;
const LONG_PRESS_DELAY = 500;
const DOUBLE_CLICK_INTERVAL = 300;
const THUMBNAIL_UPDATE_INTERVAL = 5.0;
const STORAGE_PREFIX = 'video-progress-';

// Kontrollerin ve Progress Bar'ın kaybolma süresi (2 saniye olarak güncellendi)
const HIDE_CONTROLS_DELAY = 2000; 
// "Kaldığınız yerden devam ediliyor" göstergesinin kaybolma süresi (10 saniye)
const HIDE_RESUME_INDICATOR_DELAY = 10000; 

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  progressKey?: string;
  overlayLabel?: string;
  subtitles?: Array<{language: string; languageCode: string; content: string; format: string}>;
}

// Zaman formatlama işlevi (dışarıya taşındı)
const formatTime = (time: number): string => {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = Math.floor(time % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Birleşik olay tipi tanımı
type ProgressInteractionEvent = React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>;

export function VideoPlayer({ src, poster, className, progressKey, overlayLabel, subtitles = [] }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbnailCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<'main' | 'speed' | 'quality' | 'onevision' | 'onesub'>('main');
  const [quality, setQuality] = useState('auto');
  const [hls, setHls] = useState<Hls | null>(null);
  const [availableQualities, setAvailableQualities] = useState<Array<{height: number, width: number, bitrate: number, name: string, selected: boolean}>>([]);
  const [isLoadingQualities, setIsLoadingQualities] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  
  // Scene Detection State
  const [scenes, setScenes] = useState<Array<{start: number, end: number, settings: any}>>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number>(-1);
  const [isAnalyzingScenes, setIsAnalyzingScenes] = useState(false);
  const [sceneDetectionEnabled, setSceneDetectionEnabled] = useState(false);
  
  // OneVision™ & OneHDR™ State
  const [oneVisionEnabled, setOneVisionEnabled] = useState(false);
  const [oneHDREnabled, setOneHDREnabled] = useState(false);
  const [colorProfile, setColorProfile] = useState<'natural' | 'vivid' | 'cinematic' | 'ozel' | 'cool' | 'warm'>('natural');
  const [isAutoEnhance, setIsAutoEnhance] = useState(true);
  
  // OneHDR™ Settings
  const [hdrSettings, setHdrSettings] = useState({
    intensity: 0.7,     // Genel HDR etkisi şiddeti (70%)
    contrastDepth: 1.05, // Kontrast derinliği (5%)
    colorVibrancy: 1.1, // Renk canlılığı (10%)
    highlightDetail: 1.0, // Ayrıntıları koruma (parlak alanlar)
    shadowDetail: 1.0,  // Gölge detayları
    toneBalance: 0.5,   // Ton dengesi (0: daha koyu, 1: daha aydınlık, 0.5: Doğal)
    isDynamic: true,    // Dinamik ton eşleme aktif mi?
    isAuto: false       // Otomatik ayarlar aktif mi?
  });
  
  const [isAnalyzingHDR, setIsAnalyzingHDR] = useState(false);
  const lastAnalysisTime = useRef(0);
  
  // Gelişmiş HDR analizi için histogram analizi yapar
  const analyzeFrame = (imageData: ImageData) => {
    const data = imageData.data;
    const histogram = {
      r: new Array(256).fill(0),
      g: new Array(256).fill(0),
      b: new Array(256).fill(0),
      luma: new Array(256).fill(0)
    };
    
    let rSum = 0, gSum = 0, bSum = 0;
    let minLuma = 255, maxLuma = 0;
    let pixelCount = 0;
    
    // Her 4 pikselde bir örnek al (performans için)
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Luminance (BT.709)
      const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      
      histogram.r[r]++;
      histogram.g[g]++;
      histogram.b[b]++;
      histogram.luma[luma]++;
      
      rSum += r;
      gSum += g;
      bSum += b;
      
      minLuma = Math.min(minLuma, luma);
      maxLuma = Math.max(maxLuma, luma);
      
      pixelCount++;
    }
    
    // Ortalama değerler
    const avgR = rSum / pixelCount;
    const avgG = gSum / pixelCount;
    const avgB = bSum / pixelCount;
    const avgLuma = (avgR * 0.2126 + avgG * 0.7152 + avgB * 0.0722);
    
    // Kontrast oranı (0-1 arası)
    const contrastRatio = (maxLuma - minLuma) / 255;
    
    // Renk doygunluğu
    const colorfulness = Math.sqrt(
      (Math.pow(avgR - avgLuma, 2) + 
       Math.pow(avgG - avgLuma, 2) + 
       Math.pow(avgB - avgLuma, 2)) / 3
    ) / 128; // Normalize
    
    return {
      histogram,
      avgLuma: avgLuma / 255, // 0-1 arası
      contrastRatio,
      colorfulness,
      isLowLight: avgLuma < 50,
      isHighKey: avgLuma > 200 && contrastRatio < 0.5,
      isHighContrast: contrastRatio > 0.7,
      isColorful: colorfulness > 0.2
    };
  };
  
  // Video içeriğini analiz edip HDR ayarlarını otomatik yap
  const analyzeAndApplyHDR = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !oneHDREnabled || !hdrSettings.isAuto) return;
    
    // Aynı anda sadece bir analiz yap
    if (isAnalyzingHDR) return;
    
    // Analiz sıklığını kontrol et (en az 2 saniye arayla)
    const now = Date.now();
    if (now - lastAnalysisTime.current < 2000) return;
    lastAnalysisTime.current = now;
    
    // Analiz başlıyor
    setIsAnalyzingHDR(true);
    
    try {
    
      // Mevcut kareyi analiz etmek için canvas oluştur
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      
      // Canvas boyutlarını ayarla (daha küçük boyutta analiz yap, performans için)
      const scale = Math.min(640 / video.videoWidth, 360 / video.videoHeight, 1);
      canvas.width = Math.max(160, Math.floor(video.videoWidth * scale));
      canvas.height = Math.max(90, Math.floor(video.videoHeight * scale));
      
      // Mevcut kareyi çiz
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Piksel verilerini al ve analiz et
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const analysis = analyzeFrame(imageData);
      
      // Ayarları belirle
      const newSettings = { ...hdrSettings };
      
      // Işık seviyesine göre temel ayarlar
      if (analysis.isLowLight) {
        // Karanlık sahneler
        newSettings.intensity = 1.4;
        newSettings.contrastDepth = 1.05;
        newSettings.shadowDetail = 1.3;
        newSettings.highlightDetail = 0.9;
        newSettings.toneBalance = 0.45; // Biraz sıcak
      } else if (analysis.isHighKey) {
        // Aşırı aydınlık sahneler
        newSettings.intensity = 0.85;
        newSettings.contrastDepth = 1.15;
        newSettings.highlightDetail = 1.3;
        newSettings.shadowDetail = 1.05;
        newSettings.toneBalance = 0.55; // Biraz soğuk
      } else {
        // Normal aydınlık
        newSettings.intensity = 1.1;
        newSettings.contrastDepth = 1.1;
        newSettings.highlightDetail = 1.1;
        newSettings.shadowDetail = 1.05;
        newSettings.toneBalance = 0.5; // Doğal tonlar
      }
      
      // Kontrasta göre ince ayar
      if (analysis.isHighContrast) {
        newSettings.contrastDepth = Math.min(1.25, newSettings.contrastDepth * 1.1);
        newSettings.shadowDetail = Math.min(1.2, newSettings.shadowDetail * 1.05);
      } else {
        newSettings.contrastDepth = Math.max(0.95, newSettings.contrastDepth * 0.98);
      }
      
      // Renkliliğe göre canlılık ayarı
      newSettings.colorVibrancy = 1.0 + (analysis.colorfulness * 0.5); // 1.0 - 1.5 arası
      
      // Dinamik aralığa göre ince ayar
      const dynamicRange = analysis.contrastRatio;
      if (dynamicRange > 0.7) {
        newSettings.intensity = Math.min(1.5, newSettings.intensity * 1.05);
      } else if (dynamicRange < 0.3) {
        newSettings.intensity = Math.max(0.8, newSettings.intensity * 0.95);
      }
      
      // Yeni ayarları uygula
      setHdrSettings(prev => ({
        ...prev,
        ...newSettings,
        isAuto: true // Otomatik modu etkinleştir
      }));
      
    } catch (error) {
      console.error('HDR analiz hatası:', error);
    } finally {
      setIsAnalyzingHDR(false);
    }
  }, [hdrSettings, oneHDREnabled]);
  
  // Otomatik HDR analizini başlat/durdur
  const toggleAutoHDR = useCallback(async () => {
    const newAutoState = !hdrSettings.isAuto;
    
    // Hemen durumu güncelle ve kullanıcıya geri bildirim ver
    setHdrSettings(prev => ({
      ...prev,
      isAuto: newAutoState
    }));
    
    // Eğer otomatik mod açılıyorsa analiz yap
    if (newAutoState) {
      try {
        setIsAnalyzingHDR(true);
        await analyzeAndApplyHDR();
      } finally {
        // Analiz bittiğinde veya hata oluştuğunda yükleniyor durumunu kaldır
        setTimeout(() => setIsAnalyzingHDR(false), 500);
      }
    }
  }, [hdrSettings.isAuto, analyzeAndApplyHDR]);
  
  // Video ilerledikçe veya sahneler değiştikçe otomatik HDR analizi yap
  useEffect(() => {
    if (!hdrSettings.isAuto || !oneHDREnabled) return;
    
    const video = videoRef.current;
    if (!video) return;
    
    let lastAnalysisTime = 0;
    const ANALYSIS_COOLDOWN = 3000; // 3 saniye
    
    // Video zamanı değiştiğinde analiz yap
    const handleTimeUpdate = () => {
      const now = Date.now();
      // Sadece oynatma sırasında ve cooldown süresi dolduğunda analiz yap
      if (!video.paused && !isAnalyzingHDR && (now - lastAnalysisTime) > ANALYSIS_COOLDOWN) {
        lastAnalysisTime = now;
        analyzeAndApplyHDR();
      }
    };
    
    // Daha hassas analiz için timeupdate olayını dinle
    video.addEventListener('timeupdate', handleTimeUpdate);
    
    // Ayrıca büyük atlamalarda da analiz yap (örn. kullanıcı ileri/geri sarma yaptığında)
    const handleSeeked = () => {
      if (hdrSettings.isAuto && !isAnalyzingHDR) {
        analyzeAndApplyHDR();
      }
    };
    
    video.addEventListener('seeked', handleSeeked);
    
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [hdrSettings.isAuto, oneHDREnabled, analyzeAndApplyHDR, isAnalyzingHDR]);
  
  // Sahne değişikliklerini dinle
  useEffect(() => {
    if (!hdrSettings.isAuto || !oneHDREnabled || !sceneDetectionEnabled) return;
    
    // Eğer sahne değişikliği algılanırsa yeni analiz yap
    if (currentSceneIndex !== -1 && scenes[currentSceneIndex]) {
      analyzeAndApplyHDR();
    }
  }, [currentSceneIndex, scenes, hdrSettings.isAuto, oneHDREnabled, sceneDetectionEnabled, analyzeAndApplyHDR]);
  const [customSettings, setCustomSettings] = useState({
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpness: 1.0,
    temperature: 0,
    tint: 0
  });
  
  // OneSub™ - Altyazı State'leri
  const [oneSubEnabled, setOneSubEnabled] = useState(false); // Varsayılan olarak kapalı
  const [currentSubtitleIndex, setCurrentSubtitleIndex] = useState(0);
  const [parsedSubtitles, setParsedSubtitles] = useState<Array<{start: number; end: number; text: string}>>([]);
  const [currentSubtitleText, setCurrentSubtitleText] = useState('');
  const [subtitleSettings, setSubtitleSettings] = useState({
    fontSize: 24, // 10-40px arası
    fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif', // Font ailesi
    fontColor: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    backgroundOpacity: 0.7, // 0-1 arası
    position: 10, // 0-100 arası, % olarak bottom'dan
    fontWeight: 400, // 100-900 arası
    textOutline: 2, // Metin kenarlık kalınlığı (px)
  });
  
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [loop, setLoop] = useState<'none' | 'all' | 'one'>('none');
  
  const [isHoveringProgress, setIsHoveringProgress] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [thumbnailPosition, setThumbnailPosition] = useState(0);

  const [isLongPressing, setIsLongPressing] = useState(false);
  const [savedPlaybackRate, setSavedPlaybackRate] = useState(1);
  const [skipIndicator, setSkipIndicator] = useState<{ show: boolean; direction: 'forward' | 'backward'; count: number; position: 'left' | 'right' }>({ show: false, direction: 'forward', count: 0, position: 'right' });
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  
  // Yeni durumlar
  const [resumeTime, setResumeTime] = useState<number | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [showResumeIndicator, setShowResumeIndicator] = useState(false);

  // Çift tıklama için durum yönetimi
  const lastClickTime = useRef(0);
  const singleClickTimeout = useRef<NodeJS.Timeout>();

  const hideControlsTimeout = useRef<NodeJS.Timeout>();
  const longPressTimeout = useRef<NodeJS.Timeout>();
  const skipIndicatorTimeout = useRef<NodeJS.Timeout>();
  const resumeIndicatorTimeout = useRef<NodeJS.Timeout>(); 
  
  // Thumbnail Cache Sistemi (Performans için)
  const thumbnailCache = useRef<Map<number, string>>(new Map());
  const thumbnailVideoRef = useRef<HTMLVideoElement | null>(null);
  const isGeneratingThumbnail = useRef(false);

  const storageIdentifier = useMemo(() => progressKey ?? src, [progressKey, src]);

  // OneSub™ - Gelişmiş Altyazı Parse Fonksiyonu
  const parseSubtitleFile = useCallback((content: string | undefined, format: string) => {
    const parsed: Array<{start: number; end: number; text: string}> = [];
    
    try {
      // İçerik yoksa veya boşsa boş dizi döndür
      if (!content || typeof content !== 'string' || !content.trim()) {
        console.warn('OneSub™: Boş veya geçersiz altyazı içeriği');
        return [];
      }
      
      console.log('OneSub™: Altyazı içeriği parse ediliyor...');
      const trimmedContent = content.trim();
      
      // Formatı otomatik tespit et (eğer belirtilmediyse)
      let detectedFormat = format.toLowerCase();
      if (!detectedFormat || detectedFormat === 'auto') {
        if (trimmedContent.includes('-->') && /\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{3}/.test(trimmedContent)) {
          detectedFormat = 'srt';
        } else if (/\d{1,2}:\d{2}:\d{2}[,\.]\d{3},\d{1,2}:\d{2}:\d{2}[,\.]\d{3}/.test(trimmedContent)) {
          detectedFormat = 'sbv';
        } else if (trimmedContent.includes('WEBVTT')) {
          detectedFormat = 'vtt';
        } else {
          detectedFormat = 'srt'; // Varsayılan olarak SRT kabul et
        }
        console.log(`OneSub™: Otomatik format tespit edildi: ${detectedFormat}`);
      }

      // Zaman formatını parse etme yardımcı fonksiyonu
      const parseTimeString = (timeStr: string): number | null => {
        try {
          // 00:00:00.000 veya 00:00:00,000 formatı
          const match = timeStr.trim().match(/(\d{1,2}):(\d{2}):([\d,]+)/) || 
                       timeStr.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[\.](\d{3})/);
          
          if (match) {
            const hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const seconds = parseFloat(match[3].replace(',', '.'));
            return hours * 3600 + minutes * 60 + seconds;
          }
          
          // 00:00.000 formatı (dakika:saniye)
          const minSecMatch = timeStr.trim().match(/(\d{1,2}):(\d{2}[\.\,]\d{3})/);
          if (minSecMatch) {
            const minutes = parseInt(minSecMatch[1]);
            const seconds = parseFloat(minSecMatch[2].replace(',', '.'));
            return minutes * 60 + seconds;
          }
          
          return null;
        } catch (e) {
          console.error('Zaman parse hatası:', e);
          return null;
        }
      };
      
      // SRT formatı için parse işlemi
      if (detectedFormat === 'srt' || detectedFormat === 'sub') {
        const blocks = trimmedContent.split(/\r?\n\s*\r?\n/).filter(Boolean);
        
        blocks.forEach((block, index) => {
          try {
            const lines = block.split('\n').filter(line => line.trim() !== '');
            if (lines.length < 2) return;
            
            // Zaman çizgisini bul (--> içeren satır)
            const timeLineIndex = lines.findIndex(line => line.includes('-->'));
            if (timeLineIndex === -1) return;
            
            const timeLine = lines[timeLineIndex];
            const timeMatch = timeLine.trim().match(/(\d{1,2}):(\d{2}):([\d,\.]+)\s*-->\s*(\d{1,2}):(\d{2}):([\d,\.]+)/);
            
            if (!timeMatch) return;
            
            const startTime = parseTimeString(`${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`);
            const endTime = parseTimeString(`${timeMatch[4]}:${timeMatch[5]}:${timeMatch[6]}`);
            
            if (startTime === null || endTime === null) return;
            
            // Altyazı metnini al (zaman çizgisinden sonraki satırlar)
            const textLines = lines.slice(timeLineIndex + 1);
            const text = textLines.join('\n').trim();
            
            if (text) {
              parsed.push({ 
                start: startTime, 
                end: endTime, 
                text: text
                  .replace(/<[^>]*>/g, '') // HTML etiketlerini temizle
                  .replace(/\{.*?\}/g, '') // SSA/ASS stillerini temizle
                  .replace(/\\[nN]/g, '\n') // Yeni satır karakterlerini düzelt
                  .trim()
              });
            }
          } catch (error) {
            console.error(`OneSub™: Altyazı bloğu parse edilemedi (${index + 1}. blok):`, error);
          }
        });
      } 
      // VTT formatı için parse işlemi
      else if (detectedFormat === 'vtt') {
        const lines = trimmedContent.split('\n');
        let currentBlock: {start?: number, end?: number, text: string[]} = { text: [] };
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          
          // Zaman çizgisi bulunduğunda
          if (line.includes('-->')) {
            // Önceki bloğu kaydet
            if (currentBlock.start !== undefined && currentBlock.end !== undefined && currentBlock.text.length > 0) {
              parsed.push({
                start: currentBlock.start,
                end: currentBlock.end,
                text: currentBlock.text.join('\n').trim()
              });
            }
            
            // Yeni blok oluştur
const timeMatch = line.match(/(\d{1,2}:)?\d{1,2}:\d{2}[\.\,]\d{3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[\.\,]\d{3}/);
if (timeMatch) {
  const times = line.split('-->').map(t => t.trim());
  const start = parseTimeString(times[0]);
  const end = parseTimeString(times[1]);
  
  if (start !== null && end !== null) {
    currentBlock = {
      start: start,
      end: end,
      text: []
    };
  } else {
    console.warn('OneSub™: Geçersiz zaman formatı:', line);
  }
}
          // Boş satır bloğu bitirir
          else if (line === '' && currentBlock.text.length > 0) {
            if (currentBlock.start !== undefined && currentBlock.end !== undefined) {
              parsed.push({
                start: currentBlock.start,
                end: currentBlock.end,
                text: currentBlock.text.join('\n').trim()
              });
            }
            currentBlock = { text: [] };
          } 
          // Altyazı metni
          else if (currentBlock.text && !line.startsWith('WEBVTT') && !line.startsWith('NOTE') && line !== '') {
            currentBlock.text.push(line);
          }
        }
        
        // Son bloğu ekle
        if (currentBlock.start !== undefined && currentBlock.end !== undefined && currentBlock.text.length > 0) {
          parsed.push({
            start: currentBlock.start,
            end: currentBlock.end,
            text: currentBlock.text.join('\n').trim()
          });
        }
      }
      }
      // SBV formatı için parse işlemi
      else if (detectedFormat === 'sbv') {
        const blocks = trimmedContent.split(/\n\s*\n/).filter(Boolean);
        
        blocks.forEach(block => {
          try {
            const lines = block.split('\n').filter(line => line.trim() !== '');
            if (lines.length < 2) return;
            
            const timeMatch = lines[0].trim().match(/(\d{1,2}:)?(\d{1,2}:\d{2}[\.,]\d{3}),(\d{1,2}:)?(\d{1,2}:\d{2}[\.,]\d{3})/);
            if (!timeMatch) return;
            
            const startTime = parseTimeString(timeMatch[2]);
            const endTime = parseTimeString(timeMatch[4]);
            
            if (startTime === null || endTime === null) return;
            
            const text = lines.slice(1).join('\n').trim();
            
            if (text) {
              parsed.push({ 
                start: startTime, 
                end: endTime, 
                text: text
                  .replace(/<[^>]*>/g, '') // HTML etiketlerini temizle
                  .replace(/\\[nN]/g, '\n') // Yeni satır karakterlerini düzelt
                  .trim()
              });
            }
          } catch (error) {
            console.error('SBV parse hatası:', error);
          }
        });
      }
      
      // Sıralı olmayan altyazıları sırala
      parsed.sort((a, b) => a.start - b.start);
      
    } catch (error) {
      console.error('OneSub™: Altyazı parse hatası:', error);
    }
    
    console.log(`OneSub™: ${parsed.length} altyazı başarıyla parse edildi`);
    if (parsed.length > 0) {
      console.log('Örnek altyazı:', {
        start: parsed[0].start,
        end: parsed[0].end,
        text: parsed[0].text.substring(0, 50) + (parsed[0].text.length > 50 ? '...' : '')
      });
    }
    
    return parsed;
  }, []);

  // Altyazıları yükle ve parse et
  useEffect(() => {
    console.log('OneSub™: Altyazı yükleme effect tetiklendi', {
      subtitlesCount: subtitles?.length || 0,
      currentSubtitleIndex,
      hasParsedSubtitles: parsedSubtitles.length
    });
    
    if (subtitles && subtitles.length > 0) {
      const currentSub = subtitles[currentSubtitleIndex];
      if (currentSub && currentSub.content) {
        console.log('OneSub™: Altyazı yükleniyor...', {
          dil: currentSub.language,
          format: currentSub.format,
          uzunluk: currentSub.content.length,
          icerikBaslangic: currentSub.content.substring(0, 100) + '...'
        });
        
        try {
          // Altyazıyı parse et
          const parsed = parseSubtitleFile(currentSub.content, currentSub.format);
          
          console.log('OneSub™: Altyazı parse edildi:', {
            dil: currentSub.language,
            format: currentSub.format,
            altyaziSayisi: parsed.length,
            ilkAltyazi: parsed[0] ? {
              baslangic: parsed[0].start,
              bitis: parsed[0].end,
              metin: parsed[0].text.substring(0, 50)
            } : 'YOK'
          });
          
          // Parse edilen altyazıları sırala (zaman sırasına göre)
          const sortedSubtitles = [...parsed].sort((a, b) => a.start - b.start);
          setParsedSubtitles(sortedSubtitles);
          
          // Altyazı parse edildi ama varsayılan olarak kapalı
          if (sortedSubtitles.length > 0) {
            console.log('OneSub™: Altyazı parse edildi (varsayılan: kapalı)');
            // setOneSubEnabled(false); // Kullanıcı manuel açacak
          } else {
            console.warn('OneSub™: Parse edilen altyazı bulunamadı');
            setCurrentSubtitleText('');
          }
        } catch (error) {
          console.error('OneSub™: Altyazı parse hatası:', error);
          setParsedSubtitles([]);
          setCurrentSubtitleText('');
        }
      } else {
        console.warn('OneSub™: Geçersiz altyazı verisi veya içerik yok', {
          hasSub: !!currentSub,
          hasContent: !!currentSub?.content
        });
        setParsedSubtitles([]);
        setCurrentSubtitleText('');
      }
    } else {
      console.log('OneSub™: Gösterilecek altyazı bulunamadı');
      setParsedSubtitles([]);
      setCurrentSubtitleText('');
      setOneSubEnabled(false);
    }
  }, [subtitles, currentSubtitleIndex, parseSubtitleFile]);

  // Video zamanına göre altyazı göster - useCallback ile optimize edildi
  const updateSubtitle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    
    // Altyazı kapalıysa veya altyazı yoksa çık
    if (!oneSubEnabled || !parsedSubtitles || parsedSubtitles.length === 0) {
      if (currentSubtitleText !== '') {
        setCurrentSubtitleText('');
      }
      return;
    }
    
    const currentTime = video.currentTime;
    
    // Binary search ile mevcut zamana uygun altyazıyı bul
    let low = 0;
    let high = parsedSubtitles.length - 1;
    let currentSubtitle = null;
    
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const sub = parsedSubtitles[mid];
      
      if (currentTime >= sub.start && currentTime <= sub.end) {
        currentSubtitle = sub;
        break;
      } else if (currentTime < sub.start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    
    // Eğer tam eşleşme yoksa, en yakın altyazıyı kontrol et
    if (!currentSubtitle && parsedSubtitles.length > 0) {
      // İlk altyazıdan önce miyiz?
      if (currentTime < parsedSubtitles[0].start) {
        // İlk altyazıya çok yakınsak göster (0.5 saniye tolerans)
        if (Math.abs(parsedSubtitles[0].start - currentTime) < 0.5) {
          currentSubtitle = parsedSubtitles[0];
        }
      } 
      // Son altyazıdan sonra mıyız?
      else if (currentTime > parsedSubtitles[parsedSubtitles.length - 1].end) {
        // Son altyazıya çok yakınsak göster (0.5 saniye tolerans)
        const lastSub = parsedSubtitles[parsedSubtitles.length - 1];
        if (Math.abs(currentTime - lastSub.end) < 0.5) {
          currentSubtitle = lastSub;
        }
      }
    }
    
    // Eğer altyazı değiştiyse güncelle
    if (currentSubtitle) {
      const newText = currentSubtitle.text
        .replace(/\{.*?\}/g, '')  // {i} gibi stillendirme etiketlerini kaldır
        .replace(/<.*?>/g, '')     // HTML etiketlerini kaldır
        .replace(/\\[nN]/g, '\n')  // Yeni satır karakterlerini işle
        .trim();
      
      if (currentSubtitleText !== newText) {
        setCurrentSubtitleText(newText);
      }
    } else if (currentSubtitleText !== '') {
      // Eğer gösterilecek altyazı yoksa temizle
      setCurrentSubtitleText('');
    }
  }, [oneSubEnabled, parsedSubtitles, currentSubtitleText]);

  // Video zamanına göre altyazı göster
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    console.log('OneSub™: Event listener ekleniyor', {
      oneSubEnabled,
      parsedSubtitlesLength: parsedSubtitles.length
    });
    
    // İlk yüklemede de altyazıyı güncelle
    updateSubtitle();
    
    video.addEventListener('timeupdate', updateSubtitle);
    return () => {
      video.removeEventListener('timeupdate', updateSubtitle);
    };
  }, [updateSubtitle]);
  
  // Altyazı metni değişikliklerini izle
  useEffect(() => {
    console.log('OneSub™: Altyazı metni değişti:', {
      oneSubEnabled,
      currentSubtitleText: currentSubtitleText ? currentSubtitleText.substring(0, 50) : 'BOŞ',
      textLength: currentSubtitleText.length
    });
  }, [currentSubtitleText, oneSubEnabled]);


  // Kontrol Çubuğu Gizleme Mekanizması
  const hideControls = useCallback(() => {
    if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
    }
    // Sadece oynatılıyorsa ve ayarlar açık değilse gizle
    if (isPlaying && !showSettings && !isDraggingProgress && !isHoveringProgress) {
        hideControlsTimeout.current = setTimeout(() => {
            setShowControls(false);
            setShowSettings(false); 
        }, HIDE_CONTROLS_DELAY);
    }
  }, [isPlaying, showSettings, isDraggingProgress, isHoveringProgress]);

  // Kontrol Çubuğu Gösterme ve Gecikmeyi Yenileme
  const showAndResetControlsTimer = useCallback(() => {
    setShowControls(true);
    // Varsa önceki zamanlayıcıyı temizle
    if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
    }
    // Eğer oynatılıyorsa, yeni bir gizleme zamanlayıcısı başlat
    if (isPlaying) {
        hideControlsTimeout.current = setTimeout(() => {
            setShowControls(false);
            setShowSettings(false); 
        }, HIDE_CONTROLS_DELAY);
    }
  }, [isPlaying]);

  // Mouse hareketinde/Dokunmada kontrolü göster ve gizleme sayacını sıfırla
  const handleUserInteraction = () => {
    showAndResetControlsTimer();
  };

  const handleRetry = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackError(null);

    if (!video.currentSrc && src) {
      video.src = src;
    }

    const handleSourceReady = () => {
      video.removeEventListener('loadeddata', handleSourceReady);
      video.play().catch((err) => {
        console.error('Retry play error:', err);
        setPlaybackError('Video tekrar yüklenemedi. Kaynağı kontrol edin.');
      });
    };

    video.pause();
    video.addEventListener('loadeddata', handleSourceReady);
    video.load();
  }, [src]);


  // HLS yükleyici
  const loadHLS = useCallback((url: string) => {
    if (Hls.isSupported() && videoRef.current) {
      const video = videoRef.current;
      const hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      hlsInstance.attachMedia(video);
      
      hlsInstance.on(Hls.Events.MEDIA_ATTACHED, () => {
        hlsInstance.loadSource(url);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
          const levels = data.levels.map((level, index) => ({
            height: level.height,
            width: level.width,
            bitrate: level.bitrate,
            name: level.height ? `${level.height}p` : 'Auto',
            selected: index === (hlsInstance.currentLevel || -1)
          }));
          setAvailableQualities(levels);
          setIsLoadingQualities(false);
        });
      });

      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance.recoverMediaError();
              break;
            default:
              console.error('HLS Error:', data);
              break;
          }
        }
      });

      setHls(hlsInstance);
      return hlsInstance;
    } else if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
      // iOS Safari için native HLS desteği
      videoRef.current.src = url;
      setIsLoadingQualities(false);
    }
    return null;
  }, []);

  // HLS temizleme
  useEffect(() => {
    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [hls]);

  // Video kaynağı değiştiğinde HLS'yi yükle
  useEffect(() => {
    if (!src) return;
    
    setIsLoadingQualities(true);
    
    if (src.endsWith('.m3u8')) {
      loadHLS(src);
    } else {
      setIsLoadingQualities(false);
    }
    
    return () => {
      if (hls) {
        hls.destroy();
        setHls(null);
      }
    };
  }, [src, loadHLS]);

  // Video oynatma/durdurma işlevi
  const togglePlay = useCallback(() => {
    if (playbackError) {
      handleRetry();
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(err => console.error('Play error:', err));
    } else {
      video.pause();
    }
  }, [playbackError, handleRetry]);
  
  // Sesi açma/kapatma
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isMuted || video.volume === 0) {
      video.volume = volume || 0.5; 
      setIsMuted(false);
    } else {
      setVolume(video.volume); 
      video.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  // Tam ekran değiştirme
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  }, []);


  // Atlama göstergesi fonksiyonunu tanımla
  const showSkipIndicator = useCallback((direction: 'forward' | 'backward', position: 'left' | 'right') => {
    setSkipIndicator(prev => ({
      show: true,
      direction,
      position,
      count: prev.show && prev.direction === direction ? prev.count + 1 : 1
    }));

    if (skipIndicatorTimeout.current) {
      clearTimeout(skipIndicatorTimeout.current);
    }

    skipIndicatorTimeout.current = setTimeout(() => {
      setSkipIndicator({ show: false, direction: 'forward', count: 0, position: 'right' });
    }, 800);
  }, []);

  // Videoda atlama işlevi
  const skip = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
    video.currentTime = newTime;
    setCurrentTime(newTime);

    // Atlama göstergesini göster (Konum dinamik olarak belirlendi)
    showSkipIndicator(seconds > 0 ? 'forward' : 'backward', seconds > 0 ? 'right' : 'left');

  }, [duration, showSkipIndicator]);


  // Thumbnail oluşturma işlevi (Optimizasyonlu)
  const generateThumbnail = useCallback(async (time: number) => {
    if (isGeneratingThumbnail.current || !videoRef.current || !thumbnailCanvasRef.current) return;

    const cacheKey = Math.floor(time / THUMBNAIL_UPDATE_INTERVAL) * THUMBNAIL_UPDATE_INTERVAL;
    
    if (thumbnailCache.current.has(cacheKey)) {
        return thumbnailCache.current.get(cacheKey);
    }
    
    isGeneratingThumbnail.current = true;
    
    if (!thumbnailVideoRef.current) {
        thumbnailVideoRef.current = document.createElement('video');
        thumbnailVideoRef.current.muted = true;
        thumbnailVideoRef.current.preload = 'metadata';
        thumbnailVideoRef.current.src = videoRef.current.src; 
    }
    
    const tempVideo = thumbnailVideoRef.current;
    const canvas = thumbnailCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
        isGeneratingThumbnail.current = false;
        return;
    }
    
    tempVideo.currentTime = time;
    
    await new Promise<void>((resolve) => {
        const handleSeeked = () => {
            tempVideo.removeEventListener('seeked', handleSeeked);
            resolve();
        };
        if (tempVideo.readyState < 2) { 
            tempVideo.addEventListener('seeked', handleSeeked);
        } else {
            handleSeeked();
        }
    });

    // Thumbnail çizimi
    canvas.width = 160;
    canvas.height = 90;
    ctx.drawImage(tempVideo, 0, 0, 160, 90);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    
    if (thumbnailCache.current.size < 50) { 
        thumbnailCache.current.set(cacheKey, dataUrl);
    }

    isGeneratingThumbnail.current = false;
    return dataUrl;

  }, [src]);

  useEffect(() => {
    setPlaybackError(null);
  }, [src]);

  // Zaman çubuğu etkileşimi (fare/dokunmatik)
  const handleProgressInteraction = useCallback(async (e: ProgressInteractionEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent<HTMLDivElement>).clientX;
    
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)); 
    const time = pos * duration;

    setHoverTime(time);
    setThumbnailPosition(Math.max(80, Math.min(rect.width - 80, clientX - rect.left))); 

    // Thumbnail yükleme/gösterme
    const thumbnailDataUrl = await generateThumbnail(time);
    
    if (thumbnailCanvasRef.current && thumbnailDataUrl) {
      const canvas = thumbnailCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        if (ctx) {
          canvas.width = 160;
          canvas.height = 90;
          ctx.drawImage(img, 0, 0, 160, 90);
        }
      };
      img.src = thumbnailDataUrl;
    }

  }, [duration, generateThumbnail]);
  
  // Progress Bar Dokunmatik Başlangıç
  const handleProgressTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsDraggingProgress(true);
    setIsHoveringProgress(true);
    handleProgressInteraction(e);
    // Sürükleme sırasında kontrollerin kaybolmasını engelle
    if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
    }
  };

  // Progress Bar Dokunmatik Hareket
  const handleProgressTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isDraggingProgress) {
      e.stopPropagation();
      handleProgressInteraction(e);
    }
  };

  // Progress Bar Dokunmatik Bitiş
  const handleProgressTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsDraggingProgress(false);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.changedTouches[0].clientX; 
    
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = pos * duration;
    handleSeek([time]);

    setTimeout(() => setIsHoveringProgress(false), 200);
    // Dokunmatik etkileşim bitti, gizleme sayacını yeniden başlat
    showAndResetControlsTimer(); 
  };

  // Zaman arama (Slider)
  const handleSeek = (value: number[]) => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = value[0];
    setCurrentTime(value[0]);
    
    // Zamanı kaydet
    saveProgress(value[0]);
  };

  // Ses seviyesi değiştirme
  const handleVolumeChange = (value: number[]) => {
    const video = videoRef.current;
    if (!video) return;

    const newVolume = value[0];
    video.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0); 
  };
  
  // Kalan zamanı localStorage'a kaydetme işlevi
  const saveProgress = useCallback((time: number) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const key = STORAGE_PREFIX + storageIdentifier;
        // Videonun son %5'lik kısmını atla (bitmiş kabul et)
        if (duration > 0 && time < duration * 0.95) {
          localStorage.setItem(key, time.toString());
        } else {
          // Eğer video bittiyse veya sona çok yakınsa kaydı sil
          localStorage.removeItem(key);
        }
      } catch (error) {
        console.error('Local storage kaydetme hatası:', error);
      }
    }
  }, [storageIdentifier, duration]);

  // Kayıtlı ilerlemeyi yükleme işlevi
  const loadProgress = useCallback(() => {
    const video = videoRef.current;
    if (typeof window !== 'undefined' && window.localStorage && video) {
      try {
        const key = STORAGE_PREFIX + storageIdentifier;
        const storedTime = localStorage.getItem(key);
        
        if (storedTime) {
          const time = parseFloat(storedTime);
          if (time > 10) { // En az 10 saniye izlenmişse sor
            setResumeTime(time);
            setShowResumePrompt(true);
            video.pause(); // PROMPT GELDİĞİNDE VİDEOYU DURDUR
            return;
          }
        }
      } catch (error) {
        console.error('Local storage okuma hatası:', error);
      }
    }
    // Kayıtlı zaman yoksa veya çok azsa
    setShowResumePrompt(false);
  }, [storageIdentifier]);

  // Devam etme işlemini gerçekleştirme
  const handleResume = useCallback(() => {
    const video = videoRef.current;
    if (!video || resumeTime === null) return;
    
    video.currentTime = resumeTime;
    setCurrentTime(resumeTime);
    setShowResumePrompt(false);

    // Göstergeyi göster
    setShowResumeIndicator(true);
    if (resumeIndicatorTimeout.current) {
        clearTimeout(resumeIndicatorTimeout.current);
    }
    // 10 saniye sonra gizle (HIDE_RESUME_INDICATOR_DELAY)
    resumeIndicatorTimeout.current = setTimeout(() => {
        setShowResumeIndicator(false);
    }, HIDE_RESUME_INDICATOR_DELAY); 
    
    // Oynatmaya devam et
    video.play().catch(err => console.error('Resume play error:', err));
  }, [resumeTime]);

  // Baştan başla işlemini gerçekleştirme
  const handleRestart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    setCurrentTime(0);
    setShowResumePrompt(false);
    
    // LocalStorage kaydını sil
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_PREFIX + storageIdentifier);
    }
    
    // Oynatmaya devam et
    video.play().catch(err => console.error('Restart play error:', err));
  }, [storageIdentifier]);


  // Olay Dinleyicileri (useEffect)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      video.volume = volume; 
      
      // Metadata yüklendiğinde ilerlemeyi kontrol et
      loadProgress();
    };

    const handleTimeUpdate = () => {
      const newTime = video.currentTime;
      setCurrentTime(newTime);
      
      // Zamanı kaydet (her zaman değil, performans için)
      if (Math.floor(newTime) % 5 === 0) { // Her 5 saniyede bir kaydet
        saveProgress(newTime);
      }
    };

    const handleWaiting = () => {
      setIsBuffering(true);
    };

    const handleCanPlay = () => {
      setIsBuffering(false);
      setPlaybackError(null);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      showAndResetControlsTimer(); 
    };

    const handlePause = () => {
      setIsPlaying(false);
      // Duraklatıldığında veya prompt açıldığında gizleme sayacını temizle ve kontrol çubuğunu göster
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
      setShowControls(true);
      
      // Prompt görünmüyorsa ve manuel duraklatma ise kaydet
      if (!showResumePrompt) {
        saveProgress(video.currentTime);
      }
    };

    const handleEnded = () => {
      saveProgress(video.duration); // Bittiğinde ilerlemeyi silmek için
      if (loop === 'one') {
        video.currentTime = 0;
        video.play();
      } else if (loop === 'none') {
        setIsPlaying(false);
      }
    };

    const handleError = () => {
      const mediaError = video.error;
      let message = 'Video yüklenemedi.';
      if (mediaError) {
        switch (mediaError.code) {
          case 1:
            message = 'Video yüklemesi iptal edildi.';
            break;
          case 2:
            message = 'Ağ hatası nedeniyle video yüklenemedi.';
            break;
          case 3:
            message = 'Video formatı desteklenmiyor veya bozuk.';
            break;
          case 4:
            message = 'Video kaynağı bulunamadı veya erişim reddedildi.';
            break;
        }
      }
      setPlaybackError(message);
      setIsPlaying(false);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);

      if (thumbnailVideoRef.current) {
        thumbnailVideoRef.current.src = '';
        thumbnailVideoRef.current.load();
        thumbnailVideoRef.current = null;
      }
      // Temizlikte timeout'ları temizle
      if (resumeIndicatorTimeout.current) {
        clearTimeout(resumeIndicatorTimeout.current);
      }
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, [loop, volume, loadProgress, saveProgress, src, showResumePrompt, showAndResetControlsTimer]); 

  // Tam ekran ve Dokunmatik Cihaz Kontrolü
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Tam ekrana geçildiğinde kontrol sayacını sıfırla
      showAndResetControlsTimer();
    };

    const checkTouchDevice = () => {
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };

    checkTouchDevice();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [showAndResetControlsTimer]);

  // Klavye Kontrolleri
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Klavye etkileşiminde kontrol çubuğunu göster
      showAndResetControlsTimer(); 

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (!showResumePrompt) togglePlay();
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          if (!showResumePrompt) skip(-SEEK_SECONDS);
          break;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          if (!showResumePrompt) skip(SEEK_SECONDS);
          break;
        case 'm':
          e.preventDefault();
          if (!showResumePrompt) toggleMute(); 
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [togglePlay, skip, toggleMute, toggleFullscreen, showResumePrompt, showAndResetControlsTimer]); 
  
  // Oynatma hızı değiştirme
  const changePlaybackRate = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = rate;
    setPlaybackRate(rate);
    setSettingsView('main');
  };
  
  // Tekrarlama modunu değiştirme
  const toggleLoop = () => {
    const modes: Array<'none' | 'one'> = ['none', 'one']; 
    const currentIndex = modes.indexOf(loop === 'all' ? 'none' : loop); 
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setLoop(nextMode);
  };
  
  // Çift tıklama/Tek tıklama mantığı için ana konteyner olay işleyicisi
  const handlePlayerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingProgress || isLongPressing || showResumePrompt) return;
    
    // Tıklamada kontrolleri göster
    showAndResetControlsTimer();

    if (showSettings) {
        e.stopPropagation();
        closeSettings();
        return;
    }

    const now = Date.now();

    if (now - lastClickTime.current < DOUBLE_CLICK_INTERVAL) {
      // Çift Tıklama
      clearTimeout(singleClickTimeout.current!);
      lastClickTime.current = 0;
      
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX;
      const midPoint = rect.left + rect.width / 2;

      if (clickX < midPoint) {
        skip(-SEEK_SECONDS);
      } else {
        skip(SEEK_SECONDS);
      }
    } else {
      // Tek Tıklama Adayı
      lastClickTime.current = now;
      singleClickTimeout.current = setTimeout(() => {
        if (Date.now() - now >= DOUBLE_CLICK_INTERVAL) {
          togglePlay();
          lastClickTime.current = 0;
        }
      }, DOUBLE_CLICK_INTERVAL);
    }
  };
  
  // Uzun Basma (Long Press) Başlangıcı
  const handleLongPressStart = (e: React.TouchEvent<HTMLDivElement | HTMLVideoElement>) => {
    if (isDraggingProgress || showResumePrompt) return;
    
    const video = videoRef.current;
    if (!video) return;
    
    e.preventDefault(); 
    // Uzun basma başladığında kontrollerin gizlenmesini durdur
    if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
    }


    longPressTimeout.current = setTimeout(() => {
      setIsLongPressing(true);
      setSavedPlaybackRate(video.playbackRate);
      video.playbackRate = 2.0; 
      
      if (video.paused) {
        video.play().catch(err => console.error('Play error during long press:', err));
      }
      
    }, LONG_PRESS_DELAY);
  };

  // Uzun Basma (Long Press) Sonu
  const handleLongPressEnd = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
    }

    if (isLongPressing) {
      const video = videoRef.current;
      if (video) {
        video.playbackRate = savedPlaybackRate; 
      }
      setIsLongPressing(false);
    }
    // Uzun basma bitti, gizleme sayacını yeniden başlat
    showAndResetControlsTimer();
  };
  
  // Ayarları kapat
  const closeSettings = () => {
    setShowSettings(false);
    setSettingsView('main');
    // Ayarlar kapatıldı, gizleme sayacını yeniden başlat
    showAndResetControlsTimer();
  };
  
  // OneVision™ otomatik iyileştirme uygula
  const applyAutoEnhance = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Otomatik iyileştirme değerlerini uygula
    const profileSettings = {
      natural: { brightness: 1.05, contrast: 1.05, saturation: 1.1 },
      vivid: { brightness: 1.1, contrast: 1.1, saturation: 1.3 },
      cinematic: { brightness: 1.08, contrast: 1.15, saturation: 1.0 },
      cool: { brightness: 1.05, contrast: 1.05, saturation: 1.1 },
      warm: { brightness: 1.05, contrast: 1.1, saturation: 1.2 },
      ozel: { brightness: 1.08, contrast: 1.15, saturation: 1.3, hueRotate: -5, gamma: 1.05 }
    };

    const settings = profileSettings[colorProfile] || profileSettings.natural;
    setCustomSettings(prev => ({
      ...prev,
      ...settings,
      temperature: 0,
      tint: 0,
      sharpness: 1.0
    }));
  }, [colorProfile]);

  // Kalite değiştirme
  const changeQuality = useCallback((newQuality: string) => {
    setQuality(newQuality);
    
    if (hls && newQuality !== 'auto') {
      const level = availableQualities.findIndex(q => q.name === newQuality);
      if (level !== -1) {
        hls.currentLevel = level;
      }
    } else if (hls) {
      hls.currentLevel = -1; // Auto
    }
    
    setSettingsView('main');
  }, [hls, availableQualities]);

  // Sahne analizi yap
  const analyzeScenes = useCallback(async () => {
    const video = videoRef.current;
    if (!video || isAnalyzingScenes) return;

    setIsAnalyzingScenes(true);
    
    try {
      // Burada gerçek bir sahne analiz algoritması kullanılabilir
      // Örnek olarak, videoyu 10 saniyelik bölümlere ayırıyoruz
      const sceneDuration = 10; // saniye
      const totalScenes = Math.ceil(duration / sceneDuration);
      
      const newScenes = [];
      for (let i = 0; i < totalScenes; i++) {
        const start = i * sceneDuration;
        const end = Math.min((i + 1) * sceneDuration, duration);
        
        // Her sahne için rastgele ayarlar oluştur (gerçek uygulamada bu analiz edilir)
        const settings = {
          brightness: 0.9 + Math.random() * 0.2, // 0.9 - 1.1 arası
          contrast: 0.9 + Math.random() * 0.3,   // 0.9 - 1.2 arası
          saturation: 0.9 + Math.random() * 0.4  // 0.9 - 1.3 arası
        };
        
        newScenes.push({ start, end, settings });
      }
      
      setScenes(newScenes);
      setCurrentSceneIndex(0);
      
    } catch (error) {
      console.error('Sahne analizi başarısız:', error);
    } finally {
      setIsAnalyzingScenes(false);
    }
  }, [duration, isAnalyzingScenes]);

  // Mevcut sahneyi kontrol et ve ayarları uygula
  useEffect(() => {
    if (!sceneDetectionEnabled || scenes.length === 0 || !videoRef.current) return;
    
    const checkScene = () => {
      const currentTime = videoRef.current?.currentTime || 0;
      const newSceneIndex = scenes.findIndex(
        (scene, index) => 
          currentTime >= scene.start && 
          (index === scenes.length - 1 || currentTime < scenes[index + 1].start)
      );
      
      if (newSceneIndex !== -1 && newSceneIndex !== currentSceneIndex) {
        setCurrentSceneIndex(newSceneIndex);
        applySceneSettings(scenes[newSceneIndex].settings);
      }
    };
    
    const interval = setInterval(checkScene, 1000);
    return () => clearInterval(interval);
  }, [scenes, currentSceneIndex, sceneDetectionEnabled]);
  
  // Sahne ayarlarını uygula
  const applySceneSettings = (settings: any) => {
    setCustomSettings(prev => ({
      ...prev,
      brightness: settings.brightness,
      contrast: settings.contrast,
      saturation: settings.saturation
    }));
  };
  
  // Sahne tespitini aç/kapat
  const toggleSceneDetection = () => {
    if (sceneDetectionEnabled) {
      setSceneDetectionEnabled(false);
      // Varsayılan ayarlara dön
      applyAutoEnhance();
    } else {
      if (scenes.length === 0) {
        analyzeScenes();
      }
      setSceneDetectionEnabled(true);
    }
  };

  // Video elementine OneVision ve OneHDR efektlerini uygula
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const videoElement = video;
    const videoContainer = videoElement.parentElement;
    
    // Mevcut sınıfları ve stilleri temizle
    videoElement.className = 'w-full h-full object-contain pointer-events-none onevision-video';
    
    // OneVision etkinse, etkin sınıfını ve seçili profili uygula
    if (oneVisionEnabled) {
      videoElement.classList.add('onevision-enabled', `onevision-profile-${colorProfile}`);
      
      // OneHDR etkinleştirilmişse
      if (oneHDREnabled) {
        videoElement.classList.add('onehdr-enabled');
        
        // HDR ayarlarını uygula
        const brightness = 0.9 + (hdrSettings.intensity * 0.2);
        videoElement.style.setProperty('--hdr-brightness', brightness.toString());
        videoElement.style.setProperty('--hdr-contrast', hdrSettings.contrastDepth.toString());
        videoElement.style.setProperty('--hdr-saturation', hdrSettings.colorVibrancy.toString());
        videoElement.style.setProperty('--hdr-highlight', hdrSettings.highlightDetail.toString());
        videoElement.style.setProperty('--hdr-shadow', hdrSettings.shadowDetail.toString());
        
        // Ton dengesini uygula (sıcak/soğuk ayarı)
        const temperature = hdrSettings.toneBalance * 40 - 20; // -20 ile +20 arasında değer
        videoElement.style.setProperty('--hdr-warmth', (1 + (temperature / 100)).toString());
        videoElement.style.setProperty('--hdr-coolness', (1 - (temperature / 100)).toString());
        
        // Dinamik ton eşleme için overlay ekle
        if (hdrSettings.isDynamic && !document.querySelector('.onehdr-tone-mapping')) {
          const toneMappingOverlay = document.createElement('div');
          toneMappingOverlay.className = 'onehdr-tone-mapping';
          videoContainer?.appendChild(toneMappingOverlay);
        }
      } else {
        // HDR devre dışıysa overlay'i kaldır
        const existingOverlay = document.querySelector('.onehdr-tone-mapping');
        if (existingOverlay) {
          existingOverlay.remove();
        }
      }
      
      // Özel ayarları uygula
      videoElement.style.setProperty('--onevision-brightness', customSettings.brightness.toString());
      videoElement.style.setProperty('--onevision-contrast', customSettings.contrast.toString());
      videoElement.style.setProperty('--onevision-saturation', customSettings.saturation.toString());
      
      // Eğer sahne tespiti aktifse, mevcut sahneyi göster
      if (sceneDetectionEnabled && currentSceneIndex >= 0 && scenes[currentSceneIndex]) {
        const scene = scenes[currentSceneIndex];
        videoElement.style.setProperty('--onevision-brightness', scene.settings.brightness.toString());
        videoElement.style.setProperty('--onevision-contrast', scene.settings.contrast.toString());
        videoElement.style.setProperty('--onevision-saturation', scene.settings.saturation.toString());
      }
    } else if (oneHDREnabled) {
      // Sadece HDR etkinse
      videoElement.classList.add('onehdr-enabled');
      videoElement.style.setProperty('--onevision-brightness', '1');
      videoElement.style.setProperty('--onevision-contrast', '1');
      videoElement.style.setProperty('--onevision-saturation', '1');
    }
    
    // Cleanup function
    return () => {
      const existingOverlay = document.querySelector('.onehdr-tone-mapping');
      if (existingOverlay) {
        existingOverlay.remove();
      }
    };
  }, [oneVisionEnabled, oneHDREnabled, colorProfile, customSettings, sceneDetectionEnabled, currentSceneIndex, scenes, hdrSettings, analyzeAndApplyHDR]);
  
  // Otomatik HDR ayarları için video olaylarını dinle
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hdrSettings.isAuto || !oneHDREnabled) return;
    
    const handleTimeUpdate = () => {
      // Her 5 saniyede bir veya sahne değişiminde analiz yap
      if (video.currentTime % 5 < 0.1) {
        analyzeAndApplyHDR();
      }
    };
    
    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [hdrSettings.isAuto, oneHDREnabled, analyzeAndApplyHDR]);

  return (
    <div
      ref={containerRef}
      className={cn("relative bg-black rounded-lg overflow-hidden group focus:outline-none", className)}
      // Mouse hareketinde kontrol çubuğunu göster ve zamanlayıcıyı sıfırla
      onMouseMove={handleUserInteraction}
      // Mouse container dışına çıktığında kontrol çubuğunu gizle
      onMouseLeave={hideControls} 
      tabIndex={0} 
    >
      {/* Çift Tıklama/Uzun Basma/Tek Tıklama Alanı */}
      <div
        className="absolute inset-0 flex z-10"
        onContextMenu={(e) => e.preventDefault()}
        // Dokunmatik cihazlar için genel etkileşim alanını ayarla
        onTouchStart={handleUserInteraction} 
        onTouchEnd={handleUserInteraction} 
        onTouchCancel={handleUserInteraction} 
      >
        <div 
          className="flex-1"
          onClick={handlePlayerClick}
          // Uzun basma olaylarını bu katmanda yakala
          onTouchStart={handleLongPressStart}
          onTouchEnd={handleLongPressEnd}
          onTouchCancel={handleLongPressEnd}
        />
      </div>

      <video
        ref={videoRef}
        src={!src.endsWith('.m3u8') ? src : ''}
        poster={poster}
        className={cn(
          'w-full h-full object-contain pointer-events-none onevision-video',
          oneVisionEnabled && 'onevision-enabled',
          oneVisionEnabled && `onevision-profile-${colorProfile}`
        )}
        style={{
          '--onevision-brightness': customSettings.brightness,
          '--onevision-contrast': customSettings.contrast,
          '--onevision-saturation': customSettings.saturation,
        } as React.CSSProperties}
        playsInline
        webkit-playsinline="true"
        x5-playsinline="true"
      />

      {overlayLabel && (
        <div className="absolute top-4 left-4 z-30 bg-black/60 text-white text-sm font-medium px-3 py-1.5 rounded">
          {overlayLabel}
        </div>
      )}
      
      {/* OneSub™ - Altyazı Gösterimi */}
      {oneSubEnabled && currentSubtitleText && (
        <div 
          className={cn(
            "absolute left-0 right-0 z-20 flex justify-center px-4 pointer-events-none",
            'transition-opacity duration-300',
            currentSubtitleText ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            bottom: `${subtitleSettings.position}%`,
            pointerEvents: 'none',
          }}
        >
          <div 
            className="max-w-4xl w-full text-center px-6 py-2 rounded"
            style={{
              backgroundColor: `rgba(0, 0, 0, ${subtitleSettings.backgroundOpacity})`,
              color: subtitleSettings.fontColor,
              fontSize: `${subtitleSettings.fontSize}px`,
              fontFamily: subtitleSettings.fontFamily,
              fontWeight: subtitleSettings.fontWeight,
              lineHeight: '1.5',
              display: 'inline-block',
              pointerEvents: 'none',
              textShadow: `
                -${subtitleSettings.textOutline}px -${subtitleSettings.textOutline}px 0 #000,  
                ${subtitleSettings.textOutline}px -${subtitleSettings.textOutline}px 0 #000,
                -${subtitleSettings.textOutline}px ${subtitleSettings.textOutline}px 0 #000,
                ${subtitleSettings.textOutline}px ${subtitleSettings.textOutline}px 0 #000,
                0 0 ${subtitleSettings.textOutline * 2}px rgba(0, 0, 0, 0.8)
              `,
            }}
          >
            {currentSubtitleText.split('\n').map((line, index) => (
              <div key={index} className="pointer-events-none">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ekran Ortası Durum Göstergeleri */}
      <div className="absolute inset-0 pointer-events-none z-20">
        
        {/* Buffering Göstergesi */}
        {isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {playbackError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-auto p-4">
            <div className="bg-black/85 p-5 rounded-xl shadow-2xl max-w-sm w-full text-center border border-white/10 space-y-4">
              <div className="text-white text-base font-semibold">{playbackError}</div>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRetry();
                }}
                className="bg-white/90 hover:bg-white text-black font-semibold px-4 py-2 h-auto"
              >
                Tekrar Dene
              </Button>
            </div>
          </div>
        )}

        {/* 2x Hız Göstergesi (Sağ üste) */}
        {isLongPressing && (
          <div className="absolute top-4 right-4 bg-black/70 px-3 py-1.5 rounded-lg shadow-lg pointer-events-none transition-opacity duration-150">
            <div className="text-white text-sm font-bold">2.0x Hız</div>
          </div>
        )}

        {/* Kaldığınız yerden devam ediliyor Göstergesi (Sağ üste - 10 Saniye sonra kaybolur) */}
        {showResumeIndicator && (
          <div className="absolute top-4 right-4 bg-black/70 px-3 py-1.5 rounded-lg shadow-lg pointer-events-none transition-opacity duration-300">
            <div className="text-white text-sm font-bold">Kaldığınız yerden devam ediliyor.</div>
          </div>
        )}


        {/* Atlama Göstergesi (Konum ve Boyut Küçültüldü) */}
        {skipIndicator.show && (
          <div 
            className={cn(
                "absolute top-1/2 transform -translate-y-1/2 bg-black/60 backdrop-blur-sm rounded-xl py-3 px-4 transition-all duration-150 ease-out flex flex-col items-center",
                skipIndicator.position === 'left' ? "left-4" : "right-4"
            )}
          >
            <div className="text-white text-xl font-medium mb-1">
              {skipIndicator.count * SEEK_SECONDS} s
            </div>
            <div className="text-white">
              {skipIndicator.direction === 'forward' ? 
                <FastForward className="h-6 w-6" /> : 
                <Rewind className="h-6 w-6" />
              }
            </div>
          </div>
        )}

        {/* Kaldığınız Yerden Devam Etme İstemi (Ortada - Mobil Uyumlu ve Kompakt) */}
        {showResumePrompt && resumeTime !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-auto p-4">
            <div className="bg-black/80 p-5 rounded-xl shadow-2xl max-w-xs sm:max-w-sm w-full text-center border border-white/10"> 
              <h3 className="text-lg sm:text-xl font-bold text-white mb-3"> 
                Kaldığınız yerden devam edin
              </h3>
              <p className="text-base sm:text-lg text-slate-300 mb-5">
                ({formatTime(resumeTime)})
              </p>
              <div className="flex justify-center space-x-3 sm:space-x-4">
                <Button
                  onClick={handleResume}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 sm:px-4 text-sm sm:text-base rounded transition-colors h-auto"
                >
                  Devam Et
                </Button>
                <Button
                  onClick={handleRestart}
                  variant="ghost"
                  className="bg-white/10 hover:bg-white/20 text-white font-semibold py-2 px-3 sm:px-4 text-sm sm:text-base rounded transition-colors border-none h-auto"
                >
                  Baştan Başla
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Başlat Düğmesi (Pause durumunda) */}
      {!isPlaying && !isBuffering && !showResumePrompt && !playbackError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="w-20 h-20 rounded-full bg-white/90 hover:bg-white transition-all hover:scale-110 flex items-center justify-center cursor-pointer pointer-events-auto"
          >
            <Play className="h-10 w-10 text-black ml-1" />
          </div>
        </div>
      )}

      {/* Kontrol Çubuğu Arka Planı ve İçeriği */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 transition-opacity duration-300 pointer-events-none",
          // Prompt varken veya kontroller gösterilmek isteniyorsa tamamen görünür
          showControls || showResumePrompt ? "opacity-100" : "opacity-0" 
        )}
      />

      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 p-4 space-y-2 transition-transform duration-300 z-30",
          // Prompt varken veya kontroller gösterilmek isteniyorsa aşağıdan kaymaz
          showControls || showResumePrompt ? "translate-y-0" : "translate-y-full pointer-events-none" 
        )}
        // Kontrol çubuğu üzerine gelindiğinde gizlenmeyi iptal et ve göster
        onMouseEnter={() => showAndResetControlsTimer()} 
        // Kontrol çubuğundan çıkıldığında gizlemeyi yeniden başlat
        onMouseLeave={hideControls}
      >
        {/* Progress Bar ve Thumbnail */}
        <div
          className="relative group/progress"
          onMouseEnter={() => !isTouchDevice && setIsHoveringProgress(true)}
          onMouseLeave={() => !isTouchDevice && setIsHoveringProgress(false)}
          onMouseMove={(e) => !isTouchDevice && handleProgressInteraction(e)}
          onTouchStart={handleProgressTouchStart}
          onTouchMove={handleProgressTouchMove}
          onTouchEnd={handleProgressTouchEnd}
        >
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
            disabled={showResumePrompt || !!playbackError} 
          />

          {/* Thumbnail Göstergesi */}
          {(isHoveringProgress || isDraggingProgress) && duration > 0 && (
            <div
              className="absolute bottom-full mb-2 transform -translate-x-1/2 pointer-events-none z-50"
              style={{ left: `${thumbnailPosition}px` }}
            >
              <div className="bg-black/95 rounded-lg p-2 shadow-xl border border-white/20">
                <canvas
                  ref={thumbnailCanvasRef}
                  className="rounded mb-2"
                  width="160"
                  height="90"
                />
                <div className="text-white text-xs font-medium text-center">
                  {formatTime(hoverTime)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Kontrol Düğmeleri */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              className="text-white hover:bg-white/20"
              disabled={showResumePrompt || !!playbackError}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </Button>

            {/* Geri Atlama */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => skip(-SEEK_SECONDS)}
              className="text-white hover:bg-white/20 hidden sm:flex"
              disabled={showResumePrompt || !!playbackError}
            >
              <SkipBack className="h-5 w-5" />
            </Button>

            {/* İleri Atlama */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => skip(SEEK_SECONDS)}
              className="text-white hover:bg-white/20 hidden sm:flex"
              disabled={showResumePrompt || !!playbackError}
            >
              <SkipForward className="h-5 w-5" />
            </Button>

            {/* Ses Kontrolü */}
            <div className="hidden sm:flex items-center gap-2 ml-2 group/volume">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleMute}
                className="text-white hover:bg-white/20"
                disabled={showResumePrompt}
              >
                {isMuted || (volume === 0 && !isMuted) ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </Button>

              <div className="w-0 overflow-hidden group-hover/volume:w-24 transition-all duration-300">
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  step={0.01}
                  onValueChange={handleVolumeChange}
                  className="cursor-pointer"
                  disabled={showResumePrompt}
                />
              </div>
            </div>

            {/* Zaman Göstergesi */}
            <span className="text-white text-sm font-medium ml-2 hidden sm:inline">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Loop Kontrolü */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLoop}
              className={cn(
                "text-white hover:bg-white/20 hidden sm:flex",
                loop !== 'none' && "text-blue-400"
              )}
              title={loop === 'none' ? 'Tekrar yok' : 'Bir kez tekrarla'}
              disabled={showResumePrompt}
            >
              {loop === 'one' ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
            </Button>
            
            {/* Ayarlar Menüsü */}
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                    setShowSettings(!showSettings);
                    setSettingsView('main');
                    showAndResetControlsTimer(); // Tıkladığında sayacı sıfırla
                }}
                className="text-white hover:bg-white/20"
                disabled={showResumePrompt}
              >
                <Settings className="h-5 w-5" />
              </Button>

              {showSettings && (
                <div className="absolute bottom-full right-0 mb-2 bg-black/95 backdrop-blur-sm rounded-lg overflow-y-auto max-h-[80vh] w-[280px] sm:min-w-[200px] shadow-2xl border border-white/10 custom-scrollbar"
                   style={{
                     WebkitOverflowScrolling: 'touch',
                     scrollbarWidth: 'none', // Hide scrollbar in Firefox
                     msOverflowStyle: 'none', // Hide scrollbar in IE/Edge
                   }}
                   onMouseEnter={() => { if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current); }}
                   onMouseLeave={hideControls}
                   onClick={(e) => e.stopPropagation()}
                >
                  {/* Ana Ayarlar */}
                  {settingsView === 'main' && (
                    <div className="py-2">
                      <button
                        onClick={() => setSettingsView('quality')}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition-colors text-white"
                      >
                        <span>Kalite</span>
                        <div className="flex items-center gap-2 text-slate-300">
                          <span className="text-xs">{quality}</span>
                          <ChevronLeft className="h-4 w-4 rotate-180" />
                        </div>
                      </button>
                      <button
                        onClick={() => setSettingsView('speed')}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition-colors text-white"
                      >
                        <span>Hız</span>
                        <div className="flex items-center gap-2 text-slate-300">
                          <span className="text-xs">{playbackRate === 1 ? 'Normal' : `${playbackRate}x`}</span>
                          <ChevronLeft className="h-4 w-4 rotate-180" />
                        </div>
                      </button>
                      <button
                        onClick={() => setSettingsView('onevision')}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition-colors text-white"
                      >
                        <div className="flex items-center gap-2">
                          <span>OneVision™</span>
                          <span className="text-xs bg-gradient-to-r from-blue-500 to-purple-500 text-white px-1.5 py-0.5 rounded">BETA</span>
                        </div>
                        <ChevronLeft className="h-4 w-4 rotate-180 text-slate-300" />
                      </button>
                      <button
                        onClick={() => setSettingsView('onesub')}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition-colors text-white"
                      >
                        <div className="flex items-center gap-2">
                          <span>OneSub™</span>
                          <span className="text-xs bg-gradient-to-r from-green-500 to-teal-500 text-white px-1.5 py-0.5 rounded">BETA</span>
                        </div>
                        <ChevronLeft className="h-4 w-4 rotate-180 text-slate-300" />
                      </button>
                    </div>
                  )}

                  {/* Kalite Ayarları */}
                  {settingsView === 'quality' && (
                    <div className="py-2">
                      <div className="sticky top-0 bg-black/95 z-10 flex items-center gap-2 px-4 py-2 border-b border-white/10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSettingsView('main');
                          }}
                          className="p-1 -ml-1 text-white hover:text-slate-300 transition-colors"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className="text-white text-base font-medium">Kalite</span>
                      </div>
                      {isLoadingQualities ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                      <span className="ml-2 text-sm text-white">Kaliteler yükleniyor...</span>
                    </div>
                  ) : availableQualities.length > 0 ? (
                    <>
                      <button
                        key="auto"
                        onClick={() => changeQuality('auto')}
                        className={cn(
                          "w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors flex items-center justify-between",
                          quality === 'auto' ? "text-blue-400 bg-white/5" : "text-white"
                        )}
                      >
                        <span>Otomatik</span>
                        {quality === 'auto' && <Check className="h-4 w-4" />}
                      </button>
                      {availableQualities.map((q) => (
                        <button
                          key={q.name}
                          onClick={() => changeQuality(q.name)}
                          className={cn(
                            "w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors flex items-center justify-between",
                            quality === q.name ? "text-blue-400 bg-white/5" : "text-white"
                          )}
                        >
                          <span>{q.name}</span>
                          {quality === q.name && <Check className="h-4 w-4" />}
                        </button>
                      ))}
                    </>
                  ) : (
                    <div className="p-4 text-center text-sm text-white/70">
                      Kalite seçeneği bulunamadı
                    </div>
                  )}
                    </div>
                  )}

                  {/* Hız Ayarları */}
                  {settingsView === 'speed' && (
                    <div className="py-2">
                      <div className="sticky top-0 bg-black/95 z-10 flex items-center gap-2 px-4 py-2 border-b border-white/10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSettingsView('main');
                          }}
                          className="p-1 -ml-1 text-white hover:text-slate-300 transition-colors"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className="text-white text-base font-medium">Oynatma Hızı</span>
                      </div>
                      {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changePlaybackRate(rate)}
                          className={cn(
                            "w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors",
                            playbackRate === rate ? "text-blue-400 bg-white/5" : "text-white"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span>{rate === 1 ? 'Normal' : `${rate}x`}</span>
                            {playbackRate === rate && (
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* OneVision™ Ayarları */}
                  {settingsView === 'onevision' && (
                    <div className="py-2">
                      <div className="sticky top-0 bg-black/95 z-10 flex items-center gap-2 px-4 py-2 border-b border-white/10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSettingsView('main');
                          }}
                          className="p-1 -ml-1 text-white hover:text-slate-300 transition-colors"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className="text-white text-base font-medium">OneVision™</span>
                      </div>
                      
                      <div className="px-4 py-2">
                        <div className="space-y-4 p-2">
                          <div className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5">
                            <span className="text-sm text-white">OneVision™</span>
                            <button
                              onClick={() => {
                                const newState = !oneVisionEnabled;
                                setOneVisionEnabled(newState);
                                if (newState && isAutoEnhance) {
                                  applyAutoEnhance();
                                }
                              }}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                oneVisionEnabled ? 'bg-blue-600' : 'bg-gray-600'
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                  oneVisionEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>

                          {oneVisionEnabled && (
                            <div className="flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className="text-sm text-white">Sahne Tespiti</span>
                                <span className="text-xs text-white/60">Sahneye göre otomatik ayar</span>
                              </div>
                              <div className="flex items-center">
                                {isAnalyzingScenes && (
                                  <Loader2 className="h-3 w-3 mr-2 animate-spin text-blue-400" />
                                )}
                                <button
                                  onClick={toggleSceneDetection}
                                  disabled={isAnalyzingScenes}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                    sceneDetectionEnabled ? 'bg-blue-600' : 'bg-gray-600'
                                  } ${isAnalyzingScenes ? 'opacity-50' : ''}`}
                                >
                                  <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                      sceneDetectionEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                  />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {oneVisionEnabled && (
                          <div className="space-y-4">
                            <div className="mt-4">
                              <div className="flex justify-between mb-2">
                                <span className="text-xs text-white/80">Renk Profili</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { id: 'natural', label: 'Doğal' },
                                  { id: 'vivid', label: 'Canlı' },
                                  { id: 'cinematic', label: 'Sinema' },
                                  { id: 'cool', label: 'Soğuk' },
                                  { id: 'ozel', label: 'Özel' },
                                  { id: 'warm', label: 'Sıcak' }
                                ].map((profile) => (
                                  <button
                                    key={profile.id}
                                    onClick={() => setColorProfile(profile.id as any)}
                                    className={cn(
                                      "py-1.5 px-2 text-xs rounded-md transition-colors",
                                      colorProfile === profile.id 
                                        ? "bg-blue-600 text-white" 
                                        : "bg-white/10 text-white/80 hover:bg-white/20"
                                    )}
                                  >
                                    {profile.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="pt-2 border-t border-white/10">
                              {/* OneHDR™ Toggle */}
                              <div className="flex justify-between items-center mb-2">
                                <div className="flex flex-col">
                                  <span className="text-sm text-white">OneHDR™</span>
                                  <span className="text-xs text-white/60">Akıllı HDR Simülasyonu</span>
                                </div>
                                <button
                                  onClick={() => setOneHDREnabled(!oneHDREnabled)}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                    oneHDREnabled ? 'bg-gradient-to-r from-yellow-500 to-orange-500' : 'bg-gray-600'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                      oneHDREnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                  />
                                </button>
                              </div>
                              
                              {oneHDREnabled && (
                                <div className="pl-2 border-l-2 border-yellow-500/30 mb-3 space-y-3">
                                  {/* Otomatik HDR Toggle - Sadeleştirilmiş Versiyon */}
                                  <div className="flex justify-between items-center p-2 rounded-lg">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-white">Akıllı HDR</span>
                                      {isAnalyzingHDR && (
                                        <div className="flex items-center">
                                          <Loader2 className="h-3 w-3 animate-spin text-yellow-400 mr-1" />
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={toggleAutoHDR}
                                      disabled={isAnalyzingHDR}
                                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all focus:outline-none ${
                                        hdrSettings.isAuto 
                                          ? 'bg-gradient-to-r from-blue-600 to-purple-600 shadow-lg shadow-blue-500/20' 
                                          : 'bg-gray-600 hover:bg-gray-500'
                                      } ${isAnalyzingHDR ? 'opacity-70' : ''}`}
                                    >
                                      <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-all ${
                                          hdrSettings.isAuto ? 'translate-x-4' : 'translate-x-0.5'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                  
                                  {!hdrSettings.isAuto && (
                                    <>
                                      <div>
                                        <div className="flex justify-between mb-1">
                                          <span className="text-xs text-white/80">HDR Şiddeti</span>
                                          <span className="text-xs text-yellow-400/80">
                                            {Math.round(hdrSettings.intensity * 100)}%
                                          </span>
                                        </div>
                                        <Slider
                                          value={[hdrSettings.intensity]}
                                          min={0.5}
                                          max={2}
                                          step={0.1}
                                          onValueChange={([value]) => 
                                            setHdrSettings(prev => ({ ...prev, intensity: value, isAuto: false }))
                                          }
                                          className="h-1.5"
                                          disabled={hdrSettings.isAuto}
                                        />
                                      </div>
                                  
                                      <div>
                                        <div className="flex justify-between mb-1">
                                          <span className="text-xs text-white/80">Kontrast Derinliği</span>
                                          <span className="text-xs text-yellow-400/80">
                                            {Math.round((hdrSettings.contrastDepth - 1) * 100)}%
                                          </span>
                                        </div>
                                        <Slider
                                          value={[hdrSettings.contrastDepth]}
                                          min={0.8}
                                          max={1.5}
                                          step={0.05}
                                          onValueChange={([value]) => 
                                            setHdrSettings(prev => ({ ...prev, contrastDepth: value, isAuto: false }))
                                          }
                                          className="h-1.5"
                                          disabled={hdrSettings.isAuto}
                                        />
                                      </div>
                                      
                                      <div>
                                        <div className="flex justify-between mb-1">
                                          <span className="text-xs text-white/80">Renk Canlılığı</span>
                                          <span className="text-xs text-yellow-400/80">
                                            {Math.round((hdrSettings.colorVibrancy - 1) * 100)}%
                                          </span>
                                        </div>
                                        <Slider
                                          value={[hdrSettings.colorVibrancy]}
                                          min={0.8}
                                          max={1.5}
                                          step={0.05}
                                          onValueChange={([value]) => 
                                            setHdrSettings(prev => ({ ...prev, colorVibrancy: value, isAuto: false }))
                                          }
                                          className="h-1.5"
                                          disabled={hdrSettings.isAuto}
                                        />
                                      </div>
                                      
                                      <div>
                                        <div className="flex justify-between mb-1">
                                          <span className="text-xs text-white/80">Ton Dengesi</span>
                                          <span className="text-xs text-yellow-400/80">
                                            {hdrSettings.toneBalance < 0.4 ? 'Sıcak' : hdrSettings.toneBalance > 0.6 ? 'Soğuk' : 'Doğal'}
                                          </span>
                                        </div>
                                        <Slider
                                          value={[hdrSettings.toneBalance]}
                                          min={0}
                                          max={1}
                                          step={0.1}
                                          onValueChange={([value]) => 
                                            setHdrSettings(prev => ({ ...prev, toneBalance: value, isAuto: false }))
                                          }
                                          className="h-1.5"
                                          disabled={hdrSettings.isAuto}
                                        />
                                      </div>
                                    </>
                                  )}
                                  
                                  <div className="flex justify-between items-center pt-1">
                                    <span className="text-xs text-white/80">Dinamik Ton Eşleme</span>
                                    <button
                                      onClick={() => setHdrSettings(prev => ({ ...prev, isDynamic: !prev.isDynamic }))}
                                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                                        hdrSettings.isDynamic ? 'bg-blue-600' : 'bg-gray-600'
                                      }`}
                                    >
                                      <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                          hdrSettings.isDynamic ? 'translate-x-4' : 'translate-x-0.5'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                </div>
                              )}
                              
                              <div className="flex justify-between items-center mb-2 pt-2 border-t border-white/10">
                                <span className="text-sm text-white">Otomatik İyileştirme</span>
                                <button
                                  onClick={() => {
                                    const newState = !isAutoEnhance;
                                    setIsAutoEnhance(newState);
                                    if (newState) {
                                      applyAutoEnhance();
                                    }
                                  }}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                    isAutoEnhance ? 'bg-blue-600' : 'bg-gray-600'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                      isAutoEnhance ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                  />
                                </button>
                              </div>

                              {!isAutoEnhance && (
                                <div className="space-y-3">
                                  <div>
                                    <div className="flex justify-between mb-1">
                                      <span className="text-xs text-white/80">Parlaklık</span>
                                      <span className="text-xs text-white/60">
                                        {Math.round(customSettings.brightness * 100)}%
                                      </span>
                                    </div>
                                    <Slider
                                      value={[customSettings.brightness]}
                                      min={0.5}
                                      max={1.5}
                                      step={0.05}
                                      onValueChange={([value]) => 
                                        setCustomSettings(prev => ({ ...prev, brightness: value }))
                                      }
                                      className="h-2"
                                    />
                                  </div>
                                  
                                  <div>
                                    <div className="flex justify-between mb-1">
                                      <span className="text-xs text-white/80">Kontrast</span>
                                      <span className="text-xs text-white/60">
                                        {Math.round(customSettings.contrast * 100)}%
                                      </span>
                                    </div>
                                    <Slider
                                      value={[customSettings.contrast]}
                                      min={0.5}
                                      max={1.5}
                                      step={0.05}
                                      onValueChange={([value]) => 
                                        setCustomSettings(prev => ({ ...prev, contrast: value }))
                                      }
                                      className="h-2"
                                    />
                                  </div>
                                  
                                  <div>
                                    <div className="flex justify-between mb-1">
                                      <span className="text-xs text-white/80">Doygunluk</span>
                                      <span className="text-xs text-white/60">
                                        {Math.round(customSettings.saturation * 100)}%
                                      </span>
                                    </div>
                                    <Slider
                                      value={[customSettings.saturation]}
                                      min={0}
                                      max={2}
                                      step={0.05}
                                      onValueChange={([value]) => 
                                        setCustomSettings(prev => ({ ...prev, saturation: value }))
                                      }
                                      className="h-2"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        <div className="mt-4 pt-4 border-t border-white/10">
                          <p className="text-xs text-white/60 text-center">
                            {oneHDREnabled ? (
                              <span>OneHDR™ ile videolarınızı gerçek HDR kalitesinde izleyin. <span className="text-yellow-400">V0.0.0.3</span></span>
                            ) : (
                              <span>OneVision™ ile videolarınızı daha canlı ve kaliteli hale getir <span className="text-blue-400">V0.0.0.7</span> </span>
                            )}
                            <br />Developed by: S4Patrol
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* OneSub™ Ayarları */}
                  {settingsView === 'onesub' && (
                    <div className="py-2 max-h-[500px] overflow-y-auto">
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 sticky top-0 bg-black/95 backdrop-blur-sm z-10">
                        <button
                          onClick={() => setSettingsView('main')}
                          className="text-white hover:text-slate-300 transition-colors"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-white text-sm font-medium">OneSub™ Ayarları</span>
                      </div>
                      
                      <div className="px-4 py-3">
                        <div className="space-y-5">
                          {/* Altyazı Aç/Kapat */}
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-white font-medium">Altyazı Göster</span>
                            <button
                              onClick={() => setOneSubEnabled(!oneSubEnabled)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                oneSubEnabled ? 'bg-green-600' : 'bg-gray-600'
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                  oneSubEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                          
                          {/* Dil Seçimi */}
                          {subtitles && subtitles.length > 0 && (
                            <div className="space-y-2">
                              <span className="text-xs text-white/70 font-medium">Altyazı Dili</span>
                              <div className="space-y-1">
                                {subtitles.map((sub, index) => (
                                  <button
                                    key={index}
                                    onClick={() => setCurrentSubtitleIndex(index)}
                                    className={cn(
                                      "w-full text-left px-3 py-2 text-sm rounded hover:bg-white/10 transition-colors",
                                      currentSubtitleIndex === index ? "text-green-400 bg-white/5" : "text-white"
                                    )}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span>{sub.language}</span>
                                      {currentSubtitleIndex === index && (
                                        <Check className="h-4 w-4 text-green-400" />
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          <div className="border-t border-white/10 pt-4">
                            <h4 className="text-xs font-semibold text-white/90 mb-3">Görünüm Ayarları</h4>
                            
                            {/* Yazı Boyutu - Slider */}
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-white/70">Yazı Boyutu</span>
                                <span className="text-xs text-white font-mono">{subtitleSettings.fontSize}px</span>
                              </div>
                              <Slider
                                value={[subtitleSettings.fontSize]}
                                onValueChange={(value) => setSubtitleSettings(prev => ({ ...prev, fontSize: value[0] }))}
                                min={10}
                                max={40}
                                step={1}
                                className="w-full"
                              />
                            </div>
                            
                            {/* Font Seçimi */}
                            <div className="space-y-2 mb-4">
                              <span className="text-xs text-white/70">Font</span>
                              <select
                                value={subtitleSettings.fontFamily}
                                onChange={(e) => setSubtitleSettings(prev => ({ ...prev, fontFamily: e.target.value }))}
                                className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/20 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-green-500"
                              >
                                <option value="var(--font-inter), Inter, system-ui, sans-serif" className="bg-gray-900">Inter (Önerilen)</option>
                                <option value="var(--font-nunito), Nunito, sans-serif" className="bg-gray-900">Nunito</option>
                                <option value="var(--font-noto-sans), Noto Sans, sans-serif" className="bg-gray-900">Noto Sans</option>
                                <option value="var(--font-roboto), Roboto, sans-serif" className="bg-gray-900">Roboto</option>
                                <option value="var(--font-open-sans), Open Sans, sans-serif" className="bg-gray-900">Open Sans</option>
                                <option value="Arial, Helvetica, sans-serif" className="bg-gray-900">Arial</option>
                                <option value="'Segoe UI', Tahoma, sans-serif" className="bg-gray-900">Segoe UI</option>
                                <option value="system-ui, -apple-system, sans-serif" className="bg-gray-900">Sistem Fontu</option>
                              </select>
                            </div>
                            
                            {/* Yazı Kalınlığı - Slider */}
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-white/70">Yazı Kalınlığı</span>
                                <span className="text-xs text-white font-mono">{subtitleSettings.fontWeight}</span>
                              </div>
                              <Slider
                                value={[subtitleSettings.fontWeight]}
                                onValueChange={(value) => setSubtitleSettings(prev => ({ ...prev, fontWeight: value[0] }))}
                                min={100}
                                max={900}
                                step={100}
                                className="w-full"
                              />
                            </div>
                            
                            {/* Konum - Slider */}
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-white/70">Konum (Alttan)</span>
                                <span className="text-xs text-white font-mono">{subtitleSettings.position}%</span>
                              </div>
                              <Slider
                                value={[subtitleSettings.position]}
                                onValueChange={(value) => setSubtitleSettings(prev => ({ ...prev, position: value[0] }))}
                                min={0}
                                max={50}
                                step={1}
                                className="w-full"
                              />
                            </div>
                          </div>
                          
                          <div className="border-t border-white/10 pt-4">
                            <h4 className="text-xs font-semibold text-white/90 mb-3">Renk Ayarları</h4>
                            
                            {/* Yazı Rengi */}
                            <div className="space-y-2 mb-4">
                              <span className="text-xs text-white/70">Yazı Rengi</span>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={subtitleSettings.fontColor}
                                  onChange={(e) => setSubtitleSettings(prev => ({ ...prev, fontColor: e.target.value }))}
                                  className="w-12 h-10 rounded cursor-pointer border border-white/20"
                                />
                                <input
                                  type="text"
                                  value={subtitleSettings.fontColor}
                                  onChange={(e) => setSubtitleSettings(prev => ({ ...prev, fontColor: e.target.value }))}
                                  className="flex-1 bg-white/10 text-white text-xs px-3 py-2 rounded border border-white/20 font-mono"
                                  placeholder="#FFFFFF"
                                />
                              </div>
                            </div>
                            
                            {/* Arka Plan Opaklığı */}
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-white/70">Arka Plan Opaklığı</span>
                                <span className="text-xs text-white font-mono">{Math.round(subtitleSettings.backgroundOpacity * 100)}%</span>
                              </div>
                              <Slider
                                value={[subtitleSettings.backgroundOpacity * 100]}
                                onValueChange={(value) => setSubtitleSettings(prev => ({ ...prev, backgroundOpacity: value[0] / 100 }))}
                                min={0}
                                max={100}
                                step={5}
                                className="w-full"
                              />
                            </div>
                            
                            {/* Metin Kenarlık Kalınlığı */}
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-white/70">Metin Kenarlık</span>
                                <span className="text-xs text-white font-mono">{subtitleSettings.textOutline}px</span>
                              </div>
                              <Slider
                                value={[subtitleSettings.textOutline]}
                                onValueChange={(value) => setSubtitleSettings(prev => ({ ...prev, textOutline: value[0] }))}
                                min={0}
                                max={5}
                                step={0.5}
                                className="w-full"
                              />
                            </div>
                          </div>
                          
                          <div className="mt-4 pt-4 border-t border-white/10">
                            <p className="text-xs text-white/60 text-center">
                              <span>OneSub™ - Gelişmiş Altyazı Sistemi <span className="text-green-400">V2.0.0</span></span>
                              <br />Developed by: S4Patrol
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tam Ekran */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/20"
            >
              {isFullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}