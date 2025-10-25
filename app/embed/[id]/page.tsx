'use client';

import { useEffect, useState } from 'react';
import { VideoPlayer } from '@/components/VideoPlayer';
import { Loader2 } from 'lucide-react';

export default function EmbedPage({ params }: { params: { id: string } }) {
  const [videoData, setVideoData] = useState<{
    url: string;
    embedId: string;
    animeTitle?: string;
    episodeNumber?: string;
    subtitles?: Array<{language: string; languageCode: string; content: string; format: string}>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVideo = async () => {
      try {
        const response = await fetch(`/api/embed/${params.id}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load video');
        }
        
        console.log('📺 Video verisi yüklendi:', {
          url: data.video?.url,
          embedId: data.video?.embedId,
          subtitles: data.video?.subtitles,
          subtitleCount: data.video?.subtitles?.length || 0
        });
        
        setVideoData(data.video);
      } catch (err) {
        console.error('Error fetching video:', err);
        setError(err instanceof Error ? err.message : 'Failed to load video');
      } finally {
        setIsLoading(false);
      }
    };

    fetchVideo();
  }, [params.id]);

  // Show player immediately, it will handle its own loading state
  if (isLoading || !videoData) {
    return (
      <div className="w-full h-screen bg-black">
        <VideoPlayer
          src=""
          progressKey="loading-player"
          className="w-full h-full"
        />
      </div>
    );
  }

  if (error || !videoData) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center p-6 max-w-md">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">Error</h2>
          <p className="text-gray-700 dark:text-gray-300">
            {error || 'Video not found or failed to load'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-black">
      <VideoPlayer
        src={videoData.url}
        progressKey={`embed-${videoData.embedId}`}
        className="w-full h-full"
        overlayLabel={[videoData.animeTitle, videoData.episodeNumber].filter(Boolean).join(' ')}
        subtitles={videoData.subtitles || []}
      />
    </div>
  );
}
