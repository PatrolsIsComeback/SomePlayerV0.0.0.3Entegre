import { NextResponse } from 'next/server';

const BACKEND_PROXY_URL = process.env.PROXY_SERVICE_URL;
const GOOGLE_DRIVE_ID_REGEX = /[\w-]{20,}/;

interface ProxyRequestBody {
  provider?: string;
  source?: string;
  identifier?: string;
}

const detectSource = (input: string) => {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();

    // Google Drive
    if (host.includes('drive.google.com') || host.includes('drive.usercontent.google.com')) {
      const idParam = url.searchParams.get('id');
      const match = url.pathname.match(/\/file\/d\/([^/]+)/) || url.pathname.match(/\/download\/([^/]+)/);
      const id = idParam || match?.[1];
      if (id) {
        return {
          provider: 'google-drive',
          identifier: id,
        };
      }
    }

    // Vidmoly
    if (host.includes('vidmoly') || host.includes('vidmoly.to')) {
      // Handle both vidmoly.me and vidmoly.to domains
      const slug = url.pathname.split('/').filter(Boolean).pop();
      if (slug && slug.length > 5) { // Basic validation for slug
        return {
          provider: 'vidmoly',
          identifier: slug,
        };
      }
    }

    if (host.includes('voe')) {
      const slug = url.pathname.split('/').filter(Boolean).pop();
      return {
        provider: 'voe',
        identifier: slug ?? trimmed,
      };
    }

    if (url.pathname.toLowerCase().endsWith('.mp4')) {
      return {
        provider: 'direct',
        identifier: trimmed,
      };
    }
  } catch {
    if (trimmed.toLowerCase().endsWith('.mp4')) {
      return {
        provider: 'direct',
        identifier: trimmed,
      };
    }
  }

  return { provider: 'unknown', identifier: trimmed };
};

const USER_AGENT_HEADER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Common headers to mimic a real browser
const crypto = require('crypto');

const COMMON_HEADERS = {
  'User-Agent': USER_AGENT_HEADER,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0'
};

const getSetCookieHeaders = (response: Response): string[] => {
  const anyResponse = response as unknown as { headers?: { getSetCookie?: () => string[] } };
  if (anyResponse?.headers?.getSetCookie) {
    return anyResponse.headers.getSetCookie();
  }

  const singleCookie = response.headers.get('set-cookie');
  return singleCookie ? [singleCookie] : [];
};

const appendCookies = (cookieJar: Map<string, string>, cookieHeaders: string[]) => {
  cookieHeaders.forEach((cookieHeader) => {
    const [pair] = cookieHeader.split(';');
    if (!pair) return;
    const [name, ...rest] = pair.split('=');
    if (!name) return;
    cookieJar.set(name.trim(), rest.join('=').trim());
  });
};

const buildCookieHeader = (cookieJar: Map<string, string>) => {
  if (!cookieJar.size) return undefined;
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
};

const resolveRelativeUrl = (location: string, base: string) => {
  try {
    return new URL(location, base).toString();
  } catch {
    return location;
  }
};

const extractConfirmToken = (html: string) => {
  const match = html.match(/confirm=([0-9A-Za-z_-]+)/);
  return match ? match[1] : null;
};

