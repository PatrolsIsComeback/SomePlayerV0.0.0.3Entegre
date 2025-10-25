import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import AccessCode from '@/models/AccessCode';

interface RequestBody {
  code: string;
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const { code } = await request.json() as RequestBody;

    if (!code) {
      return NextResponse.json(
        { success: false, message: 'Access code is required' },
        { status: 400 }
      );
    }

    // Find the access code
    const accessCode = await AccessCode.findOne({ code });

    if (!accessCode) {
      return NextResponse.json(
        { success: false, message: 'Invalid access code' },
        { status: 404 }
      );
    }

    // Check if code is already used
    if (accessCode.used) {
      return NextResponse.json(
        { success: false, message: 'This code has already been used' },
        { status: 400 }
      );
    }

    // Check if code is expired
    if (new Date() > new Date(accessCode.expiresAt)) {
      return NextResponse.json(
        { success: false, message: 'This code has expired' },
        { status: 400 }
      );
    }

    // Mark code as used
    accessCode.used = true;
    accessCode.usedAt = new Date();
    await accessCode.save();

    // Set a cookie or session to remember the user has access
    // For now, we'll just return success
    return NextResponse.json({
      success: true,
      message: 'Access granted',
      expiresAt: accessCode.expiresAt
    });

  } catch (error) {
    console.error('Error verifying access code:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
