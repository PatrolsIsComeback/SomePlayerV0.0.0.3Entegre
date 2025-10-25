'use client';

import { useState, useRef, ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export function VideoUploader({ onUploadComplete }: { onUploadComplete: (url: string) => void }) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if file is a video
    if (!file.type.startsWith('video/')) {
      setError('Lütfen sadece video dosyası yükleyin.');
      return;
    }

    // Check file size (max 2GB)
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setError('Dosya boyutu 2GB\'dan büyük olamaz.');
      return;
    }

    await uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError(null);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Dosya yüklenirken bir hata oluştu');
      }

      if (!result.url) {
        throw new Error('Dosya URL\'si alınamadı');
      }

      onUploadComplete(result.url);

    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Dosya yüklenirken bir hata oluştu');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? 'Yükleniyor...' : 'Dosya Seç'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />
        {isUploading && (
          <span className="text-sm text-muted-foreground">
            {progress}% tamamlandı
          </span>
        )}
      </div>
      
      {isUploading && <Progress value={progress} className="h-2" />}
      
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
      
      <p className="text-xs text-muted-foreground">
        Desteklenen formatlar: MP4, WebM, MOV, AVI (Maks. 2GB)
      </p>
    </div>
  );
}