// Function to fetch video stream from Vidmoly using a more reliable approach
async function fetchVidmolyStream(slug: string, rangeHeader?: string) {
  const VIDMOLY_URL = `https://vidmoly.me/${slug}`;
  const API_ENDPOINT = 'https://api.vevioz.com/api/button/videos';
  
  try {
    console.log(`Fetching Vidmoly video: ${VIDMOLY_URL}`);
    
    // First, try to get the video ID from the page
    const pageResponse = await fetch(VIDMOLY_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.google.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!pageResponse.ok) {
      throw new Error(`Failed to fetch Vidmoly page: ${pageResponse.status} ${pageResponse.statusText}`);
    }
    
    const pageHtml = await pageResponse.text();
    
    // Try to extract the video ID from the page
    const videoIdMatch = pageHtml.match(/video_id['"]\s*[:=]\s*['"]([^'"&]+)/i) || 
                         pageHtml.match(/vidmoly\.me\/([a-zA-Z0-9]+)/i);
    
    if (!videoIdMatch || !videoIdMatch[1]) {
      throw new Error('Could not extract video ID from the page');
    }
    
    const videoId = videoIdMatch[1];
    console.log('Extracted video ID:', videoId);
    
    // Use a third-party API to get the video URL
    const apiResponse = await fetch(`${API_ENDPOINT}/${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Referer': VIDMOLY_URL,
        'Origin': 'https://vidmoly.me'
      },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!apiResponse.ok) {
      throw new Error(`Failed to fetch video info: ${apiResponse.status} ${apiResponse.statusText}`);
    }
    
    const videoData = await apiResponse.json();
    
    // Extract the highest quality video URL
    if (!videoData || !videoData.videos || !Array.isArray(videoData.videos) || videoData.videos.length === 0) {
      throw new Error('No video sources found in the API response');
    }
    
    // Sort by quality (highest first)
    const sortedVideos = videoData.videos.sort((a: any, b: any) => {
      const aQuality = parseInt(a.quality?.replace('p', '') || '0');
      const bQuality = parseInt(b.quality?.replace('p', '') || '0');
      return bQuality - aQuality;
    });
    
    const videoUrl = sortedVideos[0]?.url;
    if (!videoUrl) {
      throw new Error('No valid video URL found');
    }
    
    console.log('Found video URL:', videoUrl);
    
    // Fetch the video stream
    const videoResponse = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': VIDMOLY_URL,
        'Origin': 'https://vidmoly.me',
        'Range': rangeHeader || 'bytes=0-',
      },
      signal: AbortSignal.timeout(30000)
    });
    
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video: ${videoResponse.status} ${videoResponse.statusText}`);
    }
    
    return videoResponse;
    
  } catch (error: any) {
    console.error('Vidmoly fetch error:', error);
    throw new Error(`Vidmoly error: ${error.message}`);
  }
}


