import { NextResponse } from 'next/server';

const PUBLIT_IO_API_KEY = 'oQmoHgv5Nega6zcAqTfj'; // oQmoHgv5Nega6zcAqTfj
const PUBLIT_IO_API_SECRET = 'H4rxg8oqnvlwzgBRThAL7vN6rgzR5cpo'; // H4rxg8oqnvlwzgBRThAL7vN6rgzR5cpo

// Function to generate auth signature for publit.io
function generateAuthSignature(apiKey: string, apiSecret: string, timestamp: string): string {
  const crypto = require('crypto');
  return crypto
    .createHash('sha1')
    .update(apiKey + timestamp + apiSecret)
    .digest('hex');
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json(
        { error: 'Dosya bulunamadı' },
        { status: 400 }
      );
    }

    // Generate timestamp and signature
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = generateAuthSignature(PUBLIT_IO_API_KEY, PUBLIT_IO_API_SECRET, timestamp);

    // 1. Get upload URL from publit.io
    const authResponse = await fetch('https://api.publit.io/v1/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${PUBLIT_IO_API_KEY}, Signature ${signature}, Timestamp ${timestamp}`,
      },
      body: JSON.stringify({
        title: file.name || 'video',
        public_id: `video_${Date.now()}`,
        privacy: 'public',
        tags: ['video', 'upload'],
        file_extension: file.name.split('.').pop() || 'mp4',
        size: file.size,
        mime_type: file.type || 'video/mp4',
      }),
    });

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('Publit.io auth error:', {
        status: authResponse.status,
        statusText: authResponse.statusText,
        error: errorText,
        url: 'https://api.publit.io/v1/files',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${PUBLIT_IO_API_KEY}, Signature [HIDDEN], Timestamp [HIDDEN]`,
        },
        body: {
          title: file.name || 'video',
          public_id: `video_${Date.now()}`,
          privacy: 'public',
          tags: ['video', 'upload'],
          file_extension: file.name.split('.').pop() || 'mp4',
          size: file.size,
          mime_type: file.type || 'video/mp4',
        },
      });
      
      // Try an alternative endpoint
      console.log('Trying alternative upload method...');
      return await tryAlternativeUpload(file);
    }

    const { upload_url, download_url } = await authResponse.json();

    if (!upload_url || !download_url) {
      console.error('Invalid response from publit.io:', { upload_url, download_url });
      return NextResponse.json(
        { error: 'Geçersiz yanıt alındı' },
        { status: 500 }
      );
    }

    // 2. Upload the file to the presigned URL
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    
    try {
      const uploadResponse = await fetch(upload_url, {
        method: 'PUT',
        body: fileBuffer,
        headers: {
          'Content-Type': file.type || 'video/mp4',
          'Content-Length': file.size.toString(),
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }
    } catch (uploadError) {
      console.error('Upload to presigned URL failed, trying direct upload...', uploadError);
      return await tryDirectUpload(file);
    }

    // 3. Return the public URL of the uploaded file
    return NextResponse.json({ 
      success: true,
      url: download_url,
      message: 'Dosya başarıyla yüklendi'
    });

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { 
        error: 'Dosya yüklenirken bir hata oluştu',
        details: error instanceof Error ? error.message : 'Bilinmeyen hata',
        code: 'UPLOAD_ERROR'
      },
      { status: 500 }
    );
  }
}

// Alternative direct upload method
async function tryDirectUpload(file: File) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('public_id', `video_${Date.now()}`);
    formData.append('tags', 'video,upload');
    formData.append('upload_preset', 'ml_default'); // You might need to set this up in your publit.io dashboard

    const response = await fetch('https://api.publit.io/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PUBLIT_IO_API_KEY}`,
      },
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Direct upload failed');
    }

    return NextResponse.json({
      success: true,
      url: result.secure_url || result.url,
      message: 'Dosya başarıyla yüklendi (direct upload)'
    });
  } catch (error) {
    console.error('Direct upload error:', error);
    return NextResponse.json(
      { 
        error: 'Direkt yükleme sırasında hata oluştu',
        details: error instanceof Error ? error.message : 'Bilinmeyen hata',
        code: 'DIRECT_UPLOAD_ERROR'
      },
      { status: 500 }
    );
  }
}

// Alternative upload method
async function tryAlternativeUpload(file: File) {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = generateAuthSignature(PUBLIT_IO_API_KEY, PUBLIT_IO_API_SECRET, timestamp);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', PUBLIT_IO_API_KEY);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('public_id', `video_${Date.now()}`);
    formData.append('tags', 'video,upload');

    const response = await fetch('https://api.publit.io/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PUBLIT_IO_API_KEY}, Signature ${signature}, Timestamp ${timestamp}`,
      },
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Alternative upload failed');
    }

    return NextResponse.json({
      success: true,
      url: result.url || result.secure_url,
      message: 'Dosya başarıyla yüklendi (alternative method)'
    });
  } catch (error) {
    console.error('Alternative upload error:', error);
    return NextResponse.json(
      { 
        error: 'Alternatif yükleme yöntemi de başarısız oldu',
        details: error instanceof Error ? error.message : 'Bilinmeyen hata',
        code: 'ALTERNATIVE_UPLOAD_ERROR',
        suggestion: 'Lütfen API anahtarlarınızı ve izinlerinizi kontrol edin.'
      },
      { status: 500 }
    );
  }
}