// Function to fetch video stream from Google Drive
async function fetchGoogleDriveStream(id: string, rangeHeader?: string) {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
  const cookieJar = new Map<string, string>();
  const MAX_RETRIES = 6;

  // Try multiple approaches to get the file, ordered by most reliable first
  const approaches = [
    // Google Drive API (requires API key) - most reliable if available
    ...(GOOGLE_API_KEY ? [{
      name: 'Google Drive API',
      url: `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${GOOGLE_API_KEY}`,
      useApi: true
    }] : []),
    
    // Direct download with cookie-based authentication
    {
      name: 'Direct Download with Cookie',
      url: `https://drive.google.com/uc?export=download&id=${id}&confirm=t&uuid=`,
      useApi: false
    },
    
    // Alternative direct download URL
    {
      name: 'Alternative Direct Download',
      url: `https://drive.google.com/uc?export=download&id=${id}&confirm=t`,
      useApi: false
    },
    
    // Standard download with retry
    {
      name: 'Standard Download',
      url: `https://drive.google.com/uc?export=download&id=${id}`,
      useApi: false
    },
    
    // View URL as last resort
    {
      name: 'View URL',
      url: `https://drive.google.com/uc?export=view&id=${id}`,
      useApi: false
    }
  ];

  let finalUrl = '';
  let lastError: Error | null = null;

  for (const approach of approaches) {
    // Skip API approach if no API key is provided
    if (approach.useApi && (!GOOGLE_API_KEY || GOOGLE_API_KEY.length < 20)) {
      console.log(`Skipping ${approach.name} - No valid API key provided`);
      continue;
    }

    console.log(`Trying ${approach.name}...`);
    
    try {
      // Add a random UUID to prevent caching
      const urlWithUUID = approach.url + (approach.url.includes('?') ? '&' : '?') + 'uuid=' + crypto.randomUUID();
      
      const response = await fetch(urlWithUUID, {
        method: 'GET',
        headers: {
          ...COMMON_HEADERS,
          ...(rangeHeader ? { 'Range': rangeHeader } : {}),
          ...(cookieJar.size > 0 ? { 'Cookie': buildCookieHeader(cookieJar) } : {}),
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': '*/*',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': 'https://drive.google.com/'
        },
        redirect: 'manual',
        // Add a 30-second timeout
        signal: AbortSignal.timeout(30000)
      });

      // Handle redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          console.log(`Redirected to: ${location}`);
          finalUrl = location;
          break;
        }
      }

      // If we get a successful response, use this URL
      if (response.ok) {
        console.log(`Success with ${approach.name}`);
        finalUrl = approach.url;
        break;
      }

      // If we get an HTML response, it might be a confirmation page
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        console.log(`Got HTML response, might be a confirmation page`);
        
        // Try to extract download URL from the page
        const html = await response.text();
        const formActionMatch = html.match(/<form[^>]*action="([^"]*)"/i);
        const confirmTokenMatch = html.match(/name="confirm"[^>]*value="([^"]*)"/i);
        
        if (formActionMatch && confirmTokenMatch) {
          const formAction = formActionMatch[1];
          const confirmToken = confirmTokenMatch[1];
          console.log(`Found form action: ${formAction}, confirm token: ${confirmToken}`);
          
          // Submit the form to get the actual download URL
          const formUrl = new URL(formAction, approach.url).toString();
          console.log(`Submitting form to: ${formUrl}`);
          
          // Add a small delay before form submission
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const formResponse = await fetch(formUrl, {
            method: 'POST',
            headers: {
              'User-Agent': USER_AGENT_HEADER,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
              'Accept-Language': 'en-US,en;q=0.9',
              'Content-Type': 'application/x-www-form-urlencoded',
              'Origin': 'https://drive.google.com',
              'Referer': approach.url,
              'Cookie': buildCookieHeader(cookieJar) || '',
              'DNT': '1',
              'Connection': 'keep-alive',
              'Upgrade-Insecure-Requests': '1',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'same-origin',
              'Sec-Fetch-User': '?1',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Accept-Encoding': 'gzip, deflate, br',
              'TE': 'trailers'
            },
            body: new URLSearchParams({
              'confirm': confirmToken,
              'id': id,
              'export': 'download'
            }),
            redirect: 'manual'
          });

          if (formResponse.status >= 300 && formResponse.status < 400) {
            const location = formResponse.headers.get('location');
            if (location) {
              console.log(`Form submission redirected to: ${location}`);
              finalUrl = location;
              break;
            }
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      console.warn(`Error with ${approach.name}: ${err.message}`);
      lastError = err;
    }
  }

  if (!finalUrl) {
    console.error('All download attempts failed');
    throw new Error(lastError?.message || 'Could not access Google Drive file. Please check: ' +
      '1. The file has "Anyone with the link" permission\n' +
      '2. The file is not too large (under 100MB for direct downloads)\n' +
      '3. The Google Drive link is correct\n' +
      '4. If the file is large, you might need to wait a few minutes for Google Drive to process it\n' +
      '5. For large files, consider uploading to YouTube and sharing from there');
  }

  if (!finalUrl) {
    throw new Error('Could not access Google Drive file with any method');
  }

  // First, try to get the file metadata to check if it exists and is accessible
  const metadataUrl = `https://www.googleapis.com/drive/v3/files/${id}?fields=name,size,mimeType,webContentLink,webViewLink`;
  
  try {
    // Try to get file metadata
    const metadataResponse = await fetch(metadataUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json();
      console.log('File metadata:', metadata);
      
      // If we have a direct web content link, try to use it
      if (metadata.webContentLink) {
        console.log('Trying webContentLink:', metadata.webContentLink);
        const response = await fetch(metadata.webContentLink, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Range': rangeHeader || 'bytes=0-',
          },
          redirect: 'follow',
        });
        
        if (response.ok && response.body) {
          console.log('Successfully got video stream from webContentLink');
          return { response };
        }
      }
    }
  } catch (error) {
    console.log('Error fetching file metadata, falling back to direct download:', error);
  }
  
  // Try to fetch the final URL with proper headers and handling
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Fetching from URL (Attempt ${attempt}/${MAX_RETRIES}): ${finalUrl}`);
    
    try {
      const response = await fetch(finalUrl, {
        headers: {
          ...COMMON_HEADERS,
          'Accept': 'video/*, */*',
          'Referer': 'https://drive.google.com/',
          'Origin': 'https://drive.google.com',
          'Sec-Fetch-Dest': 'video',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site',
          ...(rangeHeader ? { 'Range': rangeHeader } : {}),
          ...(cookieJar.size > 0 ? { 'Cookie': buildCookieHeader(cookieJar) } : {})
        },
        redirect: 'follow',
        // @ts-ignore - Node.js fetch options
        follow: 5,
        compress: false
      });

      console.log(`Response status: ${response.status} ${response.statusText}`);
      
      // If we get a successful response, return it
      if (response.ok) {
        return { response };
      }

      // Handle rate limiting or temporary errors
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10) * 1000;
        console.log(`Rate limited, waiting ${retryAfter}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }

      console.log(`Response status: ${response.status} ${response.statusText}`);
      
      // Handle redirects manually to inspect them
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        console.log(`Redirected to: ${location}`);
        
        if (location) {
          // If we're redirected to a Google Drive viewer, try to extract the download URL
          if (location.includes('drive.google.com/file/d/')) {
            const fileIdMatch = location.match(/\/file\/d\/([^/]+)/);
            if (fileIdMatch && fileIdMatch[1]) {
              const newId = fileIdMatch[1];
              console.log(`Extracted new file ID from redirect: ${newId}`);
              // Try again with the new ID
              return fetchGoogleDriveStream(newId, rangeHeader);
            }
          }
          
          // If we're redirected to a download confirmation page, try to extract the download URL
          if (location.includes('drive.google.com/uc?') && location.includes('confirm=')) {
            const confirmMatch = location.match(/confirm=([^&]+)/);
            if (confirmMatch && confirmMatch[1]) {
              const confirmToken = confirmMatch[1];
              console.log(`Extracted confirm token: ${confirmToken}`);
              const newUrl = `https://drive.google.com/uc?export=download&id=${id}&confirm=${confirmToken}`;
              console.log(`Trying URL with confirm token: ${newUrl}`);
              const confirmedResponse = await fetch(newUrl, { 
                headers: {
                  ...COMMON_HEADERS,
                  'Accept': 'video/*, */*',
                  'Referer': 'https://drive.google.com/',
                  'Origin': 'https://drive.google.com'
                },
                redirect: 'follow' 
              });
              
              if (confirmedResponse.ok && confirmedResponse.body) {
                console.log('Successfully got video stream after confirm token');
                return { response: confirmedResponse };
              }
            }
          }
        }
        
        // If we have a location and it's not a Google Drive URL, try to follow it
        if (location && !location.startsWith('https://drive.google.com/')) {
          console.log(`Following external redirect to: ${location}`);
          try {
            // Define headers type that includes all possible headers we might use
            type HeadersType = {
              [key: string]: string | undefined;
              'Referer'?: string;
              'Origin'?: string;
              'content-length'?: string;
              'user-agent'?: string;
              'range'?: string;
              'cookie'?: string;
            };

            // Create new headers for the external request with proper typing
            const externalHeaders: HeadersType = {
              ...COMMON_HEADERS,
              'Referer': 'https://drive.google.com/',
              'Origin': 'https://drive.google.com',
              ...(rangeHeader ? { 'Range': rangeHeader } : {})
            };
            
            // Create a new headers object without problematic headers and undefined values
            const { 'content-length': contentLength, ...cleanHeaders } = externalHeaders;
            
            // Filter out undefined values and ensure all values are strings
            const filteredHeaders = Object.fromEntries(
              Object.entries(cleanHeaders)
                .filter(([_, value]) => value !== undefined)
                .map(([key, value]) => [key, String(value)])
            );
            
            // Make the request with the external URL
            const externalResponse = await fetch(location, { 
              headers: filteredHeaders,
              redirect: 'follow',
              // @ts-ignore - Node.js fetch types might not include all options
              follow: 5, // Follow up to 5 redirects
              // @ts-ignore
              compress: false // Disable compression to avoid issues with streaming
            });
            
            if (externalResponse.ok && externalResponse.body) {
              console.log('Successfully got video stream from external URL');
              // Create a new response with the correct headers
              const responseHeaders = new Headers(externalResponse.headers);
              responseHeaders.set('Access-Control-Allow-Origin', '*');
              responseHeaders.set('Access-Control-Expose-Headers', '*');
              
              return { 
                response: new Response(externalResponse.body, {
                  status: externalResponse.status,
                  headers: responseHeaders
                }) 
              };
            } else {
              console.log(`External request failed with status: ${externalResponse.status}`);
            }
          } catch (error) {
            console.error('Error following external redirect:', error);
          }
        }
        
        continue; // Try next URL format
      }
      
      // Check if we got a successful response with video content
      if (response.status === 200 || response.status === 206) {
        const contentType = response.headers.get('content-type') || '';
        console.log(`Content-Type: ${contentType}`);
        
        // If we got HTML, try to extract confirm token or move to next URL
        if (contentType.includes('text/html')) {
          const html = await response.text();
          console.log('Got HTML response, checking for confirm token...');
          
          // Try to find the download form and submit it
          const formActionMatch = html.match(/<form[^>]*action="([^"]*)"[^>]*>/);
          const confirmTokenMatch = html.match(/name="confirm"[^>]*value="([^"]*)"/);
          
          if (formActionMatch && confirmTokenMatch) {
            const formAction = formActionMatch[1];
            const confirmToken = confirmTokenMatch[1];
            console.log(`Found form action: ${formAction}, confirm token: ${confirmToken}`);
            
            // Try to submit the form
            const formUrl = new URL(formAction, 'https://drive.google.com').toString();
            console.log(`Submitting form to: ${formUrl}`);
            
            const formData = new URLSearchParams();
            formData.append('confirm', confirmToken);
            
            const formResponse = await fetch(formUrl, {
              method: 'POST',
              headers: {
                ...COMMON_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://drive.google.com',
                'Referer': `https://drive.google.com/uc?export=download&id=${id}`
              },
              body: formData.toString(),
              redirect: 'follow',
            });
            
            if (formResponse.ok && formResponse.body) {
              console.log('Successfully got video stream after form submission');
              return { response: formResponse };
            }
          }
          
          console.log('No confirm token found in HTML, trying next URL format');
          continue; // Try next URL format
        }
        
        // If we got a video response or binary data, return it
        if (contentType.startsWith('video/') || 
            contentType === 'application/octet-stream' ||
            contentType === 'application/x-mpegURL' ||
            contentType === 'application/vnd.apple.mpegurl' ||
            // Add more video MIME types if needed
            contentType.startsWith('audio/') ||
            contentType.includes('stream') ||
            // Check if the response is binary data
            (response.headers.has('content-disposition') && 
             response.headers.get('content-disposition')?.includes('filename='))) {
          
          console.log(`Successfully got video stream with content-type: ${contentType}`);
          
          // Create a new response with proper headers
          const responseHeaders = new Headers(response.headers);
          
          // Ensure we have a valid content type
          if (!contentType.startsWith('video/') && !contentType.includes('mpegurl')) {
            responseHeaders.set('content-type', 'video/mp4');
          }
          
          // Set CORS headers
          responseHeaders.set('Access-Control-Allow-Origin', '*');
          responseHeaders.set('Access-Control-Expose-Headers', '*');
          
          // Ensure we support range requests
          if (!responseHeaders.has('accept-ranges')) {
            responseHeaders.set('accept-ranges', 'bytes');
          }
          
          // Create a new response with the same body but updated headers
          const modifiedResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
          
          return { response: modifiedResponse };
        }
        
        console.log(`Unexpected content type: ${contentType}`);
        continue; // Try next URL format
      }
      
      // If we got an error status, log it and try next URL
      console.log(`Error status: ${response.status} ${response.statusText}`);
      
    } catch (error) {
      console.error(`Error fetching from URL:`, error);
      // Continue to next URL on error
    }
  }

  // If we've tried all URL formats and nothing worked
  return { 
    error: 'google-drive-failed-all-attempts', 
    details: 'Tüm denemeler başarısız oldu. Lütfen şunları kontrol edin:\n' +
             '1. Dosyanın "Linki olan herkes görüntüleyebilir" iznine sahip olduğundan emin olun\n' +
             '2. Dosya boyutunun 100MB\'dan küçük olduğundan emin olun (büyük dosyalar için Google Drive API anahtarı gerekebilir)\n' +
             '3. Google Drive bağlantısının doğru olduğundan emin olun\n' +
             '4. Eğer dosya büyükse, Google Drive\'ın işlemesi için birkaç dakika bekleyin\n' +
             '5. Alternatif olarak, videoyu YouTube\'a yükleyip oradan paylaşabilirsiniz',
    status: 400
  } as const;
};

const forwardRemoteResponse = (remoteResponse: Response) => {
  const headers = new Headers();
  
  // Copy important headers from the original response
  const headersToCopy = [
    'content-type',
    'content-length',
    'accept-ranges',
    'content-range',
    'content-disposition',
    'cache-control',
    'etag',
    'last-modified'
  ];

  headersToCopy.forEach((header) => {
    const value = remoteResponse.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  });

  // Ensure we have a content type
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/octet-stream');
  }

  // Set CORS headers
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Range');
  headers.set('Access-Control-Expose-Headers', headersToCopy.join(','));
  
  // Cache control
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');

  // For video streaming
  headers.set('Accept-Ranges', 'bytes');
  
  // Create a new response with the original body and our headers
  return new Response(remoteResponse.body, {
    status: remoteResponse.status,
    statusText: remoteResponse.statusText,
    headers
  });
};

const fetchAndForward = async (remoteUrl: string, rangeHeader?: string) => {
  try {
    const outgoingHeaders: Record<string, string> = {
      'User-Agent': USER_AGENT_HEADER,
      Accept: '*/*',
    };

    if (rangeHeader) {
      outgoingHeaders.Range = rangeHeader;
    }

    const remoteResponse = await fetch(remoteUrl, {
      headers: outgoingHeaders,
      redirect: 'follow',
    });

    if (!remoteResponse.ok || !remoteResponse.body) {
      const text = await remoteResponse.text().catch(() => undefined);
      return NextResponse.json({ message: 'Kaynak alınamadı.', details: text }, { status: remoteResponse.status });
    }

    const contentType = remoteResponse.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      const text = await remoteResponse.text().catch(() => undefined);
      return NextResponse.json({ message: 'Kaynak video olarak yayınlanamıyor.', details: text }, { status: 502 });
    }

    return forwardRemoteResponse(remoteResponse);
  } catch (error) {
    return NextResponse.json({ message: 'Kaynak getirilemedi.', details: (error as Error).message }, { status: 502 });
  }
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  let body: ProxyRequestBody | null = null;

  try {
    body = await request.json();
  } catch (error) {
    // JSON body olmayabilir, query parametrelerini kullanacağız
  }

  const source = body?.source ?? url.searchParams.get('source') ?? undefined;

  if (!source) {
    return NextResponse.json({ message: 'source alanı zorunludur.' }, { status: 400 });
  }

  const resolved = detectSource(body?.source ?? url.searchParams.get('source') ?? source);
  const provider = body?.provider ?? url.searchParams.get('provider') ?? resolved.provider;
  const identifier = body?.identifier ?? url.searchParams.get('identifier') ?? resolved.identifier;

  if (provider === 'unknown') {
    return NextResponse.json({ message: 'Desteklenmeyen kaynak bağlantısı.' }, { status: 400 });
  }

  const normalizedIdentifier = identifier && identifier.trim() ? identifier : source;

  if (provider === 'direct') {
    return NextResponse.json({ playbackUrl: source });
  }

  // Handle Vidmoly directly without backend proxy
  if (provider === 'vidmoly') {
    const slug = normalizedIdentifier.split('/').filter(Boolean).pop();
    if (!slug) {
      return NextResponse.json({ message: 'Geçersiz Vidmoly bağlantısı.' }, { status: 400 });
    }
    const playbackUrl = `/api/proxy?stream=1&provider=vidmoly&identifier=${encodeURIComponent(slug)}`;
    return NextResponse.json({ playbackUrl });
  }

  if (!BACKEND_PROXY_URL) {
    if (provider === 'google-drive') {
      const idMatch = normalizedIdentifier.match(GOOGLE_DRIVE_ID_REGEX);
      if (idMatch) {
        const playbackUrl = `/api/proxy?stream=1&provider=google-drive&identifier=${encodeURIComponent(idMatch[0])}`;
        return NextResponse.json({ playbackUrl });
      }
      return NextResponse.json({ message: 'Google Drive kimliği çözümlenemedi.' }, { status: 502 });
    }

    return NextResponse.json({ message: `${provider} sağlayıcısı için proxy servisine ihtiyaç var.` }, { status: 501 });
  }

  try {
    const upstreamResponse = await fetch(BACKEND_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider, source, identifier: normalizedIdentifier }),
    });

    if (!upstreamResponse.ok) {
      const text = await upstreamResponse.text();
      return NextResponse.json(
        { message: 'Proxy servisi hata döndürdü.', details: text },
        { status: upstreamResponse.status }
      );
    }

    const data = await upstreamResponse.json();

    if (!data || typeof data.playbackUrl !== 'string') {
      return NextResponse.json({ message: 'Proxy servisi beklenen veriyi döndürmedi.' }, { status: 502 });
    }

    return NextResponse.json({ playbackUrl: data.playbackUrl });
  } catch (error) {
    return NextResponse.json({ message: 'Proxy servisine ulaşılırken hata oluştu.' }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const streamFlag = url.searchParams.get('stream');
  
  if (!streamFlag) {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 });
  }

  const provider = url.searchParams.get('provider');
  const identifier = url.searchParams.get('identifier');
  const sourceParam = url.searchParams.get('source');

  if (!provider || !identifier) {
    return NextResponse.json({ 
      message: 'Provider ve identifier parametreleri zorunludur.' 
    }, { status: 400 });
  }

  // Get range header for partial content support
  const rangeHeader = request.headers.get('range') || 'bytes=0-';
  
  try {
    switch (provider) {
      case 'vidmoly': {
        console.log(`Fetching Vidmoly stream for: ${identifier}`);
        try {
          return await fetchVidmolyStream(identifier, rangeHeader);
        } catch (error) {
          console.error('Vidmoly stream error:', error);
          return NextResponse.json({
            message: 'Vidmoly videosu yüklenirken hata oluştu.',
            details: (error as Error).message
          }, { status: 500 });
        }
      }
      
      case 'google-drive': {
        // Extract Google Drive ID from the identifier
        const idMatch = identifier.match(GOOGLE_DRIVE_ID_REGEX);
        if (!idMatch) {
          return NextResponse.json({ 
            error: 'Geçersiz Google Drive ID formatı'
          }, { status: 400 });
        }
        
        // Fetch the Google Drive stream
        return fetchGoogleDriveStream(idMatch[0], rangeHeader);
      }
      
      case 'direct': {
        const remoteUrl = sourceParam || identifier;
        console.log(`Fetching direct URL: ${remoteUrl}`);
        return fetchAndForward(remoteUrl, rangeHeader);
      }
      
      case 'vidmoly': {
        console.log(`Fetching Vidmoly video with slug: ${identifier}`);
        try {
          return await fetchVidmolyStream(identifier, rangeHeader);
        } catch (error) {
          console.error('Error fetching from Vidmoly:', error);
          return NextResponse.json({
            message: 'Vidmoly videosı yüklenirken hata oluştu.',
            details: (error as Error).message
          }, { status: 500 });
        }
      }
      
      default: {
        if (!BACKEND_PROXY_URL) {
          return NextResponse.json({ 
            message: `${provider} sağlayıcısı için proxy servisine ihtiyaç var.` 
          }, { status: 501 });
        }

        console.log(`Forwarding to backend proxy for provider: ${provider}`);
        const upstreamResponse = await fetch(BACKEND_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            provider, 
            source: sourceParam || identifier, 
            identifier 
          }),
        });

        if (!upstreamResponse.ok) {
          const text = await upstreamResponse.text();
          console.error('Backend proxy error:', text);
          return NextResponse.json({ 
            message: 'Proxy servisi hata döndürdü.', 
            details: text 
          }, { 
            status: upstreamResponse.status 
          });
        }

        const data = await upstreamResponse.json();
        if (!data?.playbackUrl || typeof data.playbackUrl !== 'string') {
          return NextResponse.json({ 
            message: 'Proxy servisi beklenen veriyi döndürmedi.' 
          }, { status: 502 });
        }
        
        console.log(`Proxying to playback URL: ${data.playbackUrl}`);
        return fetchAndForward(data.playbackUrl, rangeHeader);
      }
    }
  } catch (error) {
    console.error('Unexpected error in proxy GET handler:', error);
    return NextResponse.json({
      message: 'Beklenmeyen bir hata oluştu.',
      details: (error as Error).message,
      stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined
    }, { status: 500 });
  }
}
